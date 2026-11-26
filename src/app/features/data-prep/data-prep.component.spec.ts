import { provideZonelessChangeDetection } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, beforeEach } from "vitest";
import { DataPrepComponent } from "./data-prep.component";
import { StateManagerService } from "../../core/state/state.service";

describe("DataPrepComponent", () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    window.localStorage?.clear();
    TestBed.configureTestingModule({
      imports: [DataPrepComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        StateManagerService,
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  function flushDirectDataset(
    tableName: string,
    columns: readonly {
      readonly name: string;
      readonly displayType: string;
      readonly numeric?: boolean;
    }[],
    rows: readonly Record<string, unknown>[],
  ): void {
    const previewReqs = httpMock.match("/api/ingestion/pipeline/preview");
    for (const req of previewReqs) {
      req.flush([
        {
          batchIndex: 0,
          tableName,
          schema: Object.fromEntries(
            columns.map((c) => [c.name, c.displayType.toUpperCase()]),
          ),
          columns: columns.map((c) => ({
            name: c.name,
            type: c.displayType,
            displayType: c.displayType,
            icon: c.displayType,
            numeric: c.numeric ?? false,
          })),
          rows,
          quarantinedRecords: [],
        },
      ]);
    }
    for (const req of httpMock.match("/api/models")) {
      req.flush({});
    }
    for (const req of httpMock.match((r) => r.url.includes("/tables/"))) {
      req.flush({});
    }
  }

  it("instantiates the component with enterprise initial state", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeDefined();
    expect(component.sources().length).toBe(0);
    expect(component.appliedSteps().length).toBe(0);
    expect(component.selectedSource()).toBeNull();
  });

  it("toggles accordion sections and handles collapse all correctly", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isExpanded("Steps")).toBe(true);
    expect(component.isExpanded("Definition")).toBe(true);
    expect(component.isExpanded("Quarantine")).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);

    component.toggleSection("Steps");
    expect(component.isExpanded("Steps")).toBe(false);

    component.toggleSection("Steps");
    expect(component.isExpanded("Steps")).toBe(true);

    component.toggleAll();
    expect(component.isExpanded("Steps")).toBe(false);
    expect(component.isExpanded("Definition")).toBe(false);
    expect(component.isExpanded("Quarantine")).toBe(false);
    expect(component.isAllCollapsed()).toBe(true);

    component.toggleAll();
    expect(component.isExpanded("Steps")).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);
  });

  it("updates selected source when selectSource is triggered", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadDataset("source_1.csv", "CSV", "id,val\n1,10");
    flushDirectDataset(
      "source_1",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "val", displayType: "Int64", numeric: true },
      ],
      [{ id: 1, val: 10 }],
    );

    component.loadDataset("source_2.csv", "CSV", "id,val\n2,20");
    flushDirectDataset(
      "source_2",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "val", displayType: "Int64", numeric: true },
      ],
      [{ id: 2, val: 20 }],
    );

    const targetSource = component.sources()[1];
    component.selectSource(targetSource);
    flushDirectDataset(
      "source_2",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "val", displayType: "Int64", numeric: true },
      ],
      [{ id: 2, val: 20 }],
    );

    expect(component.selectedSourceId()).toBe(targetSource.id);
    expect(component.selectedSource()?.name).toBe(targetSource.name);
  });

  it("updates selected step and synchronizes JSON definition", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadDataset("source_1.csv", "CSV", "id,val\n1,10");
    flushDirectDataset(
      "source_1",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "val", displayType: "Int64", numeric: true },
      ],
      [{ id: 1, val: 10 }],
    );

    component.changeType("val", "Float64");
    flushDirectDataset(
      "source_1",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "val", displayType: "Float64", numeric: true },
      ],
      [{ id: 1, val: 10 }],
    );

    expect(component.appliedSteps().length).toBe(2);
    component.selectStep(1);
    flushDirectDataset(
      "source_1",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "val", displayType: "Float64", numeric: true },
      ],
      [{ id: 1, val: 10 }],
    );

    expect(component.selectedStepIndex()).toBe(1);
    const activeStep = component.activeStep();
    expect(activeStep?.name).toContain("Change Type");

    const json = component.activeStepDefinitionJson();
    expect(json).toContain("ChangeType");
  });

  it("announces user actions to StateManagerService without alerts", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    const state = TestBed.inject(StateManagerService);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    component.applyLoad();
    expect(state.statusMessage()).toContain("R-Query");

    component.runRefresh();
    expect(state.statusMessage()).toContain("Incremental refresh");
    for (const req of httpMock.match("/api/ingestion/incremental-refresh")) {
      req.flush({ recordsUpserted: 5 });
    }
  });

  it("formats cell values cleanly according to column data types", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const row = {
      transaction_id: "TX-1",
      net_amount: 1500.5,
      MarginRate: 0.854,
      missing_key: null,
    };

    expect(component.formatCell(row, "missing_key")).toBe("—");
    expect(component.formatCell(row, "transaction_id")).toBe("TX-1");
    expect(component.formatCell(row, "MarginRate")).toBe("85.4%");
    expect(component.formatCell(row, "net_amount")).toBe("€1,500.50");
  });

  it("executes R-Query transformations (Filter, Unpivot, Group By, Custom Column, Index, Shaping) and supports time-travel step preview", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const initialCols = [
      { name: "region", displayType: "String" },
      { name: "jan", displayType: "Int64", numeric: true },
      { name: "feb", displayType: "Int64", numeric: true },
    ];
    const initialRows = [
      { region: "North", jan: 100, feb: 150 },
      { region: "South", jan: 200, feb: 250 },
      { region: "North", jan: 50, feb: 50 },
    ];
    component.loadDataset(
      "sales_q1.csv",
      "CSV",
      "region,jan,feb\nNorth,100,150\nSouth,200,250\nNorth,50,50",
    );
    flushDirectDataset("sales_q1", initialCols, initialRows);
    expect(component.rows().length).toBe(3);

    // 1. Unpivot jan & feb
    component.unpivotMode.set("selected");
    component.unpivotColumns.set(["jan", "feb"]);
    component.unpivotAttrName.set("Month");
    component.unpivotValName.set("Revenue");
    component.applyUnpivot();
    const unpivotCols = [
      { name: "region", displayType: "String" },
      { name: "Month", displayType: "String" },
      { name: "Revenue", displayType: "Float64", numeric: true },
    ];
    const unpivotRows = [
      { region: "North", Month: "jan", Revenue: 100 },
      { region: "North", Month: "feb", Revenue: 150 },
      { region: "South", Month: "jan", Revenue: 200 },
      { region: "South", Month: "feb", Revenue: 250 },
      { region: "North", Month: "jan", Revenue: 50 },
      { region: "North", Month: "feb", Revenue: 50 },
    ];
    flushDirectDataset("sales_q1", unpivotCols, unpivotRows);
    expect(component.rows().length).toBe(6);
    expect(component.columns().map((c) => c.name)).toEqual([
      "region",
      "Month",
      "Revenue",
    ]);

    // 2. Filter Revenue > 100
    component.filterColumn.set("Revenue");
    component.filterOperator.set("greaterThan");
    component.filterValue.set("100");
    component.applyFilter();
    const filteredRows = [
      { region: "North", Month: "feb", Revenue: 150 },
      { region: "South", Month: "jan", Revenue: 200 },
      { region: "South", Month: "feb", Revenue: 250 },
    ];
    flushDirectDataset("sales_q1", unpivotCols, filteredRows);
    expect(component.rows().length).toBe(3);

    // 3. Time-travel back to Step 0 (Source Ingestion) and forward to latest
    component.selectStep(0);
    flushDirectDataset("sales_q1", initialCols, initialRows);
    expect(component.rows().length).toBe(3);
    expect(component.columns().map((c) => c.name)).toEqual([
      "region",
      "jan",
      "feb",
    ]);

    component.selectStep(2);
    flushDirectDataset("sales_q1", unpivotCols, filteredRows);
    expect(component.rows().length).toBe(3);

    // 4. Add Custom Column & Surrogate Index
    component.customColumnMode.set("expression");
    component.customColumnName.set("DoubleRev");
    component.customColumnExpression.set("[Revenue] * 2");
    component.applyCustom();
    flushDirectDataset(
      "sales_q1",
      [...unpivotCols, { name: "DoubleRev", displayType: "Float64", numeric: true }],
      [
        { region: "North", Month: "feb", Revenue: 150, DoubleRev: 300 },
        { region: "South", Month: "jan", Revenue: 200, DoubleRev: 400 },
        { region: "South", Month: "feb", Revenue: 250, DoubleRev: 500 },
      ],
    );
    expect(component.rows()[0]["DoubleRev"]).toBe(300);

    component.customColumnMode.set("index");
    component.customColumnName.set("RowKey");
    component.indexInitialValue.set(1);
    component.indexIncrement.set(1);
    component.applyCustom();
    const indexPreviewReqs = httpMock.match("/api/ingestion/pipeline/preview");
    for (const req of indexPreviewReqs) {
      req.flush([
        {
          batchIndex: 0,
          tableName: "sales_q1",
          columns: [
            ...unpivotCols,
            { name: "DoubleRev", displayType: "Float64", numeric: true },
            { name: "RowKey", displayType: "Int64", numeric: true },
          ],
          rows: [
            {
              region: "North",
              Month: "feb",
              Revenue: 150,
              DoubleRev: 300,
              RowKey: 1,
            },
            {
              region: "South",
              Month: "jan",
              Revenue: 200,
              DoubleRev: 400,
              RowKey: 2,
            },
            {
              region: "South",
              Month: "feb",
              Revenue: 250,
              DoubleRev: 500,
              RowKey: 3,
            },
          ],
          quarantinedRecords: [],
          mQueryScript:
            "let\n  Source = Table.Unpivot(...),\n  Filtered = Table.SelectRows(...),\n  Indexed = Table.AddIndexColumn(...)\nin\n  Indexed",
        },
      ]);
    }
    expect(component.rows()[0]["RowKey"]).toBe(1);
    expect(component.rows()[1]["RowKey"]).toBe(2);

    // 5. M-Query script populated from backend response
    expect(component.activeMQueryScript()).toContain("Table.Unpivot");
    expect(component.activeMQueryScript()).toContain("Table.SelectRows");
    expect(component.activeMQueryScript()).toContain("Table.AddIndexColumn");
  });

  it("isolates non-coercible rows in quarantineStats and replaces redundant ChangeType steps on the same column", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadDataset(
      "dirty.csv",
      "CSV",
      "id,amount\n1,100\n2,INVALID_NUM\n3,300",
    );
    flushDirectDataset(
      "dirty",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "amount", displayType: "String" },
      ],
      [
        { id: 1, amount: "100" },
        { id: 2, amount: "INVALID_NUM" },
        { id: 3, amount: "300" },
      ],
    );
    expect(component.rows().length).toBe(3);

    component.changeType("amount", "Int64");
    for (const req of httpMock.match("/api/ingestion/pipeline/preview")) {
      req.flush([
        {
          batchIndex: 0,
          tableName: "dirty",
          columns: [
            { name: "id", displayType: "Int64", numeric: true },
            { name: "amount", displayType: "Int64", numeric: true },
          ],
          rows: [
            { id: 1, amount: 100 },
            { id: 3, amount: 300 },
          ],
          quarantinedRecords: [
            {
              sourceLineNumber: 2,
              columnName: "amount",
              expectedType: "INT64",
              rawPayload: "{id=2, amount=INVALID_NUM}",
              errorReason: "Invalid integer value",
            },
          ],
        },
      ]);
    }
    expect(component.rows().length).toBe(2);
    expect(component.quarantineStats().rowsQuarantined).toBe(1);
    expect(component.appliedSteps().length).toBe(2);

    // Changing type on the same column again replaces the existing ChangeType step instead of stacking
    component.changeType("amount", "Float64");
    flushDirectDataset(
      "dirty",
      [
        { name: "id", displayType: "Int64", numeric: true },
        { name: "amount", displayType: "Float64", numeric: true },
      ],
      [
        { id: 1, amount: 100 },
        { id: 3, amount: 300 },
      ],
    );
    expect(component.appliedSteps().length).toBe(2);
    expect(component.activeStep()?.detail).toContain("Float64");
  });

  it("supports Enable Load toggle for staging queries and step deletion", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    const state = TestBed.inject(StateManagerService);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadDataset(
      "staging_lookup.csv",
      "CSV",
      "code,label\nA,Alpha\nB,Beta",
    );
    flushDirectDataset(
      "staging_lookup",
      [
        { name: "code", displayType: "String" },
        { name: "label", displayType: "String" },
      ],
      [
        { code: "A", label: "Alpha" },
        { code: "B", label: "Beta" },
      ],
    );
    const src = component.sources()[0];

    // Disable load on staging query
    component.toggleLoad(src.id);
    expect(component.selectedSource()?.enableLoad).toBe(false);
    expect(state.sharedTables.some((t) => t.name === "staging_lookup")).toBe(
      false,
    );

    // Apply & Load should keep staging query out of semantic model
    component.applyLoad();
    expect(state.sharedTables.some((t) => t.name === "staging_lookup")).toBe(
      false,
    );

    // Re-enable load and commit
    component.toggleLoad(src.id);
    component.applyLoad();
    for (const req of httpMock.match("/api/models")) {
      req.flush({});
    }
    for (const req of httpMock.match((r) => r.url.includes("/tables/"))) {
      req.flush({});
    }
    expect(state.sharedTables.some((t) => t.name === "staging_lookup")).toBe(
      true,
    );

    // Step deletion restores prior state
    component.removeColumn("label");
    flushDirectDataset(
      "staging_lookup",
      [{ name: "code", displayType: "String" }],
      [{ code: "A" }, { code: "B" }],
    );
    expect(component.columns().length).toBe(1);
    component.removeStep(1);
    flushDirectDataset(
      "staging_lookup",
      [
        { name: "code", displayType: "String" },
        { name: "label", displayType: "String" },
      ],
      [
        { code: "A", label: "Alpha" },
        { code: "B", label: "Beta" },
      ],
    );
    expect(component.columns().length).toBe(2);
  });

  it("manages global Import file-only connectors and toggle state", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.ingestion.importMenuOpen()).toBe(false);

    component.ingestion.toggleMenu();
    expect(component.ingestion.importMenuOpen()).toBe(true);

    expect(
      component.ingestion.fileConnectors.every((c) => c.category === "file"),
    ).toBe(true);
    expect(component.ingestion.fileConnectors.map((c) => c.id)).toEqual([
      "excel",
      "csv",
      "json",
      "xml",
    ]);

    component.ingestion.triggerConnector("json");
    expect(component.ingestion.selectedConnectorId()).toBe("json");
    expect(component.ingestion.importMenuOpen()).toBe(false);
  });

  it("opens pre-ingestion Navigator modal, previews raw unpromoted sheets, and generates standard 4-step Power Query pipeline", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.ingestion.isNavigatorModalOpen()).toBe(false);

    // Open Navigator for workbook/CSV
    component.ingestion.openText(
      "Financial Sample.xlsx",
      "XLSX",
      "XLSX",
      "Segment,Country,Product\nGovernment,Canada,Carretera\nMidmarket,Germany,Carretera",
    );

    const sheetsReq = httpMock.expectOne("/api/ingestion/sheets");
    sheetsReq.flush({
      tableName: "Financial_Sample",
      sheets: [
        {
          id: "sheet_1",
          name: "Sheet1",
          kind: "Sheet",
          sheetName: "Sheet1",
          tableName: "Financial_Sample",
          columns: [
            { name: "Column1", type: "String", displayType: "String", icon: "String" },
            { name: "Column2", type: "String", displayType: "String", icon: "String" },
            { name: "Column3", type: "String", displayType: "String", icon: "String" },
          ],
          rows: [
            { Column1: "Segment", Column2: "Country", Column3: "Product" },
            { Column1: "Government", Column2: "Canada", Column3: "Carretera" },
            { Column1: "Midmarket", Column2: "Germany", Column3: "Carretera" },
          ],
        },
      ],
      error: null,
    });

    expect(component.ingestion.isNavigatorModalOpen()).toBe(true);
    expect(component.ingestion.navigatorSheets().length).toBeGreaterThanOrEqual(
      1,
    );

    const sheet = component.ingestion.selectedNavigatorSheet();
    expect(sheet).toBeDefined();
    expect(sheet?.columns[0].name).toBe("Column1");
    expect(sheet?.rows[0]["Column1"]).toBe("Segment");

    // Confirm Navigator import and run reactive sync
    component.ingestion.confirmNavigator();
    for (const req of httpMock.match("/api/ingestion/pipeline/preview")) {
      req.flush([
        {
          batchIndex: 0,
          tableName: "Financial_Sample",
          columns: [
            { name: "Segment", displayType: "String" },
            { name: "Country", displayType: "String" },
            { name: "Product", displayType: "String" },
          ],
          rows: [
            { Segment: "Government", Country: "Canada", Product: "Carretera" },
            { Segment: "Midmarket", Country: "Germany", Product: "Carretera" },
          ],
          quarantinedRecords: [],
          activeStepFormula:
            "= Table.TransformColumnTypes(#\"Promoted Headers_2\", /* Auto-Detected Schema */)",
        },
      ]);
    }
    fixture.detectChanges();
    for (const req of httpMock.match("/api/ingestion/pipeline/preview")) {
      req.flush([
        {
          batchIndex: 0,
          tableName: "Financial_Sample",
          columns: [
            { name: "Segment", displayType: "String" },
            { name: "Country", displayType: "String" },
            { name: "Product", displayType: "String" },
          ],
          rows: [
            { Segment: "Government", Country: "Canada", Product: "Carretera" },
            { Segment: "Midmarket", Country: "Germany", Product: "Carretera" },
          ],
          quarantinedRecords: [],
          activeStepFormula:
            "= Table.TransformColumnTypes(#\"Promoted Headers_2\", /* Auto-Detected Schema */)",
        },
      ]);
    }
    expect(component.ingestion.isNavigatorModalOpen()).toBe(false);

    // Assert 4-step Power Query chain
    const steps = component.appliedSteps();
    expect(steps.length).toBe(4);
    expect(steps[0].type).toBe("FileSource");
    expect(steps[1].type).toBe("Navigation");
    expect(steps[2].type).toBe("PromoteHeaders");
    expect(steps[3].type).toBe("DetectDataType");

    // Final state (Step 3: Changed Type) has promoted headers and coerced data rows
    expect(component.selectedStepIndex()).toBe(3);
    expect(component.columns().map((c) => c.name)).toEqual([
      "Segment",
      "Country",
      "Product",
    ]);
    expect(component.rows().length).toBe(2);
    expect(component.activeStepFormula()).toContain(
      "Table.TransformColumnTypes",
    );

    // Time-travel back to Step 1 (Navigation): unpromoted raw columns
    component.selectStep(1);
    for (const req of httpMock.match("/api/ingestion/pipeline/preview")) {
      req.flush([
        {
          batchIndex: 0,
          tableName: "Financial_Sample",
          columns: [
            { name: "Column1", displayType: "String" },
            { name: "Column2", displayType: "String" },
            { name: "Column3", displayType: "String" },
          ],
          rows: [
            { Column1: "Segment", Column2: "Country", Column3: "Product" },
            { Column1: "Government", Column2: "Canada", Column3: "Carretera" },
            { Column1: "Midmarket", Column2: "Germany", Column3: "Carretera" },
          ],
          quarantinedRecords: [],
          activeStepFormula: '= Source{[Item="Sheet1",Kind="Sheet"]}[Data]',
        },
      ]);
    }
    expect(component.selectedStepIndex()).toBe(1);
    expect(component.columns().map((c) => c.name)).toEqual([
      "Column1",
      "Column2",
      "Column3",
    ]);
    expect(component.rows().length).toBe(3);
    expect(component.activeStepFormula()).toContain(
      'Item="Sheet1",Kind="Sheet"',
    );

    // Time-travel forward to Step 2 (Promoted Headers)
    component.selectStep(2);
    for (const req of httpMock.match("/api/ingestion/pipeline/preview")) {
      req.flush([
        {
          batchIndex: 0,
          tableName: "Financial_Sample",
          columns: [
            { name: "Segment", displayType: "String" },
            { name: "Country", displayType: "String" },
            { name: "Product", displayType: "String" },
          ],
          rows: [
            { Segment: "Government", Country: "Canada", Product: "Carretera" },
            { Segment: "Midmarket", Country: "Germany", Product: "Carretera" },
          ],
          quarantinedRecords: [],
          activeStepFormula:
            '= Table.PromoteHeaders(#"Navigation_1", [PromoteAllScalars=true])',
        },
      ]);
    }
    expect(component.selectedStepIndex()).toBe(2);
    expect(component.columns().map((c) => c.name)).toEqual([
      "Segment",
      "Country",
      "Product",
    ]);
    expect(component.rows().length).toBe(2);
    expect(component.activeStepFormula()).toContain("Table.PromoteHeaders");
  });

  it("unnests structured JSON documents in Navigator instead of parsing syntax lines as CSV", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const sampleJson = JSON.stringify(
      [
        {
          joueur: "Gianluigi Donnarumma",
          position: "Gardien",
          statistiques_par_saison: [
            {
              saison: "2014-15",
              matchs_joues: 35,
              minutes_jouees: 1803,
              buts_encaisses: 32,
            },
            {
              saison: "2015-16",
              matchs_joues: 30,
              minutes_jouees: 2700,
              buts_encaisses: 29,
            },
          ],
        },
      ],
      null,
      2,
    );

    component.ingestion.openText(
      "Performances_Ligue1_10_Saisons.json",
      "REST",
      "JSON",
      sampleJson,
    );

    const sheetsReq = httpMock.expectOne("/api/ingestion/sheets");
    sheetsReq.flush({
      tableName: "Performances_Ligue1_10_Saisons",
      sheets: [
        {
          id: "table_1",
          name: "Performances_Ligue1_10_Saisons",
          kind: "Table",
          sheetName: "Performances_Ligue1_10_Saisons",
          tableName: "Performances_Ligue1_10_Saisons",
          columns: [
            { name: "Column1", displayType: "String" },
            { name: "Column2", displayType: "String" },
            { name: "Column3", displayType: "String" },
            { name: "Column4", displayType: "String" },
            { name: "Column5", displayType: "String" },
            { name: "Column6", displayType: "String" },
          ],
          rows: [
            {
              Column1: "joueur",
              Column2: "position",
              Column3: "saison",
              Column4: "matchs_joues",
              Column5: "minutes_jouees",
              Column6: "buts_encaisses",
            },
            {
              Column1: "Gianluigi Donnarumma",
              Column2: "Gardien",
              Column3: "2014-15",
              Column4: 35,
              Column5: 1803,
              Column6: 32,
            },
            {
              Column1: "Gianluigi Donnarumma",
              Column2: "Gardien",
              Column3: "2015-16",
              Column4: 30,
              Column5: 2700,
              Column6: 29,
            },
          ],
        },
      ],
      error: null,
    });

    const sheets = component.ingestion.navigatorSheets();
    expect(sheets.map((s) => s.name)).toEqual([
      "Performances_Ligue1_10_Saisons",
    ]);
    expect(sheets[0].columns.map((c) => c.name)).toEqual([
      "Column1",
      "Column2",
      "Column3",
      "Column4",
      "Column5",
      "Column6",
    ]);
    expect(sheets[0].rows[0]).toEqual({
      Column1: "joueur",
      Column2: "position",
      Column3: "saison",
      Column4: "matchs_joues",
      Column5: "minutes_jouees",
      Column6: "buts_encaisses",
    });

    component.ingestion.confirmNavigator("transform");
    const promotedCols = [
      { name: "joueur", displayType: "String" },
      { name: "position", displayType: "String" },
      { name: "saison", displayType: "String" },
      { name: "matchs_joues", displayType: "Int64", numeric: true },
      { name: "minutes_jouees", displayType: "Int64", numeric: true },
      { name: "buts_encaisses", displayType: "Int64", numeric: true },
    ];
    const promotedRows = [
      {
        joueur: "Gianluigi Donnarumma",
        position: "Gardien",
        saison: "2014-15",
        matchs_joues: 35,
        minutes_jouees: 1803,
        buts_encaisses: 32,
      },
      {
        joueur: "Gianluigi Donnarumma",
        position: "Gardien",
        saison: "2015-16",
        matchs_joues: 30,
        minutes_jouees: 2700,
        buts_encaisses: 29,
      },
    ];
    flushDirectDataset(
      "Performances_Ligue1_10_Saisons",
      promotedCols,
      promotedRows,
    );
    fixture.detectChanges();
    flushDirectDataset(
      "Performances_Ligue1_10_Saisons",
      promotedCols,
      promotedRows,
    );

    expect(component.columns().map((c) => `${c.name}:${c.type}`)).toEqual([
      "joueur:String",
      "position:String",
      "saison:String",
      "matchs_joues:Int64",
      "minutes_jouees:Int64",
      "buts_encaisses:Int64",
    ]);
    expect(component.rows().length).toBe(2);
    expect(component.rows()[0]).toEqual({
      joueur: "Gianluigi Donnarumma",
      position: "Gardien",
      saison: "2014-15",
      matchs_joues: 35,
      minutes_jouees: 1803,
      buts_encaisses: 32,
    });
  });

  it("mounts all transformation and apply actions in a single right-aligned workspace toolbar", async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const header = el.querySelector(".rc-page-header.rc-workspace-header");
    expect(header).toBeTruthy();
    expect(el.querySelector(".rc-rquery-ribbon")).toBeNull();

    const expectedIds = [
      "#data-prep-filter-btn",
      "#data-prep-change-type-btn",
      "#data-prep-unpivot-btn",
      "#data-prep-groupby-btn",
      "#data-prep-custom-column-btn",
      "#data-prep-merge-queries-btn",
      "#data-prep-shaping-btn",
      "#data-prep-range-params-btn",
      "#data-prep-refresh-btn",
      "#data-prep-apply-close-btn",
    ];
    for (const id of expectedIds) {
      expect(header?.querySelector(id)).toBeTruthy();
    }
  });
});
