import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap } from 'rxjs';
import {
  FilterClause,
  RaxMeasureDescriptor,
  StateManagerService,
} from './state-manager.service';
import { AuthService } from './auth.service';
import { DEFAULT_SEMANTIC_MODEL } from './semantic-model.service';

export interface VisualQueryPayload {
  modelId?: string;
  tenantId?: string;
  reportId?: string;
  visualId?: string;
  measureId?: string;
  raxExpression?: string;
  factTableName?: string;
  estimatedRows?: number;
  operationalLookup?: boolean;
  groupByColumns?: string[];
  activeFilters?: Record<string, unknown[]>;
  externalSlicerFilters?: Record<string, unknown[]>;
  evaluationDate?: string;
  acceptLanguage?: string;
}

export interface VisualQueryRequestOptions {
  readonly visualId: string;
  readonly measureId?: string;
  readonly raxExpression?: string;
  readonly factTableName?: string;
  readonly groupByColumns?: readonly string[];
  readonly externalSlicerFilters?: Record<string, readonly unknown[]>;
}

export interface QueryExecutionResult {
  cacheKey: string;
  cacheHit: boolean;
  routedEngine: 'DUCKDB' | 'MYSQL';
  executionTimeMs: number;
  executedSql: string;
  rows: Array<Record<string, unknown>>;
}

export interface ScalarEvalContext {
  readonly tableName?: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly rowContext?: Record<string, unknown>;
  readonly localMeasures?: ReadonlyMap<string, RaxMeasureDescriptor>;
  readonly variables?: ReadonlyMap<string, unknown>;
  readonly externalSlicerFilters?: Record<string, readonly unknown[]>;
  readonly ignoreActiveFilters?: boolean;
  readonly depth?: number;
}

@Injectable({ providedIn: 'root' })
export class RaxQueryService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);
  private readonly auth = inject(AuthService, { optional: true });

  public serializeActiveFilters(): Record<string, unknown[]> {
    const serialized: Record<string, unknown[]> = {};
    for (const [, clause] of this.state.activeFilters().clauses.entries()) {
      if (clause.values.length > 0) {
        serialized[`${clause.dimension}:${clause.operator}`] = [...clause.values];
      }
    }
    return serialized;
  }

  public executeMeasureQuery(
    measureId: string,
    raxExpression?: string,
    visualId?: string
  ): Observable<QueryExecutionResult> {
    const reportId = this.state.activeProject().filename || 'default-report';
    const tenantId = this.auth?.currentUser()?.tenantId || 'ws-90124-enterprise';
    const primaryTable =
      this.resolveTargetTableName(undefined, raxExpression) ||
      this.state.sharedTables.find((t) => t.role === 'FACT')?.name ||
      this.state.sharedTables[0]?.name ||
      'fact_transactions';
    const payload: VisualQueryPayload = {
      modelId: DEFAULT_SEMANTIC_MODEL.modelId,
      reportId,
      visualId: visualId ?? 'active-visual',
      measureId,
      raxExpression: raxExpression ?? '',
      tenantId,
      factTableName: primaryTable,
      estimatedRows: 0,
      operationalLookup: false,
      groupByColumns: [],
      activeFilters: this.serializeActiveFilters(),
      externalSlicerFilters: {},
      evaluationDate: new Date().toISOString().split('T')[0],
      acceptLanguage: 'en-US',
    };

    const startTime = performance.now();
    this.state.setLoading(true, `Evaluating RAX measure ${measureId}...`);

    return this.http
      .post<QueryExecutionResult>(`/api/reports/${encodeURIComponent(reportId)}/query`, payload)
      .pipe(
        tap((result) => {
          const duration = Math.round(performance.now() - startTime);
          this.state.setLoading(false);
          this.state.recordExchange('success', 'POST', `/api/reports/${reportId}/query`, 200, duration);
          this.state.announce(`RAX evaluated in ${result.executionTimeMs}ms via ${result.routedEngine}`);
        }),
        catchError((error) => {
          const duration = Math.round(performance.now() - startTime);
          this.state.setLoading(false);
          this.state.recordExchange('error', 'POST', `/api/reports/${reportId}/query`, error?.status ?? 500, duration);

          const studioResult = this.evaluateStudioQuery(raxExpression || '');
          if (studioResult && studioResult.rows.length > 0) {
            const firstRow = studioResult.rows[0];
            const firstKey = Object.keys(firstRow)[0];
            const rows =
              visualId === 'rax-studio'
                ? studioResult.rows
                : [
                    {
                      ...firstRow,
                      measure_value:
                        firstRow['measure_value'] ?? (firstKey ? firstRow[firstKey] : 0),
                    },
                  ];
            const fallbackStudio: QueryExecutionResult = {
              ...studioResult,
              executionTimeMs: Math.max(1, duration),
              rows,
            };
            this.state.announce(
              `RAX evaluated locally (${rows.length} row(s))`
            );
            return of(fallbackStudio);
          }

          const evaluatedValue = this.evaluateScalarExpression(raxExpression || '', {
            tableName: primaryTable,
          });
          const fallbackResult: QueryExecutionResult = {
            cacheKey: 'local-eval',
            cacheHit: false,
            routedEngine: 'DUCKDB',
            executionTimeMs: Math.max(1, duration),
            executedSql: `SELECT ${raxExpression || '0'} AS measure_value FROM ${primaryTable};`,
            rows: [{ measure_value: evaluatedValue }],
          };
          this.state.announce(`RAX evaluated locally: ${evaluatedValue}`);
          return of(fallbackResult);
        })
      );
  }

  public executeVisualQuery(options: VisualQueryRequestOptions): Observable<QueryExecutionResult> {
    const reportId = this.state.activeProject().filename || 'default-report';
    const tenantId = this.auth?.currentUser()?.tenantId || 'ws-90124-enterprise';
    const targetTable =
      this.resolveTargetTableName(options.factTableName, options.raxExpression, options.groupByColumns) ||
      this.state.sharedTables.find((t) => t.role === 'FACT')?.name ||
      this.state.sharedTables[0]?.name ||
      'fact_transactions';

    const externalFilters: Record<string, unknown[]> = {};
    if (options.externalSlicerFilters) {
      for (const [key, vals] of Object.entries(options.externalSlicerFilters)) {
        if (vals.length > 0) {
          externalFilters[key] = [...vals];
        }
      }
    }

    const payload: VisualQueryPayload = {
      modelId: DEFAULT_SEMANTIC_MODEL.modelId,
      reportId,
      visualId: options.visualId,
      measureId: options.measureId ?? '',
      raxExpression: options.raxExpression ?? '',
      tenantId,
      factTableName: targetTable,
      estimatedRows: this.state.getTableRows(targetTable).length,
      operationalLookup: false,
      groupByColumns: options.groupByColumns ? [...options.groupByColumns] : [],
      activeFilters: this.serializeActiveFilters(),
      externalSlicerFilters: externalFilters,
      evaluationDate: new Date().toISOString().split('T')[0],
      acceptLanguage: 'en-US',
    };

    const startTime = performance.now();

    return this.http
      .post<QueryExecutionResult>(`/api/reports/${encodeURIComponent(reportId)}/query`, payload)
      .pipe(
        tap(() => {
          const duration = Math.round(performance.now() - startTime);
          this.state.recordExchange('success', 'POST', `/api/reports/${reportId}/query`, 200, duration);
        }),
        catchError(() => {
          const duration = Math.round(performance.now() - startTime);
          const localRows = this.evaluateDatasetRowsLocally({
            ...options,
            factTableName: targetTable,
          });
          const fallback: QueryExecutionResult = {
            cacheKey: 'local-dataset-eval',
            cacheHit: false,
            routedEngine: 'DUCKDB',
            executionTimeMs: duration,
            executedSql: `-- Local dataset query on ${targetTable}`,
            rows: localRows,
          };
          return of(fallback);
        })
      );
  }

  public evaluateDatasetRowsLocally(options: VisualQueryRequestOptions): Array<Record<string, unknown>> {
    const targetTable = this.resolveTargetTableName(
      options.factTableName,
      options.raxExpression,
      options.groupByColumns
    );
    if (!targetTable) {
      return [];
    }

    const rawRows = this.state.getTableRows(targetTable);
    if (!rawRows || rawRows.length === 0) {
      return [];
    }

    const filteredRows = this.filterRows(
      rawRows,
      Array.from(this.state.activeFilters().clauses.values()),
      options.externalSlicerFilters
    );

    const groupCols = options.groupByColumns ?? [];
    const parsedExpr = this.parseAggregationExpression(options.raxExpression, targetTable);

    if (groupCols.length === 0) {
      const value =
        parsedExpr.aggOp !== 'UNSUPPORTED'
          ? this.aggregateValues(filteredRows, parsedExpr.columnName, parsedExpr.aggOp)
          : this.evaluateScalarExpression(options.raxExpression ?? '', {
              tableName: targetTable,
              rows: filteredRows,
              externalSlicerFilters: options.externalSlicerFilters,
            });
      return [{ measure_value: value }];
    }

    const groups = new Map<string, Record<string, unknown>[]>();
    const groupKeysMeta = new Map<string, Record<string, unknown>>();

    for (const row of filteredRows) {
      const keyParts: string[] = [];
      const meta: Record<string, unknown> = {};
      for (const gCol of groupCols) {
        const bareCol = this.stripTablePrefix(gCol);
        const val = this.readRowProperty(row, bareCol) ?? 'Unspecified';
        keyParts.push(String(val));
        meta[bareCol] = val;
        meta[gCol] = val;
      }
      const compositeKey = keyParts.join('||');
      const existing = groups.get(compositeKey);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(compositeKey, [row]);
        groupKeysMeta.set(compositeKey, meta);
      }
    }

    const results: Array<Record<string, unknown>> = [];
    for (const [compositeKey, groupRows] of groups.entries()) {
      const meta = groupKeysMeta.get(compositeKey) ?? {};
      const aggregated =
        parsedExpr.aggOp !== 'UNSUPPORTED'
          ? this.aggregateValues(groupRows, parsedExpr.columnName, parsedExpr.aggOp)
          : this.evaluateScalarExpression(options.raxExpression ?? '', {
              tableName: targetTable,
              rows: groupRows,
              externalSlicerFilters: options.externalSlicerFilters,
            });
      const resultRow: Record<string, unknown> = {
        ...meta,
        measure_value: aggregated,
      };
      if (parsedExpr.columnName) {
        resultRow[parsedExpr.columnName] = aggregated;
      }
      results.push(resultRow);
    }

    return results;
  }

  public supportsLocalEvaluation(raxExpression: string | undefined): boolean {
    const expr = (raxExpression ?? '').trim();
    if (!expr) {
      return true;
    }
    return true;
  }

  /**
   * Evaluates a full RAX Studio script (DEFINE MEASURE, VAR/RETURN, EVALUATE ROW,
   * SUMMARIZECOLUMNS, FILTER, TOPN, ADDCOLUMNS, SELECTCOLUMNS, VALUES, UNION,
   * table references, or standalone scalar formulas) against in-memory semantic model data.
   */
  public evaluateStudioQuery(
    rawScript: string,
    extraMeasures?: ReadonlyMap<string, RaxMeasureDescriptor>
  ): QueryExecutionResult | null {
    const startTime = performance.now();
    const cleaned = this.stripComments(rawScript).trim();
    if (!cleaned) {
      return null;
    }

    const localMeasures = new Map<string, RaxMeasureDescriptor>();
    if (extraMeasures) {
      for (const [k, v] of extraMeasures.entries()) {
        localMeasures.set(k.toLowerCase(), v);
      }
    }

    const variables = new Map<string, unknown>();
    let queryBody = cleaned;

    // 1. Parse optional DEFINE section
    if (/^DEFINE\b/i.test(queryBody)) {
      const evalIdx = this.findTopLevelKeywordIndex(queryBody, 'EVALUATE');
      const defineSection =
        evalIdx >= 0 ? queryBody.slice(6, evalIdx).trim() : queryBody.slice(6).trim();
      this.parseDefineSection(defineSection, localMeasures, variables);
      if (evalIdx >= 0) {
        queryBody = queryBody.slice(evalIdx).trim();
      } else {
        // DEFINE without EVALUATE: evaluate all defined measures and display their values
        if (localMeasures.size > 0) {
          const rows = Array.from(localMeasures.values()).map((m) => ({
            Table: m.table,
            Measure: m.label,
            Expression: m.formula,
            Value: this.evaluateScalarExpression(m.formula, {
              tableName: m.table,
              localMeasures,
              variables,
            }),
          }));
          return {
            cacheKey: 'local-define-eval',
            cacheHit: false,
            routedEngine: 'DUCKDB',
            executionTimeMs: Math.max(1, Math.round(performance.now() - startTime)),
            executedSql: `-- Evaluated ${rows.length} defined measure(s) in DuckDB memory`,
            rows,
          };
        }
        return null;
      }
    }

    // 2. Strip leading EVALUATE keyword if present
    const hadEvaluate = /^EVALUATE\b/i.test(queryBody);
    if (hadEvaluate) {
      queryBody = queryBody.replace(/^EVALUATE\b\s*/i, '').trim();
    }

    // 3. Extract optional trailing ORDER BY at depth 0
    const { coreBody, orderBy } = this.extractTrailingOrderBy(queryBody);
    queryBody = coreBody.trim();

    // 4. Unwrap top-levelVAR ... RETURN blocks
    const baseCtx: ScalarEvalContext = {
      localMeasures,
      variables,
    };
    const varUnwrapped = this.unwrapVarReturnBlock(queryBody, baseCtx);
    queryBody = varUnwrapped.body.trim();
    const activeCtx = varUnwrapped.ctx;

    // 5. Handle assignment syntax: Name = <expression>
    const assignMatch = queryBody.match(
      /^(?:'([^']+)'|\[([^\]]+)\]|([A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ\s-]*?))\s*=\s*([\s\S]+)$/
    );
    let assignedName: string | null = null;
    if (assignMatch && !this.isComparisonOperatorStart(assignMatch[4])) {
      assignedName = (assignMatch[1] ?? assignMatch[2] ?? assignMatch[3]).trim();
      queryBody = assignMatch[4].trim();
      const innerVar = this.unwrapVarReturnBlock(queryBody, activeCtx);
      queryBody = innerVar.body.trim();
      Object.assign(activeCtx, innerVar.ctx);
    }

    // 6. Check if queryBody is a table-valued expression
    if (this.isTableValuedExpression(queryBody, activeCtx)) {
      let rows = this.evaluateTableExpression(queryBody, activeCtx);
      if (orderBy && rows.length > 1) {
        rows = this.sortRowsByClause(rows, orderBy.column, orderBy.direction);
      }
      const elapsed = Math.max(1, Math.round(performance.now() - startTime));
      return {
        cacheKey: `local-table-${Date.now()}`,
        cacheHit: false,
        routedEngine: 'DUCKDB',
        executionTimeMs: elapsed,
        executedSql: this.buildSqlPlanDescription(queryBody, orderBy),
        rows,
      };
    }

    // 7. Otherwise evaluate as a scalar RAX formula
    const scalarVal = this.evaluateScalarExpression(queryBody, activeCtx);
    const colLabel = assignedName || 'Value';
    const elapsed = Math.max(1, Math.round(performance.now() - startTime));
    return {
      cacheKey: `local-scalar-${Date.now()}`,
      cacheHit: false,
      routedEngine: 'DUCKDB',
      executionTimeMs: elapsed,
      executedSql: `SELECT ${queryBody} AS "${colLabel}";`,
      rows: [{ [colLabel]: scalarVal }],
    };
  }

  /**
   * Evaluates a table-returning RAX expression (ROW, SUMMARIZECOLUMNS, FILTER,
   * TOPN, ADDCOLUMNS, SELECTCOLUMNS, VALUES, DISTINCT, ALL, UNION, or table ref).
   */
  public evaluateTableExpression(
    rawExpr: string,
    ctx: ScalarEvalContext = {}
  ): Array<Record<string, unknown>> {
    const expr = this.stripOuterParens(this.stripComments(rawExpr).trim());
    if (!expr) {
      return [];
    }

    // Unwrap VAR ... RETURN inside table expression if present
    if (/^VAR\b/i.test(expr)) {
      const unwrapped = this.unwrapVarReturnBlock(expr, ctx);
      return this.evaluateTableExpression(unwrapped.body, unwrapped.ctx);
    }

    // Check table variable in ctx.variables
    const varLookup = ctx.variables?.get(expr.toLowerCase());
    if (Array.isArray(varLookup)) {
      return varLookup as Array<Record<string, unknown>>;
    }

    const fnCall = this.parseTopLevelFunctionCall(expr);
    if (fnCall) {
      const fn = fnCall.name.toUpperCase();
      const args = this.splitTopLevelArgs(fnCall.argsContent);

      switch (fn) {
        case 'ROW': {
          const rowObj: Record<string, unknown> = {};
          for (let i = 0; i + 1 < args.length; i += 2) {
            const colName = this.unquoteString(args[i]);
            const val = this.evaluateScalarExpression(args[i + 1], ctx);
            rowObj[colName] = val;
          }
          return Object.keys(rowObj).length > 0 ? [rowObj] : [];
        }

        case 'SUMMARIZECOLUMNS': {
          return this.evaluateSummarizeColumns(args, ctx);
        }

        case 'FILTER': {
          if (args.length < 2) {
            return [];
          }
          const baseTableName = this.extractTableNameFromExpr(args[0]) ?? ctx.tableName;
          const baseRows = this.evaluateTableExpression(args[0], {
            ...ctx,
            tableName: baseTableName,
          });
          return baseRows.filter((row) =>
            this.isTruthy(
              this.evaluateScalarExpression(args[1], {
                ...ctx,
                tableName: baseTableName,
                rowContext: row,
              })
            )
          );
        }

        case 'TOPN': {
          if (args.length < 2) {
            return [];
          }
          const limit = Math.max(
            0,
            Math.floor(Number(this.evaluateScalarExpression(args[0], ctx)) || 0)
          );
          const baseTableName = this.extractTableNameFromExpr(args[1]) ?? ctx.tableName;
          const baseRows = [
            ...this.evaluateTableExpression(args[1], {
              ...ctx,
              tableName: baseTableName,
            }),
          ];
          if (args.length >= 3 && args[2].trim()) {
            const orderExpr = args[2].trim();
            const dir = (args[3] ?? 'DESC').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            baseRows.sort((a, b) => {
              const va = this.evaluateScalarExpression(orderExpr, {
                ...ctx,
                tableName: baseTableName,
                rowContext: a,
              });
              const vb = this.evaluateScalarExpression(orderExpr, {
                ...ctx,
                tableName: baseTableName,
                rowContext: b,
              });
              return this.compareValues(va, vb, dir === 'DESC');
            });
          }
          return baseRows.slice(0, limit);
        }

        case 'ADDCOLUMNS': {
          if (args.length < 3) {
            return [];
          }
          const baseTableName = this.extractTableNameFromExpr(args[0]) ?? ctx.tableName;
          const baseRows = this.evaluateTableExpression(args[0], {
            ...ctx,
            tableName: baseTableName,
          });
          return baseRows.map((row) => {
            const copy: Record<string, unknown> = { ...row };
            for (let i = 1; i + 1 < args.length; i += 2) {
              const alias = this.unquoteString(args[i]);
              copy[alias] = this.evaluateScalarExpression(args[i + 1], {
                ...ctx,
                tableName: baseTableName,
                rowContext: copy,
              });
            }
            return copy;
          });
        }

        case 'SELECTCOLUMNS': {
          if (args.length < 3) {
            return [];
          }
          const baseTableName = this.extractTableNameFromExpr(args[0]) ?? ctx.tableName;
          const baseRows = this.evaluateTableExpression(args[0], {
            ...ctx,
            tableName: baseTableName,
          });
          return baseRows.map((row) => {
            const projected: Record<string, unknown> = {};
            for (let i = 1; i + 1 < args.length; i += 2) {
              const alias = this.unquoteString(args[i]);
              projected[alias] = this.evaluateScalarExpression(args[i + 1], {
                ...ctx,
                tableName: baseTableName,
                rowContext: row,
              });
            }
            return projected;
          });
        }

        case 'VALUES':
        case 'DISTINCT': {
          if (args.length === 0) {
            return [];
          }
          const colRef = this.parseTableAndColumnRef(args[0], ctx.tableName);
          if (colRef && colRef.colName) {
            const tName = colRef.tableName || ctx.tableName || '';
            const rows = this.getEffectiveTableRows(tName, ctx);
            const seen = new Set<string>();
            const distinctRows: Array<Record<string, unknown>> = [];
            for (const r of rows) {
              const val = this.readRowProperty(r, colRef.colName);
              const key = String(val ?? '');
              if (!seen.has(key)) {
                seen.add(key);
                distinctRows.push({ [colRef.colName]: val });
              }
            }
            return distinctRows;
          }
          return this.evaluateTableExpression(args[0], ctx);
        }

        case 'ALL':
        case 'ALLSELECTED':
        case 'REMOVEFILTERS': {
          if (args.length === 0) {
            return [];
          }
          const colRef = this.parseTableAndColumnRef(args[0], ctx.tableName);
          if (colRef && colRef.colName) {
            const tName = colRef.tableName || ctx.tableName || '';
            const rows = this.state.getTableRows(tName);
            const seen = new Set<string>();
            const distinctRows: Array<Record<string, unknown>> = [];
            for (const r of rows) {
              const val = this.readRowProperty(r, colRef.colName);
              const key = String(val ?? '');
              if (!seen.has(key)) {
                seen.add(key);
                distinctRows.push({ [colRef.colName]: val });
              }
            }
            return distinctRows;
          }
          const tName = this.unquoteIdentifier(args[0]);
          return [...this.state.getTableRows(tName)];
        }

        case 'UNION': {
          const combined: Array<Record<string, unknown>> = [];
          for (const arg of args) {
            combined.push(...this.evaluateTableExpression(arg, ctx));
          }
          return combined;
        }
      }
    }

    // Bare table reference: 'TableName' or TableName
    const cleanTableName = this.unquoteIdentifier(expr);
    const rows = this.getEffectiveTableRows(cleanTableName, ctx);
    if (rows.length > 0) {
      return [...rows];
    }

    return [];
  }

  /**
   * Evaluates a scalar RAX expression (aggregations, iterators, CALCULATE, DIVIDE,
   * IF, SWITCH, VAR/RETURN, measure references, column references in row context,
   * and arithmetic/logical operators).
   */
  public evaluateScalarExpression(
    rawExpr: string,
    ctx: ScalarEvalContext = {}
  ): number | string | boolean {
    if ((ctx.depth ?? 0) > 16) {
      return 0;
    }

    let expr = this.stripComments(rawExpr).trim();
    if (/^EVALUATE\b/i.test(expr)) {
      expr = expr.replace(/^EVALUATE\b\s*/i, '').trim();
    }
    expr = this.stripOuterParens(expr);
    if (!expr) {
      return 0;
    }

    // 1. Handle VAR ... RETURN block
    if (/^VAR\b/i.test(expr)) {
      const unwrapped = this.unwrapVarReturnBlock(expr, ctx);
      return this.evaluateScalarExpression(unwrapped.body, unwrapped.ctx);
    }

    // 2. Logical OR (||) at depth 0
    const orIdx = this.findTopLevelOperator(expr, ['||']);
    if (orIdx.index >= 0) {
      const left = expr.slice(0, orIdx.index);
      const right = expr.slice(orIdx.index + orIdx.op.length);
      return (
        this.isTruthy(this.evaluateScalarExpression(left, ctx)) ||
        this.isTruthy(this.evaluateScalarExpression(right, ctx))
      );
    }

    // 3. Logical AND (&&) at depth 0
    const andIdx = this.findTopLevelOperator(expr, ['&&']);
    if (andIdx.index >= 0) {
      const left = expr.slice(0, andIdx.index);
      const right = expr.slice(andIdx.index + andIdx.op.length);
      return (
        this.isTruthy(this.evaluateScalarExpression(left, ctx)) &&
        this.isTruthy(this.evaluateScalarExpression(right, ctx))
      );
    }

    // 4. IN { ... } operator at depth 0
    const inMatch = this.matchTopLevelInOperator(expr);
    if (inMatch) {
      const leftVal = this.evaluateScalarExpression(inMatch.left, ctx);
      const items = this.splitTopLevelArgs(inMatch.setContent);
      return items.some((item) =>
        this.valuesEqual(leftVal, this.evaluateScalarExpression(item, ctx))
      );
    }

    // 5. Comparison operators (<>, !=, <=, >=, ==, =, <, >) at depth 0
    const cmpIdx = this.findTopLevelOperator(expr, [
      '<>',
      '!=',
      '<=',
      '>=',
      '==',
      '=',
      '<',
      '>',
    ]);
    if (cmpIdx.index >= 0) {
      const leftVal = this.evaluateScalarExpression(expr.slice(0, cmpIdx.index), ctx);
      const rightVal = this.evaluateScalarExpression(
        expr.slice(cmpIdx.index + cmpIdx.op.length),
        ctx
      );
      switch (cmpIdx.op) {
        case '=':
        case '==':
          return this.valuesEqual(leftVal, rightVal);
        case '<>':
        case '!=':
          return !this.valuesEqual(leftVal, rightVal);
        case '<':
          return this.compareValues(leftVal, rightVal, false) < 0;
        case '<=':
          return this.compareValues(leftVal, rightVal, false) <= 0;
        case '>':
          return this.compareValues(leftVal, rightVal, false) > 0;
        case '>=':
          return this.compareValues(leftVal, rightVal, false) >= 0;
      }
    }

    // 6. String concatenation (&) at depth 0
    const ampIdx = this.findTopLevelSingleAmpersand(expr);
    if (ampIdx >= 0) {
      const leftVal = this.evaluateScalarExpression(expr.slice(0, ampIdx), ctx);
      const rightVal = this.evaluateScalarExpression(expr.slice(ampIdx + 1), ctx);
      return `${leftVal ?? ''}${rightVal ?? ''}`;
    }

    // 7. Binary Addition / Subtraction (+, -) at depth 0 (rightmost for left-associativity)
    const addSub = this.findRightmostBinaryAddSub(expr);
    if (addSub.index > 0) {
      const leftNum = Number(
        this.evaluateScalarExpression(expr.slice(0, addSub.index), ctx)
      ) || 0;
      const rightNum = Number(
        this.evaluateScalarExpression(expr.slice(addSub.index + 1), ctx)
      ) || 0;
      const res = addSub.op === '+' ? leftNum + rightNum : leftNum - rightNum;
      return Math.round(res * 1e6) / 1e6;
    }

    // 8. Binary Multiplication / Division (*, /) at depth 0 (rightmost for left-associativity)
    const mulDiv = this.findRightmostTopLevelOperator(expr, ['*', '/']);
    if (mulDiv.index > 0) {
      const leftNum = Number(
        this.evaluateScalarExpression(expr.slice(0, mulDiv.index), ctx)
      ) || 0;
      const rightNum = Number(
        this.evaluateScalarExpression(expr.slice(mulDiv.index + 1), ctx)
      ) || 0;
      if (mulDiv.op === '*') {
        return Math.round(leftNum * rightNum * 1e6) / 1e6;
      }
      return rightNum === 0 ? 0 : Math.round((leftNum / rightNum) * 1e6) / 1e6;
    }

    // 9. Unary operators (-, +, NOT)
    if (expr.startsWith('-')) {
      return -(Number(this.evaluateScalarExpression(expr.slice(1), ctx)) || 0);
    }
    if (expr.startsWith('+')) {
      return Number(this.evaluateScalarExpression(expr.slice(1), ctx)) || 0;
    }
    if (/^NOT\s+/i.test(expr)) {
      return !this.isTruthy(this.evaluateScalarExpression(expr.replace(/^NOT\s+/i, ''), ctx));
    }

    // 10. Primitive literals (numbers, strings, booleans)
    if (/^\d+(?:\.\d+)?$/.test(expr)) {
      return Number(expr);
    }
    if (expr.startsWith('"') && expr.endsWith('"') && expr.length >= 2) {
      return this.unquoteString(expr);
    }
    const upper = expr.toUpperCase();
    if (upper === 'TRUE' || upper === 'TRUE()') {
      return true;
    }
    if (upper === 'FALSE' || upper === 'FALSE()') {
      return false;
    }
    if (upper === 'BLANK()') {
      return 0;
    }

    // 11. Variable lookup
    if (ctx.variables?.has(expr.toLowerCase())) {
      const v = ctx.variables.get(expr.toLowerCase());
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        return v;
      }
    }

    // 12. Function call evaluation
    const fnCall = this.parseTopLevelFunctionCall(expr);
    if (fnCall) {
      return this.evaluateScalarFunction(fnCall.name, fnCall.argsContent, ctx);
    }

    // 13. Measure or Column reference
    return this.evaluateIdentifierOrColumnRef(expr, ctx);
  }

  public filterRows(
    rows: readonly Record<string, unknown>[],
    clauses: readonly FilterClause[],
    externalSlicerFilters?: Record<string, readonly unknown[]>
  ): Record<string, unknown>[] {
    return rows.filter((row) => {
      for (const clause of clauses) {
        if (!clause.dimension || clause.values.length === 0) {
          continue;
        }
        const colName = this.stripTablePrefix(clause.dimension);
        const rawVal = this.readRowProperty(row, colName);
        if (rawVal === undefined) {
          continue;
        }
        if (!this.matchesFilterClause(rawVal, clause)) {
          return false;
        }
      }

      if (externalSlicerFilters) {
        for (const [dim, allowed] of Object.entries(externalSlicerFilters)) {
          if (!allowed || allowed.length === 0) {
            continue;
          }
          const colName = this.stripTablePrefix(dim);
          const rawVal = this.readRowProperty(row, colName);
          if (rawVal === undefined) {
            continue;
          }
          const matched = allowed.some((item) => this.valuesEqual(rawVal, item));
          if (!matched) {
            return false;
          }
        }
      }

      return true;
    });
  }

  public splitTopLevelArgs(input: string, delimiter = ','): string[] {
    const results: string[] = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        current += ch;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        current += ch;
        continue;
      }
      if (!inSingle && !inDouble) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

        if (
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0 &&
          input.startsWith(delimiter, i)
        ) {
          results.push(current.trim());
          current = '';
          i += delimiter.length - 1;
          continue;
        }
      }
      current += ch;
    }

    if (current.trim().length > 0) {
      results.push(current.trim());
    }
    return results;
  }

  private evaluateScalarFunction(
    rawName: string,
    argsContent: string,
    ctx: ScalarEvalContext
  ): number | string | boolean {
    const fn = rawName.trim().toUpperCase();
    const args = this.splitTopLevelArgs(argsContent);

    switch (fn) {
      case 'SUM':
      case 'AVERAGE':
      case 'AVG':
      case 'MIN':
      case 'MAX':
      case 'COUNT':
      case 'COUNTA':
      case 'DISTINCTCOUNT': {
        if (args.length === 0) {
          return 0;
        }
        const colRef = this.parseTableAndColumnRef(args[0], ctx.tableName);
        if (!colRef) {
          return 0;
        }
        const targetTable = colRef.tableName || ctx.tableName || '';
        const rows = this.getEffectiveTableRows(targetTable, ctx);
        const aggOp = fn === 'COUNTA' ? 'COUNT' : fn;
        return this.aggregateValues(rows, colRef.colName, aggOp);
      }

      case 'COUNTROWS': {
        if (args.length === 0 || !args[0]) {
          const rows = this.getEffectiveTableRows(ctx.tableName ?? '', ctx);
          return rows.length;
        }
        const tableRows = this.evaluateTableExpression(args[0], ctx);
        return tableRows.length;
      }

      case 'SUMX':
      case 'AVERAGEX':
      case 'MINX':
      case 'MAXX':
      case 'COUNTX': {
        if (args.length < 2) {
          return 0;
        }
        const iterTableName = this.extractTableNameFromExpr(args[0]) ?? ctx.tableName;
        const tableRows = this.evaluateTableExpression(args[0], {
          ...ctx,
          tableName: iterTableName,
        });
        if (tableRows.length === 0) {
          return 0;
        }
        const values: number[] = [];
        for (const row of tableRows) {
          const val = this.evaluateScalarExpression(args[1], {
            ...ctx,
            tableName: iterTableName,
            rowContext: row,
            depth: (ctx.depth ?? 0) + 1,
          });
          if (fn === 'COUNTX') {
            if (val !== null && val !== undefined && val !== '' && val !== false) {
              values.push(1);
            }
          } else {
            const num = Number(val);
            if (!Number.isNaN(num)) {
              values.push(num);
            }
          }
        }
        if (values.length === 0) {
          return 0;
        }
        if (fn === 'SUMX' || fn === 'COUNTX') {
          return Math.round(values.reduce((acc, v) => acc + v, 0) * 1e6) / 1e6;
        }
        if (fn === 'AVERAGEX') {
          return (
            Math.round((values.reduce((acc, v) => acc + v, 0) / values.length) * 1e6) /
            1e6
          );
        }
        if (fn === 'MINX') {
          return Math.min(...values);
        }
        return Math.max(...values);
      }

      case 'DIVIDE': {
        if (args.length < 2) {
          return 0;
        }
        const num = Number(this.evaluateScalarExpression(args[0], ctx)) || 0;
        const den = Number(this.evaluateScalarExpression(args[1], ctx)) || 0;
        if (den === 0) {
          return args[2] !== undefined ? this.evaluateScalarExpression(args[2], ctx) : 0;
        }
        return Math.round((num / den) * 1e6) / 1e6;
      }

      case 'CALCULATE': {
        if (args.length === 0) {
          return 0;
        }
        const exprArg = args[0];
        const filterArgs = args.slice(1);
        const inferredTable =
          this.extractTableNameFromExpr(exprArg) ||
          filterArgs.map((f) => this.extractTableNameFromExpr(f)).find(Boolean) ||
          ctx.tableName ||
          this.resolveTargetTableName(undefined, exprArg) ||
          '';

        let ignoreActive = ctx.ignoreActiveFilters ?? false;
        let workingRows: Record<string, unknown>[] | undefined = ctx.rowContext
          ? [ctx.rowContext]
          : undefined;

        for (const fArg of filterArgs) {
          const cleanFilter = fArg.trim();
          if (/^(?:ALL|REMOVEFILTERS|ALLSELECTED)\s*\(/i.test(cleanFilter)) {
            ignoreActive = true;
            workingRows = [...this.state.getTableRows(inferredTable)];
          }
        }

        if (!workingRows) {
          workingRows = [
            ...this.getEffectiveTableRows(inferredTable, {
              ...ctx,
              ignoreActiveFilters: ignoreActive,
            }),
          ];
        }

        for (const fArg of filterArgs) {
          const cleanFilter = fArg.trim();
          if (/^(?:ALL|REMOVEFILTERS|ALLSELECTED)\s*\(/i.test(cleanFilter)) {
            continue;
          }
          if (/^KEEPFILTERS\s*\(([\s\S]*)\)$/i.test(cleanFilter)) {
            const inner = cleanFilter.replace(/^KEEPFILTERS\s*\(([\s\S]*)\)$/i, '$1');
            workingRows = workingRows.filter((row) =>
              this.isTruthy(
                this.evaluateScalarExpression(inner, {
                  ...ctx,
                  tableName: inferredTable,
                  rowContext: row,
                })
              )
            );
            continue;
          }
          if (/^FILTER\s*\(/i.test(cleanFilter)) {
            const fCall = this.parseTopLevelFunctionCall(cleanFilter);
            const fSubArgs = fCall ? this.splitTopLevelArgs(fCall.argsContent) : [];
            if (fSubArgs.length >= 2) {
              const pred = fSubArgs[1];
              workingRows = workingRows.filter((row) =>
                this.isTruthy(
                  this.evaluateScalarExpression(pred, {
                    ...ctx,
                    tableName: inferredTable,
                    rowContext: row,
                  })
                )
              );
            }
            continue;
          }

          workingRows = workingRows.filter((row) =>
            this.isTruthy(
              this.evaluateScalarExpression(cleanFilter, {
                ...ctx,
                tableName: inferredTable,
                rowContext: row,
              })
            )
          );
        }

        return this.evaluateScalarExpression(exprArg, {
          ...ctx,
          tableName: inferredTable,
          rows: workingRows,
          rowContext: undefined,
          ignoreActiveFilters: ignoreActive,
          depth: (ctx.depth ?? 0) + 1,
        });
      }

      case 'IF': {
        if (args.length < 2) {
          return 0;
        }
        const cond = this.evaluateScalarExpression(args[0], ctx);
        if (this.isTruthy(cond)) {
          return this.evaluateScalarExpression(args[1], ctx);
        }
        return args[2] !== undefined ? this.evaluateScalarExpression(args[2], ctx) : 0;
      }

      case 'SWITCH': {
        if (args.length < 3) {
          return 0;
        }
        const targetVal = this.evaluateScalarExpression(args[0], ctx);
        let idx = 1;
        while (idx + 1 < args.length) {
          const caseVal = this.evaluateScalarExpression(args[idx], ctx);
          if (this.valuesEqual(targetVal, caseVal)) {
            return this.evaluateScalarExpression(args[idx + 1], ctx);
          }
          idx += 2;
        }
        return idx < args.length ? this.evaluateScalarExpression(args[idx], ctx) : 0;
      }

      case 'COALESCE': {
        for (const arg of args) {
          const val = this.evaluateScalarExpression(arg, ctx);
          if (val !== null && val !== undefined && val !== '' && val !== 0) {
            return val;
          }
        }
        return 0;
      }

      case 'AND':
        return args.every((a) => this.isTruthy(this.evaluateScalarExpression(a, ctx)));

      case 'OR':
        return args.some((a) => this.isTruthy(this.evaluateScalarExpression(a, ctx)));

      case 'NOT':
        return args.length > 0
          ? !this.isTruthy(this.evaluateScalarExpression(args[0], ctx))
          : false;

      case 'ABS':
        return Math.abs(Number(this.evaluateScalarExpression(args[0] ?? '0', ctx)) || 0);

      case 'ROUND': {
        const val = Number(this.evaluateScalarExpression(args[0] ?? '0', ctx)) || 0;
        const digits = Number(this.evaluateScalarExpression(args[1] ?? '0', ctx)) || 0;
        const factor = Math.pow(10, digits);
        return Math.round(val * factor) / factor;
      }

      case 'INT':
        return Math.floor(Number(this.evaluateScalarExpression(args[0] ?? '0', ctx)) || 0);

      case 'SQRT':
        return Math.sqrt(
          Math.max(0, Number(this.evaluateScalarExpression(args[0] ?? '0', ctx)) || 0)
        );

      case 'POWER': {
        const base = Number(this.evaluateScalarExpression(args[0] ?? '0', ctx)) || 0;
        const exp = Number(this.evaluateScalarExpression(args[1] ?? '1', ctx)) || 0;
        return Math.pow(base, exp);
      }

      case 'MOD': {
        const n = Number(this.evaluateScalarExpression(args[0] ?? '0', ctx)) || 0;
        const d = Number(this.evaluateScalarExpression(args[1] ?? '1', ctx)) || 1;
        return d === 0 ? 0 : n % d;
      }

      case 'SELECTEDVALUE': {
        if (args.length === 0) {
          return '';
        }
        const colRef = this.parseTableAndColumnRef(args[0], ctx.tableName);
        if (!colRef) {
          return '';
        }
        const rows = this.getEffectiveTableRows(colRef.tableName || ctx.tableName || '', ctx);
        const distinct = new Set<unknown>();
        for (const r of rows) {
          const val = this.readRowProperty(r, colRef.colName);
          if (val !== undefined && val !== null) {
            distinct.add(val);
          }
        }
        if (distinct.size === 1) {
          const first = Array.from(distinct)[0];
          return typeof first === 'number' || typeof first === 'boolean'
            ? first
            : String(first);
        }
        return args[1] !== undefined ? this.evaluateScalarExpression(args[1], ctx) : '';
      }

      case 'CONCATENATEX': {
        if (args.length < 2) {
          return '';
        }
        const iterTable = this.extractTableNameFromExpr(args[0]) ?? ctx.tableName;
        const rows = this.evaluateTableExpression(args[0], {
          ...ctx,
          tableName: iterTable,
        });
        const delim = args[2] !== undefined ? String(this.evaluateScalarExpression(args[2], ctx)) : ', ';
        const parts: string[] = [];
        for (const r of rows) {
          const v = this.evaluateScalarExpression(args[1], {
            ...ctx,
            tableName: iterTable,
            rowContext: r,
          });
          if (v !== null && v !== undefined && String(v) !== '') {
            parts.push(String(v));
          }
        }
        return parts.join(delim);
      }

      case 'RELATED': {
        if (args.length === 0 || !ctx.rowContext) {
          return '';
        }
        const colRef = this.parseTableAndColumnRef(args[0], ctx.tableName);
        if (!colRef) {
          return '';
        }
        const directVal = this.readRowProperty(ctx.rowContext, colRef.colName);
        if (directVal !== undefined) {
          return typeof directVal === 'number' || typeof directVal === 'boolean'
            ? directVal
            : String(directVal);
        }
        if (colRef.tableName) {
          const dimRows = this.state.getTableRows(colRef.tableName);
          for (const dRow of dimRows) {
            const matched = Object.keys(dRow).some(
              (k) =>
                k in ctx.rowContext! &&
                this.valuesEqual(dRow[k], ctx.rowContext![k])
            );
            if (matched) {
              const found = this.readRowProperty(dRow, colRef.colName);
              if (found !== undefined) {
                return typeof found === 'number' || typeof found === 'boolean'
                  ? found
                  : String(found);
              }
            }
          }
        }
        return '';
      }

      default:
        return 0;
    }
  }

  private evaluateIdentifierOrColumnRef(
    expr: string,
    ctx: ScalarEvalContext
  ): number | string | boolean {
    const colRef = this.parseTableAndColumnRef(expr, ctx.tableName);
    const lookupName = colRef ? colRef.colName : this.unquoteIdentifier(expr);

    // 1. Variable lookup
    if (ctx.variables?.has(lookupName.toLowerCase())) {
      const v = ctx.variables.get(lookupName.toLowerCase());
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        return v;
      }
    }

    // 2. Measure lookup (both unqualified [Measure] and qualified 'Table'[Measure])
    const measure = this.findMeasureByName(lookupName, ctx.localMeasures);
    if (measure) {
      const isPhysicalColumnInRow =
        ctx.rowContext !== undefined &&
        colRef?.tableName &&
        this.readRowProperty(ctx.rowContext, lookupName) !== undefined;

      if (!isPhysicalColumnInRow) {
        const targetTable =
          measure.table ||
          colRef?.tableName ||
          ctx.tableName ||
          this.extractTableNameFromExpr(measure.formula) ||
          '';
        const nextRows = ctx.rowContext
          ? [ctx.rowContext]
          : ctx.rows && (!measure.table || !ctx.tableName || measure.table.toLowerCase() === ctx.tableName.toLowerCase())
            ? ctx.rows
            : undefined;
        return this.evaluateScalarExpression(measure.formula, {
          ...ctx,
          tableName: targetTable,
          rows: nextRows,
          rowContext: undefined,
          depth: (ctx.depth ?? 0) + 1,
        });
      }
    }

    // 3. Row context column lookup (inside SUMX, FILTER, ADDCOLUMNS, SELECTCOLUMNS, etc.)
    if (ctx.rowContext) {
      const rawVal = this.readRowProperty(ctx.rowContext, lookupName);
      if (rawVal !== undefined && rawVal !== null) {
        if (typeof rawVal === 'number' || typeof rawVal === 'boolean') {
          return rawVal;
        }
        const num = Number(rawVal);
        if (typeof rawVal === 'string' && rawVal.trim() !== '' && !Number.isNaN(num)) {
          return num;
        }
        return String(rawVal);
      }
      return 0;
    }

    // 4. Implicit column aggregation when outside row context
    const targetTable =
      colRef?.tableName ||
      ctx.tableName ||
      this.resolveTargetTableName(undefined, expr) ||
      '';
    const rows = this.getEffectiveTableRows(targetTable, ctx);
    if (rows.length === 0) {
      return 0;
    }
    const parsed = this.parseAggregationExpression(lookupName, targetTable);
    return this.aggregateValues(rows, parsed.columnName ?? lookupName, parsed.aggOp);
  }

  private evaluateSummarizeColumns(
    args: readonly string[],
    ctx: ScalarEvalContext
  ): Array<Record<string, unknown>> {
    const groupColumns: Array<{ tableName: string; colName: string }> = [];
    const filterExprs: string[] = [];
    const metrics: Array<{ alias: string; expr: string }> = [];

    let i = 0;
    while (i < args.length) {
      const arg = args[i].trim();
      if (arg.startsWith('"') && arg.endsWith('"') && i + 1 < args.length) {
        metrics.push({
          alias: this.unquoteString(arg),
          expr: args[i + 1].trim(),
        });
        i += 2;
        continue;
      }
      if (/^FILTER\s*\(/i.test(arg)) {
        filterExprs.push(arg);
        i++;
        continue;
      }
      const colRef = this.parseTableAndColumnRef(arg, ctx.tableName);
      if (colRef && colRef.colName) {
        groupColumns.push(colRef);
      }
      i++;
    }

    // Resolve primary table to iterate
    const candidateTables: string[] = [];
    for (const m of metrics) {
      const extracted = this.extractTableNameFromExpr(m.expr);
      if (extracted) {
        candidateTables.push(extracted);
      }
      const refMeasure = this.findMeasureReferencedInExpr(m.expr, ctx.localMeasures);
      if (refMeasure?.table) {
        candidateTables.push(refMeasure.table);
      }
      const fromFormula = refMeasure ? this.extractTableNameFromExpr(refMeasure.formula) : undefined;
      if (fromFormula) {
        candidateTables.push(fromFormula);
      }
    }
    for (const g of groupColumns) {
      if (g.tableName) {
        candidateTables.push(g.tableName);
      }
    }

    const primaryTable =
      candidateTables.find((t) => this.state.getTableRows(t).length > 0) ||
      this.resolveTargetTableName(candidateTables[0]) ||
      candidateTables[0] ||
      '';

    let baseRows = [...this.getEffectiveTableRows(primaryTable, ctx)];

    // Enrich baseRows with dimension columns if grouping by a related dimension table
    for (const g of groupColumns) {
      if (
        g.tableName &&
        g.tableName.toLowerCase() !== primaryTable.toLowerCase() &&
        baseRows.length > 0 &&
        this.readRowProperty(baseRows[0], g.colName) === undefined
      ) {
        const dimRows = this.state.getTableRows(g.tableName);
        if (dimRows.length > 0) {
          baseRows = baseRows.map((factRow) => {
            const matchedDim = dimRows.find((dRow) =>
              Object.keys(dRow).some(
                (k) => k in factRow && this.valuesEqual(dRow[k], factRow[k])
              )
            );
            return matchedDim ? { ...matchedDim, ...factRow } : factRow;
          });
        }
      }
    }

    // Apply any FILTER() arguments in SUMMARIZECOLUMNS
    for (const fExpr of filterExprs) {
      const fCall = this.parseTopLevelFunctionCall(fExpr);
      const fArgs = fCall ? this.splitTopLevelArgs(fCall.argsContent) : [];
      if (fArgs.length >= 2) {
        baseRows = baseRows.filter((row) =>
          this.isTruthy(
            this.evaluateScalarExpression(fArgs[1], {
              ...ctx,
              tableName: primaryTable,
              rowContext: row,
            })
          )
        );
      }
    }

    if (groupColumns.length === 0) {
      if (metrics.length === 0) {
        return [];
      }
      const singleRow: Record<string, unknown> = {};
      for (const m of metrics) {
        singleRow[m.alias] = this.evaluateScalarExpression(m.expr, {
          ...ctx,
          tableName: primaryTable,
          rows: baseRows,
        });
      }
      return [singleRow];
    }

    if (baseRows.length === 0) {
      return [];
    }

    const groups = new Map<string, Record<string, unknown>[]>();
    const groupHeaders = new Map<string, Record<string, unknown>>();

    for (const row of baseRows) {
      const keyParts: string[] = [];
      const header: Record<string, unknown> = {};
      for (const g of groupColumns) {
        const val = this.readRowProperty(row, g.colName) ?? 'Unspecified';
        keyParts.push(String(val));
        header[g.colName] = val;
      }
      const key = keyParts.join('||');
      const existing = groups.get(key);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(key, [row]);
        groupHeaders.set(key, header);
      }
    }

    const resultRows: Array<Record<string, unknown>> = [];
    for (const [key, gRows] of groups.entries()) {
      const outRow: Record<string, unknown> = { ...(groupHeaders.get(key) ?? {}) };
      for (const m of metrics) {
        outRow[m.alias] = this.evaluateScalarExpression(m.expr, {
          ...ctx,
          tableName: primaryTable,
          rows: gRows,
        });
      }
      resultRows.push(outRow);
    }

    return resultRows;
  }

  private getEffectiveTableRows(
    tableName: string,
    ctx: ScalarEvalContext
  ): readonly Record<string, unknown>[] {
    if (
      ctx.rows &&
      (!tableName ||
        !ctx.tableName ||
        tableName.toLowerCase() === ctx.tableName.toLowerCase())
    ) {
      return ctx.rows;
    }
    const resolvedName =
      tableName ||
      ctx.tableName ||
      this.resolveTargetTableName() ||
      '';
    if (!resolvedName) {
      return [];
    }
    const rawRows = this.state.getTableRows(resolvedName);
    if (rawRows.length === 0 || ctx.ignoreActiveFilters) {
      return rawRows;
    }
    return this.filterRows(
      rawRows,
      Array.from(this.state.activeFilters().clauses.values()),
      ctx.externalSlicerFilters
    );
  }

  private parseDefineSection(
    defineSection: string,
    localMeasures: Map<string, RaxMeasureDescriptor>,
    variables: Map<string, unknown>
  ): void {
    const defaultTable = this.resolveTargetTableName() ?? 'fact_transactions';
    const measureRegex =
      /\bMEASURE\s+(?:'([^']+)'|([A-Za-z0-9_ -]+))?\[([^\]]+)\]\s*=\s*([\s\S]+?)(?=(?:\r?\n\s*|\s+)(?:MEASURE\b|VAR\b)|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = measureRegex.exec(defineSection)) !== null) {
      const table = (match[1] ?? match[2] ?? defaultTable).trim();
      const label = match[3].trim();
      const formula = match[4].trim();
      localMeasures.set(label.toLowerCase(), {
        id: `local-${label.toLowerCase()}`,
        label,
        formula,
        table,
      });
    }

    const varRegex =
      /\bVAR\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+?)(?=(?:\r?\n\s*|\s+)(?:VAR\b|MEASURE\b)|$)/gi;
    while ((match = varRegex.exec(defineSection)) !== null) {
      const varName = match[1].trim();
      const varExpr = match[2].trim();
      const ctx: ScalarEvalContext = { localMeasures, variables };
      const val = this.isTableValuedExpression(varExpr, ctx)
        ? this.evaluateTableExpression(varExpr, ctx)
        : this.evaluateScalarExpression(varExpr, ctx);
      variables.set(varName.toLowerCase(), val);
    }
  }

  private unwrapVarReturnBlock(
    expr: string,
    ctx: ScalarEvalContext
  ): { body: string; ctx: ScalarEvalContext } {
    const trimmed = expr.trim();
    if (!/^VAR\b/i.test(trimmed)) {
      return { body: trimmed, ctx };
    }

    const returnIdx = this.findTopLevelKeywordIndex(trimmed, 'RETURN');
    if (returnIdx < 0) {
      return { body: trimmed, ctx };
    }

    const varSection = trimmed.slice(0, returnIdx).trim();
    const returnBody = trimmed.slice(returnIdx + 6).trim();
    const nextVariables = new Map<string, unknown>(ctx.variables ?? []);

    const varStarts: Array<{ name: string; exprStart: number; keywordStart: number }> = [];
    const tokenRegex = /\bVAR\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gi;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(varSection)) !== null) {
      if (this.isAtTopLevel(varSection, m.index)) {
        varStarts.push({
          name: m[1],
          keywordStart: m.index,
          exprStart: m.index + m[0].length,
        });
      }
    }

    for (let i = 0; i < varStarts.length; i++) {
      const current = varStarts[i];
      const endPos =
        i + 1 < varStarts.length ? varStarts[i + 1].keywordStart : varSection.length;
      const varExpr = varSection.slice(current.exprStart, endPos).trim();
      const stepCtx: ScalarEvalContext = {
        ...ctx,
        variables: nextVariables,
      };
      const evaluated = this.isTableValuedExpression(varExpr, stepCtx)
        ? this.evaluateTableExpression(varExpr, stepCtx)
        : this.evaluateScalarExpression(varExpr, stepCtx);
      nextVariables.set(current.name.toLowerCase(), evaluated);
    }

    return {
      body: returnBody,
      ctx: {
        ...ctx,
        variables: nextVariables,
      },
    };
  }

  private isTableValuedExpression(expr: string, ctx: ScalarEvalContext): boolean {
    const clean = this.stripOuterParens(expr.trim());
    if (!clean) {
      return false;
    }
    if (/^VAR\b/i.test(clean)) {
      const retIdx = this.findTopLevelKeywordIndex(clean, 'RETURN');
      if (retIdx >= 0) {
        return this.isTableValuedExpression(clean.slice(retIdx + 6), ctx);
      }
    }
    if (ctx.variables?.has(clean.toLowerCase())) {
      return Array.isArray(ctx.variables.get(clean.toLowerCase()));
    }
    const fnCall = this.parseTopLevelFunctionCall(clean);
    if (fnCall) {
      const tableFns = new Set([
        'ROW',
        'SUMMARIZECOLUMNS',
        'FILTER',
        'TOPN',
        'ADDCOLUMNS',
        'SELECTCOLUMNS',
        'VALUES',
        'DISTINCT',
        'ALL',
        'ALLSELECTED',
        'REMOVEFILTERS',
        'UNION',
      ]);
      return tableFns.has(fnCall.name.toUpperCase());
    }

    const unquoted = this.unquoteIdentifier(clean);
    if (!clean.includes('[') && !clean.includes('(')) {
      const knownTable =
        this.state.sharedTables.some(
          (t) => t.name.toLowerCase() === unquoted.toLowerCase()
        ) || this.state.getTableRows(unquoted).length > 0;
      if (knownTable) {
        return true;
      }
    }
    return false;
  }

  private findMeasureByName(
    name: string,
    localMeasures?: ReadonlyMap<string, RaxMeasureDescriptor>
  ): RaxMeasureDescriptor | undefined {
    const lower = name.trim().toLowerCase();
    if (localMeasures?.has(lower)) {
      return localMeasures.get(lower);
    }
    return this.state.measures.find(
      (m) => m.label.toLowerCase() === lower || m.id.toLowerCase() === lower
    );
  }

  private findMeasureReferencedInExpr(
    expr: string,
    localMeasures?: ReadonlyMap<string, RaxMeasureDescriptor>
  ): RaxMeasureDescriptor | undefined {
    const bracketRegex = /\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = bracketRegex.exec(expr)) !== null) {
      const found = this.findMeasureByName(match[1], localMeasures);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private extractTableNameFromExpr(expr: string | undefined): string | undefined {
    if (!expr) {
      return undefined;
    }
    const quotedBracket = expr.match(/'([^']+)'\s*\[[^\]]+\]/);
    if (quotedBracket?.[1]) {
      return quotedBracket[1].trim();
    }
    const unquotedBracket = expr.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\[[^\]]+\]/);
    if (unquotedBracket?.[1]) {
      return unquotedBracket[1].trim();
    }
    const fnTableArg = expr.match(
      /\b(?:COUNTROWS|SUMX|AVERAGEX|MINX|MAXX|COUNTX|FILTER|ALL|REMOVEFILTERS|VALUES|DISTINCT|ADDCOLUMNS|SELECTCOLUMNS)\s*\(\s*(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))/i
    );
    if (fnTableArg) {
      return (fnTableArg[1] ?? fnTableArg[2])?.trim();
    }
    return undefined;
  }

  private parseTableAndColumnRef(
    rawRef: string,
    defaultTable?: string
  ): { tableName: string; colName: string } | null {
    const trimmed = rawRef.trim();
    const quotedMatch = trimmed.match(/^'([^']+)'\s*\[([^\]]+)\]$/);
    if (quotedMatch) {
      return { tableName: quotedMatch[1].trim(), colName: quotedMatch[2].trim() };
    }
    const unquotedMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_ -]*)\[([^\]]+)\]$/);
    if (unquotedMatch) {
      return { tableName: unquotedMatch[1].trim(), colName: unquotedMatch[2].trim() };
    }
    const bareBracket = trimmed.match(/^\[([^\]]+)\]$/);
    if (bareBracket) {
      return { tableName: defaultTable ?? '', colName: bareBracket[1].trim() };
    }
    const dotMatch = trimmed.match(/^(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (dotMatch) {
      return {
        tableName: (dotMatch[1] ?? dotMatch[2]).trim(),
        colName: dotMatch[3].trim(),
      };
    }
    return null;
  }

  private parseTopLevelFunctionCall(
    expr: string
  ): { name: string; argsContent: string } | null {
    const match = expr.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/);
    if (!match || !expr.endsWith(')')) {
      return null;
    }
    const openParenIdx = expr.indexOf('(');
    let depth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = openParenIdx; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble) {
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0 && i < expr.length - 1) {
            return null;
          }
        }
      }
    }

    if (depth !== 0) {
      return null;
    }
    return {
      name: match[1],
      argsContent: expr.slice(openParenIdx + 1, -1),
    };
  }

  private stripOuterParens(expr: string): string {
    let result = expr.trim();
    while (result.startsWith('(') && result.endsWith(')')) {
      let depth = 0;
      let inSingle = false;
      let inDouble = false;
      let wrapsEntire = true;
      for (let i = 0; i < result.length; i++) {
        const ch = result[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (!inSingle && !inDouble) {
          if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth === 0 && i < result.length - 1) {
              wrapsEntire = false;
              break;
            }
          }
        }
      }
      if (wrapsEntire && depth === 0) {
        result = result.slice(1, -1).trim();
      } else {
        break;
      }
    }
    return result;
  }

  private findTopLevelOperator(
    expr: string,
    operators: readonly string[]
  ): { index: number; op: string } {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          for (const op of operators) {
            if (expr.startsWith(op, i)) {
              return { index: i, op };
            }
          }
        }
      }
    }
    return { index: -1, op: '' };
  }

  private findRightmostTopLevelOperator(
    expr: string,
    operators: readonly string[]
  ): { index: number; op: string } {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;
    let foundIdx = -1;
    let foundOp = '';

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          for (const op of operators) {
            if (expr.startsWith(op, i)) {
              foundIdx = i;
              foundOp = op;
              break;
            }
          }
        }
      }
    }
    return { index: foundIdx, op: foundOp };
  }

  private findRightmostBinaryAddSub(expr: string): { index: number; op: string } {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;
    let foundIdx = -1;
    let foundOp = '';

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

        if (
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0 &&
          (ch === '+' || ch === '-')
        ) {
          const prevNonSpace = expr.slice(0, i).trimEnd().slice(-1);
          if (
            prevNonSpace &&
            !['(', ',', '=', '<', '>', '!', '&', '|', '+', '-', '*', '/', '^'].includes(
              prevNonSpace
            )
          ) {
            foundIdx = i;
            foundOp = ch;
          }
        }
      }
    }
    return { index: foundIdx, op: foundOp };
  }

  private findTopLevelSingleAmpersand(expr: string): number {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
        else if (
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0 &&
          ch === '&' &&
          expr[i + 1] !== '&' &&
          expr[i - 1] !== '&'
        ) {
          return i;
        }
      }
    }
    return -1;
  }

  private matchTopLevelInOperator(
    expr: string
  ): { left: string; setContent: string } | null {
    const regex = /\bIN\s*\{([\s\S]*)\}$/i;
    const match = expr.match(regex);
    if (!match || match.index === undefined) {
      return null;
    }
    if (!this.isAtTopLevel(expr, match.index)) {
      return null;
    }
    return {
      left: expr.slice(0, match.index).trim(),
      setContent: match[1].trim(),
    };
  }

  private isAtTopLevel(text: string, targetIndex: number): boolean {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < targetIndex && i < text.length; i++) {
      const ch = text[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
      }
    }
    return (
      !inSingle &&
      !inDouble &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    );
  }

  private findTopLevelKeywordIndex(text: string, keyword: string): number {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (this.isAtTopLevel(text, match.index)) {
        return match.index;
      }
    }
    return -1;
  }

  private extractTrailingOrderBy(queryBody: string): {
    coreBody: string;
    orderBy: { column: string; direction: 'ASC' | 'DESC' } | null;
  } {
    const orderIdx = this.findTopLevelKeywordIndex(queryBody, 'ORDER');
    if (orderIdx < 0) {
      return { coreBody: queryBody, orderBy: null };
    }
    const tail = queryBody.slice(orderIdx);
    const match = tail.match(
      /^ORDER\s+BY\s+(?:'[^']+'|[A-Za-z0-9_]+)?(?:\[([^\]]+)\]|([A-Za-z0-9_]+))\s*(ASC|DESC)?/i
    );
    if (!match) {
      return { coreBody: queryBody, orderBy: null };
    }
    const column = (match[1] ?? match[2] ?? '').trim();
    const direction = (match[3] ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return {
      coreBody: queryBody.slice(0, orderIdx).trim(),
      orderBy: { column, direction },
    };
  }

  private sortRowsByClause(
    rows: Array<Record<string, unknown>>,
    targetCol: string,
    direction: 'ASC' | 'DESC'
  ): Array<Record<string, unknown>> {
    if (rows.length <= 1 || !targetCol) {
      return rows;
    }
    const resolvedKey =
      Object.keys(rows[0]).find((k) => k.toLowerCase() === targetCol.toLowerCase()) ??
      targetCol;
    const isDesc = direction === 'DESC';
    return [...rows].sort((a, b) =>
      this.compareValues(a[resolvedKey], b[resolvedKey], isDesc)
    );
  }

  private compareValues(a: unknown, b: unknown, desc = false): number {
    const numA = Number(a);
    const numB = Number(b);
    if (
      a !== '' &&
      b !== '' &&
      a !== null &&
      b !== null &&
      !Number.isNaN(numA) &&
      !Number.isNaN(numB)
    ) {
      return desc ? numB - numA : numA - numB;
    }
    const cmp = String(a ?? '').localeCompare(String(b ?? ''));
    return desc ? -cmp : cmp;
  }

  private isTruthy(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0 && !Number.isNaN(val);
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      return lower !== '' && lower !== 'false' && lower !== '0';
    }
    return Boolean(val);
  }

  private isComparisonOperatorStart(text: string): boolean {
    return /^[=<>!]/.test(text.trim());
  }

  private stripComments(raw: string): string {
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trimStart();
        if (
          trimmed.startsWith('///') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('--')
        ) {
          return '';
        }
        return line;
      })
      .join('\n');
  }

  private unquoteString(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
      return trimmed.slice(1, -1).replace(/""/g, '"');
    }
    return trimmed;
  }

  private unquoteIdentifier(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
      return trimmed.slice(1, -1);
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length >= 2) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private buildSqlPlanDescription(
    queryBody: string,
    orderBy: { column: string; direction: 'ASC' | 'DESC' } | null
  ): string {
    const orderClause = orderBy
      ? ` ORDER BY "${orderBy.column}" ${orderBy.direction}`
      : '';
    const fnCall = this.parseTopLevelFunctionCall(queryBody);
    if (fnCall) {
      const fn = fnCall.name.toUpperCase();
      if (fn === 'ROW') {
        return `SELECT /* ROW projection */ * FROM (VALUES (${fnCall.argsContent}))${orderClause};`;
      }
      if (fn === 'SUMMARIZECOLUMNS') {
        const table = this.extractTableNameFromExpr(fnCall.argsContent) ?? 'fact_table';
        return `SELECT /* SUMMARIZECOLUMNS */ * FROM ${table} GROUP BY ALL${orderClause};`;
      }
      if (fn === 'FILTER') {
        const args = this.splitTopLevelArgs(fnCall.argsContent);
        return `SELECT * FROM ${args[0] ?? 'table'} WHERE ${args[1] ?? 'TRUE'}${orderClause};`;
      }
      if (fn === 'TOPN') {
        const args = this.splitTopLevelArgs(fnCall.argsContent);
        return `SELECT * FROM ${args[1] ?? 'table'}${orderClause} LIMIT ${args[0] ?? 10};`;
      }
    }
    return `SELECT * FROM ${this.unquoteIdentifier(queryBody)}${orderClause};`;
  }

  private matchesFilterClause(rawVal: unknown, clause: FilterClause): boolean {
    const values = clause.values;
    switch (clause.operator) {
      case 'EQ':
        return this.valuesEqual(rawVal, values[0]);
      case 'NEQ':
        return !this.valuesEqual(rawVal, values[0]);
      case 'IN': {
        const expanded = values.flatMap((v) =>
          typeof v === 'string' && v.includes(',')
            ? v
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean)
            : [v]
        );
        return expanded.some((item) => this.valuesEqual(rawVal, item));
      }
      case 'BETWEEN': {
        const expanded = values.flatMap((v) =>
          typeof v === 'string' && v.includes(',')
            ? v
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean)
            : [v]
        );
        if (expanded.length < 2) {
          return this.valuesEqual(rawVal, expanded[0]);
        }
        const numVal = Number(rawVal);
        const lowNum = Number(expanded[0]);
        const highNum = Number(expanded[1]);
        if (!Number.isNaN(numVal) && !Number.isNaN(lowNum) && !Number.isNaN(highNum)) {
          const minBound = Math.min(lowNum, highNum);
          const maxBound = Math.max(lowNum, highNum);
          return numVal >= minBound && numVal <= maxBound;
        }
        const strVal = String(rawVal);
        return strVal >= String(expanded[0]) && strVal <= String(expanded[1]);
      }
      default:
        return true;
    }
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    const numA = Number(a);
    const numB = Number(b);
    if (
      a !== '' &&
      b !== '' &&
      a !== null &&
      b !== null &&
      typeof a !== 'boolean' &&
      typeof b !== 'boolean' &&
      !Number.isNaN(numA) &&
      !Number.isNaN(numB)
    ) {
      return numA === numB;
    }
    return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  }

  private resolveTargetTableName(
    explicitTable?: string,
    raxExpression?: string,
    groupByColumns?: readonly string[]
  ): string | undefined {
    if (explicitTable && this.state.getTableRows(explicitTable).length > 0) {
      return explicitTable;
    }
    if (raxExpression) {
      const extracted = this.extractTableNameFromExpr(raxExpression);
      if (extracted && this.state.getTableRows(extracted).length > 0) {
        return extracted;
      }
      const refMeasure = this.findMeasureReferencedInExpr(raxExpression);
      if (refMeasure?.table && this.state.getTableRows(refMeasure.table).length > 0) {
        return refMeasure.table;
      }
      const dotMatch = raxExpression.match(/^([A-Za-z0-9_]+)\.[A-Za-z0-9_]+$/);
      if (dotMatch?.[1] && this.state.getTableRows(dotMatch[1]).length > 0) {
        return dotMatch[1];
      }
    }
    if (groupByColumns && groupByColumns.length > 0) {
      for (const col of groupByColumns) {
        const dotIdx = col.indexOf('.');
        if (dotIdx > 0) {
          const tableCandidate = col.slice(0, dotIdx);
          if (this.state.getTableRows(tableCandidate).length > 0) {
            return tableCandidate;
          }
        }
      }
    }
    if (explicitTable) {
      return explicitTable;
    }
    const tableWithRows = this.state.sharedTables.find(
      (t) => this.state.getTableRows(t.name).length > 0
    );
    if (tableWithRows) {
      return tableWithRows.name;
    }
    const firstRowKey = Object.keys(this.state.tableRowsMap()).find(
      (k) => (this.state.tableRowsMap()[k]?.length ?? 0) > 0
    );
    return firstRowKey ?? this.state.sharedTables[0]?.name;
  }

  private parseAggregationExpression(
    raxExpression: string | undefined,
    tableName: string
  ): { aggOp: string; columnName: string | null } {
    const expr = (raxExpression ?? '').trim();
    if (!expr) {
      return { aggOp: 'COUNTROWS', columnName: null };
    }

    const fnMatch = expr.match(
      /^(SUM|AVERAGE|AVG|MIN|MAX|COUNT|COUNTA|DISTINCTCOUNT)\s*\(\s*(?:'[^']+'|[A-Za-z0-9_ -]+)?(?:\[\s*([^\]]+?)\s*\]|\.([A-Za-z0-9_]+))\s*\)$/i
    );
    if (fnMatch) {
      const op = fnMatch[1].toUpperCase();
      return {
        aggOp: op === 'COUNTA' ? 'COUNT' : op,
        columnName: (fnMatch[2] ?? fnMatch[3]).trim(),
      };
    }

    const countRowsMatch = expr.match(/^COUNTROWS\s*\(\s*(?:'[^']+'|[A-Za-z0-9_ -]*)?\s*\)$/i);
    if (countRowsMatch) {
      return { aggOp: 'COUNTROWS', columnName: null };
    }

    if (
      expr.includes('(') ||
      expr.includes('+') ||
      expr.includes('*') ||
      expr.includes('/') ||
      /\s-\s/.test(expr)
    ) {
      return { aggOp: 'UNSUPPORTED', columnName: null };
    }

    const bareCol = this.stripTablePrefix(expr);
    if (this.findMeasureByName(bareCol)) {
      return { aggOp: 'UNSUPPORTED', columnName: null };
    }

    const tableMeta = this.state.sharedTables.find(
      (t) => t.name.toLowerCase() === tableName.toLowerCase()
    );
    const colMeta = tableMeta?.columns.find(
      (c) => c.name.toLowerCase() === bareCol.toLowerCase()
    );
    if (colMeta?.summarizeBy && colMeta.summarizeBy !== 'None') {
      return {
        aggOp: colMeta.summarizeBy.toUpperCase(),
        columnName: colMeta.name,
      };
    }

    const rows = this.state.getTableRows(tableName);
    const sampleVal = rows.length > 0 ? this.readRowProperty(rows[0], bareCol) : undefined;
    if (
      typeof sampleVal === 'number' ||
      (typeof sampleVal === 'string' &&
        sampleVal.trim() !== '' &&
        !Number.isNaN(Number(sampleVal)))
    ) {
      return { aggOp: 'SUM', columnName: bareCol };
    }

    return { aggOp: 'COUNT', columnName: bareCol };
  }

  private aggregateValues(
    rows: readonly Record<string, unknown>[],
    columnName: string | null,
    aggOp: string
  ): number {
    if (rows.length === 0) {
      return 0;
    }
    if (!columnName || aggOp === 'COUNTROWS') {
      return rows.length;
    }

    const upperOp = aggOp.toUpperCase();
    if (upperOp === 'COUNT') {
      return rows.filter((r) => {
        const val = this.readRowProperty(r, columnName);
        return val !== null && val !== undefined && val !== '';
      }).length;
    }

    if (upperOp === 'DISTINCTCOUNT') {
      const distinct = new Set<string>();
      for (const r of rows) {
        const val = this.readRowProperty(r, columnName);
        if (val !== null && val !== undefined && val !== '') {
          distinct.add(String(val));
        }
      }
      return distinct.size;
    }

    const numericValues: number[] = [];
    for (const r of rows) {
      const raw = this.readRowProperty(r, columnName);
      const num = Number(raw);
      if (raw !== null && raw !== undefined && raw !== '' && !Number.isNaN(num)) {
        numericValues.push(num);
      }
    }

    if (numericValues.length === 0) {
      return 0;
    }

    switch (upperOp) {
      case 'AVERAGE':
      case 'AVG':
        return (
          Math.round(
            (numericValues.reduce((acc, v) => acc + v, 0) / numericValues.length) * 1e6
          ) / 1e6
        );
      case 'MIN':
        return Math.min(...numericValues);
      case 'MAX':
        return Math.max(...numericValues);
      case 'SUM':
      default:
        return Math.round(numericValues.reduce((acc, v) => acc + v, 0) * 1e6) / 1e6;
    }
  }

  private stripTablePrefix(identifier: string): string {
    const bracketMatch = identifier.match(/\[([^\]]+)\]/);
    if (bracketMatch?.[1]) {
      return bracketMatch[1].trim();
    }
    const dotIdx = identifier.indexOf('.');
    return dotIdx >= 0 ? identifier.slice(dotIdx + 1).trim() : identifier.trim();
  }

  private readRowProperty(row: Record<string, unknown>, colName: string): unknown {
    if (colName in row) {
      return row[colName];
    }
    const lower = colName.toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.toLowerCase() === lower || this.stripTablePrefix(k).toLowerCase() === lower) {
        return v;
      }
    }
    return undefined;
  }
}
