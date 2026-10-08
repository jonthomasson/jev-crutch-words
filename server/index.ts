/**
 * Tiny Express hop between the Angular app and api.typesafe.ai.
 *
 * Why it exists:
 *   1. The TypeSafe API rejects browser origins other than its own console
 *      (CORS preflight from http://localhost:4200 -> "Disallowed CORS origin").
 *   2. The API key must never ship to the browser.
 *
 * Run with:  npm run server   (reads TYPESAFE_API_KEY from .env or the environment)
 */
import { config as loadEnv } from 'dotenv';
import express, { type Request, type Response } from 'express';

// .env.local wins over .env; both are git-ignored. Real env vars win over both.
loadEnv({ path: ['.env.local', '.env'], quiet: true });
import {
  APIError,
  AuthenticationError,
  RateLimitError,
  TypeSafeClient,
  type ChoiceResponse,
  type NoulResponse,
  type ScoreResponse,
} from '@typesafe-ai/sdk';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  HabitKey,
  HealthResponse,
} from '../src/app/shared/analysis.types';
import { buildQuestions, buildState, candidateKey } from './jev-questions';
import { mockSystemOne } from './mock-jev';

const PORT = Number(process.env['PORT'] ?? 3000);
const MODEL = process.env['TYPESAFE_MODEL'] ?? 'jev-latest';
const MAX_CANDIDATES = 20;
/** TYPESAFE_MOCK=1 answers locally with a heuristic stand-in (rehearsals, offline). */
const MOCK = process.env['TYPESAFE_MOCK'] === '1';

const apiKey = process.env['TYPESAFE_API_KEY'];
const client = apiKey ? new TypeSafeClient({ apiKey, defaultModel: MODEL, timeout: 15_000 }) : null;

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req: Request, res: Response<HealthResponse>) => {
  res.json({ ok: true, configured: client !== null || MOCK, model: MOCK ? 'mock-jev' : MODEL });
});

app.post('/api/analyze', async (req: Request, res: Response) => {
  if (!client && !MOCK) {
    res.status(503).json({ error: 'no_api_key', message: 'TYPESAFE_API_KEY is not set on the server.' });
    return;
  }

  const body = req.body as Partial<AnalyzeRequest> | undefined;
  if (!body || typeof body.transcript !== 'string' || !Array.isArray(body.candidates)) {
    res.status(400).json({ error: 'bad_request', message: 'Expected { transcript: string, candidates: [] }.' });
    return;
  }
  if (body.transcript.trim().length === 0) {
    res.status(400).json({ error: 'bad_request', message: 'Transcript is empty.' });
    return;
  }

  const request: AnalyzeRequest = {
    transcript: body.transcript,
    candidates: body.candidates.slice(-MAX_CANDIDATES),
  };

  const state = buildState(request);
  const questions = buildQuestions(request);

  try {
    const started = performance.now();
    const result = client ? await client.systemOne({ state, questions }) : mockSystemOne(request, questions);
    const latencyMs = Math.round(performance.now() - started);

    // Question keys were built dynamically, so narrow the answers by hand.
    const answers = result.answers as Record<string, NoulResponse | ScoreResponse | ChoiceResponse>;
    const disruption = answers['disruption'] as ScoreResponse;
    const hesitant = answers['hesitant'] as NoulResponse;
    const habit = answers['dominant_habit'] as ChoiceResponse<Record<HabitKey, string>>;

    const response: AnalyzeResponse = {
      model: result.model,
      latencyMs,
      usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
      candidates: request.candidates.map((c, i) => ({
        id: c.id,
        word: c.word,
        fillerProbability: (answers[candidateKey(i)] as NoulResponse).noul,
      })),
      disruption: {
        score: disruption.score,
        confidence: disruption.confidence,
        probabilities: disruption.probabilities as Record<string, number>,
        legend: disruption.legend as Record<string, string>,
      },
      hesitant: hesitant.noul,
      dominantHabit: {
        choice: habit.choice,
        confidence: habit.confidence,
        probabilities: habit.probabilities,
      },
      request: { state, questions },
    };

    console.log(
      `[jev] ${result.model} ${latencyMs}ms  ${result.usage.input_tokens} in-tokens  ` +
        `${request.candidates.length} candidates  disruption=${disruption.score.toFixed(2)} (conf ${disruption.confidence.toFixed(2)})`,
    );
    res.json(response);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      res.status(401).json({ error: 'auth', message: 'TypeSafe rejected the API key.' });
    } else if (err instanceof RateLimitError) {
      res.status(429).json({ error: 'rate_limit', message: 'TypeSafe rate limit hit; slow down.' });
    } else if (err instanceof APIError) {
      res.status(502).json({ error: 'upstream', message: err.message });
    } else {
      console.error('[jev] unexpected error', err);
      res.status(500).json({ error: 'server', message: (err as Error).message });
    }
  }
});

app.listen(PORT, () => {
  const mode = client ? `model ${MODEL}, key configured` : MOCK ? 'MOCK mode (TYPESAFE_MOCK=1), no real Jev calls' : 'key MISSING - set TYPESAFE_API_KEY in .env';
  console.log(`Crutch Coach API on http://localhost:${PORT}  (${mode})`);
});
