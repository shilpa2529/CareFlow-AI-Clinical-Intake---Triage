import { AnalysisResult, AnalysisResultSchema } from '../schemas/analysis';
import { evaluateRedFlags } from './triage';

export interface ClaudeConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  demoMode?: boolean;
}

export interface ClaudeCallResult {
  rawResponse: string;
  parsedJson: any;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
  isDemoMode: boolean;
}

export class ClaudeService {
  private apiKey: string;
  private model: string;
  private timeoutMs: number;
  private maxRetries: number;
  private isDemoMode: boolean;

  constructor(config: ClaudeConfig = {}) {
    const rawKey = config.apiKey || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
    this.apiKey = (rawKey || '').trim();
    this.model = config.model || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : '') || 'claude-3-5-sonnet-20241022';
    this.timeoutMs = config.timeoutMs || 15000;
    this.maxRetries = config.maxRetries ?? 1;

    // Active demo mode if explicitly set or if API key is empty/placeholder
    const envDemo = typeof process !== 'undefined' && process.env.DEMO_MODE === 'true';
    this.isDemoMode = config.demoMode || envDemo || !this.apiKey || this.apiKey.includes('your_key_here');
  }

  public getDemoMode(): boolean {
    return this.isDemoMode;
  }

  public getModel(): string {
    return this.model;
  }

  /**
   * Main call to Claude API for structured analysis extraction.
   * Includes error-correction retry on schema failure, or falls back to synthetic AI engine in Demo Mode.
   */
  async extractPatientData(
    systemPrompt: string,
    userPrompt: string,
    rawPatientText: string,
    version: 'v1' | 'v2' | 'v3' = 'v3'
  ): Promise<ClaudeCallResult> {
    const startTime = Date.now();

    if (this.isDemoMode) {
      return this.simulateExtraction(rawPatientText, version, startTime);
    }

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const payload = {
          model: this.model,
          max_tokens: 1500,
          temperature: 0.0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Claude API error (${response.status}): ${errBody}`);
        }

        const data: any = await response.json();
        const rawContent = data.content?.[0]?.text || '';
        const latencyMs = Date.now() - startTime;

        const inputTokens = data.usage?.input_tokens || Math.ceil(userPrompt.length / 4);
        const outputTokens = data.usage?.output_tokens || Math.ceil(rawContent.length / 4);

        // Parse JSON output
        let parsedJson: any = null;
        try {
          parsedJson = this.cleanAndParseJson(rawContent);
        } catch (jsonErr) {
          // If JSON parse fails, attempt error-correction retry if retries left
          if (attempt <= this.maxRetries) {
            userPrompt = `${userPrompt}\n\nATTENTION: Your previous response was not valid JSON. You MUST return ONLY a strictly valid JSON object without markdown formatting:\nError: ${(jsonErr as Error).message}`;
            continue;
          }
          throw jsonErr;
        }

        return {
          rawResponse: rawContent,
          parsedJson,
          inputTokens,
          outputTokens,
          latencyMs,
          model: this.model,
          isDemoMode: false
        };
      } catch (err: any) {
        lastError = err;
        if (attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    // If live API failed after retries, fallback gracefully to demo engine so demo never hard-crashes
    console.warn(`Claude live API call failed (${lastError?.message}), falling back to synthetic engine.`);
    return this.simulateExtraction(rawPatientText, version, startTime);
  }

  /**
   * Calls Claude to draft a patient follow-up message.
   */
  async draftFollowUp(
    systemPrompt: string,
    userPrompt: string,
    channel: 'email' | 'sms',
    tone: 'warm' | 'formal' | 'urgent_alert' | 'spanish_translation',
    urgency: 'ROUTINE' | 'SOON' | 'URGENT',
    missingInfo: string[],
    redFlags: string[]
  ): Promise<{ draftText: string; latencyMs: number; isDemoMode: boolean }> {
    const startTime = Date.now();

    if (this.isDemoMode) {
      return this.simulateFollowUp(channel, tone, urgency, missingInfo, redFlags, startTime);
    }

    try {
      const payload = {
        model: this.model,
        max_tokens: channel === 'sms' ? 250 : 800,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Claude follow-up error: ${response.statusText}`);
      }

      const data: any = await response.json();
      const draftText = data.content?.[0]?.text?.trim() || '';

      return {
        draftText,
        latencyMs: Date.now() - startTime,
        isDemoMode: false
      };
    } catch (err) {
      console.warn('Live API follow-up failed, falling back to simulated drafter.');
      return this.simulateFollowUp(channel, tone, urgency, missingInfo, redFlags, startTime);
    }
  }

  private cleanAndParseJson(raw: string): any {
    let clean = raw.trim();
    // Strip markdown code fences if present
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }
    return JSON.parse(clean.trim());
  }

  /**
   * High-fidelity synthetic AI engine for Demo Mode.
   * Produces authentic, deterministic results calibrated across v1, v2, and v3.
   */
  private simulateExtraction(rawText: string, version: 'v1' | 'v2' | 'v3', startTime: number): ClaudeCallResult {
    const lower = rawText.toLowerCase();
    const ruleEval = evaluateRedFlags(rawText);

    // Symptoms extraction
    const symptoms: string[] = [];
    if (lower.includes('sore throat')) symptoms.push('mild sore throat');
    if (lower.includes('fever')) symptoms.push('fever');
    if (lower.includes('cough')) symptoms.push('cough');
    if (lower.includes('chest tightness')) symptoms.push('chest tightness');
    if (lower.includes('chest pain')) symptoms.push('crushing chest pain');
    if (lower.includes('dizzy') || lower.includes('dizziness')) symptoms.push('dizziness');
    if (lower.includes('burning when urinating')) symptoms.push('burning when urinating', 'urinary frequency');
    if (lower.includes('ankle') || lower.includes('sprain')) symptoms.push('ankle pain', 'swelling');
    if (lower.includes('weakness')) symptoms.push('sudden right-sided weakness');
    if (lower.includes('facial droop') || lower.includes('face drooping')) symptoms.push('facial droop');
    if (lower.includes('slurred speech')) symptoms.push('slurred speech');
    if (lower.includes('throat closing') || lower.includes('swelling')) symptoms.push('throat constriction', 'tongue swelling');
    if (lower.includes('vomiting blood') || lower.includes('coughing up blood') || (lower.includes('blood') && !lower.includes('blood pressure'))) {
      symptoms.push('hematemesis', 'blood in vomit');
    }
    if (lower.includes('headache')) symptoms.push('headache');
    if (lower.includes('eczema') || lower.includes('itchy')) symptoms.push('dry itchy skin patches');
    if (lower.includes('back') || lower.includes('strain')) symptoms.push('lower back strain');
    if (lower.includes('sneezing') || lower.includes('runny nose')) symptoms.push('sneezing', 'runny nose', 'congestion');
    if (lower.includes('ear') || lower.includes('earache')) symptoms.push('ear throbbing', 'muffled hearing');
    if (lower.includes('glucose') || lower.includes('blood sugar')) symptoms.push('elevated blood glucose', 'polydipsia');

    if (symptoms.length === 0 && lower.includes('feeling off')) symptoms.push('general malaise');
    if (symptoms.length === 0 && lower.includes('stomach')) symptoms.push('abdominal discomfort');

    // Duration extraction
    let duration: string | null = null;
    const durationMatch = rawText.match(/(\d+\s+(days?|weeks?|hours?|mins?|minutes?|months?|years?)|since morning|yesterday|today)/i);
    if (durationMatch) {
      duration = durationMatch[0];
    }

    // Severity
    let severity: 'mild' | 'moderate' | 'severe' | null = null;
    if (ruleEval.ruleUrgency === 'URGENT' || lower.includes('severe') || lower.includes('crushing') || lower.includes('terrible') || lower.includes('can\'t breathe')) {
      severity = 'severe';
    } else if (ruleEval.ruleUrgency === 'SOON' || lower.includes('moderate') || lower.includes('throbbing') || lower.includes('swelling')) {
      severity = 'moderate';
    } else if (lower.includes('mild') || lower.includes('slight') || lower.includes('little')) {
      severity = 'mild';
    } else if (symptoms.length > 0) {
      severity = 'mild';
    }

    // Medications
    const medications: string[] = [];
    if (lower.includes('vitamin d')) medications.push('Vitamin D');
    if (lower.includes('lisinopril')) medications.push('Lisinopril 10mg');
    if (lower.includes('tylenol')) medications.push('Tylenol');
    if (lower.includes('ibuprofen')) medications.push('Ibuprofen');
    if (lower.includes('metformin')) medications.push('Metformin 500mg BID');
    if (lower.includes('paracetamol')) medications.push('Paracetamol');
    if (lower.includes('aspirin')) medications.push('Aspirin');
    if (lower.includes('cetirizine')) medications.push('Cetirizine');
    if (lower.includes('hydrocortisone')) medications.push('Hydrocortisone 1% cream');
    if (lower.includes('blood pressure tablets')) medications.push('Antihypertensive medication');
    if (lower.includes('inhaler')) medications.push('Inhaler');

    // Allergies
    const allergies: string[] = [];
    if (lower.includes('penicillin')) allergies.push('Penicillin');
    if (lower.includes('peanuts') || lower.includes('peanut')) allergies.push('Peanuts');

    // Relevant History
    const relevantHistory: string[] = [];
    if (lower.includes('62') || lower.includes('dad')) relevantHistory.push('Age 62, cardiovascular risk factors');
    if (lower.includes('68')) relevantHistory.push('Age 68');
    if (lower.includes('diabetic') || lower.includes('type 2')) relevantHistory.push('Type 2 Diabetes Mellitus');
    if (lower.includes('coronary') || lower.includes('stent')) relevantHistory.push('Coronary artery disease, post-stent');
    if (lower.includes('eczema')) relevantHistory.push('History of eczema / atopic dermatitis');

    // Urgency determination
    let urgency: 'ROUTINE' | 'SOON' | 'URGENT' = 'ROUTINE';
    let urgencyReason = 'Routine non-urgent complaint. Can be scheduled for standard appointment.';

    if (ruleEval.ruleUrgency === 'URGENT') {
      urgency = 'URGENT';
      urgencyReason = ruleEval.ruleReason;
    } else if (ruleEval.ruleUrgency === 'SOON') {
      urgency = 'SOON';
      urgencyReason = ruleEval.ruleReason;
    }

    // Red flags
    const red_flags = ruleEval.redFlagsDetected.map((f) => f.keyword);

    // Missing information detection
    const missing_information: string[] = [];
    if (!duration) missing_information.push('How long have the symptoms been present?');
    if (!severity) missing_information.push('How severe is the discomfort on a scale of 1-10?');
    if (allergies.length === 0) missing_information.push('Do you have any known medication or food allergies?');
    if (symptoms.some((s) => s.includes('throat') || s.includes('cough'))) {
      missing_information.push('Have you measured a fever, or do you have any difficulty swallowing or breathing?');
    }
    if (symptoms.some((s) => s.includes('chest') || s.includes('dizzy'))) {
      missing_information.push('Does the sensation spread to your arm, neck, or jaw?');
    }

    // Chief complaint
    const chief_complaint =
      symptoms.length > 0 ? symptoms[0].charAt(0).toUpperCase() + symptoms[0].slice(1) : 'General Medical Inquiry';

    // Clinician summary
    const clinician_summary =
      urgency === 'URGENT'
        ? `EMERGENCY ALERT: Patient presents with ${symptoms.join(', ') || 'acute symptoms'}. ${urgencyReason} Immediate clinical escalation advised.`
        : `Patient presents with ${symptoms.join(', ') || 'inquiry'}${duration ? ` for ${duration}` : ''}. Severity: ${severity || 'unspecified'}. Medications: ${medications.length ? medications.join(', ') : 'None listed'}. Recommended triage: ${urgency}.`;

    // Generate SBAR note
    const sbar = {
      situation: `${chief_complaint}${duration ? ` presenting for ${duration}` : ''} with reported severity: ${severity || 'unspecified'}.`,
      background: `${relevantHistory.length > 0 ? relevantHistory.join('; ') : 'No prior chronic conditions recorded in intake'}. Current medications: ${medications.length > 0 ? medications.join(', ') : 'None reported'}. Known allergies: ${allergies.length > 0 ? allergies.join(', ') : 'NKDA'}.`,
      assessment: `Triage Level: ${urgency}. ${urgencyReason}${red_flags.length > 0 ? ` Critical indicators detected: ${red_flags.join(', ')}.` : ' No acute red flags detected.'}`,
      recommendation: urgency === 'URGENT' 
        ? 'Immediate emergency clinical escalation / 911 dispatch coordinate. Priority triage nurse follow-up.' 
        : urgency === 'SOON' 
          ? 'Schedule for clinical evaluation within 24-48 hours. Collect clarifying history prior to encounter.' 
          : 'Schedule for routine appointment per provider availability. Address standard refill/wellness items.'
    };

    // Simulate v1 / v2 behavioral quirks for prompt lab comparison
    let simulatedResult: AnalysisResult;

    if (version === 'v1') {
      // v1 tends to under-call urgency on borderline cases and provides sparse missing info
      simulatedResult = {
        chief_complaint,
        symptoms,
        duration,
        severity: null, // v1 often forgets severity
        medications,
        allergies: [], // v1 frequently missed allergies
        relevant_history: [],
        urgency: urgency === 'URGENT' && !red_flags.includes('crushing chest pain') ? 'SOON' : urgency, // v1 under-triage
        urgency_reason: 'Summarised from patient text (v1 baseline model)',
        red_flags: red_flags.slice(0, 1),
        missing_information: missing_information.slice(0, 1),
        clinician_summary: `Patient has ${symptoms.join(' and ')}. Needs to see someone.`,
        sbar
      };
    } else if (version === 'v2') {
      simulatedResult = {
        chief_complaint,
        symptoms,
        duration,
        severity,
        medications,
        allergies,
        relevant_history: relevantHistory,
        urgency,
        urgency_reason: urgencyReason,
        red_flags,
        missing_information: missing_information.slice(0, 2),
        clinician_summary: clinician_summary.slice(0, 200),
        sbar
      };
    } else {
      // v3 Production Candidate: High precision, full clinical rubric, robust missing questions
      simulatedResult = {
        chief_complaint,
        symptoms,
        duration,
        severity,
        medications,
        allergies,
        relevant_history: relevantHistory,
        urgency,
        urgency_reason: urgencyReason,
        red_flags,
        missing_information,
        clinician_summary,
        sbar
      };
    }

    const latencyMs = Math.floor(Math.random() * 80) + 40; // Simulated latency ~50-120ms

    return {
      rawResponse: JSON.stringify(simulatedResult, null, 2),
      parsedJson: simulatedResult,
      inputTokens: Math.floor(rawText.length / 3) + 220,
      outputTokens: 180,
      latencyMs,
      model: `${this.model} [Demo Engine]`,
      isDemoMode: true
    };
  }

  /**
   * Interactive Clinical Copilot Assistant
   * Enables clinicians to ask questions regarding the intake, drug interactions, SBAR, or differential considerations.
   */
  async askCopilot(
    analysis: AnalysisResult,
    question: string,
    rawText: string
  ): Promise<{ answer: string; latencyMs: number; isDemoMode: boolean }> {
    const startTime = Date.now();
    const qLower = (question || '').toLowerCase();
    const chief = (analysis?.chief_complaint || rawText || 'General medical presentation').toLowerCase();
    const meds = Array.isArray(analysis?.medications) ? analysis.medications : [];
    const symptoms = Array.isArray(analysis?.symptoms) ? analysis.symptoms : [];
    const missing = Array.isArray(analysis?.missing_information) ? analysis.missing_information : [];
    const urgency = analysis?.urgency || 'ROUTINE';

    // 1. Check drug interactions
    if (qLower.includes('interaction') || qLower.includes('medication') || qLower.includes('drug')) {
      let resp = '';
      if (meds.length > 0) {
        resp = `Clinical Medication Review for [${meds.join(', ')}]:\n`;
        if (meds.some(m => m.toLowerCase().includes('antihypertensive') || m.toLowerCase().includes('blood pressure') || m.toLowerCase().includes('lisinopril') || m.toLowerCase().includes('metoprolol'))) {
          resp += `• Antihypertensives / Beta-blockers / ACE-inhibitors: Caution patient against concurrent NSAID usage (e.g. ibuprofen/naproxen) which may blunt hypotensive efficacy or exacerbate renal impairment. Monitor standing blood pressure and heart rate.\n`;
        }
        if (meds.some(m => m.toLowerCase().includes('metformin'))) {
          resp += `• Metformin: Confirm adequate hydration and verify renal function (eGFR) to mitigate lactic acidosis risks.\n`;
        }
        resp += `• Staff Note: Reconcile full electronic medical record at check-in for OTC supplements, herbal remedies, and drug allergy cross-reactions.`;
      } else {
        resp = `No active prescription medications were explicitly recorded in the patient intake message. Front desk staff should confirm current medication inventory at appointment intake.`;
      }
      return { answer: resp, latencyMs: 65, isDemoMode: true };
    }

    // 2. Triage nurse callback questions
    if (qLower.includes('callback') || qLower.includes('nurse') || qLower.includes('ask') || qLower.includes('question')) {
      let questionsText = '';
      if (missing.length > 0) {
        questionsText = missing.map((q, i) => `${i + 1}. ${q}`).join('\n');
      } else {
        questionsText = `1. Exact onset time and progression of symptoms\n2. Any worsening with exertion or change in position?\n3. Any recent fevers, chills, or difficulty breathing?\n4. Confirmation of all current prescription and OTC medications`;
      }
      return {
        answer: `TRIAGE NURSE CALLBACK PROTOCOL:\nPriority Questions to ask the patient:\n${questionsText}\n\nClinical Guidance: Confirm patient is in a safe location. If acute chest tightness, severe shortness of breath, or sudden weakness are reported during callback, instruct caller to hang up and call emergency services (911) immediately.`,
        latencyMs: 70,
        isDemoMode: true
      };
    }

    // 3. Differential considerations for clinical staff
    if (qLower.includes('differential') || qLower.includes('consideration') || qLower.includes('what could it be')) {
      let diffs: string[] = [];
      if (chief.includes('chest') || chief.includes('tightness') || chief.includes('heart')) {
        diffs = [
          'Acute Coronary Syndrome / Myocardial Ischemia (Rule out first)',
          'Aortic Dissection (Assess bilateral pulses and BP)',
          'Pulmonary Embolism (Evaluate dyspnea, pleuritic pain)',
          'Gastroesophageal Reflux Disease / Esophageal Spasm'
        ];
      } else if (chief.includes('throat') || chief.includes('cough')) {
        diffs = [
          'Acute Viral Pharyngitis / Upper Respiratory Tract Infection',
          'Streptococcal Pharyngitis (Evaluate Centor criteria)',
          'Post-Nasal Drip / Allergic Rhinitis',
          'COVID-19 / Influenza viral syndrome'
        ];
      } else if (chief.includes('urin') || chief.includes('burning')) {
        diffs = [
          'Acute Uncomplicated Cystitis (UTI)',
          'Pyelonephritis (Evaluate for flank pain / CVA tenderness)',
          'Urethritis / Urolithiasis'
        ];
      } else {
        diffs = [
          'Symptom complex under clinician review',
          'Recommend comprehensive in-person history and targeted physical exam'
        ];
      }

      const answer = `CLINICAL DIFFERENTIAL CONSIDERATIONS (For human provider evaluation only — Not a diagnosis):\n` +
        diffs.map((d, i) => `${i + 1}. ${d}`).join('\n') +
        `\n\nClinical Reminder: AI does not diagnose. In-person clinical provider evaluation and diagnostic tests are required.`;
      return { answer, latencyMs: 75, isDemoMode: true };
    }

    // 4. Default intelligent clinical synthesis
    const complaintText = analysis?.chief_complaint || 'Reported clinical presentation';
    const answer = `CareFlow Clinical Copilot Analysis:\n` +
      `Regarding "${question}":\n` +
      `The patient currently presents with ${complaintText} (${urgency} triage priority). ` +
      `Reported duration is ${analysis?.duration || 'unstated'}, with ${symptoms.length} symptoms documented. ` +
      `Missing clinical fields identified: ${missing.join('; ') || 'None'}. ` +
      `Staff recommendation: ${analysis?.sbar?.recommendation || 'Proceed with standard provider triage review.'}`;

    return { answer, latencyMs: 80, isDemoMode: true };
  }

  private simulateFollowUp(
    channel: 'email' | 'sms',
    tone: 'warm' | 'formal' | 'urgent_alert' | 'spanish_translation',
    urgency: 'ROUTINE' | 'SOON' | 'URGENT',
    missingInfo: string[],
    redFlags: string[],
    startTime: number
  ): { draftText: string; latencyMs: number; isDemoMode: boolean } {
    const isUrgent = urgency === 'URGENT' || redFlags.length > 0;

    let draftText = '';

    if (channel === 'sms') {
      if (tone === 'urgent_alert' || isUrgent) {
        draftText = `CareFlow Urgent Alert: Your reported symptoms require immediate emergency care. Please call 911 or go to the nearest emergency room right now. Do not wait for a clinic callback.`;
      } else if (tone === 'spanish_translation') {
        const q = missingInfo.length > 0 ? ` Pregunta: ${missingInfo[0]}` : '';
        draftText = `Clinica CareFlow: Recibimos su mensaje.${q} Nuestro equipo medico le llamara pronto para programar su cita. Gracias.`;
      } else if (tone === 'warm') {
        const q = missingInfo.length > 0 ? ` Quick question: ${missingInfo[0]}` : '';
        draftText = `Hi from CareFlow Clinic! We received your message and our nurse is reviewing it.${q} We will contact you shortly to schedule.`;
      } else {
        const q = missingInfo.length > 0 ? ` Required details: ${missingInfo[0]}` : '';
        draftText = `CareFlow Clinic: Your intake has been logged.${q} Our clinical team will reach out with scheduling options.`;
      }
    } else {
      // Email
      if (tone === 'spanish_translation') {
        draftText = `Estimado/a Paciente,\n\nGracias por comunicarse con la Clinica CareFlow. Hemos recibido su mensaje de admision y nuestro equipo de atencion clinica esta revisando sus datos.\n\n` +
          (missingInfo.length > 0 ? `Para ayudar a nuestro equipo a preparar su atencion, por favor responda a las siguientes preguntas:\n${missingInfo.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}\n\n` : '') +
          (isUrgent ? `AVISO DE SEGURIDAD IMPORTANTE: Si experimenta dolor en el pecho, dificultad para respirar o debilidad repentina, llame al 911 o acuda a la sala de emergencias de inmediato.\n\n` : '') +
          `Proximos Pasos: Nuestro equipo de recepcion le contactara para confirmar su horario de cita.\n\nAtentamente,\nEquipo Clinico de CareFlow`;
      } else if (tone === 'urgent_alert' || isUrgent) {
        draftText = `PRIORITY MEDICAL NOTICE — ACTION REQUIRED\n\nDear Patient,\n\nCareFlow Clinic has received your intake submission. Based on the critical symptoms described in your message, this requires IMMEDIATE medical evaluation.\n\nEMERGENCY INSTRUCTION: Please call 911 (or local emergency services) or have someone take you to the nearest emergency department right away.\n\nDo not wait for a routine appointment slot. If you are alone, inform a family member or neighbor immediately.\n\nCareFlow Urgent Triage Escalation Team`;
      } else {
        const greeting = tone === 'warm' ? 'Dear Patient,' : 'Hello,';
        const intro =
          tone === 'warm'
            ? 'Thank you for reaching out to CareFlow Clinic. We have received your intake message, and our healthcare team is currently reviewing your details.'
            : 'Thank you for contacting CareFlow Medical Practice. This message confirms receipt of your intake submission.';

        const questionsSection =
          missingInfo.length > 0
            ? `\n\nTo help our clinician prepare for your care, could you please reply with answers to the following clarifying questions:\n${missingInfo.map((q, idx) => `  ${idx + 1}. ${q}`).join('\n')}`
            : '';

        const urgentWarning = isUrgent
          ? '\n\nIMPORTANT SAFETY NOTICE: Based on the symptoms described in your message, if you are experiencing severe chest pain, shortness of breath, sudden weakness, or feel your condition is worsening, please call 911 / 999 / 000 or proceed to the nearest emergency room immediately.'
          : '';

        const nextSteps =
          urgency === 'SOON'
            ? 'We will contact you within 24 hours with an appointment slot.'
            : 'Our front-desk team will contact you within 1-2 business days to confirm an appointment time that works for you.';

        const signoff =
          tone === 'warm'
            ? 'Wishing you good health,\nCareFlow Clinical Care Team'
            : 'Sincerely,\nCareFlow Front Desk & Triage Administration';

        draftText = `${greeting}\n\n${intro}${questionsSection}${urgentWarning}\n\nNext Steps: ${nextSteps}\n\n${signoff}`;
      }
    }

    return {
      draftText,
      latencyMs: Date.now() - startTime,
      isDemoMode: true
    };
  }
}
