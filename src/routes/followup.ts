import { Hono } from 'hono';
import { getAnalysisById, getDb, getMessageById, insertMessage, recordAuditLog, updateMessageStatus } from '../db/queries';
import { FollowUpInputSchema, MessageUpdateSchema } from '../schemas/analysis';
import { ClaudeService } from '../services/claude';
import { FollowUpService } from '../services/followup';
import { rateLimiter } from '../services/ratelimit';
import { MEDICAL_DISCLAIMER } from '../services/safety';
import { AppEnv } from '../types';

export const followupRoute = new Hono<{ Bindings: AppEnv }>();

// POST /api/followup - Generate follow-up message draft
followupRoute.post('/followup', async (c) => {
  try {
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
    const rateCheck = rateLimiter.checkLimit(clientIp);
    if (!rateCheck.allowed) {
      return c.json({ error: rateCheck.reason }, 429);
    }

    const body = await c.req.json();
    const parsed = FollowUpInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => i.message)
        },
        400
      );
    }

    const { analysis_id, channel, tone, reading_level } = parsed.data;
    const db = await getDb(c.env);

    // Retrieve analysis
    const analysisRow = await getAnalysisById(db, analysis_id);
    if (!analysisRow) {
      return c.json({ error: `Analysis ID '${analysis_id}' not found` }, 404);
    }

    const analysis = JSON.parse(analysisRow.result_json);
    const finalUrgency = analysisRow.final_urgency as 'ROUTINE' | 'SOON' | 'URGENT';

    // Initialize FollowUp service
    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });
    const followupService = new FollowUpService(claudeService);

    const draftResult = await followupService.generateDraft(analysis, finalUrgency, {
      channel,
      tone,
      reading_level
    });

    const message_id = 'msg_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

    await insertMessage(db, {
      id: message_id,
      analysis_id,
      channel,
      tone,
      draft_text: draftResult.draftText,
      final_text: draftResult.draftText,
      status: 'DRAFT'
    });

    await recordAuditLog(db, 'FOLLOWUP_DRAFTED', message_id, {
      analysis_id,
      channel,
      tone,
      status: 'DRAFT',
      latency_ms: draftResult.latencyMs,
      is_demo_mode: draftResult.isDemoMode
    });

    return c.json({
      success: true,
      message_id,
      analysis_id,
      channel,
      tone,
      draft_text: draftResult.draftText,
      status: 'DRAFT',
      latency_ms: draftResult.latencyMs,
      is_demo_mode: draftResult.isDemoMode,
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to generate follow-up draft', message: err.message }, 500);
  }
});

// PATCH /api/messages/:id - Clinician Review, Edit & Approval workflow
followupRoute.patch('/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const parsed = MessageUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => i.message)
        },
        400
      );
    }

    const { final_text, status } = parsed.data;
    const db = await getDb(c.env);

    const existing = await getMessageById(db, id);
    if (!existing) {
      return c.json({ error: `Message with ID '${id}' not found` }, 404);
    }

    const wasEdited = existing.draft_text !== final_text;

    await updateMessageStatus(db, id, final_text, status);

    await recordAuditLog(db, `MESSAGE_${status}`, id, {
      previous_status: existing.status,
      new_status: status,
      was_edited: wasEdited,
      channel: existing.channel
    });

    return c.json({
      success: true,
      message_id: id,
      status,
      final_text,
      was_edited: wasEdited,
      mock_sent: status === 'APPROVED',
      sent_at: status === 'APPROVED' ? new Date().toISOString() : null,
      feedback:
        status === 'APPROVED'
          ? `[MOCK SENT] Message successfully dispatched via ${existing.channel.toUpperCase()} to patient.`
          : status === 'REJECTED'
            ? 'Message was rejected and archived without dispatch.'
            : 'Message updated and saved in draft state.'
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to update message', message: err.message }, 500);
  }
});
