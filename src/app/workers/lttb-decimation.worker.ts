/// <reference lib="webworker" />
import { downsampleLttb, TimeSeriesPoint } from '../core/lttb-decimation';

export interface LttbWorkerRequest {
  readonly points: readonly TimeSeriesPoint[];
  readonly threshold?: number;
}

export interface LttbWorkerResponse {
  readonly sampled: readonly TimeSeriesPoint[];
  readonly originalCount: number;
  readonly sampledCount: number;
  readonly durationMs: number;
}

addEventListener('message', ({ data }: MessageEvent<LttbWorkerRequest>) => {
  const start = performance.now();
  const threshold = data?.threshold ?? 1000;
  const points = data?.points ?? [];
  const sampled = downsampleLttb(points, threshold);
  const durationMs = Number((performance.now() - start).toFixed(2));

  const response: LttbWorkerResponse = {
    sampled,
    originalCount: points.length,
    sampledCount: sampled.length,
    durationMs
  };
  postMessage(response);
});
