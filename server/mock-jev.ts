/**
 * Rehearsal stand-in for Jev. Enabled with TYPESAFE_MOCK=1.
 *
 * It fakes the SHAPE of a System One result (probabilities, confidence,
 * legend, usage) with crude heuristics so the UI can be exercised offline.
 * It is not a model; do not read anything into its answers.
 */
import type { Questions } from '@typesafe-ai/sdk';
import type { AnalyzeRequest, HabitKey } from '../src/app/shared/analysis.types';
import { DISRUPTION_CRITERIA, HABIT_CRITERIA, candidateKey } from './jev-questions';

type MockAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** A "like" or "so" next to a comma, or "like" before a number/quote, is usually a pad. */
function fillerHeuristic(context: string, word: string): number {
  const idx = context.indexOf('«');
  const before = context.slice(0, idx).trimEnd();
  const after = context.slice(context.indexOf('»') + 1).trimStart();
  let p = 0.3;
  if (before.endsWith(',') || before === '') p += 0.3;
  if (after.startsWith(',')) p += 0.35;
  if (word === 'like' && /^(i|we|they|you|he|she)\s*$/i.test(before.split(/\s+/).pop() ?? '')) p -= 0.3; // "I like"
  if (word === 'so' && /^(that|much|many|far|good|bad)\b/i.test(after)) p -= 0.3; // "so that", "so much"
  if (word === 'right' && /^(here|there|now|away)\b/i.test(after)) p -= 0.3; // "right here"
  if (/^(kind of|sort of|basically|literally|actually)$/.test(word)) p += 0.25;
  return clamp01(p);
}

function normalize(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / sum);
}

/** Same formula as docs.typesafe.ai/confidence for Choice. */
function choiceConfidence(probabilities: number[]): number {
  const n = probabilities.length;
  const pMax = Math.max(...probabilities);
  return clamp01((pMax - 1 / n) / (1 - 1 / n));
}

/** Same formula as docs.typesafe.ai/confidence for Score. */
function scoreConfidence(probabilities: number[]): number {
  const n = probabilities.length;
  const m = probabilities.indexOf(Math.max(...probabilities));
  const spread = probabilities.reduce((acc, p, i) => acc + p * Math.abs(i - m), 0);
  const evenSpread = Array.from({ length: n }, (_, i) => Math.abs(i - (n - 1) / 2)).reduce((a, b) => a + b, 0) / n;
  return clamp01(1 - spread / evenSpread);
}

export function mockSystemOne(req: AnalyzeRequest, questions: Questions) {
  const answers: Record<string, MockAnswer> = {};

  const fillerCount =
    (req.transcript.match(/\b(um+|uh+|er|erm|hmm|you know|i mean)\b/gi) ?? []).length +
    req.candidates.filter((c) => fillerHeuristic(c.context, c.word) >= 0.7).length;
  const words = req.transcript.split(/\s+/).filter(Boolean).length || 1;
  const density = fillerCount / words; // fillers per word

  req.candidates.forEach((c, i) => {
    answers[candidateKey(i)] = { type: 'noul', noul: fillerHeuristic(c.context, c.word) };
  });

  // Score: peak moves from "Clean" to "Heavy" as density rises.
  const peak = Math.min(3, density * 20);
  const scoreProbs = normalize(DISRUPTION_CRITERIA.map((_, i) => Math.exp(-((i - peak) ** 2) / 0.8)));
  answers['disruption'] = {
    type: 'score',
    score: scoreProbs.reduce((acc, p, i) => acc + p * i, 0),
    confidence: scoreConfidence(scoreProbs),
    probabilities: Object.fromEntries(scoreProbs.map((p, i) => [String(i), p])),
    legend: Object.fromEntries(DISRUPTION_CRITERIA.map((l, i) => [String(i), l])),
  };

  answers['hesitant'] = { type: 'noul', noul: clamp01(density * 6) };

  const habitKeys = Object.keys(HABIT_CRITERIA) as HabitKey[];
  const t = req.transcript.toLowerCase();
  const habitWeights = habitKeys.map((k) => {
    switch (k) {
      case 'filler_sounds':
        return 0.2 + (t.match(/\b(um+|uh+|er|erm|hmm)\b/g) ?? []).length;
      case 'like':
        return 0.2 + req.candidates.filter((c) => c.word === 'like' && fillerHeuristic(c.context, c.word) >= 0.6).length;
      case 'so':
        return 0.2 + req.candidates.filter((c) => c.word === 'so' && fillerHeuristic(c.context, c.word) >= 0.6).length;
      case 'you_know':
        return 0.2 + (t.match(/\b(you know|i mean)\b/g) ?? []).length + (t.match(/\bright\?/g) ?? []).length;
      case 'hedging':
        return 0.2 + req.candidates.filter((c) => /^(kind of|sort of|basically|literally|actually|just)$/.test(c.word)).length;
      case 'none':
        return fillerCount === 0 ? 2 : 0.2;
    }
  });
  const habitProbs = normalize(habitWeights);
  const best = habitProbs.indexOf(Math.max(...habitProbs));
  answers['dominant_habit'] = {
    type: 'choice',
    choice: habitKeys[best],
    confidence: choiceConfidence(habitProbs),
    probabilities: Object.fromEntries(habitKeys.map((k, i) => [k, habitProbs[i]])),
  };

  const inputTokens = Math.round(JSON.stringify({ state: req, questions }).length / 4);
  return { model: 'mock-jev (TYPESAFE_MOCK=1)', answers, usage: { input_tokens: inputTokens, output_tokens: 0 } };
}
