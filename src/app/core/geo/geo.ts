import * as GEO from './geo.constants';
import { ProjectedPoint, ProjectedTerritory } from './geo.interface';

export function projectEurope(
  lon: number,
  lat: number,
  width = GEO.DEFAULT_WIDTH,
  height = GEO.DEFAULT_HEIGHT
): ProjectedPoint {
  const lon0 = GEO.LON0_DEG * GEO.DEG_TO_RAD;
  const lat0 = GEO.LAT0_DEG * GEO.DEG_TO_RAD;
  const phi1 = GEO.PHI1_DEG * GEO.DEG_TO_RAD;
  const phi2 = GEO.PHI2_DEG * GEO.DEG_TO_RAD;

  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
  const c = Math.cos(phi1) * Math.cos(phi1) + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(lat0)) / n;

  const lam = lon * GEO.DEG_TO_RAD;
  const phi = lat * GEO.DEG_TO_RAD;
  const theta = n * (lam - lon0);
  const rho = Math.sqrt(Math.max(0.01, c - 2 * n * Math.sin(phi))) / n;

  const rawX = rho * Math.sin(theta);
  const rawY = rho0 - rho * Math.cos(theta);

  const scale = Math.min(width, height) * GEO.SCALE_FACTOR;
  return {
    x: Number((width * GEO.OFFSET_X + rawX * scale).toFixed(1)),
    y: Number((height * GEO.OFFSET_Y - rawY * scale).toFixed(1)),
  };
}

export function hitTerritory(
  territories: readonly ProjectedTerritory[],
  cursorX: number,
  cursorY: number
): ProjectedTerritory | null {
  for (const t of territories) {
    const dx = cursorX - t.screenX;
    const dy = cursorY - t.screenY;
    if (Math.sqrt(dx * dx + dy * dy) <= t.radius + GEO.HIT_PADDING) {
      return t;
    }
  }
  return null;
}
