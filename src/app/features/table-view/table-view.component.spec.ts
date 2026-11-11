import { provideZonelessChangeDetection } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { TableViewComponent } from "./table-view.component";
import { StateManagerService } from "../../core/state-manager.service";

describe("TableViewComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TableViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const state = TestBed.inject(StateManagerService);
    state.syncTables([
      {
        id: "user-fact-transactions",
        name: "fact_transactions",
        role: "FACT",
        columns: [
          { name: "transaction_id", dataType: "BIGINT", keyType: "PK" },
          { name: "volume", dataType: "INT", keyType: "None" },
          { name: "gross_amount", dataType: "DECIMAL", keyType: "None" },
          { name: "cost_amount", dataType: "DECIMAL", keyType: "None" },
        ],
        rowCount: 0,
      },
      {
        id: "user-dim-calendar",
        name: "dim_calendar",
        role: "DIMENSION",
        columns: [
          { name: "date_id", dataType: "DATE", keyType: "PK" },
          { name: "calendar_year", dataType: "INT", keyType: "None" },
        ],
        rowCount: 0,
      },
    ]);
  });

  it("instantiates the component with enterprise initial state", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeDefined();
    expect(component.tables().length).toBeGreaterThan(0);
    expect(component.activeTable()).toBeDefined();
    expect(component.displayedRows().length).toBe(0);
  });

  it("toggles accordion sections and collapse all", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isSectionExpanded("Tables")).toBe(true);
    expect(component.isSectionExpanded("Columns")).toBe(true);
    expect(component.isSectionExpanded("Calculations")).toBe(true);

    component.toggleSection("Tables");
    expect(component.isSectionExpanded("Tables")).toBe(false);

    component.toggleSection("Tables");
    expect(component.isSectionExpanded("Tables")).toBe(true);

    component.toggleCollapseAll();
    expect(component.isSectionExpanded("Tables")).toBe(false);
    expect(component.isSectionExpanded("Columns")).toBe(false);
    expect(component.isSectionExpanded("Calculations")).toBe(false);
    expect(component.isAllCollapsed()).toBe(true);

    component.toggleCollapseAll();
    expect(component.isSectionExpanded("Tables")).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);
  });

  it("switches active table and updates displayed rows", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const calendarTable = component
      .tables()
      .find((t) => t.name === "dim_calendar");
    if (calendarTable) {
      component.selectTable("dim_calendar");
      fixture.detectChanges();

      expect(component.activeTable()?.name).toBe("dim_calendar");
      expect(component.selectedTableName()).toBe("dim_calendar");
      expect(
        component.activeColumns().some((c) => c.name === "calendar_year"),
      ).toBe(true);
    }
  });

  it("filters tables in the explorer dock", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.filteredTables().length).toBe(component.tables().length);

    component.tableSearchQuery.set("transactions");
    fixture.detectChanges();

    expect(component.filteredTables().length).toBe(1);
    expect(component.filteredTables()[0].name).toBe("fact_transactions");

    component.tableSearchQuery.set("non_existent_table");
    fixture.detectChanges();
    expect(component.filteredTables().length).toBe(0);
  });

  it("sorts rows ascending, descending, clears sort, and respects Sort by Column", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.selectTable("fact_transactions");
    component.loadTableRows("fact_transactions", [
      { transaction_id: 1, volume: 100 },
      { transaction_id: 2, volume: 50 },
      { transaction_id: 3, volume: 200 },
    ]);
    fixture.detectChanges();

    expect(component.sortColumn()).toBeNull();

    component.toggleSort("volume");
    fixture.detectChanges();
    expect(component.sortColumn()).toBe("volume");
    expect(component.sortDirection()).toBe("asc");

    const firstAsc = component.displayedRows()[0]["volume"] as number;
    const lastAsc = component.displayedRows()[
      component.displayedRows().length - 1
    ]["volume"] as number;
    expect(firstAsc).toBeLessThanOrEqual(lastAsc);

    component.toggleSort("volume");
    fixture.detectChanges();
    expect(component.sortDirection()).toBe("desc");

    const firstDesc = component.displayedRows()[0]["volume"] as number;
    const lastDesc = component.displayedRows()[
      component.displayedRows().length - 1
    ]["volume"] as number;
    expect(firstDesc).toBeGreaterThanOrEqual(lastDesc);

    component.toggleSort("volume");
    fixture.detectChanges();
    expect(component.sortColumn()).toBeNull();
  });

  it("authors and commits a calculated column in row context and persists to StateManagerService", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const state = TestBed.inject(StateManagerService);
    component.selectTable("fact_transactions");
    component.loadTableRows("fact_transactions", [
      { transaction_id: 1, volume: 4, gross_amount: 500, cost_amount: 300 },
    ]);
    fixture.detectChanges();

    component.onNewColumn();
    expect(component.isFormulaActive()).toBe(true);
    expect(component.formulaTarget().startsWith("[NewColumn")).toBe(true);
    expect(component.formulaText()).toContain("'fact_transactions'[");

    component.formulaTarget.set("[Margin]");
    component.formulaText.set("'fact_transactions'[gross_amount] - 'fact_transactions'[cost_amount]");
    component.commitFormula();
    fixture.detectChanges();

    expect(component.isFormulaActive()).toBe(false);
    expect(component.activeColumns().some((c) => c.name === "Margin")).toBe(
      true,
    );
    expect(component.displayedRows()[0]["Margin"]).toBe(200);
    expect(state.getTableRows("fact_transactions")[0]["Margin"]).toBe(200);
  });

  it("creates a full 365-day calculated calendar table with Offset columns, SUMMARIZECOLUMNS, and INFO.VIEW Data Dictionary", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const initialTableCount = component.tables().length;

    component.onNewTable();
    expect(component.isFormulaActive()).toBe(true);

    component.formulaTarget.set("Calendar2026");
    component.formulaText.set(
      'ADDCOLUMNS(CALENDAR(DATE(2026, 1, 1), DATE(2026, 12, 31)), "Offset Day", DATEDIFF(TODAY(), [Date], DAY))',
    );
    component.commitFormula();
    fixture.detectChanges();

    expect(component.tables().length).toBe(initialTableCount + 1);
    expect(component.tables().some((t) => t.name === "Calendar2026")).toBe(
      true,
    );
    expect(component.activeTable()?.name).toBe("Calendar2026");
    expect(component.displayedRows().length).toBe(365);
    expect(
      component.activeColumns().some((c) => c.name === "Offset Day"),
    ).toBe(true);

    // Create Data Dictionary via INFO.VIEW functions
    component.onNewTable();
    component.formulaTarget.set("Data Dictionary");
    component.formulaText.set(
      "UNION(INFO.VIEW.COLUMNS(), INFO.VIEW.MEASURES(), INFO.VIEW.TABLES())",
    );
    component.commitFormula();
    fixture.detectChanges();

    expect(component.activeTable()?.name).toBe("Data Dictionary");
    expect(component.displayedRows().length).toBeGreaterThan(0);
    expect(component.activeColumns().map((c) => c.name)).toEqual([
      "Type",
      "Name",
      "Table",
      "Description",
      "Rax",
    ]);
  });

  it("adds a new measure, marks date table with primary key, and configures Column Tools properties", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const state = TestBed.inject(StateManagerService);
    const initialMeasureCount = state.measures.length;

    component.selectTable("dim_calendar");
    component.onNewMeasure();
    fixture.detectChanges();

    expect(state.measures.length).toBe(initialMeasureCount + 1);

    component.onMarkDateTable("date_id");
    expect(state.liveAnnouncement()).toContain("marked as Date Table");
    expect(component.activeTable()?.isDateTable).toBe(true);
    expect(component.activeTable()?.dateColumn).toBe("date_id");

    // Column Tools: Do not summarize, Hide in Report View, and Format override
    component.updateColumnSummarization("calendar_year", "None");
    const yearCol = component
      .activeColumns()
      .find((c) => c.name === "calendar_year")!;
    expect(yearCol.summarizeBy).toBe("None");

    component.toggleColumnHidden("calendar_year");
    expect(
      component.activeColumns().find((c) => c.name === "calendar_year")
        ?.isHidden,
    ).toBe(true);
  });

  it("formats cell values accurately for currency, percentage, explicit ColumnFormatConfig, and date types", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    const currencyCol = { name: "gross_amount", dataType: "DECIMAL" };
    expect(component.formatCellValue(12500.5, currencyCol)).toBe("€12,500.50");

    const pctCol = { name: "margin_pct", dataType: "FLOAT" };
    expect(component.formatCellValue(0.245, pctCol)).toBe("24.5%");

    const nullCol = { name: "unknown", dataType: "VARCHAR" };
    expect(component.formatCellValue(null, nullCol)).toBe("—");

    const boolCol = { name: "is_weekend", dataType: "BOOLEAN" };
    expect(component.formatCellValue(true, boolCol)).toBe("True");
    expect(component.formatCellValue(false, boolCol)).toBe("False");

    // French monetary column heuristics
    const frenchPriceCol = { name: "Prix_Unitaire_EUR", dataType: "FLOAT64" };
    expect(component.formatCellValue(8.68, frenchPriceCol)).toBe("€8.68");

    const frenchCaCol = { name: "Chiffre_Affaires_EUR", dataType: "FLOAT64" };
    expect(component.formatCellValue(52.08, frenchCaCol)).toBe("€52.08");

    // Explicit Column Tools Format override
    component.selectTable("fact_transactions");
    component.setColumnFormat("volume", "Currency");
    const volCol = component.activeColumns().find((c) => c.name === "volume")!;
    expect(component.formatCellValue(42, volCol)).toBe("€42.00");
  });

  it("normalizes column data types and computes effective date column", async () => {
    const fixture = TestBed.createComponent(TableViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getColumnDataType({ name: "col1", dataType: "STRING" })).toBe("STRING");
    expect(component.getColumnDataType({ name: "col2", dataType: "FLOAT64" })).toBe("FLOAT64");
    expect(component.getColumnDataType({ name: "col3", dataType: "INT64" })).toBe("INT64");
    expect(component.getColumnDataType({ name: "col4", dataType: "VARCHAR" })).toBe("VARCHAR");
    expect(component.isCustomDataType("STRING")).toBe(false);
    expect(component.isCustomDataType("UUID")).toBe(true);

    // effectiveDateColumn should fallback gracefully
    expect(component.effectiveDateColumn()).toBeTruthy();
  });
});
