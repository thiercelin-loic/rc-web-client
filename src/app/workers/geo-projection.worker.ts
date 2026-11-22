/// <reference lib="webworker" />
import { hitTerritory, projectBatch } from "../core/geo/geo";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from "../core/geo/geo.constants";
import { ProjectedTerritory, TerritoryInput } from "../core/geo/geo.interface";

export interface GeoWorkerRequest {
  readonly action: "PROJECT" | "HIT_TEST";
  readonly width?: number;
  readonly height?: number;
  readonly territories?: readonly TerritoryInput[];
  readonly projected?: readonly ProjectedTerritory[];
  readonly cursorX?: number;
  readonly cursorY?: number;
}

addEventListener(
  "message",
  async ({ data }: MessageEvent<GeoWorkerRequest>) => {
    if (data.action === "PROJECT" && data.territories) {
      const projected = await projectBatch(
        data.territories,
        data.width ?? DEFAULT_WIDTH,
        data.height ?? DEFAULT_HEIGHT,
      );
      postMessage({ action: "PROJECT_RESULT", projected });
    } else if (data.action === "HIT_TEST" && data.projected) {
      const matched = await hitTerritory(
        data.projected,
        data.cursorX ?? 0,
        data.cursorY ?? 0,
      );
      postMessage({ action: "HIT_TEST_RESULT", matched });
    }
  },
);
