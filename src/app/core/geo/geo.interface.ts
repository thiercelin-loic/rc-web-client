export interface TerritoryInput {
  readonly id: string;
  readonly nutsCode: string;
  readonly name: string;
  readonly centerLon: number;
  readonly centerLat: number;
}

export interface ProjectedTerritory {
  readonly id: string;
  readonly nutsCode: string;
  readonly name: string;
  readonly screenX: number;
  readonly screenY: number;
  readonly radius: number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

export interface ProjectPointPayload {
  readonly lon: number;
  readonly lat: number;
  readonly width: number;
  readonly height: number;
}

export interface ProjectBatchPayload {
  readonly territories: readonly TerritoryInput[];
  readonly width: number;
  readonly height: number;
}

export interface HitTestPayload {
  readonly territories: readonly ProjectedTerritory[];
  readonly cursorX: number;
  readonly cursorY: number;
}
