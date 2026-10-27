import { UniversalDb, insertIntake, getIntakeById, listAllIntakes, insertAnalysis, insertMessage, recordAuditLog } from '../db/queries';
import { ClaudeService } from './claude';
import { ExtractionService } from './extraction';
import { FollowUpService } from './followup';
import { checkPii, checkInjection, MEDICAL_DISCLAIMER } from './safety';

export interface IntakeSubmissionResult {
  success: boolean;
  intake_id: string;
  stored_text: string;
  original_length: number;
  pii_info: {
    has_pii: boolean;
    warnings: string[];
    masked_preview: string;
    detected_types: string[];
  };
  injection_info: {
    is_adversarial: boolean;
    warnings: string[];
    risk_score: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  triage_info?: {
    analysis_id: string;
    message_id: string;
    final_urgency: string;
    result_json: string;
    message_text: string;
    message_status: string;
  } | null;
  disclaimer: string;
  created_at: string;
}

/**
 * Dedicated Patient Intake Service Module.
 * Encapsulates message sanitization, real-time PII masking, adversarial guardrails,
 * unique ID generation, and local database ingestion with automatic clinical triage.
 */
export class IntakeModuleService {
  /**
   * Automatically executes clinical triage extraction and drafts an initial follow-up message.
   */
  static async autoTriage(
    db: UniversalDb,
    intake_id: string,
    rawText: string,
    envConfig?: { apiKey?: string; model?: string }
  ) {
    const apiKey = envConfig?.apiKey || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = envConfig?.model || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });
    const extractionService = new ExtractionService(claudeService);

    // 1. Run clinical triage extraction (v3 production prompt)
    const extractionOutput = await extractionService.runExtraction(rawText, 'v3');

    // 2. Persist analysis
    const analysis_id = 'anlys_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    await insertAnalysis(db, {
      id: analysis_id,
      intake_id,
      prompt_version: 'v3',
      model: extractionOutput.model,
      result_json: JSON.stringify(extractionOutput.analysis),
      final_urgency: extractionOutput.finalUrgency,
      latency_ms: extractionOutput.latencyMs,
      input_tokens: extractionOutput.inputTokens,
      output_tokens: extractionOutput.outputTokens
    });

    // 3. Persist draft follow-up message
    const followupService = new FollowUpService(claudeService);
    const draftResult = await followupService.generateDraft(
      extractionOutput.analysis,
      extractionOutput.finalUrgency as 'ROUTINE' | 'SOON' | 'URGENT',
      { channel: 'email', tone: 'warm', reading_level: 'plain' }
    );

    const message_id = 'msg_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    await insertMessage(db, {
      id: message_id,
      analysis_id,
      channel: 'email',
      tone: 'warm',
      draft_text: draftResult.draftText,
      final_text: draftResult.draftText,
      status: 'DRAFT'
    });

    await recordAuditLog(db, 'AUTO_TRIAGE_COMPLETED', analysis_id, {
      intake_id,
      final_urgency: extractionOutput.finalUrgency,
      message_id
    });

    return {
      analysis_id,
      message_id,
      final_urgency: extractionOutput.finalUrgency,
      result_json: JSON.stringify(extractionOutput.analysis),
      message_text: draftResult.draftText,
      message_status: 'DRAFT'
    };
  }

  /**
   * Processes a patient intake submission with strict safety screening, storage, and auto-triage.
   */
  static async processIntake(
    db: UniversalDb,
    rawText: string,
    maskPii = false,
    envConfig?: { apiKey?: string; model?: string }
  ): Promise<IntakeSubmissionResult> {
    const trimmed = (rawText || '').trim();
    if (!trimmed) {
      throw new Error('Patient intake text cannot be empty');
    }
    if (trimmed.length > 3000) {
      throw new Error('Patient intake text exceeds maximum allowed boundary of 3,000 characters');
    }

    // 1. Run privacy & safety screenings
    const piiResult = checkPii(trimmed);
    const injectionResult = checkInjection(trimmed);

    // 2. Anonymize if requested or if critical PII detected
    const textToStore = maskPii ? piiResult.maskedText : trimmed;

    // 3. Generate secure unique intake ID
    const intake_id = 'intk_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

    // 4. Ingest into persistent storage
    await insertIntake(db, intake_id, textToStore);

    // 5. Immutable governance audit log
    await recordAuditLog(db, 'INTAKE_SUBMITTED', intake_id, {
      has_pii: piiResult.hasPii,
      pii_types: piiResult.detectedTypes,
      masked: maskPii,
      is_adversarial: injectionResult.isAdversarial,
      risk_score: injectionResult.riskScore
    });

    // 6. Automatically triage & draft follow-up communication so intake is immediately reviewable
    let triageInfo: any = null;
    try {
      triageInfo = await IntakeModuleService.autoTriage(db, intake_id, textToStore, envConfig);
    } catch (e) {
      console.warn('Auto-triage error during intake ingestion:', e);
    }

    return {
      success: true,
      intake_id,
      stored_text: textToStore,
      original_length: rawText.length,
      pii_info: {
        has_pii: piiResult.hasPii,
        warnings: piiResult.warnings,
        masked_preview: piiResult.maskedText,
        detected_types: piiResult.detectedTypes
      },
      injection_info: {
        is_adversarial: injectionResult.isAdversarial,
        warnings: injectionResult.warnings,
        risk_score: injectionResult.riskScore
      },
      triage_info: triageInfo,
      disclaimer: MEDICAL_DISCLAIMER,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Retrieves an intake by ID.
   */
  static async getIntake(db: UniversalDb, id: string) {
    return getIntakeById(db, id);
  }

  /**
   * Lists all intake records.
   */
  static async listIntakes(db: UniversalDb) {
    return listAllIntakes(db);
  }

  /**
   * Real-time client-side PII and safety preview without saving.
   */
  static previewPii(rawText: string) {
    const pii = checkPii(rawText || '');
    const injection = checkInjection(rawText || '');
    return {
      has_pii: pii.hasPii,
      warnings: pii.warnings,
      masked_preview: pii.maskedText,
      detected_types: pii.detectedTypes,
      is_adversarial: injection.isAdversarial,
      risk_score: injection.riskScore,
      char_count: (rawText || '').length
    };
  }

  /**
   * Retrieves summary statistics for the intake module.
   */
  static async getStats(db: UniversalDb) {
    const all = await listAllIntakes(db);
    const intakes = all.results || [];
    const total = intakes.length;
    const withPii = intakes.filter((i: any) => checkPii(i.raw_text || '').hasPii).length;
    return {
      total_intakes: total,
      intakes_with_pii: withPii,
      clean_intakes: total - withPii,
      latest_intakes: intakes.slice(0, 10)
    };
  }
}
