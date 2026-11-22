import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DataPrepColumn,
  DataPrepStep,
} from "../../features/data-prep/data-prep.model";
import {
  DataPrepEngineService,
  StepEvaluationResult,
} from "./prep.service";

describe("DataPrepEngineService", () => {
  let engine: DataPrepEngineService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DataPrepEngineService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    engine = TestBed.inject(DataPrepEngineService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("normalizes RQuery step payloads and strips FileSource/Navigation metadata steps", () => {
    const steps: DataPrepStep[] = [
      {
        id: "s0",
        name: "Source",
        type: "FileSource",
        definition: { step: "FileSource" },
      },
      {
        id: "s1",
        name: "Promoted Headers",
        type: "PromoteHeaders",
        definition: { step: "PromoteHeaders" },
      },
      {
        id: "s2",
        name: "Cast Revenue",
        type: "ChangeType",
        definition: {
          step: "ChangeType",
          column: "Revenue",
          targetType: "Float64",
        },
      },
    ];

    const mapped = engine.buildSteps(steps);
    expect(mapped).toHaveLength(2);
    expect(mapped[0].step).toBe("PromoteHeadersStep");
    expect(mapped[1].step).toBe("ChangeTypeStep");
    expect(mapped[1].type).toBe("FLOAT64");
  });

  it("evaluates a pipeline chain on the backend via POST /api/ingestion/preview", () => {
    const initialCols: DataPrepColumn[] = [
      { name: "Column1", type: "String", icon: "String" },
      { name: "Column2", type: "String", icon: "String" },
      { name: "Column3", type: "String", icon: "String" },
    ];
    const initialRows: Record<string, unknown>[] = [
      { Column1: "Player", Column2: "Points", Column3: "Active" },
      { Column1: "Jimmy Butler", Column2: "25", Column3: "true" },
      { Column1: "Luka Doncic", Column2: "30", Column3: "true" },
      { Column1: "Bench Player", Column2: "5", Column3: "false" },
    ];

    const steps: DataPrepStep[] = [
      {
        id: "s1",
        name: "Promoted Headers",
        type: "PromoteHeaders",
        definition: { step: "PromoteHeaders" },
      },
      {
        id: "s2",
        name: "Detect Types",
        type: "DetectDataType",
        definition: { step: "DetectDataType" },
      },
      {
        id: "s3",
        name: "Filter Star Players",
        type: "FilterRows",
        definition: { step: "FilterRows", predicate: "[Points] >= 20" },
      },
    ];

    let result: StepEvaluationResult | undefined;
    engine.evaluateSteps(initialCols, initialRows, steps).subscribe((res) => {
      result = res;
    });

    const req = httpMock.expectOne("/api/ingestion/preview");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.initialColumns).toEqual(initialCols);
    expect(req.request.body.initialRows).toEqual(initialRows);
    expect(req.request.body.steps).toHaveLength(3);

    req.flush([
      {
        batchIndex: 0,
        schema: {
          Player: "UTF8_STRING",
          Points: "INT64",
          Active: "BOOLEAN",
        },
        rows: [
          { Player: "Jimmy Butler", Points: 25, Active: true },
          { Player: "Luka Doncic", Points: 30, Active: true },
        ],
        quarantinedRecords: [],
      },
    ]);

    expect(result).toBeDefined();
    expect(result?.columns.map((c) => c.name)).toEqual([
      "Player",
      "Points",
      "Active",
    ]);
    expect(result?.columns.find((c) => c.name === "Points")?.type).toBe(
      "Int64",
    );
    expect(result?.columns.find((c) => c.name === "Active")?.type).toBe(
      "Boolean",
    );
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0]["Player"]).toBe("Jimmy Butler");
    expect(result?.rows[0]["Points"]).toBe(25);
  });
});
