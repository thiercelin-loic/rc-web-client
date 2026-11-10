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
    expect(fixture.componentInstance.tabs().length).toBeGreaterThanOrEqual(1);
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

  it("adds and closes script tabs correctly", async () => {
    const fixture = TestBed.createComponent(RaxRequestsComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const initialCount = comp.tabs().length;

    comp.addNewTab();
    expect(comp.tabs().length).toBe(initialCount + 1);

    const createdId = comp.activeTabId();
    comp.closeTab(createdId);
    expect(comp.tabs().length).toBe(initialCount);
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
});
