/**
 * Client for our own /api, which forwards to Jev. See server/index.ts.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AnalyzeRequest, AnalyzeResponse, HealthResponse } from '../shared/analysis.types';

export type JevStatus = 'unknown' | 'ready' | 'no-key' | 'unreachable';

@Injectable({ providedIn: 'root' })
export class JevService {
  private readonly http = inject(HttpClient);

  readonly status = signal<JevStatus>('unknown');
  readonly lastError = signal<string | null>(null);

  async checkHealth(): Promise<void> {
    try {
      const health = await firstValueFrom(this.http.get<HealthResponse>('/api/health'));
      this.status.set(health.configured ? 'ready' : 'no-key');
    } catch {
      this.status.set('unreachable');
    }
  }

  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse | null> {
    try {
      const response = await firstValueFrom(this.http.post<AnalyzeResponse>('/api/analyze', request));
      this.lastError.set(null);
      this.status.set('ready');
      return response;
    } catch (err) {
      const e = err as HttpErrorResponse;
      const body = (e.error ?? {}) as { error?: string; message?: string };
      if (e.status === 503 && body.error === 'no_api_key') {
        this.status.set('no-key');
      } else if (e.status === 0) {
        this.status.set('unreachable');
      }
      this.lastError.set(body.message ?? e.message ?? 'Request failed');
      return null;
    }
  }
}
