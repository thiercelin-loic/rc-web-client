import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryService } from "./query.service";
import type {
  ApplyMeasuresResponse,
  FormatQueryResponse,
  QueryExecutionResult,
  RaxFunctionCatalogEntry,
  TmdlGenerateResponse,
} from "./rax.interface";

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

  it("delegates formatScript, generateTmdl, executeScript, applyMeasures, validateScript, and loadCatalog to /api/rax/*", () => {
    let formatted: FormatQueryResponse | undefined;
    service.formatScript("evaluate 1").subscribe((res) => (formatted = res));
    httpMock
      .expectOne("/api/rax/format")
      .flush({ formattedScript: "EVALUATE\n    1" });
    expect(formatted?.formattedScript).toBe("EVALUATE\n    1");

    let tmdl: TmdlGenerateResponse | undefined;
    service.generateTmdl("m-1").subscribe((res) => (tmdl = res));
    httpMock
      .expectOne("/api/rax/tmdl")
      .flush({ tmdlScript: "createOrReplace" });
    expect(tmdl?.tmdlScript).toBe("createOrReplace");

    let execResult: QueryExecutionResult | undefined;
    service
      .executeScript("EVALUATE 1", "m-1")
      .subscribe((res) => (execResult = res));
    expect(service.isExecuting()).toBe(true);
    httpMock.expectOne("/api/rax/execute").flush({
      cacheKey: "exec-1",
      cacheHit: false,
      routedEngine: "DUCKDB",
      executionTimeMs: 4,
      executedSql: "SELECT 1;",
      rows: [{ Value: 1 }],
    });
    expect(service.isExecuting()).toBe(false);
    expect(execResult?.rows).toEqual([{ Value: 1 }]);

    let applyRes: ApplyMeasuresResponse | undefined;
    service
      .applyMeasures("DEFINE MEASURE 'T'[M] = 1", "m-1")
      .subscribe((res) => (applyRes = res));
    httpMock.expectOne("/api/rax/measures/apply").flush({
      appliedCount: 1,
      measures: [
        {
          id: "m_1",
          name: "M",
          tableName: "T",
          raxExpression: "1",
        },
      ],
    });
    expect(applyRes?.appliedCount).toBe(1);

    let blankValidation: unknown = "unset";
    service.validateScript("   ").subscribe((res) => (blankValidation = res));
    httpMock.expectNone("/api/rax/diagnostics/validate");
    expect(blankValidation).toBeNull();

    let catalog: readonly RaxFunctionCatalogEntry[] | undefined;
    service.loadCatalog().subscribe((res) => (catalog = res));
    httpMock
      .expectOne("/api/rax/catalog")
      .flush([{ label: "SUM", signature: "SUM(<col>)", doc: "Sum" }]);
    expect(catalog?.[0].label).toBe("SUM");
    expect(service.catalog()[0].label).toBe("SUM");
  });
});
