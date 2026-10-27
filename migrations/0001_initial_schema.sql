-- CareFlow AI Database Schema Migration for Cloudflare D1

CREATE TABLE IF NOT EXISTS intakes (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  intake_id TEXT REFERENCES intakes(id),
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  final_urgency TEXT NOT NULL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  analysis_id TEXT REFERENCES analyses(id),
  channel TEXT,
  tone TEXT,
  draft_text TEXT,
  final_text TEXT,
  status TEXT DEFAULT 'DRAFT',   -- DRAFT | APPROVED | REJECTED
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  version TEXT PRIMARY KEY,
  system_prompt TEXT NOT NULL,
  change_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  prompt_version TEXT,
  urgency_accuracy REAL,
  field_accuracy REAL,
  json_valid_rate REAL,
  avg_latency_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial prompt versions if not exists
INSERT OR IGNORE INTO prompt_versions (version, system_prompt, change_note) VALUES 
('v1', 'You are a clinic assistant. Summarise this patient message.', 'Baseline: Simple open-ended summary instruction. Tends to produce unstructured text with missing fields.'),
('v2', 'You are an intake triage assistant. Extract patient details into strict JSON: chief_complaint, symptoms, duration, severity, medications, allergies, relevant_history, urgency (ROUTINE, SOON, URGENT), urgency_reason, red_flags, missing_information, clinician_summary. Use null or empty array if unstated.', 'Intermediate: Added strict JSON schema, required field definitions, and null handling.'),
('v3', 'You are CareFlow AI, a clinical intake safety & triage assistant. Extract structured facts into strict JSON matching the schema. Follow safety guardrails: NEVER diagnose, NEVER recommend medical treatment or drugs. Detect red flags rigorously (chest pain, dyspnea, anaphylaxis, severe hemorrhage, acute neurologic deficits). Apply calibrated urgency rubric (URGENT, SOON, ROUTINE). List missing clinical info as explicit clarifying questions.', 'Production Candidate: Few-shot examples, strict anti-diagnosis guardrails, explicit emergency rubric, and structured missing-information detection.');
