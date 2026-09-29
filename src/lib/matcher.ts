/**
 * Name matching engine.
 *
 * Produces a confidence score (0–100) plus the reasoning behind it. Two people
 * are never merged silently: anything below the configured "matched" threshold
 * is reported as a possible match or as unmatched and must be approved by the
 * administrator in the Review Center.
 */

import {
  diceCoefficient,
  jaccard,
  jaroWinkler,
  nameTokens,
  nameVariants,
  normalizeName,
  phoneticKey,
} from './normalize';
import type {
  AliasRule,
  AttendanceEmployee,
  MatchTier,
  NameMatch,
  NameMatchAlternative,
  Settings,
} from './types';

export interface EmployeeIndexEntry {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  normalized: string;
  tokens: string[];
  phoneticTokens: string[];
  variants: Set<string>;
}

export interface EmployeeIndex {
  entries: EmployeeIndexEntry[];
  byNormalized: Map<string, EmployeeIndexEntry[]>;
  byPhonetic: Map<string, EmployeeIndexEntry[]>;
}

export interface MatchOutcome {
  employeeId: string | null;
  employeeName: string | null;
  /** 0..100 */
  confidence: number;
  tier: MatchTier;
  method: string;
  reasons: string[];
  alternatives: NameMatchAlternative[];
}

export const DEFAULT_MATCH_SETTINGS = {
  matchedThreshold: 85,
  possibleThreshold: 62,
};

export function buildEmployeeIndex(employees: AttendanceEmployee[]): EmployeeIndex {
  const entries: EmployeeIndexEntry[] = employees.map((employee) => {
    const normalized = normalizeName(employee.name) || normalizeName(employee.employeeCode ?? '');
    const tokens = nameTokens(employee.name);
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.employeeCode,
      department: employee.department,
      normalized,
      tokens,
      phoneticTokens: tokens.map((token) => phoneticKey(token)),
      variants: new Set(nameVariants(employee.name)),
    };
  });

  const byNormalized = new Map<string, EmployeeIndexEntry[]>();
  const byPhonetic = new Map<string, EmployeeIndexEntry[]>();
  for (const entry of entries) {
    for (const variant of entry.variants) {
      const list = byNormalized.get(variant) ?? [];
      list.push(entry);
      byNormalized.set(variant, list);
    }
    const primaryFirst = entry.phoneticTokens[0];
    if (primaryFirst) {
      const list = byPhonetic.get(primaryFirst) ?? [];
      list.push(entry);
      byPhonetic.set(primaryFirst, list);
    }
  }
  return { entries, byNormalized, byPhonetic };
}

interface Scored {
  entry: EmployeeIndexEntry;
  score: number;
  method: string;
  reasons: string[];
}

/** True when two name tokens refer to the same person with high confidence. */
function sameToken(a: string, b: string, transliteration: boolean): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (transliteration && phoneticKey(a) === phoneticKey(b)) return true;
  return jaroWinkler(a, b) >= 0.88;
}

function scorePair(
  queryNormalized: string,
  queryTokens: string[],
  entry: EmployeeIndexEntry,
  options: { transliteration: boolean },
): Scored {
  const reasons: string[] = [];
  if (!queryNormalized) {
    return { entry, score: 0, method: 'empty', reasons: ['No comparable name.'] };
  }

  // 1. exact normalised equality
  if (queryNormalized === entry.normalized) {
    reasons.push(`Normalised names are identical ("${queryNormalized}").`);
    return { entry, score: 100, method: 'exact (normalized)', reasons };
  }

  // 2. known variant equality (spelling variations / reordering)
  if (entry.variants.has(queryNormalized)) {
    reasons.push(`"${queryNormalized}" is a recorded spelling variant of "${entry.normalized}".`);
    return { entry, score: 96, method: 'spelling variant', reasons };
  }

  const setEntry = new Set(entry.tokens);
  const setQuery = new Set(queryTokens);
  const queryPhonetic = queryTokens.map((token) =>
    options.transliteration ? phoneticKey(token) : token,
  );

  const firstEqual = queryTokens[0] === entry.tokens[0];
  const firstVariant =
    !firstEqual &&
    options.transliteration &&
    Boolean(queryPhonetic[0]) &&
    queryPhonetic[0] === entry.phoneticTokens[0] &&
    queryTokens[0].length > 3;
  const lastEqual =
    queryTokens.length > 0 &&
    entry.tokens.length > 0 &&
    queryTokens[queryTokens.length - 1] === entry.tokens[entry.tokens.length - 1];

  // 3. same first name and last name (order may differ)
  if (firstEqual && lastEqual && queryTokens.length >= 2) {
    reasons.push('First and last name both match (order may differ).');
    return { entry, score: 94, method: 'first + last name', reasons };
  }

  // 4. first name matches and every remaining token corresponds closely
  if ((firstEqual || firstVariant) && queryTokens.length >= 2) {
    const rest = queryTokens.slice(1);
    const entryRest = entry.tokens.slice(1);
    const allRest = rest.every((queryToken) =>
      entryRest.some((entryToken) => sameToken(queryToken, entryToken, options.transliteration)),
    );
    if (allRest) {
      reasons.push(
        `First name matches and the remaining token(s) (${rest.join(', ')}) correspond to "${entryRest.join(
          ', ',
        )}".`,
      );
      return { entry, score: firstEqual ? 92 : 88, method: 'first name + similar surname', reasons };
    }
  }

  // 5. a single-token reference ("Ikram", "Nafiisa", "Teacher Xuseen")
  if (queryTokens.length === 1) {
    const token = queryTokens[0];
    if (firstEqual) {
      reasons.push(`Single-name reference "${token}" matches the first name of "${entry.employeeName}".`);
      return { entry, score: 86, method: 'first name only', reasons };
    }
    if (firstVariant) {
      reasons.push(
        `Single-name reference "${token}" is a transliteration variant of "${entry.tokens[0]}".`,
      );
      return { entry, score: 82, method: 'first name variant only', reasons };
    }
    if (setEntry.has(token)) {
      reasons.push(`"${token}" appears in the attendance name but is not the first name.`);
      return { entry, score: 72, method: 'surname only', reasons };
    }
  }

  // 6. every token of the WhatsApp name appears in the attendance name
  const containment = [...setQuery].every((token) => setEntry.has(token));
  if (containment && setQuery.size >= 2) {
    const coverage = setQuery.size / Math.max(setEntry.size, 1);
    const score = 80 + Math.min(15, coverage * 15) + 3;
    reasons.push(
      `All tokens of the WhatsApp name (${queryTokens.join(', ')}) appear in the attendance name (${entry.tokens.join(', ')}).`,
    );
    return { entry, score: Math.min(96, score), method: 'token containment', reasons };
  }

  // 7. first name matches but the rest of the name does not
  if (firstEqual || firstVariant) {
    const extra = lastEqual ? 4 : 0;
    const score = (firstEqual ? 80 : 74) + extra;
    reasons.push(
      firstEqual
        ? `First name "${queryTokens[0]}" matches "${entry.tokens[0]}", but the other name parts differ.`
        : `First name "${queryTokens[0]}" is a transliteration variant of "${entry.tokens[0]}", but the other name parts differ.`,
    );
    if (queryTokens.length === 1 && entry.tokens.length > 1) {
      reasons.push(
        'The WhatsApp message uses only a first name; extra attendance tokens are acceptable but reduce confidence.',
      );
    }
    return { entry, score, method: firstEqual ? 'first name' : 'first name variant', reasons };
  }

  // 8. fuzzy similarity of the full normalised names and of the token sets
  const jw = jaroWinkler(queryNormalized, entry.normalized);
  const dice = diceCoefficient(queryNormalized, entry.normalized);
  const tokenSet = jaccard(setQuery, setEntry);
  const phoneticSet = jaccard(new Set(queryPhonetic), new Set(entry.phoneticTokens));
  const fuzzy = Math.max(jw, dice, tokenSet, phoneticSet);
  if (fuzzy > 0.62) {
    reasons.push(
      `No exact token match; string similarity (best of Jaro-Winkler ${jw.toFixed(2)}, Dice ${dice.toFixed(
        2,
      )}, token overlap ${tokenSet.toFixed(2)}, phonetic overlap ${phoneticSet.toFixed(2)}).`,
    );
    return { entry, score: Math.round(fuzzy * 88), method: 'fuzzy string similarity', reasons };
  }

  return { entry, score: 0, method: 'no similarity', reasons: [] };
}

/**
 * Matches one WhatsApp name against every attendance employee.
 * Returns the best candidate plus runner-ups for review.
 */
export function matchEmployeeName(
  queryName: string,
  index: EmployeeIndex,
  settings: Pick<Settings, 'matchedThreshold' | 'possibleThreshold' | 'useTransliterationVariants'>,
  options: { excludeEmployeeIds?: (string | null)[] } = {},
): MatchOutcome {
  const queryNormalized = normalizeName(queryName);
  const queryTokens = nameTokens(queryName);
  const excluded = new Set((options.excludeEmployeeIds ?? []).filter(Boolean) as string[]);

  if (!queryNormalized) {
    return {
      employeeId: null,
      employeeName: null,
      confidence: 0,
      tier: 'unmatched',
      method: 'empty',
      reasons: ['The WhatsApp name is empty after normalisation.'],
      alternatives: [],
    };
  }

  const scored: Scored[] = [];
  for (const entry of index.entries) {
    if (excluded.has(entry.employeeId)) continue;
    scored.push(
      scorePair(queryNormalized, queryTokens, entry, {
        transliteration: settings.useTransliterationVariants,
      }),
    );
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];

  if (!best || best.score <= 0) {
    return {
      employeeId: null,
      employeeName: null,
      confidence: 0,
      tier: 'unmatched',
      method: 'no candidate',
      reasons: [
        `No attendance employee name is similar enough to "${queryName}".`,
        `Searched ${index.entries.length} attendance record(s).`,
      ],
      alternatives: [],
    };
  }

  const seenEmployees = new Set<string>();
  const alternatives: NameMatchAlternative[] = [];
  for (const candidate of scored) {
    if (candidate.score < Math.max(45, settings.possibleThreshold - 20)) break;
    if (candidate.entry.employeeId === best.entry.employeeId) continue;
    if (seenEmployees.has(candidate.entry.employeeId)) continue;
    seenEmployees.add(candidate.entry.employeeId);
    alternatives.push({
      employeeId: candidate.entry.employeeId,
      employeeName: candidate.entry.employeeName,
      confidence: candidate.score,
    });
    if (alternatives.length >= 3) break;
  }

  // Two employees are only "ambiguous" when both are genuinely plausible.
  const ambiguous = Boolean(
    runnerUp &&
      best.score >= settings.matchedThreshold &&
      runnerUp.entry.employeeId !== best.entry.employeeId &&
      best.score - runnerUp.score < 6 &&
      runnerUp.score >= settings.matchedThreshold - 6,
  );

  const reasons = [...best.reasons];
  if (ambiguous && runnerUp) {
    reasons.push(
      `Alternative candidate "${runnerUp.entry.employeeName}" scores ${runnerUp.score} — the difference is too small to merge automatically. Confirm the correct person in the Review Center.`,
    );
  }

  let tier: MatchTier;
  let confidence = best.score;
  if (best.score >= settings.matchedThreshold && !ambiguous) {
    tier = 'matched';
  } else if (ambiguous) {
    tier = 'possible';
    confidence = Math.round(best.score * 0.95);
  } else if (best.score >= settings.possibleThreshold) {
    tier = 'possible';
  } else {
    tier = 'unmatched';
  }

  return {
    employeeId: tier === 'unmatched' ? null : best.entry.employeeId,
    employeeName: tier === 'unmatched' ? null : best.entry.employeeName,
    confidence,
    tier,
    method: best.method,
    reasons: [
      ...reasons,
      `Score ${confidence}/100 — "matched" requires ≥ ${settings.matchedThreshold}, "possible" requires ≥ ${settings.possibleThreshold}.`,
    ],
    alternatives,
  };
}

/**
 * Resolves every distinct WhatsApp name to an employee, applying manual aliases
 * first, then automatic matching. Ambiguous names stay ambiguous on purpose.
 */
export function resolveNameMatches(
  names: { name: string; occurrences: number }[],
  employees: AttendanceEmployee[],
  aliases: AliasRule[],
  settings: Settings,
): NameMatch[] {
  const index = buildEmployeeIndex(employees);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const results: NameMatch[] = [];

  // Attendance employees already claimed by an unambiguous 1:1 match
  // WhatsApp names already resolved manually
  const claimed = new Map<string, string>(); // employeeId -> whatsappName

  // Pass 1 — manual aliases win
  for (const item of names) {
    const normalized = normalizeName(item.name);
    const alias = aliases.find((rule) => normalizeName(rule.whatsappName) === normalized);
    if (!alias) continue;
    const employee = employeeById.get(alias.employeeId);
    if (!employee) continue;
    results.push({
      id: `nm-${normalized.replace(/\s+/g, '-')}`,
      whatsappName: item.name,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.employeeCode,
      department: employee.department,
      confidence: 100,
      tier: 'manual',
      method: 'manual alias',
      reasons: [
        `An administrator linked "${item.name}" to "${employee.name}" in the Review Center.`,
      ],
      alternatives: [],
      occurrences: item.occurrences,
      manual: true,
    });
    claimed.set(employee.id, item.name);
  }

  // Pass 2 — automatic matching
  for (const item of names) {
    const normalized = normalizeName(item.name);
    if (results.some((result) => normalizeName(result.whatsappName) === normalized)) continue;
    const outcome = matchEmployeeName(item.name, index, settings);

    results.push({
      id: `nm-${normalized.replace(/\s+/g, '-')}`,
      whatsappName: item.name,
      employeeId: outcome.tier === 'unmatched' ? null : outcome.employeeId,
      employeeName: outcome.employeeName,
      employeeCode: outcome.employeeId
        ? (employeeById.get(outcome.employeeId)?.employeeCode ?? null)
        : null,
      department: outcome.employeeId
        ? (employeeById.get(outcome.employeeId)?.department ?? null)
        : null,
      confidence: outcome.confidence,
      tier: outcome.tier,
      method: outcome.method,
      reasons: outcome.reasons,
      alternatives: outcome.alternatives.filter(
        (alternative) => alternative.employeeId !== outcome.employeeId,
      ),
      occurrences: item.occurrences,
      manual: false,
    });
  }

  return results;
}
