/**
 * Grounding contract for the AI assistant: "the model narrates and cites, it
 * never computes." Every number in an AI response must exist in the
 * deterministic analysis payload; every doctrine claim must cite a retrieved
 * source. This module builds the system prompt that states that contract and
 * — because a prompt is a request, not a guarantee — validates the model's
 * response against it afterwards.
 *
 * This is a best-effort heuristic, not a formal proof: numeric extraction is
 * regex-based and citation checking is a literal ID match. It is deliberately
 * strict (any unmatched number fails validation) — the caller
 * (`assistantBriefing.ts` / `assistantChat.ts`) treats a failed check as
 * "discard the AI response and fall back to the deterministic template",
 * never as "show it anyway". See docs/AI_ASSISTANT.md for the full contract.
 */

import { DoctrineChunk } from './knowledgeBase';

export interface NumericClaim {
  /** The matched substring, e.g. "4.2 h", "$2,100", "25°". */
  raw: string;
  value: number;
  unit?: string;
}

// Digits (comma-grouped thousands OR a plain digit run), optional leading $,
// optional trailing unit word. The plain-run alternative matters: matching
// only \d{1,3} before comma groups mis-parses an unseparated "$2100" as
// "$210" + "0" (caught by the unit tests). Longer/more specific unit
// alternatives are listed before their prefixes (e.g. "hours?" before "h")
// so regex alternation — which takes the first match at each position —
// picks the more specific one.
const NUMBER_RE = /(\$)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(hours?|hrs?|km\/h|km|ha|minutes?|mins?|m|h|%|°)?/g;

/**
 * Extract numeric claims from free text. Bare small integers with no unit,
 * decimal point, or currency sign (e.g. "one of 3 options") are excluded —
 * low fabrication risk, and including them produces false positives on
 * ordinary list/count phrasing that isn't really a data claim.
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(text)) !== null) {
    const [, dollar, numStr, unitWord] = m;
    if (!numStr) continue;
    const value = parseFloat(numStr.replace(/,/g, ''));
    if (Number.isNaN(value)) continue;
    const unit = dollar ? '$' : unitWord ? unitWord.toLowerCase() : undefined;
    const hasDecimal = numStr.includes('.');
    const isBareSmallInt = !unit && !hasDecimal && Number.isInteger(value) && Math.abs(value) < 10;
    if (isBareSmallInt) continue;
    const raw = `${dollar ?? ''}${numStr}${unitWord ? ` ${unitWord}` : ''}`.trim();
    const key = `${value}|${unit ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ raw, value, unit });
  }
  return claims;
}

const CITATION_RE = /\[\[doc:([a-z0-9-]+)\]\]/gi;

/** Extract `[[doc:ID]]` citation markers the model is required to use. */
export function extractCitationIds(text: string): string[] {
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(text)) !== null) ids.push(m[1].toLowerCase());
  return Array.from(new Set(ids));
}

/** Recursively collect every finite number appearing anywhere in a payload object/array. */
export function flattenPayloadNumbers(payload: unknown): Set<number> {
  const out = new Set<number>();
  const visit = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.add(v);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(visit);
    }
  };
  visit(payload);
  return out;
}

/** Does `value` match a payload number, tolerating the model's own rounding? */
function matchesAnyPayloadNumber(value: number, payloadNumbers: Set<number>): boolean {
  for (const p of payloadNumbers) {
    if (Math.abs(p - value) < 1e-9) return true; // exact
    if (Math.abs(Math.round(p) - value) < 1e-9) return true; // rounded to whole
    if (Math.abs(Math.round(p * 10) / 10 - value) < 1e-9) return true; // rounded to 1dp
    const rel = p !== 0 ? Math.abs(p - value) / Math.abs(p) : Math.abs(value);
    if (rel < 0.01) return true; // ~1% relative tolerance
  }
  return false;
}

export interface GroundingCheckResult {
  ok: boolean;
  /** Numbers the model stated that don't appear (within tolerance) in the payload. */
  unmatchedNumbers: string[];
  /** Citation IDs the model used that weren't in the retrieved set. */
  unknownCitations: string[];
}

/** Validate a model response against the payload it was given and the doctrine it was allowed to cite. */
export function validateGroundedResponse(
  text: string,
  payload: unknown,
  retrievedChunks: DoctrineChunk[]
): GroundingCheckResult {
  const payloadNumbers = flattenPayloadNumbers(payload);
  const unmatchedNumbers = extractNumericClaims(text)
    .filter((c) => !matchesAnyPayloadNumber(c.value, payloadNumbers))
    .map((c) => c.raw);

  const knownIds = new Set(retrievedChunks.map((c) => c.id));
  const unknownCitations = extractCitationIds(text).filter((id) => !knownIds.has(id));

  return {
    ok: unmatchedNumbers.length === 0 && unknownCitations.length === 0,
    unmatchedNumbers,
    unknownCitations,
  };
}

/**
 * Build the system prompt stating the grounding contract, with retrieved
 * doctrine inlined. `audience` describes who is being narrated to and about
 * what — the contract rules themselves (never compute, always cite, say "I
 * don't know") are the same regardless of mode, so this is the only part
 * that varies between the fire-break assistant and the Terrain Mobility
 * assistant (`assistantMobilityBriefing.ts`).
 */
function citationBlockFor(citations: DoctrineChunk[]): string {
  return citations.length
    ? citations.map((c) => `[[doc:${c.id}]] ${c.title} — ${c.source}\n${c.text}`).join('\n\n')
    : '(no doctrine chunks retrieved for this query — do not cite anything)';
}

/** The grounding contract itself — identical wherever it's used (narration,
 * reality-check critique, Terrain Mobility), so it can't drift between
 * personas. Numbered so a persona-specific prompt can still refer to "rule 1"
 * unambiguously. */
const STRICT_RULES = [
  '1. Every number you state (distance, time, cost, slope, percentage, count) MUST come verbatim from the ANALYSIS DATA you are given. Never compute, estimate, round differently, or invent a number.',
  '2. Every doctrine or best-practice claim MUST cite one of the reference chunks below using the exact marker [[doc:ID]] immediately after the claim. Never cite an ID that is not listed below.',
  '3. If the analysis data does not contain the answer to a question, say so plainly and point to the relevant tab (Terrain, Equipment, Assistant) instead of guessing.',
  '4. Be concise, operational, and plain-spoken — this is a field planning tool, not a report.',
  '5. Never present a recommendation as certain when the data itself is flagged estimated/fallback — carry that caveat through.',
];

export function buildSystemPrompt(
  citations: DoctrineChunk[],
  audience: string = 'a firefighter planning a fire break'
): string {
  return [
    `You are the Fire Break Calculator's Plan Assistant, narrating a deterministic analysis to ${audience}.`,
    '',
    'STRICT RULES:',
    ...STRICT_RULES,
    '',
    'REFERENCE CHUNKS (cite ONLY these, by their [[doc:ID]] marker):',
    citationBlockFor(citations),
  ].join('\n');
}

/**
 * System prompt for the "Field Reality Check" persona (assistantRealityCheck.ts):
 * an experienced heavy-plant operator / crew leader's honest, sceptical
 * sanity check on a plan BEFORE it reaches the field — the perspective the
 * app's own credibility review (docs/CALCULATION_REVIEW.md) argued should be
 * baked in rather than assumed present at every desk-planning decision. Same
 * grounding contract as buildSystemPrompt (STRICT_RULES, verbatim) — a
 * critique persona still cannot fabricate a number or a citation; it is a
 * different FRAMING of the same grounded narration, not a licence to guess.
 */
export function buildRealityCheckSystemPrompt(citations: DoctrineChunk[]): string {
  return [
    "You are 'Col' — a fictional, forty-year heavy-plant/hand-crew veteran giving this plan its field reality check before a desk-planned estimate reaches a real crew or operator. Your job is to be usefully sceptical, not to reassure.",
    '',
    'STRICT RULES (identical contract the narration assistant follows — a critique is not licence to guess):',
    ...STRICT_RULES,
    '',
    'REALITY-CHECK INSTRUCTIONS — ground every point in the REALITY-CHECK CONTEXT fields of the ANALYSIS DATA (they exist specifically for this):',
    '6. If lowConfidenceSegmentCount > 0, call out that some ground was classified with low confidence — say how many segments, not "some".',
    '7. If estimatedData is true, say plainly that some of this plan rests on estimated/fallback data, not a measured source.',
    '8. If equipmentCaveats is non-empty, quote at least one caveat verbatim (or close to it) for the tasked equipment — this is exactly the "who actually checked this number" question a field operator would ask.',
    "9. If mobilisationCostIncluded is false, say the shown cost/time does NOT include getting the resource to site (transport, mobilisation, standby) — this is a real, named gap in the cost model (CALCULATION_REVIEW.md), not something to gloss over.",
    '10. Never soften a genuine gap into false reassurance ("should be fine") — state what is unverified and what a crew leader should do about it (spot-check on arrival, confirm ground condition, calibrate locally).',
    '11. If none of the reality-check context fields raise a concern, say so plainly — a clean bill is a real, useful answer, not a reason to invent a caveat.',
    '12. Stay in voice: blunt, plain-spoken, field-experienced — but every sentence must still obey rules 1-5 above.',
    '',
    'REFERENCE CHUNKS (cite ONLY these, by their [[doc:ID]] marker):',
    citationBlockFor(citations),
  ].join('\n');
}
