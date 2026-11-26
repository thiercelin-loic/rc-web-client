import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManagerService } from "../state/state.service";
import {
  ApplyMeasuresResponse,
  FormatQueryResponse,
  QueryExecutionResult,
  RaxFunctionCatalogEntry,
  RaxService,
  RaxValidationResult,
  TmdlGenerateResponse,
} from "./rax.service";

describe("RaxService", () => {
  let service: RaxService;
  let state: StateManagerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [RaxService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RaxService);
    state = TestBed.inject(StateManagerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("inspects and tokenizes RAX formulas via backend POST /api/rax/diagnostics/validate", () => {
    let result: RaxValidationResult | undefined;
    service
      .inspectFormula(`Average Order = AVERAGE('Sales Fact'[Amount])`)
      .subscribe((res) => {
        result = res;
      });

    const req = httpMock.expectOne("/api/rax/diagnostics/validate");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.formula).toBe(
      `Average Order = AVERAGE('Sales Fact'[Amount])`,
    );

    req.flush({
      isValid: true,
      statusLabel: "RAX Syntax Valid",
      measureName: "Average Order",
      formulaExpression: "AVERAGE('Sales Fact'[Amount])",
      diagnostics: [],
      tokens: [
        { text: "AVERAGE", type: "function" },
        { text: "(", type: "operator" },
        { text: "'Sales Fact'[Amount]", type: "column" },
        { text: ")", type: "operator" },
      ],
    });

    expect(result).toBeDefined();
    expect(result?.isValid).toBe(true);
    expect(result?.measureName).toBe("Average Order");
    expect(result?.formulaExpression).toBe("AVERAGE('Sales Fact'[Amount])");
    expect(result?.tokens.map((t) => t.type)).toEqual([
      "function",
      "operator",
      "column",
      "operator",
    ]);
  });

  it("guards validateScript against blank input without sending an HTTP request", () => {
    let result: RaxValidationResult | null | undefined;
    service.validateScript("   ").subscribe((res) => {
      result = res;
    });

    httpMock.expectNone("/api/rax/diagnostics/validate");
    expect(result).toBeNull();
    expect(service.diagnostics()).toEqual([]);
  });

  it("surfaces backend ANTLR syntax diagnostics for invalid formulas", () => {
    let result: RaxValidationResult | undefined;
    service.inspectFormula("VAR Total = SUM([Amount])").subscribe((res) => {
      result = res;
    });

    const req = httpMock.expectOne("/api/rax/diagnostics/validate");
    req.flush({
      isValid: false,
      statusLabel: "Syntax Error: VAR requires RETURN",
      measureName: "New Measure",
      formulaExpression: "VAR Total = SUM([Amount])",
      diagnostics: [
        {
          line: 1,
          startColumn: 0,
          length: 25,
          errorCode: "ERR_RAX_SYNTAX",
          message:
            "Scoped variable declaration VAR requires a corresponding RETURN clause.",
          severity: "ERROR",
        },
      ],
      tokens: [],
    });

    expect(result?.isValid).toBe(false);
    expect(result?.diagnostics[0].errorCode).toBe("ERR_RAX_SYNTAX");
    expect(result?.diagnostics[0].message).toContain("RETURN");
  });

  it("formats scripts via POST /api/rax/format", () => {
    let response: FormatQueryResponse | undefined;
    service.formatScript("evaluate info.tables()").subscribe((res) => {
      response = res;
    });

    const req = httpMock.expectOne("/api/rax/format");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ script: "evaluate info.tables()" });
    req.flush({ formattedScript: "EVALUATE\n    INFO.TABLES()" });

    expect(response?.formattedScript).toBe("EVALUATE\n    INFO.TABLES()");
  });

  it("generates TMDL via POST /api/rax/tmdl and defines measures via POST /api/rax/measures/define", () => {
    let response: TmdlGenerateResponse | undefined;
    service.generateTmdl("model-1").subscribe((res) => {
      response = res;
    });

    const req = httpMock.expectOne("/api/rax/tmdl");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ modelId: "model-1" });
    req.flush({ tmdlScript: "createOrReplace\n  table 'Sales'" });

    expect(response?.tmdlScript).toContain("createOrReplace");

    let definedScript: string | undefined;
    service.defineMeasures("model-1").subscribe((res) => {
      definedScript = res.script;
    });

    const defReq = httpMock.expectOne("/api/rax/measures/define");
    expect(defReq.request.method).toBe("POST");
    expect(defReq.request.body).toEqual({ modelId: "model-1" });
    defReq.flush({
      script: "DEFINE\n    MEASURE 'Sales'[Total] = SUM('Sales'[Amount])",
    });

    expect(definedScript).toContain("DEFINE");
  });

  it("executes scripts via POST /api/rax/execute", () => {
    let result: QueryExecutionResult | undefined;
    service
      .executeScript("EVALUATE INFO.VIEW.TABLES()", "model-1", "DUCKDB")
      .subscribe((res) => {
        result = res;
      });

    const req = httpMock.expectOne("/api/rax/execute");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({
      modelId: "model-1",
      script: "EVALUATE INFO.VIEW.TABLES()",
      dialect: "DUCKDB",
    });
    req.flush({
      cacheKey: "meta-info-query",
      cacheHit: false,
      routedEngine: "DUCKDB",
      executionTimeMs: 3,
      executedSql: "SELECT * FROM information_schema.rax_catalog;",
      rows: [{ Name: "Orders" }],
    });

    expect(result?.rows).toEqual([{ Name: "Orders" }]);
  });

  it("applies measures via POST /api/rax/measures/apply and saves them to state", () => {
    let response: ApplyMeasuresResponse | undefined;
    service
      .applyMeasures("DEFINE MEASURE 'Orders'[Total] = SUM(Orders[Amount])")
      .subscribe((res) => {
        response = res;
      });

    const req = httpMock.expectOne("/api/rax/measures/apply");
    expect(req.request.method).toBe("POST");
    req.flush({
      appliedCount: 1,
      measures: [
        {
          id: "m_total",
          name: "Total",
          tableName: "Orders",
          raxExpression: "SUM(Orders[Amount])",
          formatString: "#,0.00",
          description: "Total amount",
        },
      ],
    });

    expect(response?.appliedCount).toBe(1);
    const saved = state.measures.find((m) => m.label === "Total");
    expect(saved?.formula).toBe("SUM(Orders[Amount])");
    expect(saved?.description).toBe("Total amount");
  });

  it("loads function catalog via GET /api/rax/catalog and updates catalog signal", () => {
    let entries: readonly RaxFunctionCatalogEntry[] | undefined;
    service.loadCatalog().subscribe((res) => {
      entries = res;
    });

    const req = httpMock.expectOne("/api/rax/catalog");
    expect(req.request.method).toBe("GET");
    req.flush([
      {
        label: "SUMMARIZECOLUMNS",
        signature: "SUMMARIZECOLUMNS(<groupBy>)",
        doc: "Returns a summary table over a set of groups.",
      },
    ]);

    expect(entries?.length).toBe(1);
    expect(service.catalog()[0].label).toBe("SUMMARIZECOLUMNS");
  });

  it("correctly separates measure name from expression in parseFormula", () => {
    const standard = service.parseFormula(
      "Average Order = AVERAGE(Sales[Amount])",
    );
    expect(standard.measureName).toBe("Average Order");
    expect(standard.formulaExpression).toBe("AVERAGE(Sales[Amount])");

    const bracketed = service.parseFormula(
      "[Total Sales] = SUM(Sales[Amount])",
    );
    expect(bracketed.measureName).toBe("Total Sales");
    expect(bracketed.formulaExpression).toBe("SUM(Sales[Amount])");

    const defineMeasure = service.parseFormula(
      "DEFINE MEASURE 'Sales Fact'[Gross Margin] = DIVIDE(10, 2)",
    );
    expect(defineMeasure.measureName).toBe("Gross Margin");
    expect(defineMeasure.formulaExpression).toBe("DIVIDE(10, 2)");

    const varExpr = service.parseFormula(
      "VAR SubTotal = SUM(Sales[Amount]) RETURN SubTotal",
    );
    expect(varExpr.measureName).toBeNull();
  });

  it("maps CalculatedTableResult from POST /api/rax/calculated-table into SharedTable with PK and metadata", () => {
    let tableName = "";
    let isDate = false;
    service
      .evalTable({
        tableName: "Calendar2026",
        formula: "CALENDAR(DATE(2026, 1, 1), DATE(2026, 1, 2))",
      })
      .subscribe((res) => {
        tableName = res.table.name;
        isDate = Boolean(res.table.isDateTable);
      });

    const req = httpMock.expectOne("/api/rax/calculated-table");
    expect(req.request.method).toBe("POST");
    expect(req.request.body.modelId).toBeTruthy();
    req.flush({
      tableName: "Calendar2026",
      isDateTable: true,
      dateColumn: "Date",
      columns: [
        {
          name: "Date",
          dataType: "DATE",
          isPrimaryKey: true,
          isForeignKey: false,
          isHidden: false,
          summarizeBy: "None",
          format: "Date",
        },
        {
          name: "Month",
          dataType: "VARCHAR",
          isPrimaryKey: false,
          isForeignKey: false,
          isHidden: false,
          summarizeBy: "None",
          sortByColumn: "MonthNum",
        },
        {
          name: "MonthNum",
          dataType: "INT",
          isPrimaryKey: false,
          isForeignKey: false,
          isHidden: true,
          summarizeBy: "None",
        },
      ],
      rows: [
        { Date: "2026-01-01", Month: "Jan", MonthNum: 1 },
        { Date: "2026-01-02", Month: "Jan", MonthNum: 1 },
      ],
    });

    expect(tableName).toBe("Calendar2026");
    expect(isDate).toBe(true);
    const stored = state.sharedTables.find((t) => t.name === "Calendar2026");
    expect(stored?.role).toBe("DIMENSION");
    expect(stored?.dateColumn).toBe("Date");
    expect(stored?.expression).toBe(
      "CALENDAR(DATE(2026, 1, 1), DATE(2026, 1, 2))",
    );
    expect(stored?.columns[0].keyType).toBe("PK");
    expect(stored?.columns[0].format).toBe("Date");
    expect(stored?.columns[1].sortByColumn).toBe("MonthNum");
    expect(stored?.columns[2].isHidden).toBe(true);
    expect(state.tableRows("Calendar2026").length).toBe(2);
  });

  it("maps ColumnDefinition fields in evalColumn and propagates HTTP 400 ProblemDetail errors", () => {
    state.syncTables([
      {
        id: "t-orders",
        name: "Orders",
        role: "FACT",
        columns: [
          { name: "Quantity", dataType: "INT", keyType: "None" },
          { name: "UnitPrice", dataType: "DECIMAL", keyType: "None" },
        ],
      },
    ]);

    service
      .evalColumn({
        tableName: "Orders",
        columnName: "Total",
        formula: "[Quantity] * [UnitPrice]",
        rows: [{ Quantity: 3, UnitPrice: 12.5 }],
      })
      .subscribe();

    const okReq = httpMock.expectOne("/api/rax/calculated-column");
    expect(okReq.request.body.modelId).toBeTruthy();
    okReq.flush({
      column: {
        name: "Total",
        dataType: "DECIMAL",
        isPrimaryKey: false,
        isForeignKey: false,
        isHidden: false,
        summarizeBy: "Sum",
        expression: "[Quantity] * [UnitPrice]",
        sortByColumn: "",
        format: "Currency",
      },
      inferredDataType: "DECIMAL",
      rows: [{ Quantity: 3, UnitPrice: 12.5, Total: 37.5 }],
      diagnostics: [],
    });

    const totalCol = state.sharedTables
      .find((t) => t.name === "Orders")
      ?.columns.find((c) => c.name === "Total");
    expect(totalCol?.summarizeBy).toBe("Sum");
    expect(totalCol?.format).toBe("Currency");

    let caughtStatus = 0;
    service
      .evalColumn({
        tableName: "Orders",
        columnName: "BadCol",
        formula: "INVALID(",
      })
      .subscribe({
        error: (err) => {
          caughtStatus = err.status;
        },
      });

    const badReq = httpMock.expectOne("/api/rax/calculated-column");
    badReq.flush(
      {
        title: "RAX Syntax Validation Error",
        status: 400,
        detail: "ERR_RAX_SYNTAX: Unterminated expression.",
        errorCode: "ERR_RAX_SYNTAX",
      },
      { status: 400, statusText: "Bad Request" },
    );

    expect(caughtStatus).toBe(400);
    expect(state.statusIsError()).toBe(true);
  });
});
