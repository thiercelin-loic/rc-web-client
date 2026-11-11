import { Injectable } from '@angular/core';
import {
  AggregationFunction,
  DataPrepColumn,
  DataPrepStep,
  RQueryAggregateDefinition,
  tableNameFromSource,
  toBackendType,
} from '../features/data-prep/data-prep.model';
import { DataPrepQuarantineRow } from '../services/api.service';

export type LookupTableResolver = (targetSourceIdOrName: string) => {
  columns?: readonly DataPrepColumn[];
  rows: readonly Record<string, unknown>[];
} | undefined;

export interface StepEvaluationResult {
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly quarantined: DataPrepQuarantineRow[];
}

/**
 * Pure R-Query step execution engine for tabular data preparation.
 * Evaluates transformation chains locally without UI or server dependencies.
 */
@Injectable({ providedIn: 'root' })
export class DataPrepEngineService {
  public evaluateStepsLocally(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
    lookupResolver?: LookupTableResolver,
  ): StepEvaluationResult {
    let cols: DataPrepColumn[] = initialCols.map((c) => ({ ...c }));
    let currentRows: Record<string, unknown>[] = initialRows.map((r) => ({ ...r }));
    const quarantined: DataPrepQuarantineRow[] = [];

    for (const step of steps) {
      const def = step.definition ?? {};
      const stepKind = String(def['step'] ?? step.type).replace(/Step$/, '');

      switch (stepKind) {
        case 'FileSource':
        case 'Navigation':
          break;

        case 'ChangeType': {
          const colName = String(def['column'] ?? '');
          const targetType = String(def['targetType'] ?? def['type'] ?? 'String');
          cols = cols.map((c) =>
            c.name === colName ? { ...c, type: targetType, icon: targetType } : c,
          );
          const validRows: Record<string, unknown>[] = [];
          currentRows.forEach((row, rIdx) => {
            const rawVal = row[colName];
            if (rawVal === null || rawVal === undefined || rawVal === '') {
              validRows.push({ ...row, [colName]: null });
              return;
            }
            const coerced = this.coerceValue(rawVal, targetType);
            if (coerced.valid) {
              validRows.push({ ...row, [colName]: coerced.value });
            } else {
              quarantined.push({
                sourceLineNumber: rIdx + 1,
                columnName: colName,
                expectedType: toBackendType(targetType),
                errorReason: `Cannot coerce "${String(rawVal)}" to ${targetType}`,
                rawPayload: JSON.stringify(row),
              });
            }
          });
          currentRows = validRows;
          break;
        }

        case 'DetectDataType': {
          cols = cols.map((col) => {
            const sample = currentRows.find(
              (r) => r[col.name] !== null && r[col.name] !== undefined && r[col.name] !== '',
            )?.[col.name];
            let inferred = 'String';
            if (typeof sample === 'number') {
              inferred = Number.isInteger(sample) ? 'Int64' : 'Float64';
            } else if (typeof sample === 'boolean') {
              inferred = 'Boolean';
            } else if (typeof sample === 'string') {
              const trimmed = sample.trim();
              if (/^-?\d+$/.test(trimmed)) inferred = 'Int64';
              else if (/^-?\d+\.\d+$/.test(trimmed)) inferred = 'Float64';
              else if (/^(true|false|yes|no)$/i.test(trimmed)) inferred = 'Boolean';
              else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) inferred = 'Date';
            }
            return { ...col, type: inferred, icon: inferred };
          });
          currentRows = currentRows.map((r) => {
            const nextRow = { ...r };
            cols.forEach((c) => {
              const val = nextRow[c.name];
              if (typeof val === 'string' && val !== '') {
                if (c.type === 'Int64') {
                  const n = Number(val);
                  if (!Number.isNaN(n)) nextRow[c.name] = Math.trunc(n);
                } else if (c.type === 'Float64') {
                  const n = Number(val);
                  if (!Number.isNaN(n)) nextRow[c.name] = n;
                } else if (c.type === 'Boolean') {
                  const lower = val.toLowerCase();
                  if (lower === 'true' || lower === 'yes') nextRow[c.name] = true;
                  else if (lower === 'false' || lower === 'no') nextRow[c.name] = false;
                }
              }
            });
            return nextRow;
          });
          break;
        }

        case 'RenameColumn': {
          const oldName = String(def['oldName'] ?? def['original'] ?? '');
          const newName = String(def['newName'] ?? def['renamed'] ?? '');
          if (oldName && newName && oldName !== newName) {
            cols = cols.map((c) => (c.name === oldName ? { ...c, name: newName } : c));
            currentRows = currentRows.map((r) => {
              const copy = { ...r };
              if (oldName in copy) {
                copy[newName] = copy[oldName];
                delete copy[oldName];
              }
              return copy;
            });
          }
          break;
        }

        case 'TransformColumnNames': {
          const op = String(
            (def['parameters'] as Record<string, unknown>)?.['operation'] ?? 'UPPERCASE',
          );
          const transformName = (n: string): string => {
            if (op === 'LOWERCASE') return n.toLowerCase();
            if (op === 'TRIM') return n.trim();
            if (op === 'CLEAN') return n.replace(/[^a-zA-Z0-9_]/g, '_');
            return n.toUpperCase();
          };
          const mapping = new Map<string, string>();
          cols = cols.map((c) => {
            const nextName = transformName(c.name);
            mapping.set(c.name, nextName);
            return { ...c, name: nextName };
          });
          currentRows = currentRows.map((r) => {
            const nextRow: Record<string, unknown> = {};
            Object.entries(r).forEach(([k, v]) => {
              nextRow[mapping.get(k) ?? transformName(k)] = v;
            });
            return nextRow;
          });
          break;
        }

        case 'RemoveColumn': {
          const colName = String(def['column'] ?? '');
          cols = cols.filter((c) => c.name !== colName);
          currentRows = currentRows.map((r) => {
            const copy = { ...r };
            delete copy[colName];
            return copy;
          });
          break;
        }

        case 'RemoveOtherColumns': {
          const keep =
            ((def['parameters'] as Record<string, unknown>)?.['keepColumns'] as string[]) ?? [];
          const keepSet = new Set(keep);
          cols = cols.filter((c) => keepSet.has(c.name));
          currentRows = currentRows.map((r) => {
            const nextRow: Record<string, unknown> = {};
            keep.forEach((k) => {
              if (k in r) nextRow[k] = r[k];
            });
            return nextRow;
          });
          break;
        }

        case 'FilterNulls': {
          const colName = String(def['column'] ?? '');
          currentRows = currentRows.filter(
            (r) => r[colName] !== null && r[colName] !== undefined && r[colName] !== '',
          );
          break;
        }

        case 'FilterRows': {
          const predicate = String(def['predicate'] ?? '');
          currentRows = currentRows.filter((r) => this.evaluatePredicate(r, predicate));
          break;
        }

        case 'UnpivotColumns': {
          const pivotCols = (def['pivotColumns'] as string[]) ?? [];
          const nameCol = String(def['nameCol'] ?? 'Attribute');
          const valCol = String(def['valCol'] ?? 'Value');
          const pivotSet = new Set(pivotCols);
          const anchorCols = cols.filter((c) => !pivotSet.has(c.name));
          cols = [
            ...anchorCols,
            { name: nameCol, type: 'String', icon: 'String' },
            { name: valCol, type: 'Float64', icon: 'Float64' },
          ];
          const unpivoted: Record<string, unknown>[] = [];
          for (const r of currentRows) {
            for (const pCol of pivotCols) {
              const val = r[pCol];
              if (val !== null && val !== undefined && val !== '') {
                const base: Record<string, unknown> = {};
                anchorCols.forEach((ac) => (base[ac.name] = r[ac.name]));
                base[nameCol] = pCol;
                base[valCol] = val;
                unpivoted.push(base);
              }
            }
          }
          currentRows = unpivoted;
          break;
        }

        case 'UnpivotOtherColumns': {
          const anchorNames = (def['groupColumns'] as string[]) ?? [];
          const nameCol = String(def['nameCol'] ?? 'Attribute');
          const valCol = String(def['valCol'] ?? 'Value');
          const anchorSet = new Set(anchorNames);
          const pivotCols = cols.filter((c) => !anchorSet.has(c.name)).map((c) => c.name);
          const anchorCols = cols.filter((c) => anchorSet.has(c.name));
          cols = [
            ...anchorCols,
            { name: nameCol, type: 'String', icon: 'String' },
            { name: valCol, type: 'Float64', icon: 'Float64' },
          ];
          const unpivoted: Record<string, unknown>[] = [];
          for (const r of currentRows) {
            for (const pCol of pivotCols) {
              const val = r[pCol];
              if (val !== null && val !== undefined && val !== '') {
                const base: Record<string, unknown> = {};
                anchorCols.forEach((ac) => (base[ac.name] = r[ac.name]));
                base[nameCol] = pCol;
                base[valCol] = val;
                unpivoted.push(base);
              }
            }
          }
          currentRows = unpivoted;
          break;
        }

        case 'GroupRows': {
          const gCols = (def['groupColumns'] as string[]) ?? [];
          const aggs = (def['aggregations'] as RQueryAggregateDefinition[]) ?? [];
          const groups = new Map<string, Record<string, unknown>[]>();
          for (const r of currentRows) {
            const key = gCols.map((c) => String(r[c] ?? 'NULL')).join('||');
            const bucket = groups.get(key) ?? [];
            bucket.push(r);
            groups.set(key, bucket);
          }
          const nextRows: Record<string, unknown>[] = [];
          groups.forEach((bucket) => {
            const exemplar = bucket[0] ?? {};
            const outRow: Record<string, unknown> = {};
            gCols.forEach((c) => (outRow[c] = exemplar[c]));
            for (const agg of aggs) {
              const nums = bucket
                .map((b) => Number(b[agg.sourceColumn]))
                .filter((n) => !Number.isNaN(n));
              if (agg.function === 'COUNT') {
                outRow[agg.outputColumn] = bucket.length;
              } else if (nums.length === 0) {
                outRow[agg.outputColumn] = 0;
              } else if (agg.function === 'SUM') {
                outRow[agg.outputColumn] = nums.reduce((a, b) => a + b, 0);
              } else if (agg.function === 'AVG') {
                outRow[agg.outputColumn] = nums.reduce((a, b) => a + b, 0) / nums.length;
              } else if (agg.function === 'MIN') {
                outRow[agg.outputColumn] = Math.min(...nums);
              } else if (agg.function === 'MAX') {
                outRow[agg.outputColumn] = Math.max(...nums);
              }
            }
            nextRows.push(outRow);
          });
          cols = [
            ...cols.filter((c) => gCols.includes(c.name)),
            ...aggs.map((a) => ({
              name: a.outputColumn,
              type: a.function === 'COUNT' ? 'Int64' : 'Float64',
              icon: a.function === 'COUNT' ? 'Int64' : 'Float64',
            })),
          ];
          currentRows = nextRows;
          break;
        }

        case 'AddCustomColumn': {
          const newCol = String(def['newName'] ?? 'Custom');
          const expr = String(def['expression'] ?? '');
          const validRows: Record<string, unknown>[] = [];
          currentRows.forEach((r, idx) => {
            const res = this.evaluateCustomExpression(r, expr);
            if (res.error) {
              quarantined.push({
                sourceLineNumber: idx + 1,
                columnName: newCol,
                expectedType: 'FLOAT64',
                errorReason: res.error,
                rawPayload: JSON.stringify(r),
              });
            } else {
              validRows.push({ ...r, [newCol]: res.value });
            }
          });
          currentRows = validRows;
          const sampleVal = currentRows[0]?.[newCol];
          const colType = typeof sampleVal === 'number' ? 'Float64' : 'String';
          if (!cols.some((c) => c.name === newCol)) {
            cols = [...cols, { name: newCol, type: colType, icon: colType }];
          }
          break;
        }

        case 'AddIndexColumn': {
          const newCol = String(def['newName'] ?? 'Index');
          const params = (def['parameters'] as Record<string, unknown>) ?? {};
          const initial = Number(params['initialValue'] ?? 1);
          const increment = Number(params['increment'] ?? 1);
          currentRows = currentRows.map((r, idx) => ({
            ...r,
            [newCol]: initial + idx * increment,
          }));
          if (!cols.some((c) => c.name === newCol)) {
            cols = [...cols, { name: newCol, type: 'Int64', icon: 'Int64' }];
          }
          break;
        }

        case 'MergeQueries': {
          const targetSourceId = String(
            (def['parameters'] as Record<string, unknown>)?.['targetSourceId'] ?? '',
          );
          const targetTableName = String(def['targetTable'] ?? '');
          const joinKeys = (def['joinKeys'] as string[]) ?? [];
          const joinKey = joinKeys[0] ?? '';
          const joinType = String(def['joinType'] ?? 'LEFT');
          const params = (def['parameters'] as Record<string, unknown>) ?? {};
          const mode = String(params['mode'] ?? 'expand');

          const resolved = lookupResolver
            ? lookupResolver(targetSourceId || targetTableName)
            : undefined;
          const lookupRows = resolved?.rows ?? [];

          if (joinKey && lookupRows.length > 0) {
            if (mode === 'aggregate') {
              const aggCol = String(params['aggregateColumn'] ?? '');
              const aggFn = String(params['aggregateFunction'] ?? 'SUM') as AggregationFunction;
              const outName = String(params['outputColumn'] ?? `${targetTableName}_${aggFn}`);
              currentRows = currentRows
                .map((leftRow) => {
                  const keyVal = leftRow[joinKey];
                  const matches = lookupRows.filter(
                    (lr) => String(lr[joinKey]) === String(keyVal),
                  );
                  if (matches.length === 0 && joinType === 'INNER') return null;
                  const nums = matches
                    .map((m) => Number(m[aggCol]))
                    .filter((n) => !Number.isNaN(n));
                  let aggVal = 0;
                  if (aggFn === 'COUNT') aggVal = matches.length;
                  else if (aggFn === 'SUM') aggVal = nums.reduce((a, b) => a + b, 0);
                  else if (aggFn === 'AVG')
                    aggVal = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
                  else if (aggFn === 'MIN') aggVal = nums.length ? Math.min(...nums) : 0;
                  else if (aggFn === 'MAX') aggVal = nums.length ? Math.max(...nums) : 0;
                  return { ...leftRow, [outName]: aggVal };
                })
                .filter((r): r is Record<string, unknown> => r !== null);
              if (!cols.some((c) => c.name === outName)) {
                cols = [...cols, { name: outName, type: 'Float64', icon: 'Float64' }];
              }
            } else {
              const extraCols = (resolved?.columns ?? []).filter(
                (tc) => tc.name !== joinKey && !cols.some((c) => c.name === tc.name),
              );
              currentRows = currentRows
                .map((leftRow) => {
                  const keyVal = leftRow[joinKey];
                  const match = lookupRows.find((lr) => String(lr[joinKey]) === String(keyVal));
                  if (!match && joinType === 'INNER') return null;
                  const merged: Record<string, unknown> = { ...leftRow };
                  extraCols.forEach((ec) => {
                    merged[ec.name] = match ? (match[ec.name] ?? null) : null;
                  });
                  return merged;
                })
                .filter((r): r is Record<string, unknown> => r !== null);
              cols = [...cols, ...extraCols];
            }
          }
          break;
        }

        case 'FillDown': {
          const colName = String(def['column'] ?? '');
          let lastNonNull: unknown = null;
          currentRows = currentRows.map((r) => {
            const val = r[colName];
            if (val !== null && val !== undefined && val !== '') {
              lastNonNull = val;
              return r;
            }
            return lastNonNull !== null ? { ...r, [colName]: lastNonNull } : r;
          });
          break;
        }

        case 'PromoteHeaders': {
          if (currentRows.length > 0) {
            const firstRow = currentRows[0];
            const mapping = new Map<string, string>();
            cols = cols.map((c, idx) => {
              const promoted = String(firstRow[c.name] ?? `Column_${idx + 1}`).trim() || c.name;
              mapping.set(c.name, promoted);
              return { ...c, name: promoted };
            });
            currentRows = currentRows.slice(1).map((r) => {
              const next: Record<string, unknown> = {};
              Object.entries(r).forEach(([k, v]) => {
                next[mapping.get(k) ?? k] = v;
              });
              return next;
            });
          }
          break;
        }

        case 'Transpose': {
          if (cols.length > 0 && currentRows.length > 0) {
            const newCols: DataPrepColumn[] = currentRows.map((_, rIdx) => ({
              name: `Column_${rIdx + 1}`,
              type: 'String',
              icon: 'String',
            }));
            const transposedRows: Record<string, unknown>[] = cols.map((col) => {
              const rowObj: Record<string, unknown> = {};
              currentRows.forEach((r, rIdx) => {
                rowObj[`Column_${rIdx + 1}`] = r[col.name];
              });
              return rowObj;
            });
            cols = newCols;
            currentRows = transposedRows;
          }
          break;
        }

        case 'RemoveTopRows': {
          const count = Math.max(
            0,
            Number((def['parameters'] as Record<string, unknown>)?.['count'] ?? 1),
          );
          currentRows = currentRows.slice(count);
          break;
        }

        case 'RemoveBottomRows': {
          const count = Math.max(
            0,
            Number((def['parameters'] as Record<string, unknown>)?.['count'] ?? 1),
          );
          currentRows =
            count > 0 ? currentRows.slice(0, Math.max(0, currentRows.length - count)) : currentRows;
          break;
        }

        case 'RemoveDuplicates': {
          const keyCols = (def['groupColumns'] as string[]) ?? cols.map((c) => c.name);
          const seen = new Set<string>();
          currentRows = currentRows.filter((r) => {
            const sig = keyCols.map((k) => String(r[k] ?? 'NULL')).join('||');
            if (seen.has(sig)) return false;
            seen.add(sig);
            return true;
          });
          break;
        }

        case 'SplitColumn': {
          const colName = String(def['column'] ?? '');
          const delimiter = String(
            (def['parameters'] as Record<string, unknown>)?.['delimiter'] ?? ',',
          );
          const col1 = `${colName}_1`;
          const col2 = `${colName}_2`;
          currentRows = currentRows.map((r) => {
            const raw = String(r[colName] ?? '');
            const idx = raw.indexOf(delimiter);
            const p1 = idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
            const p2 = idx >= 0 ? raw.slice(idx + delimiter.length).trim() : null;
            const copy = { ...r, [col1]: p1, [col2]: p2 };
            delete copy[colName];
            return copy;
          });
          const targetIdx = cols.findIndex((c) => c.name === colName);
          if (targetIdx >= 0) {
            cols = [
              ...cols.slice(0, targetIdx),
              { name: col1, type: 'String', icon: 'String' },
              { name: col2, type: 'String', icon: 'String' },
              ...cols.slice(targetIdx + 1),
            ];
          }
          break;
        }

        case 'MergeColumns': {
          const sourceCols = (def['groupColumns'] as string[]) ?? [];
          const newCol = String(def['newName'] ?? 'Merged');
          const sep = String((def['parameters'] as Record<string, unknown>)?.['separator'] ?? ' ');
          if (sourceCols.length >= 2) {
            currentRows = currentRows.map((r) => ({
              ...r,
              [newCol]: sourceCols
                .map((sc) => r[sc])
                .filter((v) => v !== null && v !== undefined && v !== '')
                .join(sep),
            }));
            if (!cols.some((c) => c.name === newCol)) {
              cols = [...cols, { name: newCol, type: 'String', icon: 'String' }];
            }
          }
          break;
        }

        case 'SortRows': {
          const colName = String(def['column'] ?? '');
          const asc = (def['parameters'] as Record<string, unknown>)?.['ascending'] !== false;
          currentRows = [...currentRows].sort((a, b) => {
            const va = a[colName];
            const vb = b[colName];
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            const cmp =
              typeof va === 'number' && typeof vb === 'number'
                ? va - vb
                : String(va).localeCompare(String(vb));
            return asc ? cmp : -cmp;
          });
          break;
        }

        case 'InlineCleansing': {
          const colName = String(def['column'] ?? '');
          const params = (def['parameters'] as Record<string, unknown>) ?? {};
          const op = String(params['operation'] ?? 'TRIM');
          currentRows = currentRows.map((r) => {
            const raw = r[colName];
            if (raw === null || raw === undefined) return r;
            const str = String(raw);
            let nextVal: unknown = str;
            if (op === 'TRIM') nextVal = str.trim();
            else if (op === 'UPPERCASE') nextVal = str.toUpperCase();
            else if (op === 'LOWERCASE') nextVal = str.toLowerCase();
            else if (op === 'REPLACE') {
              const target = String(params['target'] ?? '');
              const replacement = String(params['replacement'] ?? '');
              nextVal = target ? str.split(target).join(replacement) : str;
            }
            return { ...r, [colName]: nextVal };
          });
          break;
        }
      }
    }

    return { columns: cols, rows: currentRows, quarantined };
  }

  public coerceValue(rawVal: unknown, targetType: string): { valid: boolean; value: unknown } {
    const upper = targetType.toUpperCase();
    if (upper === 'STRING' || upper === 'TEXT' || upper === 'UTF8_STRING') {
      return { valid: true, value: String(rawVal) };
    }
    if (upper === 'INT64') {
      const cleaned = String(rawVal).replace(/[€$,\s]/g, '');
      const num = Number(cleaned);
      if (Number.isNaN(num) || !Number.isFinite(num)) return { valid: false, value: null };
      return { valid: true, value: Math.trunc(num) };
    }
    if (upper === 'FLOAT64' || upper === 'DECIMAL' || upper === 'CURRENCY') {
      const cleaned = String(rawVal).replace(/[€$,\s]/g, '');
      const num = Number(cleaned);
      if (Number.isNaN(num) || !Number.isFinite(num)) return { valid: false, value: null };
      return { valid: true, value: num };
    }
    if (upper === 'BOOLEAN') {
      const s = String(rawVal).trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return { valid: true, value: true };
      if (s === 'false' || s === '0' || s === 'no') return { valid: true, value: false };
      return { valid: false, value: null };
    }
    if (
      upper === 'DATE' ||
      upper === 'DATETIME' ||
      upper === 'ISO_DATE' ||
      upper === 'ISO_DATETIME'
    ) {
      const str = String(rawVal).trim();
      const parsed = Date.parse(str);
      if (Number.isNaN(parsed)) return { valid: false, value: null };
      return { valid: true, value: str };
    }
    return { valid: true, value: rawVal };
  }

  public evaluatePredicate(row: Record<string, unknown>, predicate: string): boolean {
    if (!predicate.trim()) return true;
    const clauses = predicate.split(/\s+and\s+/i);
    return clauses.every((clause) => {
      const match = clause
        .trim()
        .match(/^\[([^\]]+)\]\s*(==|!=|<>|>=|<=|>|<)\s*(.+)$/);
      if (!match) return true;
      const [, col, op, rawLit] = match;
      const cellVal = row[col];
      const lit = rawLit.trim().replace(/^['"]|['"]$/g, '');
      if (cellVal === null || cellVal === undefined) {
        return op === '!=' || op === '<>';
      }
      const numCell = Number(cellVal);
      const numLit = Number(lit);
      const bothNumeric =
        !Number.isNaN(numCell) && !Number.isNaN(numLit) && !rawLit.trim().startsWith("'");
      const cmp = bothNumeric ? numCell - numLit : String(cellVal).localeCompare(lit);

      switch (op) {
        case '==':
          return bothNumeric ? numCell === numLit : String(cellVal) === lit;
        case '!=':
        case '<>':
          return bothNumeric ? numCell !== numLit : String(cellVal) !== lit;
        case '>':
          return cmp > 0;
        case '>=':
          return cmp >= 0;
        case '<':
          return cmp < 0;
        case '<=':
          return cmp <= 0;
        default:
          return true;
      }
    });
  }

  public evaluateCustomExpression(
    row: Record<string, unknown>,
    expression: string,
  ): { value: unknown; error?: string } {
    const trimmed = expression.trim();
    if (!trimmed) return { value: null };

    const textSelectMatch = trimmed.match(/Text\.Select\(\s*\[([^\]]+)\]/i);
    if (textSelectMatch) {
      const col = textSelectMatch[1];
      const raw = String(row[col] ?? '');
      return { value: raw.replace(/\D+/g, '') };
    }

    const condMatch = trimmed.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+)$/i);
    if (condMatch) {
      const [, condExpr, thenExpr, elseExpr] = condMatch;
      const condTrue = this.evaluatePredicate(row, condExpr.trim());
      const branch = (condTrue ? thenExpr : elseExpr).trim().replace(/^['"]|['"]$/g, '');
      const numBranch = Number(branch);
      return { value: !Number.isNaN(numBranch) && branch !== '' ? numBranch : branch };
    }

    if (trimmed.includes('&')) {
      const parts = trimmed.split('&').map((part) => {
        const p = part.trim();
        const colRef = p.match(/^\[([^\]]+)\]$/);
        if (colRef) return String(row[colRef[1]] ?? '');
        return p.replace(/^['"]|['"]$/g, '');
      });
      return { value: parts.join('') };
    }

    const binMatch = trimmed.match(
      /^\[([^\]]+)\]\s*([+\-*/])\s*(?:\[([^\]]+)\]|(-?\d+(?:\.\d+)?))$/,
    );
    if (binMatch) {
      const [, leftCol, op, rightCol, rightLit] = binMatch;
      const leftNum = Number(row[leftCol]);
      const rightNum = rightCol !== undefined ? Number(row[rightCol]) : Number(rightLit);
      if (Number.isNaN(leftNum) || Number.isNaN(rightNum)) {
        return { value: null, error: `Non-numeric operand in ${trimmed}` };
      }
      if (op === '/' && rightNum === 0) {
        return { value: null, error: 'Division by zero' };
      }
      const val =
        op === '+'
          ? leftNum + rightNum
          : op === '-'
            ? leftNum - rightNum
            : op === '*'
              ? leftNum * rightNum
              : leftNum / rightNum;
      return { value: Number(val.toFixed(4)) };
    }

    const singleCol = trimmed.match(/^\[([^\]]+)\]$/);
    if (singleCol) {
      return { value: row[singleCol[1]] ?? null };
    }
    return { value: trimmed.replace(/^['"]|['"]$/g, '') };
  }
}

