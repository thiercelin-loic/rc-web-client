import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateManagerService } from "../state/state.service";
import { ExportService } from "./export.service";

describe("ExportService", () => {
  let service: ExportService;
  let state: StateManagerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ExportService);
    state = TestBed.inject(StateManagerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  it("refuses export and announces error when active page has no visuals", () => {
    state.clearVisuals();
    let emitted = false;
    service.triggerExport("rep-1", "vis-1", ".xlsx").subscribe(() => {
      emitted = true;
    });

    expect(emitted).toBe(false);
    expect(state.statusIsError()).toBe(true);
    expect(service.lastReceipt()).toBeNull();
  });

  it("posts PDF export to /api/reports/:reportId/export", () => {
    state.addVisual("Bar");
    let receiptFormat = "";

    service
      .triggerExport("rep-1", "vis-1", ".pdf", {
        width: 1280,
        height: 720,
        preset: "16:9",
      })
      .subscribe((r) => {
        receiptFormat = r.format;
      });

    const req = httpMock.expectOne("/api/reports/rep-1/export");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.format).toBe(".pdf");
    expect(req.request.body.canvasDimensions?.width).toBe(1280);

    req.flush({
      jobId: "job-1",
      format: ".pdf",
      mimeType: "application/pdf",
      filename: "Untitled Project.pdf",
      status: "COMPLETED",
      timestamp: "2026-11-15T12:00:00Z",
    });

    expect(receiptFormat).toBe(".pdf");
    expect(service.lastReceipt()?.jobId).toBe("job-1");
  });

  it("posts tabular exports to /api/reports/:reportId/export and propagates errors", () => {
    state.addVisual("Bar");
    let errorStatus = 0;

    service.triggerExport("rep-1", "vis-1", ".csv").subscribe({
      error: (err) => {
        errorStatus = err.status;
      },
    });

    const req = httpMock.expectOne("/api/reports/rep-1/export");
    expect(req.request.method).toBe("POST");
    req.flush("Server error", { status: 500, statusText: "Server Error" });

    expect(errorStatus).toBe(500);
    expect(service.lastReceipt()).toBeNull();
    expect(state.statusIsError()).toBe(true);
  });
});
