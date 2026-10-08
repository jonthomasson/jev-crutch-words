/**
 * Orchestration: turns transcript segments into counts (code), windows of
 * questions for Jev (network), and nudges (code, gated on Jev's confidence).
 */
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import type { AnalyzeResponse, CrutchCandidate } from '../shared/analysis.types';
import {
  FILLER_THRESHOLD,
  candidatesFor,
  findHardFillers,
  perMinute,
  tally,
  wordCount,
} from './crutch-counter';
import { JevService } from './jev.service';
import { SpeechService, type TranscriptSegment } from './speech.service';

/** Only the last N ms of transcript go to Jev: unrelated text is a distractor. */
const WINDOW_MS = 45_000;
/** Rolling window the fillers-per-minute rate is measured over. */
const RATE_WINDOW_MS = 60_000;
/** Below this much speech the per-minute rate is extrapolating from noise; damp it. */
const RATE_MIN_WINDOW_MS = 15_000;
/** Wait for the recogniser to settle before asking Jev. */
const DEBOUNCE_MS = 1_200;
/** Do not nudge again sooner than this. */
const NUDGE_COOLDOWN_MS = 20_000;
/** Below this confidence, Jev's disruption score does not drive a nudge. */
const NUDGE_MIN_CONFIDENCE = 0.5;
/** Score rubric index: 0 Clean, 1 Light, 2 Noticeable, 3 Heavy. */
const NUDGE_MIN_DISRUPTION = 1.5;

export interface HistoryPoint {
  at: number;
  disruption: number;
  confidence: number;
  latencyMs: number;
}

@Injectable({ providedIn: 'root' })
export class CoachService {
  readonly speech = inject(SpeechService);
  readonly jev = inject(JevService);
  private readonly destroyRef = inject(DestroyRef);

  /** Ticks once a second so rolling-window computeds re-evaluate. */
  private readonly now = signal(Date.now());
  private readonly startedAt = signal<number | null>(null);

  /** Candidate id -> Jev's filler probability. */
  readonly verdicts = signal<ReadonlyMap<string, number>>(new Map());
  readonly latest = signal<AnalyzeResponse | null>(null);
  readonly history = signal<HistoryPoint[]>([]);
  readonly analyzing = signal(false);
  readonly requestCount = signal(0);
  readonly nudge = signal<string | null>(null);
  readonly thresholdPerMinute = signal(5);

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private lastAnalyzedSegmentId: string | null = null;
  private lastNudgeAt = 0;

  // ---- code-side counting -------------------------------------------------

  readonly elapsedMs = computed(() => {
    const start = this.startedAt();
    return start === null ? 0 : this.now() - start;
  });

  readonly words = computed(() => this.speech.segments().reduce((n, s) => n + wordCount(s.text), 0));

  /** Every filler the code is sure about plus every one Jev confirmed. */
  readonly fillerHits = computed(() => this.collectFillers(this.speech.segments()));

  readonly totalFillers = computed(() => this.fillerHits().length);

  readonly countsByWord = computed(() => {
    const counts = tally(this.fillerHits());
    return Object.entries(counts)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count);
  });

  /** Fillers per minute over the last RATE_WINDOW_MS (or the whole session if shorter). */
  readonly fillersPerMinute = computed(() => {
    const now = this.now();
    const since = now - RATE_WINDOW_MS;
    const recent = this.collectFillers(this.speech.segments().filter((s) => s.at >= since));
    const windowMs = Math.max(RATE_MIN_WINDOW_MS, Math.min(RATE_WINDOW_MS, this.elapsedMs()));
    return perMinute(recent.length, windowMs);
  });

  readonly pendingCandidates = computed(() => {
    const verdicts = this.verdicts();
    return this.speech
      .segments()
      .flatMap((s) => candidatesFor(s.id, s.text))
      .filter((c) => !verdicts.has(c.id)).length;
  });

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(tick));

    // New final segment -> schedule a Jev window.
    effect(() => {
      const segments = this.speech.segments();
      const last = segments[segments.length - 1];
      if (!last || last.id === this.lastAnalyzedSegmentId) {
        return;
      }
      this.scheduleAnalysis();
    });

    void this.jev.checkHealth();
  }

  // ---- session control ----------------------------------------------------

  start(): void {
    if (this.startedAt() === null) {
      this.startedAt.set(Date.now());
    }
    this.speech.start();
  }

  stop(): void {
    this.speech.stop();
  }

  /** Typed input for rehearsals or when a microphone is not available. */
  addLine(text: string): void {
    if (this.startedAt() === null) {
      this.startedAt.set(Date.now());
    }
    this.speech.addManual(text);
  }

  reset(): void {
    this.speech.stop();
    this.speech.reset();
    this.startedAt.set(null);
    this.verdicts.set(new Map());
    this.latest.set(null);
    this.history.set([]);
    this.nudge.set(null);
    this.requestCount.set(0);
    this.lastAnalyzedSegmentId = null;
    this.lastNudgeAt = 0;
  }

  dismissNudge(): void {
    this.nudge.set(null);
  }

  // ---- Jev window ---------------------------------------------------------

  private scheduleAnalysis(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => void this.analyzeWindow(), DEBOUNCE_MS);
  }

  async analyzeWindow(): Promise<void> {
    if (this.analyzing()) {
      this.scheduleAnalysis(); // try again once the in-flight request returns
      return;
    }
    const segments = this.speech.segments();
    const last = segments[segments.length - 1];
    if (!last) {
      return;
    }

    const since = Date.now() - WINDOW_MS;
    const windowSegments = segments.filter((s) => s.at >= since);
    const transcript = windowSegments.map((s) => s.text).join(' ');
    if (!transcript.trim()) {
      return;
    }

    // Only ask about occurrences Jev has not already judged.
    const known = this.verdicts();
    const candidates: CrutchCandidate[] = windowSegments
      .flatMap((s) => candidatesFor(s.id, s.text))
      .filter((c) => !known.has(c.id));

    //example of speculative fan-out
    this.analyzing.set(true);
    this.lastAnalyzedSegmentId = last.id;
    try {
      const response = await this.jev.analyze({ transcript, candidates });
      if (!response) {
        return;
      }
      this.requestCount.update((n) => n + 1);
      this.latest.set(response);
      this.history.update((h) => [
        ...h.slice(-59),
        {
          at: Date.now(),
          disruption: response.disruption.score,
          confidence: response.disruption.confidence,
          latencyMs: response.latencyMs,
        },
      ]);
      if (response.candidates.length) {
        this.verdicts.update((map) => {
          const next = new Map(map);
          for (const v of response.candidates) {
            next.set(v.id, v.fillerProbability);
          }
          return next;
        });
      }
      this.maybeNudge(response);
    } finally {
      this.analyzing.set(false);
    }
  }

  // ---- nudges: code owns the rule, Jev supplies the judgement -------------

  private maybeNudge(response: AnalyzeResponse): void {
    const now = Date.now();
    if (now - this.lastNudgeAt < NUDGE_COOLDOWN_MS) {
      return;
    }
    const rate = this.fillersPerMinute();
    const overRate = rate >= this.thresholdPerMinute();
    //confidence gated routing
    const jevAgrees =
      response.disruption.score >= NUDGE_MIN_DISRUPTION && response.disruption.confidence >= NUDGE_MIN_CONFIDENCE;

    if (!overRate && !jevAgrees) {
      return;
    }

    const top = this.countsByWord()[0];
    const parts: string[] = [];
    if (overRate) {
      parts.push(`${rate.toFixed(0)} fillers a minute`);
    }
    if (top) {
      parts.push(`"${top.word}" is your go-to (${top.count}×)`);
    }
    if (jevAgrees) {
      const level = response.disruption.legend[String(Math.round(response.disruption.score))] ?? '';
      parts.push(`Jev rates clarity "${level.split(':')[0]}"`);
    }
    this.nudge.set(`Take a breath. ${parts.join(' · ')}.`);
    this.lastNudgeAt = now;
  }

  // ---- helpers ------------------------------------------------------------

  private collectFillers(segments: readonly TranscriptSegment[]): { word: string }[] {
    const verdicts = this.verdicts();
    const hits: { word: string }[] = [];
    for (const s of segments) {
      for (const h of findHardFillers(s.text)) {
        hits.push({ word: h.word });
      }
      for (const c of candidatesFor(s.id, s.text)) {
        const p = verdicts.get(c.id);
        if (p !== undefined && p >= FILLER_THRESHOLD) {
          hits.push({ word: c.word });
        }
      }
    }
    return hits;
  }
}
