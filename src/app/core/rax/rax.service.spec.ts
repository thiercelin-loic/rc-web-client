import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RaxService, RaxValidationResult } from "./rax.service";

describe("RaxService", () => {
  let service: RaxService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [RaxService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RaxService);
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
});
