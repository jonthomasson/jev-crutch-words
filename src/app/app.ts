import { DecimalPipe, JsonPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CoachService } from './services/coach.service';
import { annotate, type Span } from './services/crutch-counter';
import { DISRUPTION_LEVELS } from './shared/analysis.types';

interface RenderedSegment {
  id: string;
  spans: Span[];
}

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, PercentPipe, JsonPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly coach = inject(CoachService);
  protected readonly speech = this.coach.speech;
  protected readonly jev = this.coach.jev;
  protected readonly levels = DISRUPTION_LEVELS;

  protected readonly rendered = computed<RenderedSegment[]>(() => {
    const verdicts = this.coach.verdicts();
    return this.speech.segments().map((s) => ({ id: s.id, spans: annotate(s.id, s.text, verdicts) }));
  });

  protected readonly elapsedLabel = computed(() => {
    const total = Math.floor(this.coach.elapsedMs() / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  });

  protected readonly maxCount = computed(() => this.coach.countsByWord()[0]?.count ?? 1);

  /** Score probabilities as an ordered list for the bar chart. */
  protected readonly disruptionBars = computed(() => {
    const latest = this.coach.latest();
    if (!latest) {
      return [];
    }
    return DISRUPTION_LEVELS.map((label, i) => ({
      label,
      probability: latest.disruption.probabilities[String(i)] ?? 0,
    }));
  });

  protected readonly habitBars = computed(() => {
    const latest = this.coach.latest();
    if (!latest) {
      return [];
    }
    return Object.entries(latest.dominantHabit.probabilities)
      .map(([key, probability]) => ({ key, probability }))
      .sort((a, b) => b.probability - a.probability);
  });

  protected readonly disruptionLabel = computed(() => {
    const latest = this.coach.latest();
    if (!latest) {
      return '—';
    }
    return DISRUPTION_LEVELS[Math.min(3, Math.max(0, Math.round(latest.disruption.score)))];
  });

  protected readonly statusLabel = computed(() => {
    if (!this.speech.supported) {
      return 'Speech recognition unsupported in this browser';
    }
    return this.speech.listening() ? 'Listening' : 'Idle';
  });

  protected readonly jevStatusLabel = computed(() => {
    switch (this.jev.status()) {
      case 'ready':
        return 'Jev connected';
      case 'no-key':
        return 'Server has no TYPESAFE_API_KEY';
      case 'unreachable':
        return 'API server not running (npm run server)';
      default:
        return 'Checking Jev…';
    }
  });

  protected onManualSubmit(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    this.coach.addLine(input.value);
    input.value = '';
  }

  protected onThresholdInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isNaN(value) && value > 0) {
      this.coach.thresholdPerMinute.set(value);
    }
  }

  protected kindTitle(span: Span): string {
    switch (span.kind) {
      case 'hard':
        return 'Filler (matched by code)';
      case 'filler':
        return `Filler per Jev (p=${(span.probability ?? 0).toFixed(2)})`;
      case 'unsure':
        return `Jev unsure (p=${(span.probability ?? 0).toFixed(2)})`;
      case 'meaningful':
        return `Meaningful per Jev (p=${(span.probability ?? 0).toFixed(2)})`;
      case 'pending':
        return 'Waiting for Jev';
      default:
        return '';
    }
  }
}
