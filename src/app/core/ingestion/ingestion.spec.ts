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
      sheets: [
        {
          id: "table_1",
          name: "Metrics_Dataset_Sample",
          kind: "Table",
          sheetName: "Metrics_Dataset_Sample",
          columns: [
            { name: "Column1", type: "String", icon: "String" },
            { name: "Column2", type: "String", icon: "String" },
            { name: "Column3", type: "String", icon: "String" },
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
      sheets: [
        {
          id: "sheet_1",
          name: "Stats NBA",
          kind: "Sheet",
          sheetName: "Stats NBA",
          columns: [
            { name: "Column1", type: "String", icon: "String" },
            { name: "Column2", type: "String", icon: "String" },
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

  it("loads direct datasets via backend POST /api/ingestion/preview", () => {
    let loadedDataset: unknown;
    service
      .loadDirect("sales.csv", "CSV", "Region,Revenue\nEMEA,1200")
      .subscribe((res) => {
        loadedDataset = res;
      });

    const req = httpMock.expectOne("/api/ingestion/preview");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.format).toBe("CSV");
    expect(req.request.body.rawPayload).toBe("Region,Revenue\nEMEA,1200");

    req.flush([
      {
        batchIndex: 0,
        schema: { Region: "UTF8_STRING", Revenue: "INT64" },
        rows: [{ Region: "EMEA", Revenue: 1200 }],
        quarantinedRecords: [],
      },
    ]);

    expect(loadedDataset).toBeTruthy();
    expect(service.sources()).toHaveLength(1);
    expect(service.sources()[0].name).toBe("sales.csv");
  });
});
