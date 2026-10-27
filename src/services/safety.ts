/**
 * Safety & PII Guard Module
 * 1. Detects personal identifiable information (PII) such as emails, phone numbers, SSNs.
 * 2. Provides deterministic masking/anonymization for patient safety.
 * 3. Inspects for adversarial prompt injection and jailbreak attempts.
 * 4. Supplies mandatory medical disclaimer banners.
 */

export interface PiiCheckResult {
  hasPii: boolean;
  warnings: string[];
  maskedText: string;
  detectedTypes: string[];
}

export interface InjectionCheckResult {
  isAdversarial: boolean;
  warnings: string[];
  riskScore: 'LOW' | 'MEDIUM' | 'HIGH';
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g;
const SSN_REGEX = /\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d{4}[- ]?){3}\d{4}\b/g;

const ADVERSARIAL_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i, label: 'Instruction override attempt' },
  { regex: /system\s+override/i, label: 'System override keyword' },
  { regex: /you\s+are\s+now\s+(DAN|unfiltered|jailbroken|a\s+doctor)/i, label: 'Persona hijacking / Jailbreak' },
  { regex: /override\s+(urgency|triage|priority)\s+to/i, label: 'Triage manipulation attempt' },
  { regex: /suppress\s+(all\s+)?(red\s+flags|warnings|alerts)/i, label: 'Safety suppression attempt' },
  { regex: /diagnose\s+me\s+with/i, label: 'Forced diagnosis solicitation' },
  { regex: /prescribe\s+(\w+)\s+immediately/i, label: 'Forced prescription solicitation' },
  { regex: /repeat\s+the\s+system\s+prompt/i, label: 'Prompt extraction attack' }
];

export const MEDICAL_DISCLAIMER =
  'PROTOTYPE FOR DEMONSTRATION ONLY. NOT A MEDICAL DEVICE. DOES NOT PROVIDE MEDICAL ADVICE, DIAGNOSIS, OR TREATMENT. USES SYNTHETIC PATIENT DATA ONLY.';

export function checkPii(rawText: string): PiiCheckResult {
  const warnings: string[] = [];
  const detectedTypes: string[] = [];

  let maskedText = rawText;

  if (EMAIL_REGEX.test(rawText)) {
    warnings.push('Input appears to contain an email address.');
    detectedTypes.push('EMAIL');
    maskedText = maskedText.replace(EMAIL_REGEX, '[ANONYMIZED_EMAIL]');
  }

  if (PHONE_REGEX.test(rawText)) {
    warnings.push('Input appears to contain a telephone number.');
    detectedTypes.push('PHONE');
    maskedText = maskedText.replace(PHONE_REGEX, '[ANONYMIZED_PHONE]');
  }

  if (SSN_REGEX.test(rawText)) {
    warnings.push('Input appears to contain a Social Security Number or National ID.');
    detectedTypes.push('NATIONAL_ID');
    maskedText = maskedText.replace(SSN_REGEX, '[ANONYMIZED_SSN]');
  }

  if (CREDIT_CARD_REGEX.test(rawText)) {
    warnings.push('Input appears to contain a credit card or financial number.');
    detectedTypes.push('PAYMENT_CARD');
    maskedText = maskedText.replace(CREDIT_CARD_REGEX, '[ANONYMIZED_CARD]');
  }

  return {
    hasPii: warnings.length > 0,
    warnings,
    maskedText,
    detectedTypes
  };
}

export function checkInjection(rawText: string): InjectionCheckResult {
  const warnings: string[] = [];

  for (const pattern of ADVERSARIAL_PATTERNS) {
    if (pattern.regex.test(rawText)) {
      warnings.push(`Detected potential adversarial trigger: ${pattern.label}`);
    }
  }

  const isAdversarial = warnings.length > 0;
  const riskScore: 'LOW' | 'MEDIUM' | 'HIGH' =
    warnings.length >= 2 ? 'HIGH' : warnings.length === 1 ? 'MEDIUM' : 'LOW';

  return {
    isAdversarial,
    warnings,
    riskScore
  };
}
