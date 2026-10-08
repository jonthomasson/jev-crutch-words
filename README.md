# Crutch Coach — a Jev (TypeSafe AI) demo

A small Angular 22 app that listens to you speak and nudges you when you lean on
crutch words ("um", "like", "you know", "basically"…).

It exists to show how to use **Jev**, TypeSafe AI's *System One* model, inside a
real application. The design follows TypeSafe's own guidance:

| Who | Does what | Why |
| --- | --- | --- |
| **Code** (browser) | Transcribes speech (Web Speech API), regex-matches filler words, counts them, computes fillers-per-minute, decides when to nudge | Jev 1.13 does not count reliably; counting and thresholds belong in code |
| **Jev** (via our server) | For each ambiguous word, answers *"is this `like` a filler or a real word?"* (Noul); rates clarity on a rubric (Score); picks the dominant habit (Choice) | Semantic judgements regex cannot make, with calibrated probabilities and confidence |
| **Code** again | Gates the nudge on both its own count **and** Jev's confidence | Confidence-gated routing |

All questions for a window of speech go to Jev in **one request** (speculative fan-out).

## Run it

Prerequisites: Node 20+, Chrome/Edge/Safari (Firefox has no Web Speech API).

```bash
npm install
cp .env.example .env.local   # paste your key from https://console.typesafe.ai/keys
npm run dev              # web on :4200, API on :3000
```

Open <http://localhost:4200>, click **Start listening**, allow the microphone, talk.
No microphone? Type a line in the box under the transcript; it goes through the same pipeline.

Rehearsing offline? Set `TYPESAFE_MOCK=1` in `.env`: the server answers with a
heuristic stand-in that has the same *shape* as a Jev result (it is not a model).

Other scripts:

```bash
npm start                 # web only
npm run server            # API only (tsx watch)
npm test                  # vitest unit tests (counting/annotation logic + app shell)
npm run typecheck:server  # tsc over server/
npm run build             # production bundle
```

## Why there is a server

Two reasons, both worth saying out loud in a talk:

1. `api.typesafe.ai` only allows browser requests from the TypeSafe console origin
   (a preflight from `http://localhost:4200` returns `Disallowed CORS origin`).
2. The API key must never ship to the browser. The SDK even makes you opt in with
   `dangerouslyAllowBrowser: true` to run there.

So `server/index.ts` is a ~100-line Express app using `@typesafe-ai/sdk`, and the
Angular dev server proxies `/api/*` to it (`proxy.conf.json`).

## Where to look

| File | What |
| --- | --- |
| `server/jev-questions.ts` | **The questions.** State shape and the Noul / Score / Choice definitions. Put this next to the console playground. |
| `server/index.ts` | SDK call, error mapping, latency and token readout |
| `server/mock-jev.ts` | Offline stand-in (also shows the confidence formulas from the docs) |
| `src/app/services/crutch-counter.ts` | Pure counting/annotation functions (unit-tested) |
| `src/app/services/speech.service.ts` | Web Speech API wrapper with auto-restart |
| `src/app/services/coach.service.ts` | Windowing, debouncing, verdict cache, nudge rule |
| `src/app/shared/analysis.types.ts` | Client/server contract |
| `TALK.md` | Talk outline and speaker notes |

## Jev details used here

- Endpoint `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, model `jev-latest` (= `jev-1.13.0` at time of writing).
- Limits: 64k tokens per request (32k for state + longest question), Choice ≤ 255 options, Score 2–10 levels. Rate limits adjust dynamically; this app makes at most one request per ~1.2 s of new speech.
- Only the last 45 s of transcript is sent: the docs warn that unrelated content in state acts as a distractor.
- Thresholds in `crutch-counter.ts`: filler probability ≥ 0.7 counts as a filler, < 0.4 as meaningful, in between shows as "unsure".

## Troubleshooting the first live call

This app was built and tested in mock mode; the first run with a real key is the
first real request. If `/api/analyze` comes back **422** (validation), the likely
culprit is the structured Noul instructions in `server/jev-questions.ts`: collapse
the `{ question, definition }` object into one plain string and retry. A **401**
means the key was rejected; a **429** means slow down (the app already sends at
most one request per ~1.2 s of new speech). The server log prints model, latency,
and token counts for every call.

## Known limitations

- Chrome's recogniser often strips "um"/"uh". Word fillers ("like", "so", "you know") come through, which is where Jev earns its keep.
- Speech recognition sends audio to the browser vendor's service. Only text goes to Jev.
- The "dominant habit" Choice is a semantic read, not a count; the real counts are the bars under *Counted in code*.
