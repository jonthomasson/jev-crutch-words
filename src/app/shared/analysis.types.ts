/**
 * Contract shared by the Angular client and the Node server.
 *
 * The browser never talks to api.typesafe.ai directly: the API only allows
 * the TypeSafe console origin, and the API key must stay server-side anyway.
 * The client posts an AnalyzeRequest to /api/analyze; the server asks Jev
 * and returns an AnalyzeResponse.
 */

/** One occurrence of an ambiguous word ("like", "so", ...) the code found in the transcript. */
export interface CrutchCandidate {
  /** Stable id: `${segmentId}:${charIndex}` so verdicts survive across windows. */
  id: string;
  /** The word as spoken (lower-cased). */
  word: string;
  /** A short window of surrounding text with the occurrence wrapped in « ». */
  context: string;
}

export interface AnalyzeRequest {
  /** The last ~45 seconds of final transcript text. */
  transcript: string;
  /** Ambiguous occurrences that code cannot classify on its own. */
  candidates: CrutchCandidate[];
}

export interface CandidateVerdict {
  id: string;
  word: string;
  /** Jev's probability that the occurrence is a filler (Noul answer, 0..1). */
  fillerProbability: number;
}

export interface ScoreAnswer {
  /** Expected score; may fall between rubric levels (e.g. 1.4). */
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}

export interface ChoiceAnswer<K extends string = string> {
  choice: K;
  confidence: number;
  probabilities: Record<K, number>;
}

export type HabitKey = 'filler_sounds' | 'like' | 'so' | 'you_know' | 'hedging' | 'none';

export const DISRUPTION_LEVELS = ['Clean', 'Light', 'Noticeable', 'Heavy'] as const;

export interface AnalyzeResponse {
  model: string;
  /** Round-trip time measured on the server around the Jev call. */
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
  candidates: CandidateVerdict[];
  disruption: ScoreAnswer;
  /** Noul: probability the speaker sounds hesitant / searching for words. */
  hesitant: number;
  dominantHabit: ChoiceAnswer<HabitKey>;
  /** Exactly what was sent to Jev, so the UI can show it next to the playground. */
  request: { state: unknown; questions: unknown };
}

export interface HealthResponse {
  ok: boolean;
  /** False when TYPESAFE_API_KEY is not set on the server. */
  configured: boolean;
  model: string;
}
