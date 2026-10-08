/**
 * Pure, deterministic text functions. No Angular, no network.
 *
 * This is the "code counts" half of the design: Jev 1.13 does not count
 * reliably (docs: model jaggedness), so every total and rate in the app is
 * computed here. Jev is only asked about the occurrences regex cannot judge.
 */
import type { CrutchCandidate } from '../shared/analysis.types';

/** Always a filler when it appears in a transcript. */
export const HARD_FILLERS = ['you know', 'i mean', 'umm', 'um', 'uhh', 'uh', 'erm', 'er', 'hmm', 'mhm', 'ah'] as const;

/** Sometimes a filler, sometimes a real word. Jev decides per occurrence. */
export const AMBIGUOUS_WORDS = [
  'kind of',
  'sort of',
  'like',
  'so',
  'right',
  'actually',
  'basically',
  'literally',
  'okay',
  'well',
  'just',
] as const;

export type HardFiller = (typeof HARD_FILLERS)[number];
export type AmbiguousWord = (typeof AMBIGUOUS_WORDS)[number];

export interface WordHit {
  word: string;
  index: number;
  length: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest alternatives first so "you know" wins over "you". */
function phraseRegex(words: readonly string[]): RegExp {
  const alternation = [...words]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  return new RegExp(`(?<![\\w'])(${alternation})(?![\\w'])`, 'gi');
}

const HARD_RE = phraseRegex(HARD_FILLERS);
const AMBIGUOUS_RE = phraseRegex(AMBIGUOUS_WORDS);

function findAll(text: string, re: RegExp): WordHit[] {
  const hits: WordHit[] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    hits.push({ word: m[1].toLowerCase().replace(/\s+/g, ' '), index: m.index ?? 0, length: m[1].length });
  }
  return hits;
}

export function findHardFillers(text: string): WordHit[] {
  return findAll(text, HARD_RE);
}

export function findAmbiguous(text: string): WordHit[] {
  return findAll(text, AMBIGUOUS_RE);
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Tally hits by word. */
export function tally(hits: readonly { word: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of hits) {
    counts[h.word] = (counts[h.word] ?? 0) + 1;
  }
  return counts;
}

export function perMinute(count: number, elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return 0;
  }
  return (count * 60_000) / elapsedMs;
}

/** Stable candidate id so a verdict from one window is reused in the next. */
export function candidateId(segmentId: string, hit: WordHit): string {
  return `${segmentId}:${hit.index}`;
}

/**
 * Build what Jev sees for one ambiguous occurrence: ±N words of context with
 * the occurrence wrapped in « » so the question can point at it unambiguously.
 */
export function contextFor(text: string, hit: WordHit, wordsEachSide = 8): string {
  const before = text.slice(0, hit.index);
  const target = text.slice(hit.index, hit.index + hit.length);
  const after = text.slice(hit.index + hit.length);

  // Keep original spacing and punctuation; just trim to N tokens each side.
  const left = before.match(new RegExp(`(?:\\S+\\s*){0,${wordsEachSide}}$`))?.[0] ?? '';
  const right = after.match(new RegExp(`^(?:\\s*\\S+){0,${wordsEachSide}}`))?.[0] ?? '';
  return `${left}«${target}»${right}`;
}

export function candidatesFor(segmentId: string, text: string): CrutchCandidate[] {
  return findAmbiguous(text).map((hit) => ({
    id: candidateId(segmentId, hit),
    word: hit.word,
    context: contextFor(text, hit),
  }));
}

/** How a span of transcript should be rendered. */
export type SpanKind = 'text' | 'hard' | 'filler' | 'unsure' | 'meaningful' | 'pending';

export interface Span {
  text: string;
  kind: SpanKind;
  /** Jev's filler probability for ambiguous spans, when known. */
  probability?: number;
}

export const FILLER_THRESHOLD = 0.7;
export const MEANINGFUL_THRESHOLD = 0.4;

export function classify(probability: number | undefined): SpanKind {
  if (probability === undefined) {
    return 'pending';
  }
  if (probability >= FILLER_THRESHOLD) {
    return 'filler';
  }
  if (probability < MEANINGFUL_THRESHOLD) {
    return 'meaningful';
  }
  return 'unsure';
}

/**
 * Split a segment into renderable spans. `verdicts` maps candidate id to
 * Jev's filler probability; occurrences without a verdict render as pending.
 */
export function annotate(segmentId: string, text: string, verdicts: ReadonlyMap<string, number>): Span[] {
  const marks: (WordHit & { kind: SpanKind; probability?: number })[] = [
    ...findHardFillers(text).map((h) => ({ ...h, kind: 'hard' as const })),
    ...findAmbiguous(text).map((h) => {
      const probability = verdicts.get(candidateId(segmentId, h));
      return { ...h, kind: classify(probability), probability };
    }),
  ].sort((a, b) => a.index - b.index);

  const spans: Span[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.index < cursor) {
      continue; // overlapping match (should not happen, but stay safe)
    }
    if (m.index > cursor) {
      spans.push({ text: text.slice(cursor, m.index), kind: 'text' });
    }
    spans.push({ text: text.slice(m.index, m.index + m.length), kind: m.kind, probability: m.probability });
    cursor = m.index + m.length;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), kind: 'text' });
  }
  return spans;
}
