import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeoService } from "./geo";
import {
  DEFAULT_HEIGHT,
  DEFAULT_RADIUS,
  DEFAULT_WIDTH,
  GEO_HIT_TEST_ENDPOINT,
  GEO_PROJECT_BATCH_ENDPOINT,
  GEO_PROJECT_POINT_ENDPOINT,
} from "./geo.constants";
import { ProjectedPoint, ProjectedTerritory } from "./geo.interface";

describe("GeoService", () => {
  let service: GeoService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GeoService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(GeoService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("projects single European coordinates via backend POST /api/geo/project-point", () => {
    let result: ProjectedPoint | undefined;
    service.projectEurope(2.3522, 48.8566).subscribe((pt) => {
      result = pt;
    });

    const req = httpMock.expectOne(GEO_PROJECT_POINT_ENDPOINT);
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({
      lon: 2.3522,
      lat: 48.8566,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
    req.flush({ x: 222.4, y: 185.1 });

    expect(result).toEqual({ x: 222.4, y: 185.1 });
  });

  it("projects territory batches and resolves hit-tests via backend endpoints", () => {
    const territories = [
      {
        id: "t1",
        nutsCode: "FR10",
        name: "Île-de-France",
        centerLon: 2.35,
        centerLat: 48.85,
      },
    ];
    let projected: ProjectedTerritory[] = [];
    service.projectBatch(territories).subscribe((res) => {
      projected = res;
    });

    const batchReq = httpMock.expectOne(GEO_PROJECT_BATCH_ENDPOINT);
    expect(batchReq.request.method).toBe("POST");
    expect(batchReq.request.body).toEqual({
      territories,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
    batchReq.flush([
      {
        id: "t1",
        nutsCode: "FR10",
        name: "Île-de-France",
        screenX: 222.4,
        screenY: 185.1,
        radius: DEFAULT_RADIUS,
      },
    ]);

    expect(projected).toHaveLength(1);

    let hit: ProjectedTerritory | null = null;
    service.hitTerritory(projected, 225, 186).subscribe((matched) => {
      hit = matched;
    });

    const hitReq = httpMock.expectOne(GEO_HIT_TEST_ENDPOINT);
    expect(hitReq.request.method).toBe("POST");
    expect(hitReq.request.body).toEqual({
      territories: projected,
      cursorX: 225,
      cursorY: 186,
    });
    hitReq.flush(projected[0]);

    expect(hit).toEqual(projected[0]);
  });
});
