import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IngestionService } from "./ingestion.service";

describe("IngestionService", () => {
  let service: IngestionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        IngestionService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(IngestionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("extracts nested JSON sheets via backend POST /api/ingestion/sheets", () => {
    const jsonText = JSON.stringify([
      {
        entity: "Entity A",
        category: "Type 1",
        runs: 35,
      },
    ]);

    service.openText("Metrics_Dataset_Sample.json", "REST", "JSON", jsonText);

    const req = httpMock.expectOne("/api/ingestion/sheets");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({
      fileName: "Metrics_Dataset_Sample.json",
      format: "JSON",
      rawPayload: jsonText,
      rawPayloadBase64: "",
    });

    req.flush({
      tableName: "Metrics_Dataset_Sample",
      sheets: [
        {
          id: "table_1",
          name: "Metrics_Dataset_Sample",
          kind: "Table",
          sheetName: "Metrics_Dataset_Sample",
          tableName: "Metrics_Dataset_Sample",
          columns: [
            {
              name: "Column1",
              type: "String",
              displayType: "String",
              icon: "String",
            },
            {
              name: "Column2",
              type: "String",
              displayType: "String",
              icon: "String",
            },
            {
              name: "Column3",
              type: "String",
              displayType: "String",
              icon: "String",
            },
          ],
          rows: [
            { Column1: "entity", Column2: "category", Column3: "runs" },
            { Column1: "Entity A", Column2: "Type 1", Column3: 35 },
          ],
        },
      ],
      error: null,
    });

    expect(service.isNavigatorModalOpen()).toBe(true);
    expect(service.navigatorSheets()).toHaveLength(1);
    expect(service.selectedNavigatorSheet()?.name).toBe(
      "Metrics_Dataset_Sample",
    );
    expect(service.selectedNavigatorSheet()?.rows[0]).toEqual({
      Column1: "entity",
      Column2: "category",
      Column3: "runs",
    });
  });

  it("extracts binary XLSX workbooks via backend POST /api/ingestion/sheets", () => {
    const dummyBuffer = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    service.openBinary("Stats.xlsx", "XLSX", "XLSX", dummyBuffer, "UEsDBA==");

    const req = httpMock.expectOne("/api/ingestion/sheets");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.format).toBe("XLSX");
    expect(req.request.body.rawPayloadBase64).toBe("UEsDBA==");

    req.flush({
      tableName: "Stats_NBA",
      sheets: [
        {
          id: "sheet_1",
          name: "Stats NBA",
          kind: "Sheet",
          sheetName: "Stats NBA",
          tableName: "Stats_NBA",
          columns: [
            {
              name: "Column1",
              type: "String",
              displayType: "String",
              icon: "String",
            },
            {
              name: "Column2",
              type: "String",
              displayType: "String",
              icon: "String",
            },
          ],
          rows: [
            { Column1: "Joueur", Column2: "Points" },
            { Column1: "Jimmy Butler", Column2: 25 },
          ],
        },
      ],
      error: null,
    });

    expect(service.navigatorSheets()).toHaveLength(1);
    expect(service.navigatorSheets()[0].name).toBe("Stats NBA");
  });

  it("loads direct datasets via backend POST /api/ingestion/pipeline/preview", () => {
    let loadedDataset: unknown;
    service
      .loadDirect("sales.csv", "CSV", "Region,Revenue\nEMEA,1200")
      .subscribe((res) => {
        loadedDataset = res;
      });

    const req = httpMock.expectOne("/api/ingestion/pipeline/preview");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.fileName).toBe("sales.csv");
    expect(req.request.body.format).toBe("CSV");
    expect(req.request.body.rawPayload).toBe("Region,Revenue\nEMEA,1200");

    req.flush([
      {
        batchIndex: 0,
        tableName: "sales",
        schema: { Region: "UTF8_STRING", Revenue: "INT64" },
        columns: [
          {
            name: "Region",
            type: "UTF8_STRING",
            displayType: "String",
            icon: "String",
            numeric: false,
          },
          {
            name: "Revenue",
            type: "INT64",
            displayType: "Int64",
            icon: "Int64",
            numeric: true,
          },
        ],
        rows: [{ Region: "EMEA", Revenue: 1200 }],
        quarantinedRecords: [],
      },
    ]);

    const modelReq = httpMock.expectOne((r) =>
      r.url.startsWith("/api/models/"),
    );
    expect(modelReq.request.method).toBe("PUT");
    modelReq.flush({});

    const rowsReq = httpMock.expectOne(
      (r) =>
        r.url.includes("/api/models/") && r.url.endsWith("/tables/sales/rows"),
    );
    expect(rowsReq.request.method).toBe("POST");
    rowsReq.flush({});

    expect(loadedDataset).toBeTruthy();
    expect(service.sources()).toHaveLength(1);
    expect(service.sources()[0].name).toBe("sales.csv");
    expect(service.sources()[0].tableName).toBe("sales");
  });
});
