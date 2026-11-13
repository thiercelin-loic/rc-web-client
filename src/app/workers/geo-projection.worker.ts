/// <reference lib="webworker" />
import { hitTerritory, projectEurope } from "../core/geo/geo";
import { ProjectedTerritory } from "../core/geo/geo.interface";

export interface GeoWorkerRequest {
  readonly action: "PROJECT" | "HIT_TEST";
  readonly width?: number;
  readonly height?: number;
  readonly territories?: readonly {
    id: string;
    nutsCode: string;
    name: string;
    centerLon: number;
    centerLat: number;
  }[];
  readonly projected?: readonly ProjectedTerritory[];
  readonly cursorX?: number;
  readonly cursorY?: number;
}

addEventListener("message", ({ data }: MessageEvent<GeoWorkerRequest>) => {
  if (data.action === "PROJECT" && data.territories) {
    const width = data.width ?? 520;
    const height = data.height ?? 300;
    const projected: ProjectedTerritory[] = data.territories.map((t) => {
      const coords = projectEurope(
        t.centerLon,
        t.centerLat,
        width,
        height,
      );
      return {
        id: t.id,
        nutsCode: t.nutsCode,
        name: t.name,
        screenX: coords.x,
        screenY: coords.y,
        radius: 24,
      };
    });
    postMessage({ action: "PROJECT_RESULT", projected });
  } else if (data.action === "HIT_TEST" && data.projected) {
    const matched = hitTerritory(
      data.projected,
      data.cursorX ?? 0,
      data.cursorY ?? 0,
    );
    postMessage({ action: "HIT_TEST_RESULT", matched });
  }
});
