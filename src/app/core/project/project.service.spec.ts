import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManagerService } from "../state/state.service";
import { ProjectService } from "./project.service";

describe("ProjectService", () => {
  let service: ProjectService;
  let state: StateManagerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProjectService);
    state = TestBed.inject(StateManagerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("exports .rcp archive via POST /api/projects/export", () => {
    state.createProject("SalesDashboard");
    let resultBytes: Uint8Array | undefined;

    service.exportArchive("SalesDashboard.rcp").subscribe((bytes) => {
      resultBytes = bytes;
    });

    const req = httpMock.expectOne("/api/projects/export");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.filename).toBe("SalesDashboard.rcp");

    req.flush({
      filename: "SalesDashboard.rcp",
      archiveBase64: btoa("PK\x03\x04"),
      checksumSha256: "abc123",
    });

    expect(resultBytes).toBeDefined();
    expect(resultBytes?.[0]).toBe(0x50);
    expect(resultBytes?.[1]).toBe(0x4b);
  });

  it("imports .rcp archive via POST /api/projects/import and hydrates state", async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "Demo.rcp");
    const openPromise = service.openFile(file);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const req = httpMock.expectOne("/api/projects/import");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.filename).toBe("Demo.rcp");

    req.flush({
      filename: "Demo.rcp",
      pages: ["Overview", "Details"],
      visualsMap: { Overview: [], Details: [] },
      tables: [
        {
          id: "t1",
          name: "Sales",
          role: "FACT",
          columns: [{ name: "Amount", dataType: "Float64" }],
        },
      ],
      rows: { Sales: [{ Amount: 100 }] },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const modelReq = httpMock.expectOne((r) =>
      r.url.startsWith("/api/models/"),
    );
    expect(modelReq.request.method).toBe("PUT");
    modelReq.flush({ status: "OK" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const rowsReq = httpMock.expectOne((r) =>
      r.url.endsWith("/tables/Sales/rows"),
    );
    expect(rowsReq.request.method).toBe("POST");
    rowsReq.flush({ modelId: "default", tableName: "Sales", rowsIngested: 1 });

    const ok = await openPromise;
    expect(ok).toBe(true);
    expect(state.activeProject().filename).toBe("Demo.rcp");
    expect(state.reportPages()).toEqual(["Overview", "Details"]);
    expect(state.tableRows("Sales")).toEqual([{ Amount: 100 }]);
  });
});
