import { Hono } from 'hono';
import { getDb, getIntakeById, listAllIntakes } from '../db/queries';
import { IntakeInputSchema } from '../schemas/analysis';
import { IntakeModuleService } from '../services/intake';
import { MEDICAL_DISCLAIMER } from '../services/safety';
import { AppEnv } from '../types';

export const intakeRoute = new Hono<{ Bindings: AppEnv }>();

// POST /api/intake - Submit raw patient message via Intake Module
intakeRoute.post('/intake', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = IntakeInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => i.message)
        },
        400
      );
    }

    const { raw_text, mask_pii } = parsed.data;
    const db = await getDb(c.env);
    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');

    // Call dedicated Patient Intake Module Service with auto-triage
    const intakeResult = await IntakeModuleService.processIntake(db, raw_text, mask_pii, { apiKey, model });
    return c.json(intakeResult);
  } catch (err: any) {
    return c.json({ error: 'Internal server error', message: err.message }, 500);
  }
});

// POST or GET /api/intakes/:id/auto-triage - On-demand clinical triage for unanalyzed intakes
intakeRoute.all('/intakes/:id/auto-triage', async (c) => {
  try {
    const id = c.req.param('id');
    const db = await getDb(c.env);
    const intake = await getIntakeById(db, id);
    if (!intake) {
      return c.json({ error: `Intake ID '${id}' not found` }, 404);
    }

    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');

    const triageInfo = await IntakeModuleService.autoTriage(db, id, intake.raw_text, { apiKey, model });
    return c.json({ success: true, ...triageInfo });
  } catch (err: any) {
    return c.json({ error: 'Auto-triage failed', message: err.message }, 500);
  }
});

// POST or GET /api/intakes/batch-triage - Automatically triage all pending unanalyzed intakes
intakeRoute.all('/intakes/batch-triage', async (c) => {
  try {
    const db = await getDb(c.env);
    const unanalyzedRows = await db
      .prepare('SELECT id, raw_text FROM intakes WHERE id NOT IN (SELECT intake_id FROM analyses WHERE intake_id IS NOT NULL)')
      .all<any>();

    const rows = unanalyzedRows.results || [];
    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');

    const triaged = [];
    for (const r of rows) {
      try {
        const info = await IntakeModuleService.autoTriage(db, r.id, r.raw_text, { apiKey, model });
        triaged.push({ id: r.id, ...info });
      } catch (err: any) {
        console.warn(`Failed to auto-triage intake ${r.id}:`, err);
      }
    }

    return c.json({
      success: true,
      triaged_count: triaged.length,
      triaged
    });
  } catch (err: any) {
    return c.json({ error: 'Batch triage failed', message: err.message }, 500);
  }
});

// POST /api/intake/preview - Live PII & safety preview without persisting
intakeRoute.post('/intake/preview', async (c) => {
  try {
    const body = await c.req.json();
    const preview = IntakeModuleService.previewPii(body.raw_text || '');
    return c.json({ success: true, ...preview });
  } catch (err: any) {
    return c.json({ error: 'Failed to preview intake', message: err.message }, 500);
  }
});

// GET /api/intake/stats - High-level intake analytics
intakeRoute.get('/intake/stats', async (c) => {
  try {
    const db = await getDb(c.env);
    const stats = await IntakeModuleService.getStats(db);
    return c.json({ success: true, ...stats });
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch intake stats', message: err.message }, 500);
  }
});


// GET /api/intakes - List all intakes with urgency & status
intakeRoute.get('/intakes', async (c) => {
  try {
    const db = await getDb(c.env);
    const result = await listAllIntakes(db);
    return c.json({
      success: true,
      intakes: result.results || []
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch intakes', message: err.message }, 500);
  }
});

// GET /api/intakes/:id - Detail view of a single intake
intakeRoute.get('/intakes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = await getDb(c.env);
    const intake = await getIntakeById(db, id);

    if (!intake) {
      return c.json({ error: 'Intake not found' }, 404);
    }

    // Get analyses for this intake
    const analyses = await db
      .prepare('SELECT * FROM analyses WHERE intake_id = ? ORDER BY created_at DESC')
      .bind(id)
      .all<any>();

    // Get messages for these analyses
    const messages = await db
      .prepare(
        `SELECT m.* FROM messages m 
         JOIN analyses a ON a.id = m.analysis_id 
         WHERE a.intake_id = ? ORDER BY m.created_at DESC`
      )
      .bind(id)
      .all<any>();

    return c.json({
      success: true,
      intake,
      analyses: analyses.results || [],
      messages: messages.results || [],
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch intake details', message: err.message }, 500);
  }
});
