import { describe, expect, it } from 'vitest';
import {
  AnalysisResultSchema,
  FollowUpInputSchema,
  IntakeInputSchema,
  MessageUpdateSchema
} from '../src/schemas/analysis';

describe('CareFlow Schema Validation Tests', () => {
  it('validates a complete, compliant analysis result', () => {
    const validData = {
      chief_complaint: 'Acute sore throat',
      symptoms: ['sore throat', 'mild fever'],
      duration: '3 days',
      severity: 'mild',
      medications: ['Vitamin D'],
      allergies: ['Penicillin'],
      relevant_history: ['Seasonal allergies'],
      urgency: 'ROUTINE',
      urgency_reason: 'Self-limiting viral symptoms without respiratory compromise',
      red_flags: [],
      missing_information: ['Any swollen lymph nodes?'],
      clinician_summary: 'Patient reports 3-day history of sore throat.'
    };

    const parsed = AnalysisResultSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.urgency).toBe('ROUTINE');
      expect(parsed.data.severity).toBe('mild');
    }
  });

  it('populates sensible defaults for partial analysis results', () => {
    const partial = {
      chief_complaint: 'Headache'
    };

    const parsed = AnalysisResultSchema.safeParse(partial);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.symptoms).toEqual([]);
      expect(parsed.data.duration).toBeNull();
      expect(parsed.data.severity).toBeNull();
      expect(parsed.data.urgency).toBe('ROUTINE');
      expect(parsed.data.red_flags).toEqual([]);
    }
  });

  it('rejects invalid urgency levels', () => {
    const invalidUrgency = {
      chief_complaint: 'Cough',
      urgency: 'CRITICAL_HIGH' // Invalid enum
    };

    const parsed = AnalysisResultSchema.safeParse(invalidUrgency);
    expect(parsed.success).toBe(false);
  });

  it('validates intake inputs with length boundaries', () => {
    // Too short
    const tooShort = IntakeInputSchema.safeParse({ raw_text: 'hi' });
    expect(tooShort.success).toBe(false);

    // Valid
    const valid = IntakeInputSchema.safeParse({
      raw_text: "I've had an earache since yesterday.",
      mask_pii: true
    });
    expect(valid.success).toBe(true);
  });

  it('validates follow-up input channels and tones', () => {
    const valid = FollowUpInputSchema.safeParse({
      analysis_id: 'anlys_123',
      channel: 'sms',
      tone: 'warm'
    });
    expect(valid.success).toBe(true);

    const invalid = FollowUpInputSchema.safeParse({
      analysis_id: 'anlys_123',
      channel: 'telegram', // invalid channel
      tone: 'sarcastic' // invalid tone
    });
    expect(invalid.success).toBe(false);
  });

  it('validates clinician message status update', () => {
    const approved = MessageUpdateSchema.safeParse({
      final_text: 'Hello, your appointment is scheduled.',
      status: 'APPROVED'
    });
    expect(approved.success).toBe(true);

    const invalidStatus = MessageUpdateSchema.safeParse({
      final_text: 'Hello',
      status: 'PENDING_APPROVAL' // Not one of DRAFT | APPROVED | REJECTED
    });
    expect(invalidStatus.success).toBe(false);
  });

  it('validates SBAR clinical note generation schema', () => {
    const analysisWithSbar = {
      chief_complaint: 'Chest pain',
      symptoms: ['chest pain'],
      sbar: {
        situation: '62yo male with acute chest tightness',
        background: 'History of hypertension',
        assessment: 'URGENT triage priority',
        recommendation: 'Emergency medical services transfer'
      }
    };
    const parsed = AnalysisResultSchema.safeParse(analysisWithSbar);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sbar?.situation).toContain('62yo male');
      expect(parsed.data.sbar?.assessment).toContain('URGENT');
    }
  });
});
