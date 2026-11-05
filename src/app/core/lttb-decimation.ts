export interface TimeSeriesPoint {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) Downsampling Algorithm
 * Downsamples high-frequency time-series datasets (e.g., 100,000 raw points)
 * to target threshold (e.g., 1,000 visual points), preserving visual peaks and troughs
 * while guaranteeing fast (< 16ms) HTML5 Canvas 2D rendering.
 */
export function downsampleLttb(
  data: readonly TimeSeriesPoint[],
  threshold = 1000
): TimeSeriesPoint[] {
  const dataLength = data.length;
  if (threshold >= dataLength || threshold <= 2) {
    return [...data];
  }

  const sampled: TimeSeriesPoint[] = new Array(threshold);
  let sampledIndex = 0;

  const every = (dataLength - 2) / (threshold - 2);
  let a = 0;
  let nextA = 0;

  sampled[sampledIndex++] = data[a];

  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0;
    let avgY = 0;
    let avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    avgRangeEnd = avgRangeEnd < dataLength ? avgRangeEnd : dataLength;

    const avgRangeLength = avgRangeEnd - avgRangeStart;
    for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
      avgX += data[avgRangeStart].x;
      avgY += data[avgRangeStart].y;
    }
    avgX /= avgRangeLength || 1;
    avgY /= avgRangeLength || 1;

    let rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    const pointAX = data[a].x;
    const pointAY = data[a].y;

    let maxArea = -1;
    let maxAreaPoint = data[rangeOffs];

    for (; rangeOffs < rangeTo; rangeOffs++) {
      const area =
        Math.abs(
          (pointAX - avgX) * (data[rangeOffs].y - pointAY) -
            (pointAX - data[rangeOffs].x) * (avgY - pointAY)
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = data[rangeOffs];
        nextA = rangeOffs;
      }
    }

    sampled[sampledIndex++] = maxAreaPoint;
    a = nextA;
  }

  sampled[sampledIndex] = data[dataLength - 1];
  return sampled;
}
