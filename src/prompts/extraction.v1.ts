/**
 * Prompt Version 1 (Baseline)
 * Simple, naive instruction without structured schema or safety constraints.
 * Demonstrates common failure modes: rambling free text, omitted fields,
 * subjective or missing urgency triage, and lack of clinical guardrails.
 */
export const EXTRACTION_PROMPT_V1 = {
  version: 'v1',
  name: 'v1 - Naive Baseline',
  changeNote: 'Baseline: Simple open-ended summary instruction. Tends to produce unstructured text with missing fields and uncalibrated urgency.',
  systemPrompt: `You are a clinic assistant. Summarise this patient message for the doctor. Mention what is wrong and how urgent it seems. Output JSON if you can.`,
  userPromptTemplate: (rawText: string) => `Patient message: "${rawText}"`
};
