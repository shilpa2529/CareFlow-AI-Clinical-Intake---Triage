import { Hono } from 'hono';
import {
  getAnalysisById,
  getDb,
  getIntakeById,
  insertAnalysis,
  recordAuditLog
} from '../db/queries';
import {
  AnalyzeInputSchema,
  CopilotInputSchema,
  LiteracyInputSchema
} from '../schemas/analysis';
import { ClaudeService } from '../services/claude';
import { ExtractionService } from '../services/extraction';
import { analyzeHealthLiteracy } from '../services/literacy';
import { rateLimiter } from '../services/ratelimit';
import { MEDICAL_DISCLAIMER } from '../services/safety';
import { AppEnv } from '../types';

export const analyzeRoute = new Hono<{ Bindings: AppEnv }>();

// POST /api/analyze - Run extraction & triage
analyzeRoute.post('/analyze', async (c) => {
  try {
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
    const rateCheck = rateLimiter.checkLimit(clientIp);
    if (!rateCheck.allowed) {
      return c.json({ error: rateCheck.reason, remaining: rateCheck.remaining }, 429);
    }

    const body = await c.req.json();
    const parsed = AnalyzeInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => i.message)
        },
        400
      );
    }

    const { intake_id, prompt_version } = parsed.data;
    const db = await getDb(c.env);

    // Retrieve intake record
    const intake = await getIntakeById(db, intake_id);
    if (!intake) {
      return c.json({ error: `Intake ID '${intake_id}' not found` }, 404);
    }

    // Initialize Claude & Extraction services
    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });
    const extractionService = new ExtractionService(claudeService);

    // Run extraction & triage
    const extractionOutput = await extractionService.runExtraction(intake.raw_text, prompt_version);

    // Persist analysis in database
    const analysis_id = 'anlys_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    await insertAnalysis(db, {
      id: analysis_id,
      intake_id,
      prompt_version,
      model: extractionOutput.model,
      result_json: JSON.stringify(extractionOutput.analysis),
      final_urgency: extractionOutput.finalUrgency,
      latency_ms: extractionOutput.latencyMs,
      input_tokens: extractionOutput.inputTokens,
      output_tokens: extractionOutput.outputTokens
    });

    // Record in audit log
    await recordAuditLog(db, 'ANALYSIS_COMPLETED', analysis_id, {
      intake_id,
      prompt_version,
      model: extractionOutput.model,
      final_urgency: extractionOutput.finalUrgency,
      was_overridden: extractionOutput.wasOverridden,
      red_flags_count: extractionOutput.analysis.red_flags.length,
      latency_ms: extractionOutput.latencyMs,
      is_demo_mode: extractionOutput.isDemoMode
    });

    return c.json({
      success: true,
      analysis_id,
      intake_id,
      prompt_version,
      model: extractionOutput.model,
      final_urgency: extractionOutput.finalUrgency,
      was_overridden: extractionOutput.wasOverridden,
      override_reason: extractionOutput.overrideReason,
      emergency_notice: extractionOutput.emergencyNotice,
      analysis: extractionOutput.analysis,
      latency_ms: extractionOutput.latencyMs,
      input_tokens: extractionOutput.inputTokens,
      output_tokens: extractionOutput.outputTokens,
      is_demo_mode: extractionOutput.isDemoMode,
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Analysis failed', message: err.message }, 500);
  }
});

// POST /api/copilot - Ask the Clinical Copilot assistant a question about an intake
analyzeRoute.post('/copilot', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CopilotInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues.map((i) => i.message) }, 400);
    }

    const { analysis_id, intake_id, raw_text, question } = parsed.data;
    const db = await getDb(c.env);

    let analysis: any = {
      chief_complaint: 'Clinical intake presentation',
      symptoms: [],
      duration: 'recent',
      severity: null,
      medications: [],
      allergies: [],
      relevant_history: [],
      urgency: 'ROUTINE',
      urgency_reason: 'Routine triage review',
      red_flags: [],
      missing_information: []
    };
    let patientRawText = raw_text || '';

    // If analysis_id is provided, try looking up from DB
    if (analysis_id) {
      const analysisRow = await getAnalysisById(db, analysis_id).catch(() => null);
      if (analysisRow && analysisRow.result_json) {
        try {
          analysis = JSON.parse(analysisRow.result_json);
        } catch (_) {}
        if (!patientRawText && analysisRow.intake_id) {
          const intakeRow = await getIntakeById(db, analysisRow.intake_id).catch(() => null);
          if (intakeRow) patientRawText = intakeRow.raw_text;
        }
      }
    } else if (intake_id) {
      const intakeRow = await getIntakeById(db, intake_id).catch(() => null);
      if (intakeRow) patientRawText = intakeRow.raw_text;
    }

    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });

    const copilotResult = await claudeService.askCopilot(analysis, question, patientRawText);

    if (analysis_id) {
      await recordAuditLog(db, 'COPILOT_QUERY', analysis_id, {
        question,
        latency_ms: copilotResult.latencyMs
      }).catch(() => null);
    }

    return c.json({
      success: true,
      analysis_id: analysis_id || 'copilot_session',
      question,
      answer: copilotResult.answer,
      latency_ms: copilotResult.latencyMs,
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Copilot query failed', message: err.message }, 500);
  }
});

// POST /api/literacy - Calculate Health Literacy & Readability Metrics
analyzeRoute.post('/literacy', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = LiteracyInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues.map((i) => i.message) }, 400);
    }

    const metrics = analyzeHealthLiteracy(parsed.data.text);
    return c.json({
      success: true,
      metrics
    });
  } catch (err: any) {
    return c.json({ error: 'Literacy analysis failed', message: err.message }, 500);
  }
});
