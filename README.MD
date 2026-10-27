CareFlow AI — Patient Intake & Follow-Up Automation

Prototype for demonstration only. Not a medical device. Does not provide medical advice, diagnosis, or treatment. Uses synthetic (fake) patient data only.

CareFlow AI turns messy, free-text patient intake messages into a structured, clinician-ready summary with an urgency flag, then drafts a personalised follow-up message, all in a few seconds. It is built to show how AI can remove manual admin work in a clinic while keeping a human in the loop.

Domain: Healthcare | Focus areas: Automation + Innovation | Built for: AI Skills & Prompt Engineering Assessment (AI Growth & Automation Associate)

### 🌐 Live Cloudflare Production Deployment
- **Clinician Triage Queue**: [https://careflow-ai.shilpakonnoju.workers.dev/dashboard.html](https://careflow-ai.shilpakonnoju.workers.dev/dashboard.html)
- **Patient Intake Portal**: [https://careflow-ai.shilpakonnoju.workers.dev/intake.html](https://careflow-ai.shilpakonnoju.workers.dev/intake.html)
- **Prompt Engineering Lab**: [https://careflow-ai.shilpakonnoju.workers.dev/lab.html](https://careflow-ai.shilpakonnoju.workers.dev/lab.html)
- **Automated Benchmark Eval**: [https://careflow-ai.shilpakonnoju.workers.dev/eval.html](https://careflow-ai.shilpakonnoju.workers.dev/eval.html)
- **API Health Check**: [https://careflow-ai.shilpakonnoju.workers.dev/api/health](https://careflow-ai.shilpakonnoju.workers.dev/api/health)

1. Problem Statement

Clinic front-desk staff and nurses spend significant time reading unstructured intake messages (emails, web forms, WhatsApp texts), pulling out the key facts, deciding who needs attention first, and writing follow-up messages by hand. This causes:

Slow response times and inconsistent triage ordering
Missing information that only gets noticed at the appointment
Repetitive, copy-paste follow-up messages
Clinician time wasted reading long, rambling text
2. Solution Overview
Raw patient text ──► Safety & PII guard ──► AI extraction (structured JSON)
                                                  │
                                                  ▼
                                  Urgency flag + red-flag detection
                                                  │
                                                  ▼
                              Missing-information question generator
                                                  │
                                                  ▼
                                  AI follow-up message drafter
                                                  │
                                                  ▼
                       Clinician dashboard (review → edit → approve → send)

Human-in-the-loop by design: AI never sends anything automatically. A staff member reviews, edits, and approves every summary and message.

3. Key Features
#	Feature	Description
1	Intake capture	Paste or submit free-text patient messages (symptoms, history, concerns)
2	Structured summary	Chief complaint, symptoms, duration, severity, medications, allergies, relevant history
3	Urgency triage flag	ROUTINE, SOON, or URGENT with a plain-language reason
4	Red-flag detection	Highlights phrases that need immediate human attention (e.g. chest pain, breathing difficulty)
5	Missing-info detector	Lists what the clinic still needs to ask (e.g. "no duration given")
6	Follow-up drafter	Polite, plain-language message with the missing-info questions; selectable tone and channel (email/SMS)
7	Review & approve	Staff edit and approve before anything is "sent" (mock send in prototype)
8	Prompt version lab	Run the same intake through prompt v1, v2, v3 side by side to show iterative improvement
9	Evaluation harness	Batch-test 20+ synthetic cases and score accuracy automatically
10	Audit log	Every AI call stored with prompt version, input, output, latency, and reviewer action
4. Tech Stack
Layer	Technology	Why
Runtime / hosting	Cloudflare Workers (+ static assets)	Free tier, global, one-click live link for reviewers
Backend framework	Hono (TypeScript)	Lightweight, fast, built for Workers
Frontend	HTML + Tailwind CSS + vanilla JS (or React + Vite if preferred)	Fast to build, easy to demo
AI model	Anthropic Claude API (model name set via env var, e.g. claude-sonnet-5-5)	Strong at structured extraction and careful, safe wording
Database	Cloudflare D1 (SQLite)	Stores intakes, results, prompt versions, audit log
Validation	Zod	Validates AI JSON output against a strict schema; retries on failure
Rate limiting	Workers KV or in-memory token bucket	Protects API budget on the public demo
Testing	Vitest	Unit tests and evaluation harness runner
Tooling	Wrangler CLI, Git, GitHub	Deploy and version control
AI-assisted dev	Claude (design, code, prompt refinement)	Documented in PROMPT_LOG.md
5. System Architecture
┌─────────────┐      HTTPS       ┌───────────────────────────────┐
│  Browser UI │ ───────────────► │  Cloudflare Worker (Hono)     │
│ (Intake,    │ ◄─────────────── │                               │
│  Dashboard, │      JSON        │  routes → services → prompts  │
│  Prompt Lab)│                  └──────┬───────────┬────────────┘
└─────────────┘                         │           │
                                        ▼           ▼
                                ┌────────────┐  ┌──────────────┐
                                │ Claude API │  │ D1 database  │
                                └────────────┘  └──────────────┘
6. Required Modules
6.1 Intake Module
Dedicated Inbound Patient Ingestion portal (`public/intake.html`) featuring compact, responsive side-by-side horizontal cards and boundary-aligned ingestion.
Supports multi-modal intake simulation: free-text typing, speech-to-text voice dictation, and spoken audio voicemail transcriptions.
Features automated boundary checking, live PII detection with masking, and instant SQLite (`careflow.db`) persistence with auto-triage and Clinician Queue synchronization.
6.2 Safety & PII Guard Module
Warns the user if input looks like real personal data (phone numbers, emails, ID numbers) and offers masking.
Blocks prompts that try to override instructions (basic prompt-injection checks).
Always attaches the disclaimer banner and "not medical advice" footer.
6.3 AI Extraction Module
Calls Claude with the versioned system prompt and returns strict JSON.
Validates the output with Zod; on failure, retries once with an error-correction prompt.
Outputs: summary, symptoms, duration, severity, medications, allergies, history, missing fields.
6.4 Triage & Red-Flag Module
Assigns ROUTINE | SOON | URGENT with a reason.
Rule-based safety net runs in addition to the AI: a keyword list (e.g. chest pain, can't breathe, suicidal thoughts, severe bleeding) forces URGENT and shows an emergency notice. The final urgency is the higher of the AI result and the rule result.
6.5 Missing-Information Module
Compares the extracted fields with a required-fields checklist and lists gaps as clear questions.
6.6 Follow-Up Drafting Module
Generates a message with: greeting, acknowledgement, 2–4 clarifying questions, next-step line, and an emergency line when relevant.
Options: channel (email/SMS), tone (warm/formal), reading level (plain language).
6.7 Review & Approval Module
Editable summary and message, approve/reject buttons, and "mock send" confirmation.
Records reviewer action and edits in the audit log.
6.8 Prompt Version Lab Module
Stores prompt versions (v1, v2, v3) with change notes.
Runs one input across selected versions and shows results side by side.
6.9 Evaluation Harness Module
Runs a dataset of synthetic cases with expected urgency and key fields.
Reports urgency accuracy, field-extraction accuracy, JSON validity rate, average latency, and average cost per run, per prompt version.
6.10 Audit & Logging Module
Saves every AI request: prompt version, model, tokens, latency, status, and reviewer decision.
6.11 Rate Limiting & Config Module
Per-IP limits and daily budget cap for the public demo; configuration via environment variables.
7. Prompt Engineering Strategy

The project deliberately shows iteration, with each version logged in PROMPT_LOG.md.

Version	Approach	Observed problem	Fix in next version
v1	Simple instruction: "Summarise this patient message."	Rambling free text, inconsistent fields, no urgency	Add role, structure, and output format
v2	Role + strict JSON schema + field definitions + "use null if not stated"	Occasional invented details; urgency under-called	Add guardrails, few-shot examples, and red-flag rules
v3	Few-shot examples, explicit never-diagnose rule, urgency rubric, missing-info rules, JSON-only output	Production candidate	Tune tone and add evaluation scoring
v4 (follow-up)	Separate drafter prompt with tone/channel variables, reading level, and an emergency clause	Too long for SMS	Add length limits per channel

Techniques used: role prompting, schema-constrained output, few-shot examples, negative instructions (never diagnose or recommend treatment), chain-of-verification for urgency, temperature near 0 for extraction, and automated evaluation against a labelled dataset.

Example output schema (extraction)
json
{
  "chief_complaint": "string",
  "symptoms": ["string"],
  "duration": "string | null",
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
8. Data Model (D1)
sql
CREATE TABLE intakes (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE analyses (
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

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  analysis_id TEXT REFERENCES analyses(id),
  channel TEXT,
  tone TEXT,
  draft_text TEXT,
  final_text TEXT,
  status TEXT DEFAULT 'DRAFT',   -- DRAFT | APPROVED | REJECTED
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prompt_versions (
  version TEXT PRIMARY KEY,
  system_prompt TEXT NOT NULL,
  change_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  prompt_version TEXT,
  urgency_accuracy REAL,
  field_accuracy REAL,
  json_valid_rate REAL,
  avg_latency_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
9. API Endpoints
Method	Endpoint	Purpose
POST	/api/intake	Submit raw text, returns intake_id and auto-triggers triage
GET	/api/intake/stats	Summary metrics (total intakes, urgent cases, pending reviews)
POST	/api/analyze	Run extraction + triage (intake_id, prompt_version)
POST	/api/followup	Generate a follow-up draft (analysis_id, channel, tone)
PATCH	/api/messages/:id	Edit, approve, or reject a draft
GET	/api/intakes	List intakes with urgency (dashboard)
GET	/api/intakes/:id	Full detail of one intake
POST	/api/lab/compare	Run one input across multiple prompt versions
POST	/api/eval/run	Run the evaluation harness
GET	/api/eval/results	View past evaluation runs
GET	/api/health	Health check
10. Project Structure
careflow-ai/
├── README.MD
├── PROMPT_LOG.md              # All prompts + revisions (assessment deliverable #2)
├── .gitignore                 # Git exclusions (node_modules, .dev.vars, careflow.db)
├── wrangler.toml
├── package.json
├── tsconfig.json
├── schema.sql
├── careflow.db                # Local SQLite database instance
├── .dev.vars.example          # ANTHROPIC_API_KEY=your_key_here
├── src/
│   ├── index.ts               # Hono app entry
│   ├── server.ts              # Local dev server with static asset serving
│   ├── routes/
│   │   ├── intake.ts
│   │   ├── analyze.ts
│   │   ├── followup.ts
│   │   ├── lab.ts
│   │   └── eval.ts
│   ├── services/
│   │   ├── intake.ts          # Sanitization, boundary checks, PII, DB save
│   │   ├── claude.ts          # API client, retries, timeouts
│   │   ├── extraction.ts
│   │   ├── triage.ts          # AI + rule-based urgency
│   │   ├── followup.ts
│   │   ├── safety.ts          # PII + injection checks
│   │   └── ratelimit.ts
│   ├── prompts/
│   │   ├── extraction.v1.ts
│   │   ├── extraction.v2.ts
│   │   ├── extraction.v3.ts
│   │   └── followup.v1.ts
│   ├── schemas/
│   │   └── analysis.ts        # Zod schemas
│   └── db/
│       └── queries.ts         # Universal D1 / Node SQLite abstraction layer
├── public/
│   ├── index.html             # Intake + results
│   ├── intake.html            # Dedicated Inbound Patient Ingestion Module
│   ├── dashboard.html         # Clinician Triage Queue & Voice Assist Review
│   ├── lab.html               # Prompt version comparison (v1, v2, v3)
│   ├── eval.html              # Automated evaluation benchmark harness
│   ├── app.js
│   └── styles.css
├── data/
│   ├── synthetic_patients.json   # 20+ fake cases with expected labels
│   └── red_flag_keywords.json
└── tests/
    ├── triage.test.ts
    ├── schema.test.ts
    └── eval.test.ts
11. Getting Started
Prerequisites
Node.js 18+
A Cloudflare account (free tier)
An Anthropic API key
Wrangler CLI (npm i -g wrangler)
Setup
bash
# 1. Clone and install
git clone https://github.com/shilpa2529/careflow-ai.git
cd careflow-ai
npm install

# 2. Create the D1 database and apply the schema (Cloudflare D1)
npx wrangler d1 create careflow-db
# copy the returned database_id into wrangler.toml
npx wrangler d1 execute careflow-db --file=./schema.sql

# 3. Add secrets for local development
cp .dev.vars.example .dev.vars
# edit .dev.vars and set ANTHROPIC_API_KEY

# 4. Run locally
# Local development server (Node.js runtime with SQLite careflow.db):
npm run dev

# Or run via Cloudflare Wrangler:
npx wrangler dev
Deploy
bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler d1 execute careflow-db --remote --file=./schema.sql
npx wrangler deploy
Environment variables
Variable	Description
ANTHROPIC_API_KEY	Secret key for the Claude API (never commit)
CLAUDE_MODEL	Model name, e.g. claude-sonnet-5-5
MAX_INPUT_CHARS	Input length limit (default 3000)
DAILY_REQUEST_CAP	Demo budget guard (default 200)
12. Sample Inputs

Routine case

"Hi, I've had a mild sore throat for 3 days, no fever. I take vitamin D. Can I get an appointment next week?"

Urgent case

"My dad has had chest tightness since morning and feels dizzy, he's 62 and on blood pressure tablets."

Incomplete case

"Been feeling off lately, need to see someone."

Expected behaviour: routine → ROUTINE with a follow-up asking about fever and severity; urgent → URGENT with an emergency notice; incomplete → SOON/ROUTINE with a list of missing information.

13. Evaluation & Testing
Dataset: 20–30 synthetic cases across routine, urgent, incomplete, and adversarial (prompt-injection) inputs.
Metrics: urgency accuracy, red-flag recall (target 100%), JSON validity rate, field extraction accuracy, average latency.
Run: npm test for unit tests; POST /api/eval/run for model evaluation.
Compare v1 → v3 results in a table and include it in the video.
14. Safety, Privacy & Ethics
Synthetic data only; no real patient information.
Visible disclaimer on every page; AI never diagnoses or recommends treatment.
Rule-based red-flag safety net overrides AI under-triage.
Human review required before any message is approved.
Raw inputs are stored only in the demo database and can be purged; no third-party tracking.
Prompt-injection checks and strict JSON validation.
Production use would require compliance review (e.g. HIPAA / Australian Privacy Act), data-processing agreements, and clinical validation.