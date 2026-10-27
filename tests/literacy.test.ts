import { describe, expect, it } from 'vitest';
import { analyzeHealthLiteracy } from '../src/services/literacy';

describe('CareFlow Health Literacy & Readability Tests', () => {
  it('correctly assesses plain-English patient follow-up', () => {
    const plainText =
      'Hello. Thank you for contacting our clinic. A nurse will call you back this afternoon. Please rest and drink plenty of water.';
    const result = analyzeHealthLiteracy(plainText);

    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.isPatientAccessible).toBe(true);
    expect(result.gradeLevel).toBeLessThanOrEqual(8.5);
    expect(result.jargonFound).toHaveLength(0);
  });

  it('detects complex clinical jargon and suggests accessible replacements', () => {
    const jargonText =
      'The patient reported acute dyspnea, cephalalgia, and hypertension, along with peripheral edema.';
    const result = analyzeHealthLiteracy(jargonText);

    expect(result.jargonFound.length).toBeGreaterThanOrEqual(3);
    const terms = result.jargonFound.map((j) => j.term);
    expect(terms).toContain('dyspnea');
    expect(terms).toContain('edema');
    expect(terms).toContain('hypertension');
  });
});
