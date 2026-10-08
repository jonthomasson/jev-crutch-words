/**
 * Thin wrapper over the browser's Web Speech API (SpeechRecognition).
 *
 * Notes for the demo:
 *  - Chromium and Safari implement it; Firefox does not. The service exposes
 *    `supported` so the UI can say so instead of failing silently.
 *  - Chrome stops recognising after a stretch of silence, so `onend` restarts
 *    it while the user still wants to listen.
 *  - Chrome's recogniser often drops "um"/"uh" from transcripts. Word fillers
 *    ("like", "so", "you know") come through, which is why Jev is the
 *    interesting part: those are the ones regex cannot classify alone.
 *  - Audio never leaves the browser except to the browser vendor's speech
 *    service. Only text is sent to Jev (which only accepts text anyway).
 */
import { Injectable, signal } from '@angular/core';

// Minimal typings; TypeScript's DOM lib does not declare the constructor.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface TranscriptSegment {
  id: string;
  text: string;
  /** Epoch ms when the segment was finalised. */
  at: number;
}

function resolveCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as unknown as Record<string, unknown>;
  return (w['SpeechRecognition'] as SpeechRecognitionCtor) ?? (w['webkitSpeechRecognition'] as SpeechRecognitionCtor) ?? null;
}

@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly ctor = resolveCtor();
  private recognition: SpeechRecognitionLike | null = null;
  private wantListening = false;
  private nextId = 1;

  readonly supported = this.ctor !== null;
  readonly listening = signal(false);
  readonly interim = signal('');
  readonly segments = signal<TranscriptSegment[]>([]);
  readonly error = signal<string | null>(null);

  start(lang = 'en-US'): void {
    if (!this.ctor || this.wantListening) {
      return;
    }
    this.wantListening = true;
    this.error.set(null);

    const rec = new this.ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let interim = '';
      const finals: TranscriptSegment[] = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const text = result[0].transcript.trim();
        if (!text) {
          continue;
        }
        if (result.isFinal) {
          finals.push({ id: `s${this.nextId++}`, text, at: Date.now() });
        } else {
          interim += (interim ? ' ' : '') + text;
        }
      }
      if (finals.length) {
        this.segments.update((list) => [...list, ...finals]);
      }
      this.interim.set(interim);
    };

    rec.onerror = (ev) => {
      // "no-speech" and "aborted" are routine; anything else is worth showing.
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        this.error.set('Microphone access was denied.');
        this.wantListening = false;
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        this.error.set(`Speech recognition error: ${ev.error}`);
      }
    };

    rec.onend = () => {
      this.interim.set('');
      if (this.wantListening) {
        // Chrome ends the session after silence; keep going.
        try {
          rec.start();
        } catch {
          this.listening.set(false);
        }
      } else {
        this.listening.set(false);
      }
    };

    this.recognition = rec;
    rec.start();
    this.listening.set(true);
  }

  stop(): void {
    this.wantListening = false;
    this.recognition?.stop();
    this.recognition = null;
    this.interim.set('');
    this.listening.set(false);
  }

  /** Demo fallback: feed a typed line through the same pipeline as speech. */
  addManual(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    this.segments.update((list) => [...list, { id: `s${this.nextId++}`, text: trimmed, at: Date.now() }]);
  }

  reset(): void {
    this.segments.set([]);
    this.interim.set('');
    this.error.set(null);
  }
}
