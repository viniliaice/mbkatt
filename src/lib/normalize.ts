/**
 * Name normalization and fuzzy similarity.
 *
 * WhatsApp names and biometric names for the same person rarely look identical:
 *
 *   WhatsApp: "T. Axmed Jaamac"      Attendance: "Ahmed Jaamac Ism"
 *   WhatsApp: "Ikram"                Attendance: "Ikram Axmed"
 *
 * We normalise aggressively for *comparison* while always keeping the original
 * string for display and evidence.
 */

export const TITLE_PREFIXES = [
  'teacher',
  'teachers',
  'tr',
  't',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mister',
  'sir',
  'madam',
  'dr',
  'doctor',
  'ustaad',
  'ustaadka',
  'macalin',
  'macallin',
  'prof',
  'professor',
  'eng',
  'engineer',
  'sayid',
  'sheikh',
  'sheekh',
  'hajji',
  'haji',
  'mr.',
  't.',
];

const TITLE_SET = new Set(TITLE_PREFIXES.map((t) => t.replace(/\.$/, '')));

/** Strips accents/diacritics and normalises apostrophes, punctuation and spaces. */
export function canonicalize(value: string): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´ʾʿ]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Comparison key for a person's name: titles removed, punctuation removed,
 * whitespace collapsed. "T. Axmed Jaamac" -> "axmed jaamac"
 */
export function normalizeName(value: string): string {
  const canonical = canonicalize(value);
  if (!canonical) return '';
  const parts = canonical
    .split(' ')
    .flatMap((part) => part.split('-'))
    .filter(Boolean);
  const withoutTitles: string[] = [];
  for (const part of parts) {
    if (TITLE_SET.has(part)) continue;
    withoutTitles.push(part);
  }
  return withoutTitles.join(' ');
}

export function nameTokens(value: string): string[] {
  return normalizeName(value).split(' ').filter(Boolean);
}

/** Collapses Somali/Latin spelling variation into a comparable skeleton. */
export function phoneticKey(token: string): string {
  let t = canonicalize(token);
  if (!t) return '';
  // Somali digraphs and Latin transliteration variants
  t = t
    .replace(/^(c)(?=[a-z])/, 'a') // cabdi -> abdi, cali -> ali
    .replace(/dh/g, 'd')
    .replace(/kh/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/gh/g, 'g')
    .replace(/x/g, 'h') // axmed -> ahmed
    .replace(/q/g, 'k')
    .replace(/w/g, 'u')
    .replace(/y/g, 'i')
    .replace(/[aeiou]+/g, (match) => match[0]); // collapse vowel runs
  // collapse doubled consonants
  t = t.replace(/([b-df-hj-np-tv-z])\1+/g, '$1');
  return t;
}

/** Explicit transliteration variants for names that are common in the region. */
const VARIANT_MAP: Record<string, string[]> = {
  axmed: ['ahmed', 'ahmad', 'amed'],
  ahmed: ['axmed', 'ahmad'],
  jaamac: ['jamac', 'jama', 'jamak'],
  jamac: ['jaamac', 'jama'],
  xuseen: ['hussein', 'husain', 'xusen', 'huseen'],
  hussein: ['xuseen', 'husain'],
  maxamed: ['mohamed', 'mohammed', 'muhammad', 'maxamad'],
  mohamed: ['maxamed', 'mohammed', 'muhammad'],
  cabdullahi: ['abdullahi', 'abdullaahi', 'cabdi'],
  abdullahi: ['cabdullahi', 'abdullaahi'],
  cabdi: ['abdi', 'cabdulle'],
  abdi: ['cabdi'],
  cali: ['ali'],
  ali: ['cali'],
  nafiisa: ['nafisa', 'nafisah', 'nafisa'],
  nafisa: ['nafiisa'],
  fardosa: ['fardousa', 'fardoosa', 'fardowsa', 'fartun'],
  ikram: ['iqraam', 'ikraam', 'iqram'],
  iqram: ['ikram'],
  huda: ['hudah'],
  saeed: ['said', 'sacid', 'saeid', 'sayid'],
  said: ['saeed', 'sacid'],
  faysal: ['faisal', 'feysal'],
  faisal: ['faysal'],
  nuha: ['nuhaa', 'nuh'],
  ismaciil: ['ismail', 'ismaaciil', 'ismacil'],
  ismail: ['ismaciil'],
  xasan: ['hasan', 'hassan'],
  hasan: ['xasan'],
  xusen: ['xuseen', 'hussein'],
  hodan: ['hodaan'],
  deeqa: ['deeqo'],
  ayaan: ['ayaan'],
  aamina: ['amina', 'aminah'],
  amina: ['aamina'],
  saciid: ['saeed', 'said'],
  sharmarke: ['sharmaarke'],
  warsame: ['warsama'],
  gurey: ['gure'],
};

/** All spelling variants of a single token (including the token itself). */
export function tokenVariants(token: string, includePhonetic = true): string[] {
  const base = canonicalize(token);
  if (!base) return [];
  const variants = new Set<string>([base]);
  for (const variant of VARIANT_MAP[base] ?? []) variants.add(variant);

  if (includePhonetic) {
    const key = phoneticKey(base);
    if (key) {
      variants.add(key);
      for (const [name, list] of Object.entries(VARIANT_MAP)) {
        if (phoneticKey(name) === key) {
          variants.add(name);
          list.forEach((v) => variants.add(v));
        }
      }
    }
    // Drop a single trailing vowel: "fardoosa" -> "fardoos"
    if (variants.size > 1 && base.length > 4) variants.add(base.replace(/a$/, ''));
  }
  return [...variants].filter(Boolean);
}

/** Every comparison key for a full name, including reordered tokens. */
export function nameVariants(value: string, includeReordered = true): string[] {
  const tokens = nameTokens(value);
  if (tokens.length === 0) return [];
  const out = new Set<string>();
  out.add(tokens.join(' '));

  const perToken = tokens.map((token) => tokenVariants(token, true));
  // Cartesian product limited to a sane size (names are short in practice)
  const combine = (index: number, prefix: string[]) => {
    if (index === perToken.length) {
      out.add(prefix.join(' '));
      return;
    }
    for (const variant of perToken[index]) combine(index + 1, [...prefix, variant]);
  };
  if (perToken.reduce((size, list) => size * Math.max(list.length, 1), 1) <= 64) {
    combine(0, []);
  } else {
    out.add(tokens.map((token, i) => (i === 0 ? perToken[i][0] : token)).join(' '));
  }

  if (includeReordered && tokens.length >= 2 && tokens.length <= 4) {
    // first name + last name, last name + first name
    out.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    out.add(`${tokens[tokens.length - 1]} ${tokens[0]}`);
    // first two tokens
    out.add(tokens.slice(0, 2).join(' '));
  }
  return [...out];
}

/* ------------------------------------------------------------------ *
 * Similarity
 * ------------------------------------------------------------------ */

/** Jaro similarity (0..1). */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (k < b.length && !bMatches[k]) k += 1;
    if (k < b.length && a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

/** Jaro-Winkler similarity (0..1), biased towards common prefixes. */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  if (j === 0) return 0;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }
  return j + prefix * prefixScale * (1 - j);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Dice coefficient over bigrams — tolerant to small spelling differences. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (value: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) {
      const gram = value.slice(i, i + 2);
      set.set(gram, (set.get(gram) ?? 0) + 1);
    }
    return set;
  };
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let intersection = 0;
  for (const [gram, count] of aGrams) {
    const other = bGrams.get(gram);
    if (other) intersection += Math.min(count, other);
  }
  return (2 * intersection) / (a.length - 1 + b.length - 1);
}
