import { FOLLOWUP_PROMPT_V1 } from '../prompts/followup.v1';
import { AnalysisResult } from '../schemas/analysis';
import { ClaudeService } from './claude';

export interface FollowUpOptions {
  channel: 'email' | 'sms';
  tone: 'warm' | 'formal' | 'urgent_alert' | 'spanish_translation';
  reading_level?: 'plain' | 'clinical';
}

export interface FollowUpDraftResult {
  draftText: string;
  channel: 'email' | 'sms';
  tone: 'warm' | 'formal' | 'urgent_alert' | 'spanish_translation';
  latencyMs: number;
  isDemoMode: boolean;
}

export class FollowUpService {
  private claudeService: ClaudeService;

  constructor(claudeService?: ClaudeService) {
    this.claudeService = claudeService || new ClaudeService();
  }

  async generateDraft(
    analysis: AnalysisResult,
    finalUrgency: 'ROUTINE' | 'SOON' | 'URGENT',
    options: FollowUpOptions
  ): Promise<FollowUpDraftResult> {
    const userPrompt = FOLLOWUP_PROMPT_V1.userPromptTemplate({
      channel: options.channel,
      tone: options.tone,
      readingLevel: options.reading_level || 'plain',
      patientSummary: analysis.clinician_summary,
      urgency: finalUrgency,
      missingInfo: analysis.missing_information,
      redFlags: analysis.red_flags
    });

    const result = await this.claudeService.draftFollowUp(
      FOLLOWUP_PROMPT_V1.systemPrompt,
      userPrompt,
      options.channel,
      options.tone,
      finalUrgency,
      analysis.missing_information,
      analysis.red_flags
    );

    return {
      draftText: result.draftText,
      channel: options.channel,
      tone: options.tone,
      latencyMs: result.latencyMs,
      isDemoMode: result.isDemoMode
    };
  }
}
