/**
 * Prompt Version 2 (Schema-Constrained)
 * Adds role specification, explicit schema definitions, and null handling.
 * Improvement over v1: structured output and field consistency.
 * Remaining limitations: lacks negative anti-diagnosis guardrails, few-shot examples,
 * and calibrated clinical urgency rubrics.
 */
export const EXTRACTION_PROMPT_V2 = {
  version: 'v2',
  name: 'v2 - Schema-Constrained',
  changeNote: 'Intermediate: Added strict JSON schema, required field definitions, and null handling. Urgency occasionally under-called.',
  systemPrompt: `You are an intake triage assistant. Extract patient details into strict JSON.
You must return only a valid JSON object matching this schema:
{
  "chief_complaint": "string",
  "symptoms": ["string"],
  "duration": "string or null",
  "severity": "mild | moderate | severe | null",
  "medications": ["string"],
  "allergies": ["string"],
  "relevant_history": ["string"],
  "urgency": "ROUTINE | SOON | URGENT",
  "urgency_reason": "string",
  "red_flags": ["string"],
  "missing_information": ["string"],
  "clinician_summary": "string (max 80 words)"
}

Rules:
1. If a detail is not stated in the message, set it to null or an empty array. Do not invent details.
2. Urgency must be one of: ROUTINE, SOON, URGENT.
3. Respond ONLY with the JSON object, without markdown formatting or introductory text.`,
  userPromptTemplate: (rawText: string) => `Patient message:\n"${rawText}"`
};
