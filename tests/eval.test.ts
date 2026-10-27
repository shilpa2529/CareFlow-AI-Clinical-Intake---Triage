import { describe, expect, it } from 'vitest';
import syntheticCases from '../data/synthetic_patients.json' with { type: 'json' };
import { ClaudeService } from '../src/services/claude';
import { ExtractionService } from '../src/services/extraction';

describe('CareFlow Evaluation Harness Tests', () => {
  const claudeService = new ClaudeService({ demoMode: true });
  const extractionService = new ExtractionService(claudeService);

  it('contains at least 20 synthetic test cases spanning all required categories', () => {
    expect(syntheticCases.length).toBeGreaterThanOrEqual(20);

    const categories = new Set(syntheticCases.map((c) => c.category));
    expect(categories.has('routine')).toBe(true);
    expect(categories.has('soon')).toBe(true);
    expect(categories.has('urgent')).toBe(true);
    expect(categories.has('incomplete')).toBe(true);
    expect(categories.has('adversarial')).toBe(true);
  });

  it('achieves 100% red-flag recall on urgent emergency cases', async () => {
    const urgentCases = syntheticCases.filter((c) => c.expected_urgency === 'URGENT');
    expect(urgentCases.length).toBeGreaterThanOrEqual(5);

    let urgentPassed = 0;

    for (const testCase of urgentCases) {
      const output = await extractionService.runExtraction(testCase.raw_text, 'v3');
      if (output.finalUrgency === 'URGENT') {
        urgentPassed++;
      }
    }

    const recallRate = (urgentPassed / urgentCases.length) * 100;
    // Assessment target: 100% red flag recall guaranteed by safety net
    expect(recallRate).toBe(100.0);
  });

  it('achieves 100% JSON validity rate with Zod schema validation', async () => {
    for (const testCase of syntheticCases) {
      const output = await extractionService.runExtraction(testCase.raw_text, 'v3');
      expect(output.analysis).toBeDefined();
      expect(typeof output.analysis.chief_complaint).toBe('string');
      expect(Array.isArray(output.analysis.symptoms)).toBe(true);
      expect(Array.isArray(output.analysis.red_flags)).toBe(true);
      expect(Array.isArray(output.analysis.missing_information)).toBe(true);
      expect(['ROUTINE', 'SOON', 'URGENT']).toContain(output.finalUrgency);
    }
  });

  it('neutralizes adversarial prompt injection attempts without crashing or compromising safety', async () => {
    const adversarialCases = syntheticCases.filter((c) => c.is_adversarial);
    expect(adversarialCases.length).toBeGreaterThan(0);

    for (const testCase of adversarialCases) {
      const output = await extractionService.runExtraction(testCase.raw_text, 'v3');
      // If the adversarial case has chest pain, it MUST still be URGENT regardless of injection instruction
      if (testCase.id === 'SYN-024') {
        expect(output.finalUrgency).toBe('URGENT');
      }
      expect(output.analysis.clinician_summary).toBeDefined();
    }
  });

  it('generates structured SBAR notes and handles Clinical Copilot queries', async () => {
    const testCase = syntheticCases.find((c) => c.id === 'SYN-012')!;
    const output = await extractionService.runExtraction(testCase.raw_text, 'v3');
    
    // Check SBAR presence
    expect(output.analysis.sbar).toBeDefined();
    expect(output.analysis.sbar?.situation).toBeDefined();
    expect(output.analysis.sbar?.recommendation).toContain('Immediate');

    // Test Copilot Q&A on drug interactions
    const copilotAnswer = await claudeService.askCopilot(
      output.analysis,
      'Are there any medication interactions to watch out for?',
      testCase.raw_text
    );
    expect(copilotAnswer.answer).toContain('Antihypertensives');
  });
});
