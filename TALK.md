# Jev: an AI model that decides instead of talks

Talk outline + speaker notes. ~35–40 min with the live demo.
Sources: typesafe.ai, docs.typesafe.ai, the launch post "Introducing System One Models & Jev" (Sept 2026).
The playground section was written against the live, signed-in console on 2026-10-07, including a real run of the demo request.

---

## 1. Hook (2 min)

Open with the demo app already listening. Say one sentence that uses *both* kinds of "like":

> "I like Angular, like, a lot."

Point at the transcript: the first "like" is blue (meaningful), the second is orange (filler). Then ask the room:

> "Which model did that? Not a chatbot. It returned no text at all. It returned a probability."

That's the whole talk in one screen.

## 2. What is Jev? (5 min)

- Jev is the first **System One model**, from TypeSafe AI (San Francisco). Early access launched 15 Sept 2026.
- Kahneman's framing: System 1 = fast, intuitive judgements; System 2 = slow, deliberate reasoning. LLMs chase System 2. Jev is built for System 1.
- It **does not generate text**. You send *state* (text, JSON object, or array) plus *typed questions*; it returns *typed answers* with probabilities.
- Think of it as (their words) "a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out."
- Three primitives and that's it:

  | Primitive | Question | Answer |
  | --- | --- | --- |
  | **Noul** | yes / no | probability of yes, 0..1 |
  | **Choice** | which one of these? | chosen key + probability per option + confidence |
  | **Score** | how much, on this rubric? | expected score (can be 1.4) + probability per level + confidence |

- All questions in a request are evaluated **in parallel, in isolation**, over the same state. One round trip.

## 3. Why was it created? (6 min)

Founder Diogo Almeida's line: "Models have been superhuman at chat for years, so where is all the automation?"

The problems with using chat LLMs as components inside software:

1. **Overconfidence.** Ask an LLM "how sure are you?" and it is "overconfident and inconsistent." A model that is right 95% of the time is useless for automation if it cannot tell you *which* 5% it got wrong.
2. **Strings.** Free text must be parsed and validated. JSON mode helps the *shape*, not the *honesty*. Hallucinated tool calls deep in a workflow are "deal-breakers."
3. **Latency and cost.** Sequential token generation is slow and expensive for a decision that is a single bit.
4. **Training objective.** RLHF optimises for what a human *prefers to read*, which is not the same as being calibrated. They cite mode dropping and overconfidence as consequences.

TypeSafe's answer: give up strings. "Giving up strings actually gives us a lot of superpowers":

- Train with **RLCD** (Reinforcement Learning for Calibrated Decisions): the reward is epistemically honest probabilities, so higher confidence actually correlates with higher accuracy.
- No text → no hallucinated values, no type errors. The answer is always one of your options.
- Speed: 70–500 ms end to end vs seconds for frontier LLMs. Their headline numbers are 193.6× faster and 444.6× cheaper on their workflow evals (high-end real-world gains; say "up to").
- Pricing: $0.042 per million input tokens; output tokens free.

Honest caveats to say out loud (from their own "jaggedness" page for jev-1.13):

- It **does not count** (characters, occurrences, items). Keep arithmetic in code. This shaped our demo.
- Accuracy drops as state fills with unrelated detail. Send only what the decision needs.
- Dates are read as text, not quantities. Multi-hop reasoning and numeric proximity are weak.
- Sensitive to option ordering. Literal about instructions. Not for generation or conversation.
- Proprietary, API-only, no weights, waitlist for access.

## 4. The playground (8 min, live)

Go to <https://console.typesafe.ai/playground>. Orientation for the audience (30 s), left to right:

- Sidebar: Home, Playground, Usage, API Keys, Documentation, plus a prepaid **Balance** panel and your org at the bottom. Usage and Balance are worth a glance later: the whole demo costs cents.
- **State** editor at the top of the middle column. It is JSON, starts as `{ "example_state": "Add context for TypeSafe to evaluate" }`, and has a text/JSON toggle (the two icons on its header).
- **Questions** editor below it, with **Format** and an error counter. Clicking into an empty question pops a primitive picker: **Noul** "Evaluate how true something is", **Score** "Set up a rubric to grade with", **Choice** "Ask a multiple choice question", each with an example and a Docs link. Use the picker on stage; it writes the skeleton for you.
- Bottom bar: a model chip (`jev-latest`), a **+ Add model** button that adds a second results column (today the only other option is `jev-preview`), and **Run** (Ctrl+Enter).
- Top bar: **Clear**, **Share** (a shareable link to the exact state + questions; prepare the demo request in advance and keep the link as a fallback), and two layout toggles.
- Right panel, "Learn to TypeSafe": three walkthrough lessons, one per primitive (Noul: "Is hotdog a sandwich?", Choice: "What color is the sky?", Score: "Can monkeys create art?"), and three real-life examples (Resumé screening, Support agent audit, LLM guardrails). If the room is new to this, open the hotdog lesson first: it is the fastest way to show what a Noul returns.

Then walk through, in this order, using the *same* state and questions the app will use later (copy them from the app's "Request sent to Jev" panel, or from `server/jev-questions.ts`):

1. **State.** Paste a transcript as a JSON object:
   ```json
   { "transcript": "So, um, I was like, basically done, you know? I like pizza, like, a lot.",
     "candidates": [ { "word": "like", "context": "I was «like», basically done" },
                     { "word": "like", "context": "I «like» pizza, like, a lot" } ] }
   ```
   Point out that state can reference nested paths in questions with backticks (`candidates[0].context`).
2. **Noul.** "In `candidates[0].context`, is the word wrapped in « » used as a verbal filler?" Show the probability. Repeat for `candidates[1]`. Two identical words, two very different numbers. That's the demo's "aha."
3. **Score.** Rubric with four ordered levels (Clean / Light / Noticeable / Heavy). Show that the score lands *between* levels and that there is a probability per level.
4. **Choice.** "Which crutch habit is most prominent?" with six options including `none` as an escape hatch. Show the probability distribution and the confidence number.
5. **Confidence ≠ probability.** For Choice: `confidence = (p_max − 1/n) / (1 − 1/n)`. For Score it also penalises probability *far* from the peak more than probability *next* to it. Show how confidence drops when you make the context ambiguous.
6. **Batch.** Put all of the above in one request. Note the token count and the latency.
7. **Structured criteria.** Show that instructions, options and levels can be JSON objects (e.g. `{ what, not_for, examples }`) rather than strings.
8. Bonus if time: `jev-latest` vs `jev-1.13.0` version pinning; the "Get your API key" page at `/keys`.

**The results pane** (appears on the right after Run; worth narrating because it is the clearest picture of what a System One answer *is*):

- Header: "Response · Ran just now", with three toggles: **Overview** (the default rows), **JSON** (the raw API response, with a copy button, the request id, and the model that actually answered: `jev-1.13.0`), and **Dock to bottom**.
- A clock icon next to the model name. Hover it for timing: in our run **83 ms server** ("How fast TypeSafe was") and **811 ms network** ("Roundtrip to us-west"). Say both numbers: the model is faster than the internet between here and it.
- One row per question, keyed by your question name, with the instructions underneath. A Noul row shows e.g. **70% true** on a slider; expand it (chevron) to see true and false side by side plus the criteria text you wrote. A Score row shows **2.04 of 3** and expands to one slider per rubric level with its probability (0% / 1% / 93% / 6%). A Choice row lists every option with its probability (like 100%, none 0%, you_know 0%). Score and Choice rows carry a **Confidence** line.
- The small ↱ icon next to a key is "Find in Questions JSON": it highlights that question in the editor. Handy on stage when someone asks "what did you ask for that one?"

Numbers from the real run of the demo request (keep for the slide; they drift a few points run to run):

| Question | Answer |
| --- | --- |
| `«So», um, I was like…` filler? | 70% true |
| `I was «like», basically done` filler? | 89% true |
| `«basically» done` filler? | 69% true |
| `I «like» Angular` filler? | **15% true** |
| `Angular, «like», a lot` filler? | 77% true |
| Clarity score (0 Clean … 3 Heavy) | 2.04, confidence 93% |
| Sounds hesitant? | 90% true |
| Dominant habit | like, confidence 100% |

Same word, same sentence, 15% vs 77%. That is the slide.

Before the talk: run the demo request once, then use **Share** to get a link to the exact state + questions and keep it as a fallback. The request is reproducible from `server/jev-questions.ts` or the app's "Request sent to Jev" panel.

## 5. Building with it: patterns worth naming (4 min)

From docs.typesafe.ai "How to build with TypeSafe": *AI-powered software, not AI agents.* Code owns control flow, side effects and arithmetic; the model gets narrow, atomic, typed questions.

- **Speculative fan-out.** Ask everything you might need in one call; let code decide what matters.
- **Confidence-gated routing.** The answer says *what*; confidence says *whether to act*. Different thresholds for different consequences (their banking example: 0.6 to show a balance, 0.85 to approve a transfer, below 0.6 → human).
- **Composite scoring.** Several atomic scores combined with weights you own in code.
- **Pre-parsed value extraction.** Regex over-finds candidates; Jev picks among them with a Choice/Noul; code never gets a value that wasn't in the text. This is exactly what the demo does with "like".
- Cookbooks to point people at: LLM guardrails, re-ranking retrieval, citation checking, intent routing.

## 6. The demo app: Crutch Coach (10 min, live)

Repo: `dev-checkin/jev-crutch-words`. Angular 22 (standalone, signals, zoneless) + a 100-line Express hop.

Show the architecture slide first:

```
mic ──Web Speech API──▶ transcript segments
                         │
                         ├─ code: regex "um/uh/you know"  → counted immediately
                         ├─ code: regex "like/so/right…"  → candidates (ambiguous)
                         │
                         └─ every ~1.2 s of new speech, last 45 s of text
                              │  POST /api/analyze  (Angular proxy → Express)
                              ▼
                           Express + @typesafe-ai/sdk  ──▶  api.typesafe.ai /v1/systemone
                              │  one request: N Nouls + Score + Noul + Choice
                              ▼
                         code: cache verdicts by occurrence id, count p ≥ 0.7 as filler,
                               fillers/min over a rolling 60 s, nudge only when
                               rate ≥ threshold AND Jev's clarity score is confident
```

Walk the code in this order (each is short):

1. `server/jev-questions.ts` — the questions. Same as the playground. Note the `noul(instructions, { true, false })` criteria, the ordered `score` rubric array, the `choice` map with `none`.
2. `server/index.ts` — `new TypeSafeClient({ apiKey })`, `client.systemOne({ state, questions })`, typed answers (`.noul`, `.score`, `.choice`, `.confidence`, `.probabilities`), `usage.input_tokens`, error classes (`RateLimitError`, `AuthenticationError`).
3. `src/app/services/crutch-counter.ts` — all counting is here, pure and unit-tested. "Jev doesn't count; we do."
4. `src/app/services/coach.service.ts` — windowing (45 s), debouncing, verdict cache keyed by `segmentId:charIndex` so each occurrence is asked about once, and `maybeNudge()`: the confidence gate.
5. The UI's "Request sent to Jev" panel — paste it into the playground to show it's identical.

Then talk for a minute with the app listening. Have a prepared paragraph that mixes meaningful and filler "like"/"so"/"right". Watch the latency and token readout. Trigger a nudge by setting the threshold low.

Why there's a server (one slide): the API rejects browser origins other than the console (CORS), and the key must not ship to the browser. Mention `dangerouslyAllowBrowser` by name; its name is the lesson.

Fallbacks for the demo gods:

- No mic / noisy room: the "type a line" box uses the same pipeline.
- No network: `TYPESAFE_MOCK=1` gives a heuristic stand-in with the same response shape (say so on stage).
- Chrome usually strips "um/uh" from transcripts. If the room asks why the "um" count is low, that's why. Word fillers are the interesting ones anyway.

## 7. When to reach for Jev, and when not (3 min)

Good fits: classify, route, score, verify, extract-from-candidates, guardrail an LLM, rerank, anything you'd otherwise do with a "return only JSON" prompt and a parser.

Poor fits: generating anything, conversation, counting, math, date arithmetic, multi-hop reasoning, anything where you need an explanation.

The design test: *"Can I phrase this as a yes/no, a pick-one, or a rate-on-this-rubric over state I already have?"* If yes, it's a System One question.

## 8. Close (1 min)

"We spent three years asking models to talk. Jev is a bet that most of the value in software is in models that *decide*, cheaply, quickly, and honestly about how sure they are. The demo took an afternoon because the model's output is already a type."

Links: typesafe.ai · docs.typesafe.ai · console.typesafe.ai · `npm i @typesafe-ai/sdk` · `pip install typesafe-sdk` · there's also a Claude Code plugin (`claude plugin marketplace add typesafe-ai/skills`).

---

## Appendix: numbers and facts to have on hand

| Item | Value (per docs, Oct 2026) |
| --- | --- |
| Model ids | `jev-1.13.0`, aliases `jev-latest`, `jev-preview` |
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, Bearer auth |
| Context | 64k tokens/request; 32k for state + longest question |
| Choice options | up to 255 |
| Score levels | 2–10 |
| Price | $0.042 / M input tokens; output free |
| Rate limits | ~100K tokens/s, ~80 req/s, adjusting dynamically |
| Latency claim | 70–500 ms end to end |
| Input types | text, JSON object, array of text; no audio/images |
| SDKs | `@typesafe-ai/sdk` 0.6.0 (Node 20+, ESM+CJS+types), `typesafe-sdk` (Python, sync + async) |
| Confidence (Choice) | `(p_max − 1/n) / (1 − 1/n)` |
| HTTP errors | 401 bad key · 422 validation · 429 rate limit · 529 overloaded |
