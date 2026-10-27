/**
 * Database queries & universal D1 / SQLite abstraction layer.
 * Works natively in Cloudflare Workers (via c.env.DB) and in Node.js / Vitest
 * using Node's built-in node:sqlite DatabaseSync.
 */

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  all<T = any>(): Promise<{ results: T[]; success: boolean }>;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: any }>;
}

export interface UniversalDb {
  prepare(query: string): D1PreparedStatement;
  batch?(statements: any[]): Promise<any[]>;
  exec(query: string): Promise<any> | void;
}

// In-memory / file-based SQLite instance for Node.js runtime / Vitest
let nodeSqliteDb: UniversalDb | null = null;

export async function getNodeDatabase(dbPath = './careflow.db'): Promise<UniversalDb> {
  if (nodeSqliteDb) return nodeSqliteDb;

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(dbPath);

    // Initialise tables
    const initSql = `
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
        status TEXT DEFAULT 'DRAFT',
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

      INSERT OR IGNORE INTO prompt_versions (version, system_prompt, change_note) VALUES 
      ('v1', 'You are a clinic assistant. Summarise this patient message.', 'Baseline: Simple open-ended summary instruction.'),
      ('v2', 'You are an intake triage assistant. Extract patient details into strict JSON: chief_complaint, symptoms, duration, severity, medications, allergies, relevant_history, urgency, urgency_reason, red_flags, missing_information, clinician_summary.', 'Intermediate: Added strict JSON schema, required field definitions, and null handling.'),
      ('v3', 'You are CareFlow AI, a clinical intake safety & triage assistant. Extract structured facts into strict JSON matching the schema. Follow safety guardrails: NEVER diagnose, NEVER recommend medical treatment. Detect red flags. Apply calibrated urgency rubric.', 'Production Candidate: Few-shot examples, strict anti-diagnosis guardrails, explicit emergency rubric, and structured missing-information detection.');
    `;
    sqlite.exec(initSql);

    nodeSqliteDb = {
      prepare(query: string) {
        let boundParams: any[] = [];
        return {
          bind(...values: any[]) {
            boundParams = values;
            return this;
          },
          async all<T = any>() {
            const stmt = sqlite.prepare(query);
            const rows = (stmt.all(...boundParams) as T[]) || [];
            return { results: rows, success: true };
          },
          async first<T = any>(colName?: string) {
            const stmt = sqlite.prepare(query);
            const row = stmt.get(...boundParams) as any;
            if (!row) return null;
            if (colName) return row[colName] ?? null;
            return row as T;
          },
          async run() {
            const stmt = sqlite.prepare(query);
            const res = stmt.run(...boundParams);
            return { success: true, meta: res };
          }
        };
      },
      exec(sql: string) {
        sqlite.exec(sql);
      }
    };

    return nodeSqliteDb;
  } catch (err) {
    console.warn('Could not initialize node:sqlite, using memory fallback:', err);
    return createMemoryDb();
  }
}

function createMemoryDb(): UniversalDb {
  const intakes = new Map<string, any>();
  const analyses = new Map<string, any>();
  const messages = new Map<string, any>();
  const promptVersions = new Map<string, any>();
  const evalRuns = new Map<string, any>();
  const auditLogs = new Map<string, any>();

  promptVersions.set('v1', { version: 'v1', system_prompt: 'Summarise message', change_note: 'Baseline' });
  promptVersions.set('v2', { version: 'v2', system_prompt: 'Strict JSON schema', change_note: 'Schema-constrained' });
  promptVersions.set('v3', { version: 'v3', system_prompt: 'Production few-shot', change_note: 'Production candidate' });

  return {
    prepare(query: string) {
      let bound: any[] = [];
      return {
        bind(...values: any[]) {
          bound = values;
          return this;
        },
        async all<T = any>() {
          if (query.includes('FROM intakes')) {
            const list = Array.from(intakes.values()).reverse();
            return { results: list as T[], success: true };
          }
          if (query.includes('FROM prompt_versions')) {
            return { results: Array.from(promptVersions.values()) as T[], success: true };
          }
          if (query.includes('FROM eval_runs')) {
            return { results: Array.from(evalRuns.values()).reverse() as T[], success: true };
          }
          if (query.includes('FROM audit_logs')) {
            return { results: Array.from(auditLogs.values()).reverse() as T[], success: true };
          }
          return { results: [] as T[], success: true };
        },
        async first<T = any>() {
          if (query.includes('FROM intakes WHERE id')) {
            return (intakes.get(bound[0]) as T) || null;
          }
          if (query.includes('FROM analyses WHERE id')) {
            return (analyses.get(bound[0]) as T) || null;
          }
          if (query.includes('FROM messages WHERE id')) {
            return (messages.get(bound[0]) as T) || null;
          }
          return null;
        },
        async run() {
          if (query.includes('INSERT INTO intakes')) {
            intakes.set(bound[0], { id: bound[0], raw_text: bound[1], created_at: new Date().toISOString() });
          } else if (query.includes('INSERT INTO analyses')) {
            analyses.set(bound[0], {
              id: bound[0],
              intake_id: bound[1],
              prompt_version: bound[2],
              model: bound[3],
              result_json: bound[4],
              final_urgency: bound[5],
              latency_ms: bound[6],
              input_tokens: bound[7],
              output_tokens: bound[8],
              created_at: new Date().toISOString()
            });
          } else if (query.includes('INSERT INTO messages')) {
            messages.set(bound[0], {
              id: bound[0],
              analysis_id: bound[1],
              channel: bound[2],
              tone: bound[3],
              draft_text: bound[4],
              final_text: bound[5],
              status: bound[6] || 'DRAFT',
              created_at: new Date().toISOString()
            });
          } else if (query.includes('UPDATE messages SET')) {
            const msg = messages.get(bound[2]);
            if (msg) {
              msg.final_text = bound[0];
              msg.status = bound[1];
            }
          } else if (query.includes('INSERT INTO eval_runs')) {
            evalRuns.set(bound[0], {
              id: bound[0],
              prompt_version: bound[1],
              urgency_accuracy: bound[2],
              field_accuracy: bound[3],
              json_valid_rate: bound[4],
              avg_latency_ms: bound[5],
              created_at: new Date().toISOString()
            });
          } else if (query.includes('INSERT INTO audit_logs')) {
            auditLogs.set(bound[0], {
              id: bound[0],
              event_type: bound[1],
              entity_id: bound[2],
              details: bound[3],
              created_at: new Date().toISOString()
            });
          }
          return { success: true, meta: {} };
        }
      };
    },
    exec() {}
  };
}

/**
 * Resolves database instance from request context (Cloudflare D1 or Node SQLite)
 */
export async function getDb(env?: any): Promise<UniversalDb> {
  if (env && env.DB && typeof env.DB.prepare === 'function') {
    return env.DB as UniversalDb;
  }
  return getNodeDatabase();
}

// -----------------------------------------------------------------------------
// Database Query Helpers
// -----------------------------------------------------------------------------

export async function insertIntake(db: UniversalDb, id: string, rawText: string) {
  return db
    .prepare('INSERT INTO intakes (id, raw_text, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .bind(id, rawText)
    .run();
}

export async function getIntakeById(db: UniversalDb, id: string) {
  return db
    .prepare('SELECT * FROM intakes WHERE id = ?')
    .bind(id)
    .first<any>();
}

export async function listAllIntakes(db: UniversalDb) {
  return db
    .prepare(
      `SELECT i.id, i.raw_text, i.created_at, 
              a.id as analysis_id, a.prompt_version, a.final_urgency, a.result_json,
              m.id as message_id, m.status as message_status, m.channel as message_channel, m.final_text as message_text
       FROM intakes i
       LEFT JOIN analyses a ON a.intake_id = i.id
       LEFT JOIN messages m ON m.analysis_id = a.id
       ORDER BY i.created_at DESC`
    )
    .all<any>();
}

export async function insertAnalysis(
  db: UniversalDb,
  data: {
    id: string;
    intake_id: string;
    prompt_version: string;
    model: string;
    result_json: string;
    final_urgency: string;
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
  }
) {
  return db
    .prepare(
      `INSERT INTO analyses (id, intake_id, prompt_version, model, result_json, final_urgency, latency_ms, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      data.id,
      data.intake_id,
      data.prompt_version,
      data.model,
      data.result_json,
      data.final_urgency,
      data.latency_ms,
      data.input_tokens,
      data.output_tokens
    )
    .run();
}

export async function getAnalysisById(db: UniversalDb, id: string) {
  return db
    .prepare('SELECT * FROM analyses WHERE id = ?')
    .bind(id)
    .first<any>();
}

export async function insertMessage(
  db: UniversalDb,
  data: {
    id: string;
    analysis_id: string;
    channel: string;
    tone: string;
    draft_text: string;
    final_text: string;
    status: string;
  }
) {
  return db
    .prepare(
      `INSERT INTO messages (id, analysis_id, channel, tone, draft_text, final_text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      data.id,
      data.analysis_id,
      data.channel,
      data.tone,
      data.draft_text,
      data.final_text,
      data.status
    )
    .run();
}

export async function getMessageById(db: UniversalDb, id: string) {
  return db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .bind(id)
    .first<any>();
}

export async function updateMessageStatus(
  db: UniversalDb,
  id: string,
  finalText: string,
  status: 'DRAFT' | 'APPROVED' | 'REJECTED'
) {
  return db
    .prepare('UPDATE messages SET final_text = ?, status = ? WHERE id = ?')
    .bind(finalText, status, id)
    .run();
}

export async function insertEvalRun(
  db: UniversalDb,
  data: {
    id: string;
    prompt_version: string;
    urgency_accuracy: number;
    field_accuracy: number;
    json_valid_rate: number;
    avg_latency_ms: number;
  }
) {
  return db
    .prepare(
      `INSERT INTO eval_runs (id, prompt_version, urgency_accuracy, field_accuracy, json_valid_rate, avg_latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      data.id,
      data.prompt_version,
      data.urgency_accuracy,
      data.field_accuracy,
      data.json_valid_rate,
      data.avg_latency_ms
    )
    .run();
}

export async function listEvalRuns(db: UniversalDb) {
  return db
    .prepare('SELECT * FROM eval_runs ORDER BY created_at DESC LIMIT 20')
    .all<any>();
}

export async function recordAuditLog(
  db: UniversalDb,
  eventType: string,
  entityId: string,
  details: Record<string, any> | string
) {
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
  const logId = 'log_' + Math.random().toString(36).slice(2, 10);
  return db
    .prepare('INSERT INTO audit_logs (id, event_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .bind(logId, eventType, entityId, detailsStr)
    .run();
}

export async function listAuditLogs(db: UniversalDb, limit = 50) {
  return db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<any>();
}

export async function updateAnalysisUrgency(
  db: UniversalDb,
  analysisId: string,
  newUrgency: 'ROUTINE' | 'SOON' | 'URGENT'
) {
  return db
    .prepare('UPDATE analyses SET final_urgency = ? WHERE id = ?')
    .bind(newUrgency, analysisId)
    .run();
}

export async function getLatestAnalysisForIntake(db: UniversalDb, intakeId: string) {
  return db
    .prepare('SELECT * FROM analyses WHERE intake_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(intakeId)
    .first<any>();
}

export async function getLatestMessageForAnalysis(db: UniversalDb, analysisId: string) {
  return db
    .prepare('SELECT * FROM messages WHERE analysis_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(analysisId)
    .first<any>();
}
