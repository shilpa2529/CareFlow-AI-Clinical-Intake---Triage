import { z } from 'zod';

export const UrgencyEnum = z.enum(['ROUTINE', 'SOON', 'URGENT']);
export type UrgencyLevel = z.infer<typeof UrgencyEnum>;

export const SeverityEnum = z.enum(['mild', 'moderate', 'severe']).nullable();
export type SeverityLevel = z.infer<typeof SeverityEnum>;

export const SbarSchema = z.object({
  situation: z.string().default(''),
  background: z.string().default(''),
  assessment: z.string().default(''),
  recommendation: z.string().default('')
});

export type SbarNote = z.infer<typeof SbarSchema>;

export const AnalysisResultSchema = z.object({
  chief_complaint: z.string().default('Unspecified complaint'),
  symptoms: z.array(z.string()).default([]),
  duration: z.string().nullable().default(null),
  severity: SeverityEnum.default(null),
  medications: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  relevant_history: z.array(z.string()).default([]),
  urgency: UrgencyEnum.default('ROUTINE'),
  urgency_reason: z.string().default('Routine clinical review'),
  red_flags: z.array(z.string()).default([]),
  missing_information: z.array(z.string()).default([]),
  clinician_summary: z.string().default('Clinical summary pending review'),
  sbar: SbarSchema.optional()
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const IntakeInputSchema = z.object({
  raw_text: z.string().min(3, 'Patient text must be at least 3 characters long').max(4000, 'Text exceeds maximum character limit'),
  mask_pii: z.boolean().optional().default(false)
});

export const AnalyzeInputSchema = z.object({
  intake_id: z.string().min(1, 'intake_id is required'),
  prompt_version: z.string().default('v3')
});

export const FollowUpInputSchema = z.object({
  analysis_id: z.string().min(1, 'analysis_id is required'),
  channel: z.enum(['email', 'sms']).default('email'),
  tone: z.enum(['warm', 'formal', 'urgent_alert', 'spanish_translation']).default('warm'),
  reading_level: z.enum(['plain', 'clinical']).optional().default('plain')
});

export const MessageUpdateSchema = z.object({
  final_text: z.string().min(1, 'Message text cannot be empty'),
  status: z.enum(['DRAFT', 'APPROVED', 'REJECTED'])
});

export const CompareInputSchema = z.object({
  raw_text: z.string().min(3, 'Input text must be at least 3 characters'),
  versions: z.array(z.string()).min(1).default(['v1', 'v2', 'v3']),
  custom_system_prompt: z.string().optional()
});

export const EvalRunInputSchema = z.object({
  prompt_version: z.enum(['v1', 'v2', 'v3']).default('v3'),
  max_cases: z.number().int().positive().optional()
});

export const CopilotInputSchema = z.object({
  analysis_id: z.string().optional(),
  intake_id: z.string().optional(),
  raw_text: z.string().optional(),
  question: z.string().min(2, 'Question must be at least 2 characters')
});

export const LiteracyInputSchema = z.object({
  text: z.string().min(1, 'Text is required')
});
