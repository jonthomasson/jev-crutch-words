/**
 * Everything Jev is asked lives here, so the talk can put this file on screen
 * next to the console playground and the two match.
 *
 * Division of labour (see docs.typesafe.ai "How to build with TypeSafe"):
 *   - Code counts. Jev 1.13 does not count reliably, so "um" totals, rates
 *     per minute and thresholds are computed in the browser.
 *   - Jev judges. Whether a given "like" is a filler or a verb is a semantic
 *     call regex cannot make, so each occurrence becomes one Noul question.
 *   - Everything is batched into ONE request per window (speculative fan-out):
 *     N candidate Nouls + a Score + a Noul + a Choice, all over the same state.
 */
import { choice, noul, score, type Questions } from '@typesafe-ai/sdk';
import type { AnalyzeRequest, HabitKey } from '../src/app/shared/analysis.types';

export const DISRUPTION_CRITERIA = [
  'Clean: little or no filler; the speech reads as fluent and deliberate.',
  'Light: an occasional filler that a listener would barely notice.',
  'Noticeable: fillers recur often enough that a listener would notice the habit.',
  'Heavy: fillers crowd the speech and make it hard to follow.',
] as const;

export const HABIT_CRITERIA: Record<HabitKey, string> = {
  filler_sounds: 'Sounds such as "um", "uh", "er", "hmm".',
  like: 'Using "like" as a pad or quotative ("it was, like, huge") rather than for comparison or preference.',
  so: 'Starting or bridging sentences with "so" as a pad rather than to mean "therefore".',
  you_know: 'Check-in phrases such as "you know", "I mean", "right?" used as padding.',
  hedging: 'Softeners such as "kind of", "sort of", "basically", "actually", "just".',
  none: 'No clear crutch-word habit.',
};

/** The state Jev evaluates: the transcript plus the candidate occurrences, by index. */
export function buildState(req: AnalyzeRequest) {
  return {
    transcript: req.transcript,
    candidates: req.candidates.map((c) => ({ word: c.word, context: c.context })),
  };
}

export function candidateKey(index: number): string {
  return `filler_${index}`;
}

export function buildQuestions(req: AnalyzeRequest): Questions {
  const questions: Questions = {};

  // One Noul per ambiguous occurrence. The answer is a probability, so the
  // client can gate on it (>= 0.7 filler, 0.4..0.7 unsure, < 0.4 meaningful).
  req.candidates.forEach((c, i) => {
    questions[candidateKey(i)] = noul(
      {
        question: `In \`candidates[${i}].context\`, is the word wrapped in « » used as a verbal filler?`,
        definition:
          'A verbal filler (crutch word) pads, hedges, or marks hesitation and carries no meaning; ' +
          'deleting it would not change what the speaker is saying.',
      },
      {
        true: `«${c.word}» is a filler here and could be removed without changing the meaning.`,
        false: `«${c.word}» does real work here: a verb, comparison, quantifier, agreement, intensifier, or sequencing word.`,
      },
    );
  });

  // Ordered rubric -> Score. The answer can land between levels (e.g. 1.4) and
  // comes with a probability per level plus a confidence value.
  questions['disruption'] = score(
    "How much do filler and crutch words get in the way of the speaker's clarity in `transcript`?",
    DISRUPTION_CRITERIA,
  );

  // Plain yes/no -> Noul.
  questions['hesitant'] = noul(
    'Does the speaker in `transcript` sound hesitant, or like they are searching for words?',
  );

  // Closed set -> Choice, with a probability for every option and a "none" escape hatch.
  questions['dominant_habit'] = choice(
    'Which crutch-word habit is most prominent in `transcript`?',
    HABIT_CRITERIA,
  );

  return questions;
}
