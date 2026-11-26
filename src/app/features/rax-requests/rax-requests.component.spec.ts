import { provideZonelessChangeDetection } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RaxRequestsComponent } from "./rax-requests.component";

describe("RaxRequestsComponent", () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RaxRequestsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Drain optional background init requests (catalog / default model)
    httpMock.match(() => true);
  });

  it("instantiates the component successfully and loads catalog", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const catalogReq = httpMock.expectOne("/api/rax/catalog");
    expect(catalogReq.request.method).toBe("GET");
    catalogReq.flush([
      {
        label: "CALCULATE",
        signature: "CALCULATE(<expr>)",
        doc: "Modifies filter context.",
      },
    ]);

    expect(fixture.componentInstance).toBeDefined();
    expect(fixture.componentInstance.queryContent()).toContain(
      "INFO.VIEW.TABLES()",
    );
  });

  it("renders workspace action toolbar with query execution controls", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const actionToolbar = fixture.nativeElement.querySelector(
      ".rc-page-header.rc-workspace-header",
    );
    expect(actionToolbar).toBeTruthy();
    expect(actionToolbar.querySelector("#btn-run-query")).toBeTruthy();
  });

  it("toggles accordion sections and supports bulk collapse/expand", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.sectionExpanded("Tables")).toBe(true);

    comp.toggleSection("Tables");
    expect(comp.sectionExpanded("Tables")).toBe(false);

    comp.toggleAll();
    expect(comp.isAllCollapsed()).toBe(true);
    expect(comp.sectionExpanded("Tables")).toBe(false);

    comp.toggleAll();
    expect(comp.isAllCollapsed()).toBe(false);
    expect(comp.sectionExpanded("Tables")).toBe(true);
    expect(comp.sectionExpanded("Measures")).toBe(true);
  });

  it("manages single editor content and status directly", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.updateContent("EVALUATE 1 + 1");
    expect(comp.queryContent()).toBe("EVALUATE 1 + 1");

    comp.clearEditor();
    expect(comp.queryContent()).toBe("");
    expect(comp.diagnostics().length).toBe(0);
  });

  it("executes INFO.VIEW.TABLES metadata query via POST /api/rax/execute", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.updateContent("EVALUATE INFO.VIEW.TABLES()");
    comp.runQuery();

    const execReq = httpMock.expectOne("/api/rax/execute");
    expect(execReq.request.method).toBe("POST");
    expect(execReq.request.body.script).toBe("EVALUATE INFO.VIEW.TABLES()");
    execReq.flush({
      cacheKey: "meta-info-query",
      cacheHit: false,
      routedEngine: "DUCKDB",
      executionTimeMs: 2,
      executedSql: "SELECT * FROM information_schema.rax_catalog;",
      rows: [
        {
          ID: 1,
          Name: "user_sales",
          Role: "FACT",
          Description: "Order transactions table",
        },
      ],
    });

    const res = comp.activeTab().lastResult;
    expect(res).toBeDefined();
    expect(res?.rows.length).toBe(1);
    expect(res?.routedEngine).toBe("DUCKDB");
    expect(comp.resultColumns()).toContain("Name");
    expect(comp.resultColumns()).toContain("Description");
  });

  it("applies TMDL createOrReplace measures via POST /api/rax/measures/apply", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const tmdl = [
      "createOrReplace",
      "  table 'Order Details'",
      "    /// The amount multiplies quantity by unit selling price",
      "    measure 'Amount' = SUMX('Order Details', [Qty] * 'Order Details'[Price])",
      '      formatString: "€#,0.00"',
    ].join("\n");

    comp.updateContent(tmdl);
    comp.applyModel();

    const applyReq = httpMock.expectOne("/api/rax/measures/apply");
    expect(applyReq.request.method).toBe("POST");
    expect(applyReq.request.body.script).toBe(tmdl);
    applyReq.flush({
      appliedCount: 1,
      measures: [
        {
          id: "m_amount",
          name: "Amount",
          tableName: "Order Details",
          raxExpression: "SUMX('Order Details', [Qty] * 'Order Details'[Price])",
          description: "The amount multiplies quantity by unit selling price",
          formatString: "€#,0.00",
        },
      ],
    });

    const saved = comp["state"].measures.find((m) => m.label === "Amount");
    expect(saved).toBeDefined();
    expect(saved?.description).toBe(
      "The amount multiplies quantity by unit selling price",
    );
    expect(saved?.formatString).toBe("€#,0.00");
  });

  it("defines all measures via POST /api/rax/measures/define and supports Find & Replace", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp["state"].saveMeasure({
      id: "m-qty-1",
      label: "Total Qty",
      formula: "SUM('OldTable'[Quantity])",
      table: "OldTable",
    });

    comp.defineMeasures();
    const defineReq = httpMock.expectOne("/api/rax/measures/define");
    expect(defineReq.request.method).toBe("POST");
    defineReq.flush({
      script:
        "DEFINE\n    MEASURE 'OldTable'[Total Qty] = SUM('OldTable'[Quantity])\nEVALUATE\n    ROW(\"Total Qty\", [Total Qty])",
    });

    expect(comp.activeTab().content).toContain("DEFINE");
    expect(comp.activeTab().content).toContain("'OldTable'[Total Qty]");

    comp.findText.set("OldTable");
    comp.replaceText.set("NewTable");
    comp.replaceAll();
    expect(comp.activeTab().content).toContain("NewTable");
    expect(comp.activeTab().content).not.toContain("OldTable");
  });

  it("surfaces RFC 9457 ProblemDetail detail and errorCode in errorBanner on HTTP 400", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.updateContent("   ");
    comp.runQuery();

    const execReq = httpMock.expectOne("/api/rax/execute");
    execReq.flush(
      {
        title: "Validation Failed",
        status: 400,
        detail: "script: RAX script is required",
        errorCode: "ERR_VALIDATION_FAILED",
      },
      { status: 400, statusText: "Bad Request" },
    );
    fixture.detectChanges();

    expect(comp.errorBanner()?.errorCode).toBe("ERR_VALIDATION_FAILED");
    expect(comp.errorBanner()?.detail).toContain("RAX script is required");
    const bannerEl: HTMLElement | null =
      fixture.nativeElement.querySelector("#rax-error-banner");
    expect(bannerEl).toBeTruthy();
    expect(bannerEl?.textContent).toContain("ERR_VALIDATION_FAILED");
    expect(bannerEl?.textContent).toContain("RAX script is required");
  });

  it("guards syntax validator against blank input without HTTP call or false errors", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.clearEditor();
    comp.validateQuery();

    httpMock.expectNone("/api/rax/diagnostics/validate");
    expect(comp.diagnostics().length).toBe(0);
    expect(comp.activeTab().statusText).toBe("Ready");
  });

  it("formats RAX query text via POST /api/rax/format", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.updateContent("evaluate info.view.tables() order by [name] asc");
    comp.formatQuery();

    const req = httpMock.expectOne("/api/rax/format");
    expect(req.request.method).toBe("POST");
    req.flush({
      formattedScript: "EVALUATE\n    INFO.VIEW.TABLES()\nORDER BY [name] ASC",
    });

    expect(comp.activeTab().content).toContain("EVALUATE");
    expect(comp.activeTab().content).toContain("ORDER BY");
    expect(comp.activeTab().content).toContain("ASC");
  });

  it("switches between bottom result tabs", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.bottomActiveTab()).toBe("results");

    comp.bottomActiveTab.set("problems");
    expect(comp.bottomActiveTab()).toBe("problems");

    comp.bottomActiveTab.set("plan");
    expect(comp.bottomActiveTab()).toBe("plan");
  });

  it("persists editor formula and results across component navigation", async () => {
    const fixture1 = TestBed.createComponent(RaxRequestsComponent);
    await fixture1.whenStable();
    const comp1 = fixture1.componentInstance;

    comp1.updateContent('EVALUATE ROW("Check", 40 + 2)');
    comp1.runQuery();
    httpMock.expectOne("/api/rax/execute").flush({
      cacheKey: "rax-check-42",
      cacheHit: false,
      routedEngine: "DUCKDB",
      executionTimeMs: 2,
      executedSql: 'SELECT 42 AS "Check"',
      rows: [{ Check: 42 }],
    });
    fixture1.destroy();

    const fixture2 = TestBed.createComponent(RaxRequestsComponent);
    await fixture2.whenStable();
    const comp2 = fixture2.componentInstance;

    expect(comp2.queryContent()).toBe('EVALUATE ROW("Check", 40 + 2)');
    expect(comp2.lastResult()?.rows).toEqual([{ Check: 42 }]);
  });

  it("enforces zero-demo domain-neutral snippets and safe empty model guards", async () => {
    localStorage.clear();
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;

    const emptySnippetsJson = JSON.stringify(comp.quickSnippets());
    expect(emptySnippetsJson).not.toContain("fact_transactions");
    expect(emptySnippetsJson).not.toContain("dim_region");
    expect(emptySnippetsJson).not.toContain("gross_amount");
    expect(emptySnippetsJson).not.toContain("region_name");
    expect(
      comp.quickSnippets().every((s) => s.category === "Metadata (INFO)"),
    ).toBe(true);

    comp.updateContent("EVALUATE 1");
    comp.defineMeasures();
    expect(comp.activeTab().content).toBe("EVALUATE 1");

    comp.generateTmdl();
    httpMock.expectNone("/api/rax/tmdl");
    expect(comp.activeTab().content).toBe("EVALUATE 1");

    comp["state"].addTable({
      id: "tbl-iot",
      name: "telemetry_logs",
      role: "DIMENSION",
      columns: [
        { name: "sensor_id", dataType: "VARCHAR", keyType: "PK" },
        { name: "reading_mv", dataType: "DOUBLE", keyType: "None" },
      ],
      rowCount: 10,
    });

    const loadedCodes = comp
      .quickSnippets()
      .map((s) => s.code)
      .join("\n");
    expect(loadedCodes).toContain("'telemetry_logs'[reading_mv]");
    expect(loadedCodes).toContain("'telemetry_logs'[sensor_id]");
    expect(comp.quickSnippets().some((s) => s.label.includes("&"))).toBe(false);
  });

  it("renders 12x12 twisties, single-concept headings, and accessible diagnostic pills", async () => {
    localStorage.clear();
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    const comp = fixture.componentInstance;

    comp.updateContent("EVALUATE FILTER(ALL(telemetry_logs), TRUE)");
    comp.validateQuery();
    httpMock.expectOne("/api/rax/diagnostics/validate").flush({
      isValid: true,
      statusLabel: "Syntax valid with warnings",
      measureName: null,
      formulaExpression: "EVALUATE FILTER(ALL(telemetry_logs), TRUE)",
      diagnostics: [
        {
          line: 1,
          column: 10,
          length: 25,
          severity: "WARNING",
          code: "WARN_INEFFICIENT_TABLE_FILTER",
          message: "Filter specific column instead of full table.",
        },
      ],
      tokens: [],
    });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const chevrons = Array.from(el.querySelectorAll("svg.rc-section-chevron"));
    expect(chevrons.length).toBeGreaterThan(0);
    for (const svg of chevrons) {
      expect(svg.getAttribute("width")).toBe("12");
      expect(svg.getAttribute("height")).toBe("12");
    }

    const planTab = el.querySelector("#tab-btn-plan")?.textContent?.trim();
    expect(planTab).toBe("Execution Plan");

    const diagPill = el.querySelector(".rc-pill-warning");
    expect(diagPill).toBeTruthy();
    expect(diagPill?.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(diagPill?.textContent?.trim()).toBe("warning");
  });
});
