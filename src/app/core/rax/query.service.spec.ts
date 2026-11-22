import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryService } from "./query.service";
import type { QueryExecutionResult } from "./rax.interface";

describe("QueryService", () => {
  let service: QueryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(QueryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("executes a measure query against the backend without fictitious defaults", () => {
    const mockResult: QueryExecutionResult = {
      cacheKey: "k1",
      cacheHit: false,
      routedEngine: "DUCKDB",
      executionTimeMs: 12,
      executedSql: "SELECT 42;",
      rows: [{ measure_value: 42 }],
    };

    let actual: QueryExecutionResult | undefined;
    service.executeMeasure("m1", "SUM('Sales'[Amount])").subscribe((res) => {
      actual = res;
    });

    const req = httpMock.expectOne("/api/reports/Untitled%20Project.rcp/query");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.measureId).toBe("m1");
    expect(req.request.body.tenantId).toBeUndefined();
    expect(req.request.body.visualId).toBeUndefined();
    req.flush(mockResult);

    expect(actual).toEqual(mockResult);
  });

  it("propagates HTTP errors from executeMeasure without local fallback", () => {
    let errorStatus: number | undefined;
    service.executeMeasure("m1", "1 + 1").subscribe({
      error: (err) => {
        errorStatus = err.status;
      },
    });

    const req = httpMock.expectOne("/api/reports/Untitled%20Project.rcp/query");
    req.flush("Server error", {
      status: 503,
      statusText: "Service Unavailable",
    });

    expect(errorStatus).toBe(503);
  });

  it("propagates HTTP errors from executeVisual without local fallback", () => {
    let errorStatus: number | undefined;
    service
      .executeVisual({ visualId: "v1", groupByColumns: ["Region"] })
      .subscribe({
        error: (err) => {
          errorStatus = err.status;
        },
      });

    const req = httpMock.expectOne("/api/reports/Untitled%20Project.rcp/query");
    expect(req.request.body.visualId).toBe("v1");
    req.flush("Bad gateway", { status: 502, statusText: "Bad Gateway" });

    expect(errorStatus).toBe(502);
  });
});
