import { EXTRACTION_PROMPT_V1 } from '../prompts/extraction.v1';
import { EXTRACTION_PROMPT_V2 } from '../prompts/extraction.v2';
import { EXTRACTION_PROMPT_V3 } from '../prompts/extraction.v3';
import { AnalysisResult, AnalysisResultSchema } from '../schemas/analysis';
import { ClaudeCallResult, ClaudeService } from './claude';
import { combineUrgency, evaluateRedFlags } from './triage';

export interface ExtractionOutput {
  analysis: AnalysisResult;
  finalUrgency: 'ROUTINE' | 'SOON' | 'URGENT';
  wasOverridden: boolean;
  overrideReason?: string;
  emergencyNotice: string | null;
  rawResponse: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  promptVersion: string;
  isDemoMode: boolean;
}

export class ExtractionService {
  private claudeService: ClaudeService;

  constructor(claudeService?: ClaudeService) {
    this.claudeService = claudeService || new ClaudeService();
  }

  getPromptDef(version: string, customSystemPrompt?: string) {
    if (version === 'vCustom' && customSystemPrompt) {
      return {
        version: 'vCustom',
        name: 'Custom Prompt Experiment',
        changeNote: 'User-configured custom system prompt evaluated in Prompt Lab.',
        systemPrompt: customSystemPrompt,
        userPromptTemplate: (rawText: string) => `Extract the following patient intake message into strict JSON:\n"${rawText}"`
      };
    }
    switch (version) {
      case 'v1':
        return EXTRACTION_PROMPT_V1;
      case 'v2':
        return EXTRACTION_PROMPT_V2;
      case 'v3':
      default:
        return EXTRACTION_PROMPT_V3;
    }
  }

  async runExtraction(
    rawText: string,
    version: string = 'v3',
    customSystemPrompt?: string
  ): Promise<ExtractionOutput> {
    const promptDef = this.getPromptDef(version, customSystemPrompt);
    const userPrompt = promptDef.userPromptTemplate(rawText);

    // Call Claude (live or synthetic demo)
    const claudeResult: ClaudeCallResult = await this.claudeService.extractPatientData(
      promptDef.systemPrompt,
      userPrompt,
      rawText,
      version as any
    );

    // Validate and normalize output with Zod
    let validatedAnalysis: AnalysisResult;
    try {
      validatedAnalysis = AnalysisResultSchema.parse(claudeResult.parsedJson);
    } catch (zodErr) {
      // Fallback normalization if schema has minor missing fields
      const partial = claudeResult.parsedJson || {};
      validatedAnalysis = {
        chief_complaint: String(partial.chief_complaint || 'Intake summary'),
        symptoms: Array.isArray(partial.symptoms) ? partial.symptoms.map(String) : [],
        duration: partial.duration ? String(partial.duration) : null,
        severity: ['mild', 'moderate', 'severe'].includes(partial.severity) ? partial.severity : null,
        medications: Array.isArray(partial.medications) ? partial.medications.map(String) : [],
        allergies: Array.isArray(partial.allergies) ? partial.allergies.map(String) : [],
        relevant_history: Array.isArray(partial.relevant_history) ? partial.relevant_history.map(String) : [],
        urgency: ['ROUTINE', 'SOON', 'URGENT'].includes(partial.urgency) ? partial.urgency : 'ROUTINE',
        urgency_reason: String(partial.urgency_reason || 'Standard evaluation'),
        red_flags: Array.isArray(partial.red_flags) ? partial.red_flags.map(String) : [],
        missing_information: Array.isArray(partial.missing_information) ? partial.missing_information.map(String) : [],
        clinician_summary: String(partial.clinician_summary || rawText.slice(0, 80))
      };
    }

    // Algorithmic Red-Flag Safety Net Check
    const ruleEval = evaluateRedFlags(rawText);

    // Merge any algorithmic red flags detected that AI might have missed
    const allRedFlags = Array.from(new Set([...validatedAnalysis.red_flags, ...ruleEval.redFlagsDetected.map((m) => m.keyword)]));
    validatedAnalysis.red_flags = allRedFlags;

    // Combine urgency: final urgency is MAX(ai_urgency, rule_urgency)
    const urgencyResult = combineUrgency(validatedAnalysis.urgency, ruleEval.ruleUrgency);
    const finalUrgency = urgencyResult.finalUrgency;

    let emergencyNotice: string | null = null;
    if (finalUrgency === 'URGENT') {
      emergencyNotice = ruleEval.emergencyAdvice ||
        'Immediate clinical attention is required. If in critical distress, call 911 / 999 / 000 immediately.';
    }

    return {
      analysis: validatedAnalysis,
      finalUrgency,
      wasOverridden: urgencyResult.wasOverridden,
      overrideReason: urgencyResult.overrideReason,
      emergencyNotice,
      rawResponse: claudeResult.rawResponse,
      latencyMs: claudeResult.latencyMs,
      inputTokens: claudeResult.inputTokens,
      outputTokens: claudeResult.outputTokens,
      model: claudeResult.model,
      promptVersion: version,
      isDemoMode: claudeResult.isDemoMode
    };
  }
}
