/**
 * Classification engine.
 *
 * Two questions are answered for every WhatsApp message:
 *   1. Is it about STAFF, about STUDENTS, or is it UNCERTAIN?
 *   2. Which attendance event(s) does it describe?
 *
 * Everything is keyword- and lexicon-driven (never generative): each decision
 * records the exact substring that caused it, so the UI can explain itself.
 */

import type {
  Audience,
  DetectedEvent,
  MessageClassification,
  MentionedPerson,
  StaffEventType,
} from './types';

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export interface ClassifyContext {
  /** normalised full names of known staff, e.g. "ikram" */
  staffNames: Set<string>;
  /** normalised single tokens of known staff, e.g. "ikram", "jaamac" */
  staffTokens: Set<string>;
  /** normalised aliases configured by the administrator */
  aliases: Set<string>;
  /** message senders (used to recognise first-person messages) */
  senders: Set<string>;
  /** extra staff-only words */
  customStaffWords: string[];
  /** extra student-only words */
  customStudentWords: string[];
}

export function emptyClassifierContext(): ClassifyContext {
  return {
    staffNames: new Set(),
    staffTokens: new Set(),
    aliases: new Set(),
    senders: new Set(),
    customStaffWords: [],
    customStudentWords: [],
  };
}

export function defaultClassification(): MessageClassification {
  return {
    audience: 'uncertain',
    audienceConfidence: 0,
    audienceReasons: [],
    audienceSignals: [],
    events: [],
    mentions: [],
    studentInfo: [],
    busInfo: [],
    notes: [],
  };
}

function normalizeText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Student / staff signals
 * ------------------------------------------------------------------ */

interface SignalPattern {
  label: string;
  kind: 'student' | 'staff';
  weight: number;
  regex: RegExp;
}

const STUDENT_PATTERNS: SignalPattern[] = [
  { label: 'bus', kind: 'student', weight: 3, regex: /\bbus(?:es)?\b|\bschool\s+bus\b|\bvaan\b|\bvan\b(?!\s+driver)/g },
  { label: 'grade', kind: 'student', weight: 3, regex: /\bgrade\s*[-#]?\s*\d{1,2}\b|\bgr\.?\s*[-#]?\s*\d{1,2}\b/g },
  { label: 'grade shorthand', kind: 'student', weight: 3, regex: /\bg\s*-?\s*(?:1[0-2]|[1-9])\b/g },
  { label: 'students', kind: 'student', weight: 2.5, regex: /\bstudents?\b|\bpupils?\b|\bchildren\b|\bcarruur\b|\bcaruur\b|\barbaca\b/g },
  { label: 'class', kind: 'student', weight: 1.5, regex: /\bclasses?\b|\bclassroom\b|\bfasalka\b/g },
  { label: 'section', kind: 'student', weight: 1.5, regex: /\bsections?\b|\bstream\b/g },
  { label: 'transport', kind: 'student', weight: 2, regex: /\btransport\b|\broute\s*\d*\b|\bpick\s*-?\s*up\b|\bdrop\s*-?\s*off\b|\bschool\s+run\b/g },
  { label: 'exam/lesson', kind: 'student', weight: 1.5, regex: /\bexams?\b|\btests?\b|\bhomework\b|\blesson\b|\bimtixaan\b/g },
  { label: 'parent', kind: 'student', weight: 1, regex: /\bparents?\b|\bwaalid\b|\bhooyo\b|\baabbe\b/g },
];

const STAFF_PATTERNS: SignalPattern[] = [
  { label: 'staff title', kind: 'staff', weight: 3, regex: /\bteachers?\b|\bustaad(?:ka)?\b|\bmacallin\b|\bmacalin\b|\bstaaf\b|\bstaff\b/g },
  { label: 'personal title', kind: 'staff', weight: 2.5, regex: /\b(?:mr|mrs|ms|miss|dr)\.?\s+[a-z]/g },
  { label: 'T. abbreviation', kind: 'staff', weight: 3, regex: /(?:^|[\s(])t\.\s*[a-z]/g },
  { label: 'teacher noun', kind: 'staff', weight: 2, regex: /\bteacher'?s?\b/g },
  { label: 'colleague', kind: 'staff', weight: 2, regex: /\bcolleagues?\b|\bstaffroom\b|\bemployees?\b/g },
];

interface Match {
  label: string;
  kind: 'student' | 'staff';
  weight: number;
  text: string;
  offset: number;
}

function findSignals(text: string, source: string): Match[] {
  const out: Match[] = [];
  for (const pattern of source === 'student' ? STUDENT_PATTERNS : STAFF_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      out.push({
        label: pattern.label,
        kind: pattern.kind,
        weight: pattern.weight,
        text: text.slice(m.index, m.index + m[0].length),
        offset: m.index,
      });
      if (m[0].length === 0) regex.lastIndex += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Event lexicon
 * ------------------------------------------------------------------ */

interface EventPattern {
  type: StaffEventType;
  regex: RegExp;
  /** when true the negative construction itself is the signal ("not coming") */
  selfNegated?: boolean;
  weight?: number;
}

const EVENT_PATTERNS: EventPattern[] = [
  // Absence — including its own negative constructions
  {
    type: 'ABSENT',
    selfNegated: true,
    regex:
      /\b(?:is|are|will be|won't be|wont be|not)\s+abs(?:ent|ence)\b|\babs(?:ent|ence)\b|\bnot\s+com(?:ing|e|es)\b|\bwon'?t\s+com(?:ing|e)\b|\bwill\s+not\s+com(?:ing|e)\b|\bno\s+show\b|\bdid\s*n[o']?t\s+come\b|\bmissing\s+(?:today|from)\b|\bwon'?t\s+attend\b|\bnot\s+attend(?:ing)?\b|\bnot\s+in\s+today\b|\bwon'?t\s+make\s+it\b|\bno\s+one\s+at\b/g,
  },
  // Sick
  {
    type: 'SICK',
    regex:
      /\bsick\b|\bill(?:ness)?\b|\bunwell\b|\bnot\s+feeling\s+(?:well|good)\b|\bfever\b|\bflu\b|\bmalaria\b|\binfection\b|\bsick\s+leave\b|\bjirro\b|\bxanuun\b|\bmedical\s+leave\b|\bhealth\s+issue\b/g,
  },
  {
    type: 'HOSPITAL',
    regex:
      /\bhospital\b|\bhospitalis?[sz]ed\b|\badmitted\b|\bclinic\b|\bdialysis\b|\bsurgery\b|\boperation\b|\bmaternity\b|\bicu\b|\bemergency\s+room\b|\bdoctor\b/g,
  },
  {
    type: 'FUNERAL',
    regex:
      /\bfunerals?\b|\bburials?\b|\bjanazah\b|\bjanaaza\b|\baas\b|\btacsi\b|\bta'?si\b|\bdeath\b|\bdied\b|\bpassed\s+away\b|\bcondolence\b|\bcondolences\b|\bbereavement\b|\bloss\s+of\b|\bmourning\b/g,
  },
  {
    type: 'EMERGENCY',
    regex:
      /\bemergenc(?:y|ies)\b|\burgent(?:ly)?\b|\bcritical\b|\baccident\b|\bserious\s+(?:matter|issue|problem)\b|\bproblem\s+at\s+home\b|\bdhibaato\b/g,
  },
  {
    type: 'LEFT_EARLY',
    regex:
      /\bleft\s+early\b|\bleaving\s+early\b|\bleave\s+early\b|\bwent\s+home\s+early\b|\bleft\s+(?:already|now|at)\b|\bleaving\s+(?:now|already|today)\b|\bwent\s+out\s+early\b|\bdismissed\s+early\b|\bleft\s+the\s+(?:school|building|campus)\b|\bhad\s+to\s+leave\b|\bhas\s+left\b/g,
  },
  {
    type: 'GOING_HOME',
    regex:
      /\bgoing\s+home\b|\bwent\s+home\b|\bgoing\s+back\s+home\b|\bgone\s+home\b|\bleft\s+for\s+home\b|\bhometo\b|\bguriga\b/g,
  },
  {
    type: 'ON_THE_WAY',
    regex:
      /\bon\s+(?:the|my|his|her|their|our)\s+way\b|\b(?:is|are|am|'m)\s+coming\b|\botw\b|\barriving\s+(?:now|soon|shortly)\b|\babout\s+to\s+(?:arrive|reach)\b|\bwill\s+be\s+there\s+soon\b|\bsocdaa?\b/g,
  },
  {
    type: 'LATE',
    regex:
      /\blate\b|\blateness\b|\bdelayed?\b|\bdelay\b|\barriv(?:e|ing)\s+late\b|\bcoming\s+late\b|\bwill\s+be\s+in\s+late\b|\bdaah\b|\bdaahay\b|\b\d+\s*(?:min|mins|minutes?|hrs?|hours?)\s+late\b/g,
  },
  {
    type: 'PERSONAL',
    regex:
      /\bpersonal\b|\bfamily\s+(?:matter|issue|problem|emergency|reason|commitment)\b|\bpermission\b|\bexcuse\b|\bappointment\b|\btravel\b|\bvisa\b|\brequest(?:ing)?\s+(?:a\s+)?(?:day|leave|off)\b|\bday\s+off\b|\boff\s+today\b|\bleave\s+request\b|\bqoys\b/g,
  },
];

const NEGATORS = [
  'not',
  'no',
  "n't",
  'never',
  'without',
  'nor',
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "won't",
  "don't",
  "doesn't",
  "didn't",
  "cannot",
  "can't",
];

function hasNegationBefore(text: string, offset: number, window = 40): boolean {
  const start = Math.max(0, offset - window);
  const slice = text.slice(start, offset);
  const tail = slice.split(/[.,;:!?]/).pop() ?? slice;
  const words = tail.trim().split(/\s+/).filter(Boolean).slice(-4);
  if (words.length === 0) return false;
  return words.some((word) => {
    const clean = word.replace(/[^a-z']/g, '');
    return NEGATORS.includes(clean) || NEGATORS.includes(word);
  });
}

const EVENT_ORDER: StaffEventType[] = [
  'ABSENT',
  'SICK',
  'HOSPITAL',
  'FUNERAL',
  'EMERGENCY',
  'LEFT_EARLY',
  'GOING_HOME',
  'ON_THE_WAY',
  'LATE',
  'PERSONAL',
  'UNKNOWN',
];

export function detectEvents(rawText: string): DetectedEvent[] {
  const text = normalizeText(rawText);
  const found = new Map<StaffEventType, DetectedEvent>();

  for (const pattern of EVENT_PATTERNS) {
    const regex = new RegExp(
      pattern.regex.source,
      pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`,
    );
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const offset = m.index;
      const negated = !pattern.selfNegated && hasNegationBefore(text, offset);
      const existing = found.get(pattern.type);
      const candidate: DetectedEvent = {
        type: pattern.type,
        phrase: rawText.slice(offset, offset + m[0].length),
        negated,
        confidence: negated ? 0.3 : pattern.selfNegated ? 0.95 : 0.85,
        offset,
      };
      if (!existing || (existing.negated && !negated)) {
        found.set(pattern.type, candidate);
      }
      if (m[0].length === 0) regex.lastIndex += 1;
    }
  }

  // Negated matches ("he is not late", "she is not sick") never count as events.
  const active = [...found.values()].filter((e) => !e.negated);
  if (active.length === 0) return [];

  // Funerals / emergencies are absence *context*. They must not swallow a real
  // absence signal, but they do describe why somebody is away — the spec asks to
  // keep them as their own event, so we simply order them for display.
  active.sort((a, b) => EVENT_ORDER.indexOf(a.type) - EVENT_ORDER.indexOf(b.type));
  return active;
}

/* ------------------------------------------------------------------ *
 * Name mentions
 * ------------------------------------------------------------------ */

const TITLE_REGEX =
  /\b(?:teacher|teachers|t|tr|mr|mrs|ms|miss|ustaad|ustaadka|macallin|macalin|dr)\.?\s+((?:[A-Za-z\u00c0-\u024f'’-]+\s*){1,4})/gi;

const STOP_WORDS = new Set([
  'will',
  'is',
  'was',
  'are',
  'am',
  'be',
  'been',
  'has',
  'have',
  'had',
  'and',
  'also',
  'but',
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'from',
  'with',
  'today',
  'tomorrow',
  'yesterday',
  'morning',
  'afternoon',
  'evening',
  'night',
  'sick',
  'late',
  'absent',
  'absence',
  'left',
  'leave',
  'leaving',
  'went',
  'gone',
  'going',
  'come',
  'coming',
  'not',
  'no',
  'home',
  'hospital',
  'funeral',
  'early',
  'time',
  'min',
  'mins',
  'minute',
  'minutes',
  'hour',
  'hours',
  'day',
  'days',
  'out',
  'back',
  'way',
  'my',
  'his',
  'her',
  'our',
  'their',
  'he',
  'she',
  'they',
  'it',
  'this',
  'that',
  'just',
  'now',
  'still',
  'soon',
  'again',
  'please',
  'thanks',
  'thank',
  'good',
  'ok',
  'okay',
  'yes',
  'sorry',
  'may',
  'might',
  'should',
  'would',
  'could',
  'can',
  'cannot',
  'there',
  'here',
  'when',
  'where',
  'why',
  'how',
  'what',
  'which',
  'who',
  'if',
  'so',
  'as',
  'than',
  'then',
  'because',
  'due',
  'very',
  'much',
  'more',
  'most',
  'some',
  'any',
  'all',
  'one',
  'two',
  'three',
  'bus',
  'grade',
  'student',
  'students',
  'class',
  'section',
]);

/**
 * Removes leading/trailing stop words from a captured name candidate and reports
 * how many characters were trimmed from the front so offsets stay accurate.
 */
function trimName(candidate: string): { name: string; removedPrefix: number } {
  let removedPrefix = 0;
  let rest = candidate;

  for (;;) {
    const lead = /^\s*([^\s,.;]+)[,.;]?\s*/.exec(rest);
    if (!lead) break;
    const clean = lead[1].replace(/[^\p{L}'’-]/gu, '').toLowerCase();
    if (clean && STOP_WORDS.has(clean)) {
      removedPrefix += lead[0].length;
      rest = rest.slice(lead[0].length);
      continue;
    }
    break;
  }

  const words = rest.trim().split(/\s+/);
  while (words.length > 0) {
    const clean = words[words.length - 1].replace(/[^\p{L}'’-]/gu, '').toLowerCase();
    if (STOP_WORDS.has(clean)) words.pop();
    else break;
  }

  return { name: words.join(' ').trim(), removedPrefix };
}

const FIRST_PERSON =
  /\b(?:i|i'm|im|i am|i'll|i will|i've|i have|we|we're|we are|we'll|my|our)\b/i;

export function extractMentions(
  rawText: string,
  sender: string | null,
  context: ClassifyContext,
): { mentions: MentionedPerson[]; isFirstPerson: boolean } {
  const text = normalizeText(rawText);
  const raw = rawText;
  const found: MentionedPerson[] = [];
  const taken: [number, number][] = [];

  const overlaps = (start: number, end: number) =>
    taken.some(([s, e]) => start < e && end > s);

  // 1. First person: the sender is the subject ("I'll be in late")
  const isFirstPerson = FIRST_PERSON.test(text) && Boolean(sender);
  if (isFirstPerson && sender) {
    found.push({
      text: sender,
      normalized: normalizeText(sender),
      offset: 0,
      isSelf: true,
    });
  }

  // 2. Explicit titles: "Teacher Nuha", "T. Axmed Jaamac", "Mr Xuseen"
  TITLE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TITLE_REGEX.exec(raw)) !== null) {
    const rawCandidate = m[1];
    const { name: candidate, removedPrefix } = trimName(rawCandidate);
    if (!candidate) continue;
    const start = m.index + m[0].indexOf(rawCandidate) + removedPrefix;
    const end = start + candidate.length;
    if (overlaps(start, end)) continue;
    taken.push([start, end]);
    found.push({
      text: candidate,
      normalized: normalizeText(candidate),
      offset: start,
      isSelf: false,
    });
  }

  // 3. Known staff names from the roster / aliases (word-boundary, longest first)
  const vocabulary = [...context.aliases, ...context.staffNames]
    .filter((name) => name.length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const name of vocabulary) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^\\p{L}])(${escaped})(?=[^\\p{L}]|$)`, 'giu');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index + match[0].indexOf(match[1]);
      const end = start + match[1].length;
      if (overlaps(start, end)) continue;
      taken.push([start, end]);
      const originalText = raw.length === text.length ? raw.slice(start, end) : match[1];
      found.push({
        text: originalText,
        normalized: normalizeText(originalText),
        offset: start,
        isSelf: false,
      });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }

  // 4. Single staff tokens (e.g. "Ikram will be late" with roster token "ikram")
  const singleTokens = [...context.staffTokens]
    .filter((token) => token.length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const token of singleTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^\\p{L}'])(${escaped})(?=[^\\p{L}']|$)`, 'giu');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index + match[0].indexOf(match[1]);
      const end = start + match[1].length;
      if (overlaps(start, end)) continue;
      taken.push([start, end]);
      const originalText = raw.length === text.length ? raw.slice(start, end) : match[1];
      found.push({
        text: originalText,
        normalized: normalizeText(originalText),
        offset: start,
        isSelf: false,
      });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }

  // De-duplicate identical mention strings
  const unique: MentionedPerson[] = [];
  const seen = new Set<string>();
  for (const mention of found) {
    const key = `${mention.normalized}|${mention.isSelf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(mention);
  }

  return { mentions: unique, isFirstPerson };
}

/* ------------------------------------------------------------------ *
 * Main classifier
 * ------------------------------------------------------------------ */

export type ClassificationResult = MessageClassification;

export function classifyMessage(rawText: string, context: ClassifyContext): ClassificationResult {
  const text = normalizeText(rawText);
  const reasons: string[] = [];
  const signals: { term: string; kind: 'student' | 'staff'; offset: number }[] = [];

  const studentHits = findSignals(text, 'student');
  const staffHits = findSignals(text, 'staff');

  // Custom vocabulary from Settings
  for (const word of context.customStudentWords) {
    const w = normalizeText(word);
    if (w && text.includes(w)) {
      studentHits.push({ label: 'custom student term', kind: 'student', weight: 3, text: w, offset: text.indexOf(w) });
    }
  }
  for (const word of context.customStaffWords) {
    const w = normalizeText(word);
    if (w && text.includes(w)) {
      staffHits.push({ label: 'custom staff term', kind: 'staff', weight: 3, text: w, offset: text.indexOf(w) });
    }
  }

  const { mentions } = extractMentions(rawText, null, context);

  // Roster hits are strong staff evidence
  let rosterWeight = 0;
  for (const mention of mentions) {
    if (mention.isSelf) continue;
    const normalized = mention.normalized;
    if (context.aliases.has(normalized) || context.staffNames.has(normalized)) {
      rosterWeight += 3;
    } else if (
      normalized
        .split(' ')
        .some((token) => context.staffTokens.has(token) && token.length >= 4)
    ) {
      rosterWeight += 2.5;
    }
  }
  if (rosterWeight > 0) {
    staffHits.push({
      label: 'known staff name',
      kind: 'staff',
      weight: Math.min(rosterWeight, 4),
      text: mentions.map((x) => x.text).join(', '),
      offset: 0,
    });
  }

  const weight = (hits: Match[]) => {
    const byLabel = new Map<string, number>();
    for (const hit of hits) {
      byLabel.set(hit.label, Math.max(byLabel.get(hit.label) ?? 0, hit.weight));
    }
    return [...byLabel.values()].reduce((sum, value) => sum + value, 0);
  };

  const studentScore = weight(studentHits);
  const staffScore = weight(staffHits);

  for (const hit of [...studentHits, ...staffHits]) {
    signals.push({ term: hit.text || hit.label, kind: hit.kind, offset: hit.offset });
  }

  const events = detectEvents(rawText);
  let audience: Audience;
  let audienceConfidence: number;

  // A message that explicitly mentions students/bus/grade is student business,
  // unless it clearly also talks about the staff roster *and* has no bus/grade
  // signal (e.g. "Teacher Nuha is with grade 3 today" → still student logistics,
  // so a plain grade/bus hit always wins).
  const hardStudent = studentHits.some((hit) => hit.weight >= 3);

  if (hardStudent && staffScore === 0) {
    audience = 'student';
    audienceConfidence = 0.95;
  } else if (hardStudent && staffScore > 0) {
    audience = 'student';
    audienceConfidence = 0.7;
    reasons.push(
      'Contains both student terms (bus/grade) and staff terms — classified as student because bus/grade terms are explicit.',
    );
  } else if (studentScore > 0 && staffScore === 0) {
    audience = 'student';
    audienceConfidence = 0.75;
  } else if (staffScore >= 3 && studentScore < 3) {
    audience = 'staff';
    audienceConfidence = 0.9;
  } else if (staffScore > 0 && studentScore === 0) {
    audience = 'staff';
    audienceConfidence = mentions.length > 0 || events.length > 0 ? 0.75 : 0.55;
  } else if (events.length > 0 && studentScore === 0) {
    // "I'll be in late", "on my way" … describes an attendance event with no
    // student vocabulary anywhere — staff notification.
    audience = 'staff';
    audienceConfidence = 0.6;
    reasons.push('Describes an attendance event and contains no student terms.');
  } else if (studentScore > staffScore) {
    audience = 'student';
    audienceConfidence = 0.6;
  } else if (staffScore > studentScore) {
    audience = 'staff';
    audienceConfidence = 0.6;
  } else {
    audience = 'uncertain';
    audienceConfidence = 0.35;
    reasons.push(
      'No clear student term (bus/grade) and no clear staff reference was found in this message.',
    );
  }

  // Evidence strings for the UI
  for (const hit of studentHits) {
    reasons.push(`Student term "${hit.text}" (${hit.label}).`);
  }
  for (const hit of staffHits) {
    reasons.push(`Staff term "${hit.text}" (${hit.label}).`);
  }
  if (mentions.length > 0) {
    reasons.push(
      `Person(s) mentioned: ${mentions.map((x) => `"${x.text}"`).join(', ')}${isFirstPersonLabel(mentions)}.`,
    );
  }
  if (events.length > 0) {
    reasons.push(`Attendance event(s): ${events.map((e) => `${e.type} ("${e.phrase}")`).join(', ')}.`);
  }

  const studentInfo: string[] = [];
  const busInfo: string[] = [];
  for (const hit of studentHits) {
    if (hit.label === 'bus' || hit.label === 'transport') busInfo.push(hit.text);
    else studentInfo.push(hit.text);
  }
  const busNumber = /\bbus\s*[-#]?\s*(\d{1,3})\b/i.exec(rawText);
  if (busNumber) busInfo.push(busNumber[0]);

  const notes: string[] = [];
  if (events.length === 0 && audience === 'staff') {
    events.push({
      type: 'UNKNOWN',
      phrase: '',
      negated: false,
      confidence: 0.2,
      offset: 0,
    });
    notes.push('Staff message without a recognised attendance keyword — needs manual review.');
  }

  return {
    audience,
    audienceConfidence,
    audienceReasons: reasons,
    audienceSignals: signals,
    events,
    mentions,
    studentInfo: [...new Set(studentInfo)],
    busInfo: [...new Set(busInfo)],
    notes,
  };
}

function isFirstPersonLabel(mentions: MentionedPerson[]): string {
  return mentions.some((m) => m.isSelf) ? ' (written in the first person)' : '';
}

/** Re-runs classification with an up-to-date context (after aliases/roster change). */
export function reclassifyMessage(
  rawText: string,
  sender: string | null,
  context: ClassifyContext,
): ClassificationResult {
  const base = classifyMessage(rawText, context);
  const { mentions, isFirstPerson } = extractMentions(rawText, sender, context);
  if (isFirstPerson && mentions.length > 0) {
    const self = mentions.find((m) => m.isSelf);
    const others = mentions.filter((m) => !m.isSelf);
    base.mentions = self ? [self, ...others] : others;
  } else {
    base.mentions = mentions;
  }
  return base;
}

/** The text used to attach a notification to an employee ("who is this about?"). */
export function primarySubject(classification: MessageClassification): MentionedPerson | null {
  if (classification.mentions.length === 0) return null;
  const self = classification.mentions.find((m) => m.isSelf);
  if (self) return self;
  return classification.mentions[0];
}
