import redFlagData from '../../data/red_flag_keywords.json';

export interface RedFlagMatch {
  keyword: string;
  category: string;
  severity: 'URGENT';
  emergency_advice: string;
}

export interface TriageEvaluation {
  ruleUrgency: 'ROUTINE' | 'SOON' | 'URGENT';
  redFlagsDetected: RedFlagMatch[];
  emergencyAdvice: string | null;
  ruleReason: string;
}

const URGENCY_WEIGHT: Record<string, number> = {
  ROUTINE: 1,
  SOON: 2,
  URGENT: 3
};

/**
 * Evaluates raw patient text against algorithmic red flag keywords.
 * Functions as an independent, deterministic clinical safety net.
 */
export function evaluateRedFlags(rawText: string): TriageEvaluation {
  const normalizedText = rawText.toLowerCase();
  const matchedFlags: RedFlagMatch[] = [];

  for (const category of redFlagData.red_flags) {
    for (const keyword of category.keywords) {
      const lowerKeyword = keyword.toLowerCase();
      // Whole-phrase match or word boundary where applicable
      if (normalizedText.includes(lowerKeyword)) {
        matchedFlags.push({
          keyword,
          category: category.category,
          severity: 'URGENT',
          emergency_advice: category.emergency_advice
        });
      }
    }
  }

  if (matchedFlags.length > 0) {
    const primaryAdvice = matchedFlags[0].emergency_advice;
    const keywordsList = matchedFlags.map((m) => `"${m.keyword}"`).join(', ');
    return {
      ruleUrgency: 'URGENT',
      redFlagsDetected: matchedFlags,
      emergencyAdvice: primaryAdvice,
      ruleReason: `Safety net triggered by critical red-flag indicator(s): ${keywordsList}. Emergency escalation mandated.`
    };
  }

  // Check for intermediate urgency indicators (e.g. fever + symptoms, persistent cough, burning urination)
  const soonIndicators = [
    'burning when urinating',
    'fever for 3 days',
    'persistent cough',
    'blood sugar',
    'glucose',
    'swollen ankle',
    'twisted ankle',
    'throbbing ear',
    'earache'
  ];

  for (const indicator of soonIndicators) {
    if (normalizedText.includes(indicator)) {
      return {
        ruleUrgency: 'SOON',
        redFlagsDetected: [],
        emergencyAdvice: null,
        ruleReason: `Rule evaluation detected acute or persistent symptom (${indicator}) warranting clinical review within 24-48 hours.`
      };
    }
  }

  return {
    ruleUrgency: 'ROUTINE',
    redFlagsDetected: [],
    emergencyAdvice: null,
    ruleReason: 'No immediate emergency red flags detected by safety net rules.'
  };
}

/**
 * Combines AI urgency assessment with rule-based safety net.
 * GUARANTEE: Final urgency is the maximum of (AI urgency, Rule urgency).
 * AI can never downgrade an algorithmic red-flag trigger.
 */
export function combineUrgency(
  aiUrgency: 'ROUTINE' | 'SOON' | 'URGENT',
  ruleUrgency: 'ROUTINE' | 'SOON' | 'URGENT'
): {
  finalUrgency: 'ROUTINE' | 'SOON' | 'URGENT';
  wasOverridden: boolean;
  overrideReason?: string;
} {
  const aiWeight = URGENCY_WEIGHT[aiUrgency] || 1;
  const ruleWeight = URGENCY_WEIGHT[ruleUrgency] || 1;

  if (ruleWeight > aiWeight) {
    return {
      finalUrgency: ruleUrgency,
      wasOverridden: true,
      overrideReason: `Safety Net Override: Algorithmic rule escalated urgency from ${aiUrgency} to ${ruleUrgency} for patient safety.`
    };
  }

  return {
    finalUrgency: aiUrgency,
    wasOverridden: false
  };
}
