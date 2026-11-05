import { Injectable } from '@angular/core';

export interface DiagnosticMarker {
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly message: string;
  readonly errorCode: string;
  readonly severity: 'error' | 'warning' | 'info';
}

export interface RaxToken {
  readonly type: 'keyword' | 'function' | 'table' | 'column' | 'number' | 'string' | 'operator' | 'text';
  readonly value: string;
}

export interface RaxValidationResult {
  readonly isValid: boolean;
  readonly statusLabel: string;
  readonly diagnostics: readonly DiagnosticMarker[];
  readonly tokens: readonly RaxToken[];
}

export interface RaxFunctionSnippet {
  readonly label: string;
  readonly signature: string;
  readonly doc: string;
}

export interface RaxParsedFormula {
  readonly measureName: string | null;
  readonly formulaExpression: string;
}

/**
 * RAX Language Service & Monaco/Formula Bar Diagnostics Engine
 * Implements case-insensitive ANTLR4-compatible RAX lexical tokenization,
 * bracket/quote balancing, and autocomplete signature suggestions.
 */
@Injectable({ providedIn: 'root' })
export class RaxLanguageService {
  private readonly keywords = new Set(['VAR', 'RETURN', 'IN', 'NOT', 'TRUE', 'FALSE']);
  private readonly functions = new Set([
    'CALCULATE',
    'SUM',
    'SUMX',
    'AVERAGE',
    'AVERAGEX',
    'DIVIDE',
    'FILTER',
    'ALL',
    'ALLEXCEPT',
    'ALLSELECTED',
    'USERELATIONSHIP',
    'TOTALYTD',
    'SAMEPERIODLASTYEAR',
    'RANKX',
    'USEROBJECTID',
    'USERPRINCIPALNAME',
    'USERNAME',
    'CUSTOMDATA'
  ]);

  public readonly autocompleteCatalog: readonly RaxFunctionSnippet[] = [
    {
      label: 'CALCULATE',
      signature: 'CALCULATE(<Expression>, <Filter1>, <Filter2>...)',
      doc: 'Evaluates an expression in a modified filter context with automatic context transition.'
    },
    {
      label: 'USERELATIONSHIP',
      signature: 'USERELATIONSHIP(<ColumnName1>, <ColumnName2>)',
      doc: 'Activates an inactive relationship path (such as DeliveryDate / DueDate) for the duration of CALCULATE.'
    },
    {
      label: 'DIVIDE',
      signature: 'DIVIDE(<Numerator>, <Denominator>, [<AlternateResult>])',
      doc: 'Performs safe division with automatic zero-division handling.'
    },
    {
      label: 'TOTALYTD',
      signature: 'TOTALYTD(<Expression>, <Dates>, [<Filter>], [<YearEndDate>])',
      doc: 'Evaluates the year-to-date value of the expression in the current evaluation context.'
    },
    {
      label: 'SAMEPERIODLASTYEAR',
      signature: 'SAMEPERIODLASTYEAR(<Dates>)',
      doc: 'Shifts the contiguous date dimension selection backward by 1 fiscal year.'
    }
  ];

  public parseFormulaAssignment(rawFormula: string): RaxParsedFormula {
    if (!rawFormula || !rawFormula.trim()) {
      return { measureName: null, formulaExpression: '' };
    }

    const trimmed = rawFormula.trim();

    // 1. Check for DEFINE MEASURE 'TableName'[MeasureName] = ... or DEFINE MEASURE MeasureName = ...
    const defineMatch = trimmed.match(
      /^DEFINE\s+MEASURE\s+(?:'[^']+'\s*)?(?:\[([^\]]+)\]|'([^']+)'|([A-Za-z0-9_]+))\s*=\s*([\s\S]*)$/i
    );
    if (defineMatch) {
      const name = defineMatch[1] ?? defineMatch[2] ?? defineMatch[3];
      return {
        measureName: name ? name.trim() : null,
        formulaExpression: (defineMatch[4] ?? '').trim(),
      };
    }

    // 2. Scoped variable formula (e.g. VAR ... = ... RETURN ...) is not a measure assignment
    if (/^VAR\b/i.test(trimmed)) {
      return { measureName: null, formulaExpression: trimmed };
    }

    // 3. Scan for top-level '=' outside parentheses, brackets, or quotes
    let depthParen = 0;
    let depthBracket = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (c === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (!inSingleQuote && !inDoubleQuote) {
        if (c === '(') {
          depthParen++;
        } else if (c === ')') {
          depthParen = Math.max(0, depthParen - 1);
        } else if (c === '[') {
          depthBracket++;
        } else if (c === ']') {
          depthBracket = Math.max(0, depthBracket - 1);
        } else if (c === '=' && depthParen === 0 && depthBracket === 0) {
          // Check that it's not a comparison operator (==, !=, <=, >=, <>)
          const prev = i > 0 ? trimmed[i - 1] : ' ';
          const next = i + 1 < trimmed.length ? trimmed[i + 1] : ' ';
          if (prev !== '!' && prev !== '<' && prev !== '>' && prev !== '=' && next !== '=') {
            const candidate = trimmed.slice(0, i).trim();
            if (!/^VAR\b/i.test(candidate) && /^[\w\s\-'\[\]]+$/.test(candidate)) {
              const bracketMatch = candidate.match(/(?:'[^']+'|(?:\w+))?\[([^\]]+)\]$/);
              const measureName = bracketMatch
                ? bracketMatch[1].trim()
                : candidate.replace(/^'|'$/g, '').trim();
              const formulaExpression = trimmed.slice(i + 1).trim();
              return { measureName, formulaExpression };
            }
          }
        }
      }
    }

    return { measureName: null, formulaExpression: trimmed };
  }

  public validateFormula(formula: string): RaxValidationResult {
    return this.validateAndTokenize(formula);
  }

  public validateAndTokenize(formula: string): RaxValidationResult {
    const diagnostics: DiagnosticMarker[] = [];
    const tokens = this.tokenize(formula);

    const { measureName, formulaExpression } = this.parseFormulaAssignment(formula);

    if (measureName !== null && formulaExpression.length === 0) {
      diagnostics.push({
        line: 1,
        startColumn: Math.max(1, formula.length),
        endColumn: formula.length + 1,
        message: `Measure '${measureName}' requires a formula expression after '='.`,
        errorCode: 'ERR_RAX_SYNTAX',
        severity: 'error',
      });
    }

    const exprToValidate = formulaExpression.length > 0 ? formulaExpression : formula;
    const offset = formula.indexOf(exprToValidate);
    const colOffset = offset >= 0 ? offset : 0;

    // Check parentheses balance in expression
    let parenDepth = 0;
    for (let i = 0; i < exprToValidate.length; i++) {
      if (exprToValidate[i] === '(') parenDepth++;
      if (exprToValidate[i] === ')') parenDepth--;
      if (parenDepth < 0) {
        diagnostics.push({
          line: 1,
          startColumn: colOffset + i + 1,
          endColumn: colOffset + i + 2,
          message: 'Unexpected closing parenthesis ")" in RAX expression.',
          errorCode: 'ERR_RAX_SYNTAX',
          severity: 'error',
        });
        break;
      }
    }

    if (parenDepth > 0) {
      diagnostics.push({
        line: 1,
        startColumn: colOffset + Math.max(1, exprToValidate.length),
        endColumn: colOffset + exprToValidate.length + 1,
        message: `Unclosed parenthesis: expected ${parenDepth} closing ")" token(s).`,
        errorCode: 'ERR_RAX_SYNTAX',
        severity: 'error',
      });
    }

    // Check VAR ... RETURN pairing
    const upper = exprToValidate.toUpperCase();
    if (/\bVAR\b/.test(upper) && !/\bRETURN\b/.test(upper)) {
      diagnostics.push({
        line: 1,
        startColumn: colOffset + 1,
        endColumn: colOffset + exprToValidate.length,
        message: 'Scoped variable declaration VAR requires a corresponding RETURN clause.',
        errorCode: 'ERR_RAX_SYNTAX',
        severity: 'error',
      });
    }

    // Check for unreplaced catalog template placeholders (e.g. <Expression>, <Filter1>, ...)
    const placeholderMatch = exprToValidate.match(/<[A-Za-z0-9_]+>|\.{3}/);
    if (placeholderMatch && placeholderMatch.index !== undefined) {
      const placeholder = placeholderMatch[0];
      diagnostics.push({
        line: 1,
        startColumn: colOffset + placeholderMatch.index + 1,
        endColumn: colOffset + placeholderMatch.index + placeholder.length + 1,
        message: `Unreplaced template placeholder "${placeholder}". Replace with an actual measure, column, or filter expression.`,
        errorCode: 'ERR_RAX_PLACEHOLDER',
        severity: 'error',
      });
    }

    const isValid = diagnostics.length === 0 && exprToValidate.trim().length > 0;
    return {
      isValid,
      statusLabel: isValid ? 'Valid RAX Syntax' : 'Syntax Diagnostic',
      diagnostics,
      tokens,
    };
  }

  public tokenize(formula: string): RaxToken[] {
    const regex = /('(?:[^']|'')+')|(\[(?:[^\]]|\]\])+\])|("(?:[^"]|"")*")|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(==|!=|<>|<=|>=|&&|\|\||[=+\-*/^&(),;{}])|(\s+)/g;
    const tokens: RaxToken[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(formula)) !== null) {
      const [, table, column, str, num, ident, op, ws] = match;
      if (ws) {
        continue;
      }
      if (table) {
        tokens.push({ type: 'table', value: table });
      } else if (column) {
        tokens.push({ type: 'column', value: column });
      } else if (str) {
        tokens.push({ type: 'string', value: str });
      } else if (num) {
        tokens.push({ type: 'number', value: num });
      } else if (ident) {
        const upper = ident.toUpperCase();
        if (this.functions.has(upper)) {
          tokens.push({ type: 'function', value: ident });
        } else if (this.keywords.has(upper)) {
          tokens.push({ type: 'keyword', value: ident });
        } else {
          tokens.push({ type: 'text', value: ident });
        }
      } else if (op) {
        tokens.push({ type: 'operator', value: op });
      }
    }

    return tokens;
  }
}
