import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { RaxLanguageService } from './rax-language.service';

describe('RaxLanguageService', () => {
  let service: RaxLanguageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RaxLanguageService);
  });

  it('tokenizes RAX functions, quoted tables, columns, strings, and numbers', () => {
    const tokens = service.tokenize(`SUM('Sales Fact'[Amount]) + 42 = "Coats"`);

    expect(tokens.map((token) => token.type)).toEqual([
      'function',
      'operator',
      'table',
      'column',
      'operator',
      'operator',
      'number',
      'operator',
      'string'
    ]);
  });

  it('reports unbalanced syntax with a remediation error code', () => {
    const result = service.validateAndTokenize('VAR Total = SUM([Amount])');

    expect(result.isValid).toBe(false);
    expect(result.diagnostics[0].errorCode).toBe('ERR_RAX_SYNTAX');
    expect(result.diagnostics[0].message).toContain('RETURN');
  });

  it('detects unreplaced template placeholders from catalog snippets', () => {
    const result = service.validateAndTokenize('CALCULATE(1 + 1, <Filter1>, <Filter2>...)');

    expect(result.isValid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].errorCode).toBe('ERR_RAX_PLACEHOLDER');
    expect(result.diagnostics[0].message).toContain('<Filter1>');
  });

  it('correctly parses formula assignments and separates measure name from expression', () => {
    const standard = service.parseFormulaAssignment('Average Order = AVERAGE(Sales[Amount])');
    expect(standard.measureName).toBe('Average Order');
    expect(standard.formulaExpression).toBe('AVERAGE(Sales[Amount])');

    const bracketed = service.parseFormulaAssignment('[Total Sales] = SUM(Sales[Amount])');
    expect(bracketed.measureName).toBe('Total Sales');
    expect(bracketed.formulaExpression).toBe('SUM(Sales[Amount])');

    const tablePrefixed = service.parseFormulaAssignment("'Sales Fact'[Revenue] = SUM('Sales Fact'[Amount])");
    expect(tablePrefixed.measureName).toBe('Revenue');
    expect(tablePrefixed.formulaExpression).toBe("SUM('Sales Fact'[Amount])");

    const defineMeasure = service.parseFormulaAssignment("DEFINE MEASURE 'Sales Fact'[Gross Margin] = DIVIDE(10, 2)");
    expect(defineMeasure.measureName).toBe('Gross Margin');
    expect(defineMeasure.formulaExpression).toBe('DIVIDE(10, 2)');

    const plainExpr = service.parseFormulaAssignment('AVERAGE(Sales[Amount])');
    expect(plainExpr.measureName).toBeNull();
    expect(plainExpr.formulaExpression).toBe('AVERAGE(Sales[Amount])');

    const varExpr = service.parseFormulaAssignment('VAR SubTotal = SUM(Sales[Amount]) RETURN SubTotal');
    expect(varExpr.measureName).toBeNull();
    expect(varExpr.formulaExpression).toBe('VAR SubTotal = SUM(Sales[Amount]) RETURN SubTotal');

    const filterComparison = service.parseFormulaAssignment('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Europe")');
    expect(filterComparison.measureName).toBeNull();
    expect(filterComparison.formulaExpression).toBe('CALCULATE(SUM(Sales[Amount]), Sales[Region] = "Europe")');
  });

  it('validates formula syntax correctly even when prefixed with measure name', () => {
    const validResult = service.validateAndTokenize('Average Order = AVERAGE(Sales[Amount])');
    expect(validResult.isValid).toBe(true);
    expect(validResult.diagnostics.length).toBe(0);

    const invalidResult = service.validateAndTokenize('Average Order = AVERAGE(Sales[Amount]');
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.diagnostics[0].errorCode).toBe('ERR_RAX_SYNTAX');
  });
});
