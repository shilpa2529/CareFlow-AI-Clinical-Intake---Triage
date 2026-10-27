/**
 * CareFlow AI — Health Literacy & Readability Analyzer
 * Computes Flesch Reading Ease, Flesch-Kincaid Grade Level, and detects
 * complex clinical jargon to ensure patient follow-up messages adhere to
 * standard patient health literacy guidelines (aiming for 6th-8th grade plain language).
 */

export interface ReadabilityMetrics {
  fleschReadingEase: number;
  gradeLevel: number;
  wordCount: number;
  sentenceCount: number;
  syllableCount: number;
  readingEaseLabel: 'Very Easy' | 'Easy' | 'Fairly Easy' | 'Standard' | 'Fairly Difficult' | 'Difficult' | 'Very Confusing';
  isPatientAccessible: boolean; // Grade <= 8
  jargonFound: { term: string; suggestion: string }[];
  summary: string;
}

// Common clinical jargon dictionary with accessible layperson alternatives
const JARGON_MAP: Record<string, string> = {
  dyspnea: 'shortness of breath',
  hypertension: 'high blood pressure',
  hypotension: 'low blood pressure',
  edema: 'swelling',
  erythema: 'redness',
  pruritus: 'itching',
  tachycardia: 'rapid heartbeat',
  bradycardia: 'slow heartbeat',
  syncope: 'fainting or dizziness',
  vertigo: 'spinning sensation or dizziness',
  cephalalgia: 'headache',
  pyrexia: 'fever',
  febrile: 'feverish',
  afebrile: 'no fever',
  nausea: 'upset stomach / feeling sick',
  emesis: 'vomiting',
  hematuria: 'blood in urine',
  pharyngitis: 'sore throat',
  rhinorrhea: 'runny nose',
  myalgia: 'muscle ache',
  arthralgia: 'joint pain',
  anaphylaxis: 'severe allergic reaction',
  contraindicated: 'not safe to take',
  ambulatory: 'able to walk',
  etiology: 'cause'
};

function countSyllablesInWord(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;

  const clean = w.replace(/(?:[^laeiouy]|ed|es|e)$/, '');
  const syllables = clean.match(/[aeiouy]{1,2}/g);
  return syllables ? Math.max(1, syllables.length) : 1;
}

export function analyzeHealthLiteracy(text: string): ReadabilityMetrics {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      fleschReadingEase: 100,
      gradeLevel: 1,
      wordCount: 0,
      sentenceCount: 0,
      syllableCount: 0,
      readingEaseLabel: 'Very Easy',
      isPatientAccessible: true,
      jargonFound: [],
      summary: 'Empty text'
    };
  }

  // Split sentences by . ! ?
  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);

  // Split words
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = Math.max(1, words.length);

  // Count syllables
  let syllableCount = 0;
  for (const w of words) {
    syllableCount += countSyllablesInWord(w);
  }

  // Flesch Reading Ease formula:
  // 206.835 - 1.015 * (total words / total sentences) - 84.6 * (total syllables / total words)
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = syllableCount / wordCount;

  let flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  flesch = Math.min(100, Math.max(0, Math.round(flesch * 10) / 10));

  // Flesch-Kincaid Grade Level:
  // 0.39 * (total words / total sentences) + 11.8 * (total syllables / total words) - 15.59
  let grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
  grade = Math.max(1, Math.round(grade * 10) / 10);

  let readingEaseLabel: ReadabilityMetrics['readingEaseLabel'] = 'Standard';
  if (flesch >= 90) readingEaseLabel = 'Very Easy';
  else if (flesch >= 80) readingEaseLabel = 'Easy';
  else if (flesch >= 70) readingEaseLabel = 'Fairly Easy';
  else if (flesch >= 60) readingEaseLabel = 'Standard';
  else if (flesch >= 50) readingEaseLabel = 'Fairly Difficult';
  else if (flesch >= 30) readingEaseLabel = 'Difficult';
  else readingEaseLabel = 'Very Confusing';

  // Jargon scan
  const lowerText = trimmed.toLowerCase();
  const jargonFound: { term: string; suggestion: string }[] = [];

  for (const [term, suggestion] of Object.entries(JARGON_MAP)) {
    // Regex for word boundary
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(lowerText)) {
      jargonFound.push({ term, suggestion });
    }
  }

  const isPatientAccessible = grade <= 8.5;
  const summary = isPatientAccessible
    ? `Grade ${grade} (${readingEaseLabel}) — Plain English compliant, optimal for patient comprehension.`
    : `Grade ${grade} (${readingEaseLabel}) — Advanced reading level. Consider simplifying vocabulary.`;

  return {
    fleschReadingEase: flesch,
    gradeLevel: grade,
    wordCount,
    sentenceCount,
    syllableCount,
    readingEaseLabel,
    isPatientAccessible,
    jargonFound,
    summary
  };
}
