export interface ProjectedTerritory {
  readonly id: string;
  readonly nutsCode: string;
  readonly name: string;
  readonly screenX: number;
  readonly screenY: number;
  readonly radius: number;
}

/**
 * Albers Equal-Area Conic Projection for Continental Europe
 * Transforms spherical (lon, lat) coordinates into 2D Canvas coordinates and supports
 * fast spatial hit-testing without external tile requests.
 */
export function projectAlbersEurope(
  lon: number,
  lat: number,
  width = 520,
  height = 300
): { x: number; y: number } {
  const lon0 = 10.0 * (Math.PI / 180);
  const lat0 = 50.0 * (Math.PI / 180);
  const phi1 = 43.0 * (Math.PI / 180);
  const phi2 = 62.0 * (Math.PI / 180);

  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
  const c = Math.cos(phi1) * Math.cos(phi1) + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(lat0)) / n;

  const lam = lon * (Math.PI / 180);
  const phi = lat * (Math.PI / 180);
  const theta = n * (lam - lon0);
  const rho = Math.sqrt(Math.max(0.01, c - 2 * n * Math.sin(phi))) / n;

  const rawX = rho * Math.sin(theta);
  const rawY = rho0 - rho * Math.cos(theta);

  const scale = Math.min(width, height) * 1.65;
  return {
    x: Number((width * 0.52 + rawX * scale).toFixed(1)),
    y: Number((height * 0.58 - rawY * scale).toFixed(1))
  };
}

export function hitTestTerritory(
  territories: readonly ProjectedTerritory[],
  cursorX: number,
  cursorY: number
): ProjectedTerritory | null {
  for (const t of territories) {
    const dx = cursorX - t.screenX;
    const dy = cursorY - t.screenY;
    if (Math.sqrt(dx * dx + dy * dy) <= t.radius + 10) {
      return t;
    }
  }
  return null;
}
