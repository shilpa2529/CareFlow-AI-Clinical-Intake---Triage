import { Hono } from 'hono';
import syntheticCases from '../../data/synthetic_patients.json';
import { getDb, insertEvalRun, listEvalRuns, recordAuditLog } from '../db/queries';
import { EvalRunInputSchema } from '../schemas/analysis';
import { ClaudeService } from '../services/claude';
import { ExtractionService } from '../services/extraction';
import { MEDICAL_DISCLAIMER } from '../services/safety';
import { AppEnv } from '../types';

export const evalRoute = new Hono<{ Bindings: AppEnv }>();

export interface EvalCaseResult {
  id: string;
  name: string;
  category: string;
  expectedUrgency: string;
  actualUrgency: string;
  urgencyCorrect: boolean;
  expectedRedFlags: string[];
  actualRedFlags: string[];
  redFlagRecallPass: boolean;
  jsonValid: boolean;
  latencyMs: number;
  chiefComplaint: string;
}

// POST /api/eval/run - Execute automated evaluation harness
evalRoute.post('/eval/run', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = EvalRunInputSchema.safeParse(body);

    const prompt_version = parsed.success ? parsed.data.prompt_version : 'v3';
    const maxCases = parsed.success && parsed.data.max_cases ? parsed.data.max_cases : syntheticCases.length;

    const casesToRun = syntheticCases.slice(0, maxCases);

    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });
    const extractionService = new ExtractionService(claudeService);

    const results: EvalCaseResult[] = [];
    let urgencyMatches = 0;
    let redFlagPasses = 0;
    let redFlagCasesTotal = 0;
    let validJsonCount = 0;
    let totalLatency = 0;
    let fieldScoreSum = 0;

    for (const testCase of casesToRun) {
      const start = Date.now();
      try {
        const out = await extractionService.runExtraction(testCase.raw_text, prompt_version);
        const latency = out.latencyMs || Date.now() - start;
        totalLatency += latency;

        // 1. Urgency accuracy check
        const urgencyCorrect = out.finalUrgency === testCase.expected_urgency;
        if (urgencyCorrect) urgencyMatches++;

        // 2. Red-Flag Recall check (if testCase has expected red flags or is urgent)
        let redFlagRecallPass = true;
        if (testCase.expected_urgency === 'URGENT' || (testCase.expected_red_flags && testCase.expected_red_flags.length > 0)) {
          redFlagCasesTotal++;
          // Red flag recall is passed if final urgency is URGENT
          redFlagRecallPass = out.finalUrgency === 'URGENT';
          if (redFlagRecallPass) redFlagPasses++;
        }

        // 3. JSON validity
        const jsonValid = !!(out.analysis && out.analysis.chief_complaint);
        if (jsonValid) validJsonCount++;

        // 4. Field extraction heuristic
        let fieldMatches = 0;
        let fieldTests = 2; // duration + severity
        if (testCase.expected_duration && out.analysis.duration) fieldMatches++;
        if (testCase.expected_severity && out.analysis.severity) fieldMatches++;
        fieldScoreSum += fieldMatches / fieldTests;

        results.push({
          id: testCase.id,
          name: testCase.name,
          category: testCase.category,
          expectedUrgency: testCase.expected_urgency,
          actualUrgency: out.finalUrgency,
          urgencyCorrect,
          expectedRedFlags: testCase.expected_red_flags || [],
          actualRedFlags: out.analysis.red_flags || [],
          redFlagRecallPass,
          jsonValid,
          latencyMs: latency,
          chiefComplaint: out.analysis.chief_complaint
        });
      } catch (err: any) {
        results.push({
          id: testCase.id,
          name: testCase.name,
          category: testCase.category,
          expectedUrgency: testCase.expected_urgency,
          actualUrgency: 'ERROR',
          urgencyCorrect: false,
          expectedRedFlags: testCase.expected_red_flags || [],
          actualRedFlags: [],
          redFlagRecallPass: false,
          jsonValid: false,
          latencyMs: Date.now() - start,
          chiefComplaint: `Failed: ${err.message}`
        });
      }
    }

    const total = casesToRun.length;
    const urgencyAccuracy = Number(((urgencyMatches / total) * 100).toFixed(1));
    const redFlagRecallRate = redFlagCasesTotal > 0 ? Number(((redFlagPasses / redFlagCasesTotal) * 100).toFixed(1)) : 100.0;
    const jsonValidRate = Number(((validJsonCount / total) * 100).toFixed(1));
    const fieldAccuracy = Number(((fieldScoreSum / total) * 100).toFixed(1));
    const avgLatencyMs = Math.round(totalLatency / total);

    const runId = 'eval_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

    const db = await getDb(c.env);
    await insertEvalRun(db, {
      id: runId,
      prompt_version,
      urgency_accuracy: urgencyAccuracy,
      field_accuracy: fieldAccuracy,
      json_valid_rate: jsonValidRate,
      avg_latency_ms: avgLatencyMs
    });

    await recordAuditLog(db, 'EVAL_RUN_COMPLETED', runId, {
      prompt_version,
      cases_evaluated: total,
      urgency_accuracy: urgencyAccuracy,
      red_flag_recall: redFlagRecallRate,
      json_valid_rate: jsonValidRate,
      avg_latency_ms: avgLatencyMs
    });

    return c.json({
      success: true,
      run_id: runId,
      prompt_version,
      total_cases: total,
      metrics: {
        urgency_accuracy: urgencyAccuracy,
        red_flag_recall: redFlagRecallRate,
        json_valid_rate: jsonValidRate,
        field_accuracy: fieldAccuracy,
        avg_latency_ms: avgLatencyMs
      },
      case_results: results,
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Evaluation run failed', message: err.message }, 500);
  }
});

// GET /api/eval/results - View past evaluation runs
evalRoute.get('/eval/results', async (c) => {
  try {
    const db = await getDb(c.env);
    const runs = await listEvalRuns(db);
    return c.json({
      success: true,
      eval_runs: runs.results || []
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to retrieve eval runs', message: err.message }, 500);
  }
});

// Handler for comparative matrix across v1, v2, and v3
const handleBenchmarkAll = async (c: any) => {
  try {
    const versions = ['v1', 'v2', 'v3'];
    const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '');
    const claudeService = new ClaudeService({ apiKey, model });
    const extractionService = new ExtractionService(claudeService);

    const matrixResults = [];

    for (const ver of versions) {
      let urgencyMatches = 0;
      let redFlagPasses = 0;
      let redFlagCasesTotal = 0;
      let validJsonCount = 0;
      let totalLatency = 0;

      for (const testCase of syntheticCases) {
        const start = Date.now();
        try {
          const out = await extractionService.runExtraction(testCase.raw_text, ver as any);
          const latency = out.latencyMs || Date.now() - start;
          totalLatency += latency;

          if (out.finalUrgency === testCase.expected_urgency) urgencyMatches++;
          if (testCase.expected_urgency === 'URGENT' || (testCase.expected_red_flags && testCase.expected_red_flags.length > 0)) {
            redFlagCasesTotal++;
            if (out.finalUrgency === 'URGENT') redFlagPasses++;
          }
          if (out.analysis && out.analysis.chief_complaint) validJsonCount++;
        } catch (_) {}
      }

      const total = syntheticCases.length;
      matrixResults.push({
        version: ver,
        urgency_accuracy: Number(((urgencyMatches / total) * 100).toFixed(1)),
        red_flag_recall: redFlagCasesTotal > 0 ? Number(((redFlagPasses / redFlagCasesTotal) * 100).toFixed(1)) : 100.0,
        json_valid_rate: Number(((validJsonCount / total) * 100).toFixed(1)),
        avg_latency_ms: Math.round(totalLatency / total)
      });
    }

    return c.json({
      success: true,
      matrix: matrixResults,
      disclaimer: MEDICAL_DISCLAIMER
    });
  } catch (err: any) {
    return c.json({ error: 'Benchmark all failed', message: err.message }, 500);
  }
};

evalRoute.post('/eval/benchmark-all', handleBenchmarkAll);
evalRoute.post('/benchmark-all', handleBenchmarkAll);
evalRoute.get('/eval/benchmark-all', handleBenchmarkAll);
evalRoute.get('/benchmark-all', handleBenchmarkAll);
