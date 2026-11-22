import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  GEO_HIT_TEST_ENDPOINT,
  GEO_PROJECT_BATCH_ENDPOINT,
  GEO_PROJECT_POINT_ENDPOINT,
} from "./geo.constants";
import {
  HitTestPayload,
  ProjectBatchPayload,
  ProjectPointPayload,
  ProjectedPoint,
  ProjectedTerritory,
  TerritoryInput,
} from "./geo.interface";

@Injectable({ providedIn: "root" })
export class GeoService {
  private readonly http = inject(HttpClient);

  public projectEurope(
    lon: number,
    lat: number,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
  ): Observable<ProjectedPoint> {
    const payload: ProjectPointPayload = { lon, lat, width, height };
    return this.http.post<ProjectedPoint>(GEO_PROJECT_POINT_ENDPOINT, payload);
  }

  public projectBatch(
    territories: readonly TerritoryInput[],
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
  ): Observable<ProjectedTerritory[]> {
    const payload: ProjectBatchPayload = { territories, width, height };
    return this.http.post<ProjectedTerritory[]>(
      GEO_PROJECT_BATCH_ENDPOINT,
      payload,
    );
  }

  public hitTerritory(
    projected: readonly ProjectedTerritory[],
    cursorX: number,
    cursorY: number,
  ): Observable<ProjectedTerritory | null> {
    const payload: HitTestPayload = {
      territories: projected,
      cursorX,
      cursorY,
    };
    return this.http.post<ProjectedTerritory | null>(
      GEO_HIT_TEST_ENDPOINT,
      payload,
    );
  }
}

export async function projectEurope(
  lon: number,
  lat: number,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
): Promise<ProjectedPoint> {
  const response = await fetch(GEO_PROJECT_POINT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lon, lat, width, height }),
  });
  return (await response.json()) as ProjectedPoint;
}

export async function projectBatch(
  territories: readonly TerritoryInput[],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
): Promise<ProjectedTerritory[]> {
  const response = await fetch(GEO_PROJECT_BATCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ territories, width, height }),
  });
  return (await response.json()) as ProjectedTerritory[];
}

export async function hitTerritory(
  projected: readonly ProjectedTerritory[],
  cursorX: number,
  cursorY: number,
): Promise<ProjectedTerritory | null> {
  const payload: HitTestPayload = {
    territories: projected,
    cursorX,
    cursorY,
  };
  const response = await fetch(GEO_HIT_TEST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as ProjectedTerritory | null;
}
