import { Hono } from 'hono';
import { EXTRACTION_PROMPT_V1 } from '../prompts/extraction.v1';
import { EXTRACTION_PROMPT_V2 } from '../prompts/extraction.v2';
import { EXTRACTION_PROMPT_V3 } from '../prompts/extraction.v3';
import { CompareInputSchema } from '../schemas/analysis';
import { ClaudeService } from '../services/claude';
import { ExtractionService } from '../services/extraction';
import { MEDICAL_DISCLAIMER } from '../services/safety';
import { AppEnv } from '../types';

export const labRoute = new Hono<{ Bindings: AppEnv }>();

// GET /api/lab/versions - List available prompt versions with notes
labRoute.get('/lab/versions', (c) => {
  return c.json({
    success: true,
    versions: [
      {
        version: EXTRACTION_PROMPT_V1.version,
        name: EXTRACTION_PROMPT_V1.name,
        changeNote: EXTRACTION_PROMPT_V1.changeNote,
        systemPrompt: EXTRACTION_PROMPT_V1.systemPrompt
      },
      {
        version: EXTRACTION_PROMPT_V2.version,
        name: EXTRACTION_PROMPT_V2.name,
        changeNote: EXTRACTION_PROMPT_V2.changeNote,
        systemPrompt: EXTRACTION_PROMPT_V2.systemPrompt
      },
      {
        version: EXTRACTION_PROMPT_V3.version,
        name: EXTRACTION_PROMPT_V3.name,
        changeNote: EXTRACTION_PROMPT_V3.changeNote,
        systemPrompt: EXTRACTION_PROMPT_V3.systemPrompt
      }
    ]
  });
});

// POST /api/lab/compare - Run one input across multiple prompt versions side by side
labRoute.post('/lab/compare', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CompareInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => i.message)
        },
        400
      );
    }

    const { raw_text, versions, custom_system_prompt } = parsed.data;

    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });
    const extractionService = new ExtractionService(claudeService);

    // Run parallel extractions across each selected prompt version
    const runs = await Promise.all(
      versions.map(async (ver) => {
        const start = Date.now();
        try {
          const result = await extractionService.runExtraction(raw_text, ver, custom_system_prompt);
          return {
            version: ver,
            success: true,
            finalUrgency: result.finalUrgency,
            analysis: result.analysis,
            latencyMs: result.latencyMs,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            model: result.model,
            wasOverridden: result.wasOverridden,
            overrideReason: result.overrideReason,
            emergencyNotice: result.emergencyNotice,
            isDemoMode: result.isDemoMode
          };
        } catch (err: any) {
          return {
            version: ver,
            success: false,
            error: err.message,
            latencyMs: Date.now() - start
          };
        }
      })
    );

    return c.json({
      success: true,
      raw_text,
      results: runs,
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Prompt lab comparison failed', message: err.message }, 500);
  }
});
