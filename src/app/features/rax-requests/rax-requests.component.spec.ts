import { provideZonelessChangeDetection } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, beforeEach } from "vitest";
import { RaxRequestsComponent } from "./rax-requests.component";

describe("RaxRequestsComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RaxRequestsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it("instantiates the component successfully", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeDefined();
    expect(fixture.componentInstance.queryContent()).toContain("INFO.VIEW.TABLES()");
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
    expect(comp.isSectionExpanded("Tables")).toBe(true);

    comp.toggleSection("Tables");
    expect(comp.isSectionExpanded("Tables")).toBe(false);

    // When not all are collapsed, toggleCollapseAll collapses all
    comp.toggleCollapseAll();
    expect(comp.isAllCollapsed()).toBe(true);
    expect(comp.isSectionExpanded("Tables")).toBe(false);

    // When all are collapsed, toggleCollapseAll expands all
    comp.toggleCollapseAll();
    expect(comp.isAllCollapsed()).toBe(false);
    expect(comp.isSectionExpanded("Tables")).toBe(true);
    expect(comp.isSectionExpanded("Measures")).toBe(true);
  });

  it("manages single editor content and status directly", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.updateActiveContent("EVALUATE 1 + 1");
    expect(comp.queryContent()).toBe("EVALUATE 1 + 1");

    comp.clearEditor();
    expect(comp.queryContent()).toBe("");
    expect(comp.diagnostics().length).toBe(0);
  });

  it("executes INFO.VIEW.TABLES metadata query with Description and IsHidden columns", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp["state"].addTable({
      id: "user-tbl-1",
      name: "user_sales",
      role: "FACT",
      columns: [{ name: "id", dataType: "INT", keyType: "PK" }],
      rowCount: 1,
      description: "Order transactions table",
    });
    comp.updateActiveContent("EVALUATE INFO.VIEW.TABLES()");
    comp.runQuery();

    const res = comp.activeTab().lastResult;
    expect(res).toBeDefined();
    expect(res?.rows.length).toBeGreaterThan(0);
    expect(res?.routedEngine).toBe("DUCKDB");
    expect(comp.resultColumns()).toContain("Name");
    expect(comp.resultColumns()).toContain("Description");
  });

  it("executes INFO.CALCDEPENDENCY and INFO.STORAGETABLECOLUMNS queries", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp["state"].addTable({
      id: "user-tbl-orders",
      name: "Orders",
      role: "FACT",
      columns: [
        { name: "Quantity", dataType: "INT", keyType: "None" },
        { name: "Price", dataType: "DOUBLE", keyType: "None" },
      ],
      rowCount: 500,
    });
    comp["state"].saveMeasure({
      id: "m-qty",
      label: "Qty",
      formula: "SUM('Orders'[Quantity])",
      table: "Orders",
    });
    comp["state"].saveMeasure({
      id: "m-amt",
      label: "Amount",
      formula: "SUMX('Orders', [Qty] * 'Orders'[Price])",
      table: "Orders",
    });

    comp.updateActiveContent("EVALUATE INFO.CALCDEPENDENCY()");
    comp.runQuery();
    const depRes = comp.activeTab().lastResult;
    expect(depRes?.rows.length).toBeGreaterThanOrEqual(2);
    expect(
      depRes?.rows.some((r) => r["REFERENCED_OBJECT_TYPE"] === "MEASURE"),
    ).toBe(true);

    comp.updateActiveContent("EVALUATE INFO.STORAGETABLECOLUMNS()");
    comp.runQuery();
    const storageRes = comp.activeTab().lastResult;
    expect(storageRes?.rows.length).toBeGreaterThanOrEqual(2);
    expect(storageRes?.rows[0]).toHaveProperty("DICTIONARY_SIZE");
  });

  it("parses TMDL createOrReplace with /// descriptions and updates semantic model measures", async () => {
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

    comp.updateActiveContent(tmdl);
    comp.runQuery();

    const saved = comp["state"].measures.find((m) => m.label === "Amount");
    expect(saved).toBeDefined();
    expect(saved?.description).toBe(
      "The amount multiplies quantity by unit selling price",
    );
    expect(saved?.formatString).toBe("€#,0.00");
  });

  it("defines all measures and supports Find & Replace across the script", async () => {
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

    comp.defineAllMeasures();
    expect(comp.activeTab().content).toContain("DEFINE");
    expect(comp.activeTab().content).toContain("'OldTable'[Total Qty]");

    comp.findText.set("OldTable");
    comp.replaceText.set("NewTable");
    comp.replaceAllInEditor();
    expect(comp.activeTab().content).toContain("NewTable");
    expect(comp.activeTab().content).not.toContain("OldTable");
  });

  it("guards syntax linter against blank input without false errors", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.clearEditor();
    const diags = comp.validateQuery();
    expect(diags.length).toBe(0);
  });

  it("formats RAX query text properly", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.updateActiveContent("evaluate info.view.tables() order by [name] asc");
    comp.formatQuery();

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

    comp1.updateActiveContent("EVALUATE ROW(\"Check\", 40 + 2)");
    comp1.runQuery();
    fixture1.destroy();

    const fixture2 = TestBed.createComponent(RaxRequestsComponent);
    await fixture2.whenStable();
    const comp2 = fixture2.componentInstance;

    expect(comp2.queryContent()).toBe("EVALUATE ROW(\"Check\", 40 + 2)");
    expect(comp2.lastResult()?.rows).toEqual([{ Check: 42 }]);
  });

  it("evaluates real RAX formulas (SUM, SUMX, DIVIDE, CALCULATE, VAR/RETURN, SUMMARIZECOLUMNS) against loaded table rows", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp["state"].addTable({
      id: "user-tbl-sales",
      name: "Orders",
      role: "FACT",
      columns: [
        { name: "Region", dataType: "VARCHAR", keyType: "None" },
        { name: "Quantity", dataType: "INT", keyType: "None" },
        { name: "Price", dataType: "DOUBLE", keyType: "None" },
      ],
      rowCount: 3,
    });
    comp["state"].setTableRows("Orders", [
      { Region: "EMEA", Quantity: 2, Price: 50 },
      { Region: "EMEA", Quantity: 3, Price: 100 },
      { Region: "AMER", Quantity: 5, Price: 20 },
    ]);

    // 1. DEFINE MEASURE + SUMX with context transition + DIVIDE + ROW
    comp.updateActiveContent(
      [
        "DEFINE",
        "  MEASURE 'Orders'[Total Qty] = SUM('Orders'[Quantity])",
        "  MEASURE 'Orders'[Revenue] = SUMX('Orders', [Total Qty] * 'Orders'[Price])",
        "  MEASURE 'Orders'[EMEA Revenue] = CALCULATE([Revenue], 'Orders'[Region] = \"EMEA\")",
        "EVALUATE",
        "VAR AvgUnitRev = DIVIDE([Revenue], [Total Qty], 0)",
        "RETURN",
        "ROW(\"Qty\", [Total Qty], \"Revenue\", [Revenue], \"EMEA Revenue\", [EMEA Revenue], \"Avg Unit\", AvgUnitRev)",
      ].join("\n"),
    );
    comp.runQuery();

    const rowRes = comp.activeTab().lastResult?.rows?.[0];
    expect(rowRes).toEqual({
      Qty: 10,
      Revenue: 500,
      "EMEA Revenue": 400,
      "Avg Unit": 50,
    });

    // 2. SUMMARIZECOLUMNS with ORDER BY DESC
    comp.updateActiveContent(
      [
        "EVALUATE",
        "SUMMARIZECOLUMNS(",
        "  'Orders'[Region],",
        "  \"Region Revenue\", [Revenue],",
        "  \"Region Qty\", [Total Qty]",
        ")",
        "ORDER BY [Region Revenue] DESC",
      ].join("\n"),
    );
    comp.runQuery();

    expect(comp.activeTab().lastResult?.rows).toEqual([
      { Region: "EMEA", "Region Revenue": 400, "Region Qty": 5 },
      { Region: "AMER", "Region Revenue": 100, "Region Qty": 5 },
    ]);
  });
});
