import { describe, expect, it } from 'vitest';
import { downsampleLttb, TimeSeriesPoint } from './lttb-decimation';

describe('downsampleLttb', () => {
  it('preserves the endpoints and returns the requested threshold', () => {
    const points: TimeSeriesPoint[] = Array.from({ length: 100 }, (_, x) => ({
      x,
      y: Math.sin(x / 8)
    }));

    const sampled = downsampleLttb(points, 12);

    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
  });

  it('does not clone or truncate data below the threshold', () => {
    const points = [{ x: 0, y: 1 }, { x: 1, y: 2 }];

    expect(downsampleLttb(points, 10)).toEqual(points);
    expect(downsampleLttb(points, 10)).not.toBe(points);
  });
});
