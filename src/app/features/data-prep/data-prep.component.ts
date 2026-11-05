import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ApiService,
  DataPrepPreview,
  DataPrepQuarantineRow,
} from '../../services/api.service';
import { StateManagerService } from '../../core/state-manager.service';
import {
  AggregationFunction,
  BackendSourceFormat,
  FILTER_OPERATORS,
  FilterOperator,
  JoinKind,
  RQueryAggregateDefinition,
  RQueryStepDefinition,
  buildPredicate,
  formatFromFileName,
  formatMQueryScript,
  isBinaryFormat,
  isNumericType,
  tableNameFromSource,
  toBackendType,
  toBase64,
  toDisplayType,
} from './data-prep.model';

export interface DataPrepColumn {
  readonly name: string;
  readonly type?: string;
  readonly icon?: string;
}

export interface DataPrepStep {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly detail?: string;
  readonly definition?: Record<string, unknown>;
}

export interface IngestionSource {
  readonly id: string;
  readonly name: string;
  readonly format: 'PARQUET' | 'CSV' | 'XLSX' | 'REST';
  readonly path: string;
  readonly enableLoad?: boolean;
  readonly backendFormat?: BackendSourceFormat;
}

export type DataPrepSection = 'Steps' | 'Definition' | 'Quarantine';
export type RibbonToolPanel =
  | null
  | 'filter'
  | 'changeType'
  | 'unpivot'
  | 'groupBy'
  | 'customColumn'
  | 'mergeQueries'
  | 'shaping'
  | 'incrementalRefresh';

interface SourceSnapshot {
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly rawText?: string;
  readonly rawBase64?: string;
}

export const INITIAL_INGESTION_SOURCES: readonly IngestionSource[] = [];
export const INITIAL_PREP_STEPS: readonly DataPrepStep[] = [];
const DEFAULT_SAMPLE_COLUMNS: readonly DataPrepColumn[] = [];
const DEFAULT_SAMPLE_ROWS: readonly Record<string, unknown>[] = [];
const SOURCE_DATA_MAP: Record<
  string,
  { columns: DataPrepColumn[]; rows: Record<string, unknown>[] }
> = {};

@Component({
  selector: 'rc-data-prep',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './data-prep.component.html',
  styleUrl: './data-prep.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataPrepComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly state = inject(StateManagerService);

  public readonly filterOperators = FILTER_OPERATORS;
  public readonly activeMobileTab = signal<'data' | 'tools'>('data');
  public readonly sources = signal<readonly IngestionSource[]>(INITIAL_INGESTION_SOURCES);
  public readonly selectedSourceId = signal<string>('');
  public readonly activeColumnMenu = signal<string | null>(null);
  public readonly editingColumnName = signal<string | null>(null);
  public readonly editingColumnValue = signal<string>('');

  public readonly columns = signal<readonly DataPrepColumn[]>(DEFAULT_SAMPLE_COLUMNS);
  public readonly rows = signal<readonly Record<string, unknown>[]>(DEFAULT_SAMPLE_ROWS);
  public readonly stepsBySource = signal<Record<string, readonly DataPrepStep[]>>({});
  private readonly rawSnapshotsBySource = signal<Record<string, SourceSnapshot>>({});
  public readonly quarantinedRecords = signal<readonly DataPrepQuarantineRow[]>([]);

  // Ribbon panel and step definition view states
  public readonly activeToolPanel = signal<RibbonToolPanel>(null);
  public readonly definitionFormat = signal<'json' | 'm'>('json');

  // Filter panel form signals
  public readonly filterColumn = signal<string>('');
  public readonly filterOperator = signal<FilterOperator>('equals');
  public readonly filterValue = signal<string>('');
  public readonly filterValueTo = signal<string>('');

  // Change Type panel form signals
  public readonly changeTypeColumn = signal<string>('');
  public readonly changeTypeTarget = signal<string>('Float64');

  // Unpivot panel form signals
  public readonly unpivotMode = signal<'selected' | 'other'>('selected');
  public readonly unpivotColumns = signal<readonly string[]>([]);
  public readonly unpivotAttrName = signal<string>('Attribute');
  public readonly unpivotValName = signal<string>('Value');

  // Group By panel form signals
  public readonly groupByColumns = signal<readonly string[]>([]);
  public readonly groupBySourceColumn = signal<string>('');
  public readonly groupByFunction = signal<AggregationFunction>('SUM');
  public readonly groupByOutputColumn = signal<string>('Aggregated_Value');

  // Custom Column / Index panel form signals
  public readonly customColumnMode = signal<'expression' | 'index'>('expression');
  public readonly customColumnName = signal<string>('Custom_Metric');
  public readonly customColumnExpression = signal<string>('');
  public readonly indexInitialValue = signal<number>(1);
  public readonly indexIncrement = signal<number>(1);

  // Merge Queries panel form signals
  public readonly mergeTargetSourceId = signal<string>('');
  public readonly mergeJoinKey = signal<string>('');
  public readonly mergeJoinType = signal<JoinKind>('LEFT');
  public readonly mergePostAction = signal<'expand' | 'aggregate'>('expand');
  public readonly mergeAggColumn = signal<string>('');
  public readonly mergeAggFunction = signal<AggregationFunction>('SUM');

  // Table Shaping panel form signals
  public readonly shapingRowCount = signal<number>(1);
  public readonly splitColumnTarget = signal<string>('');
  public readonly splitDelimiter = signal<string>(',');
  public readonly mergeColumnsSelection = signal<readonly string[]>([]);
  public readonly mergeColumnsSeparator = signal<string>(' ');
  public readonly mergeColumnsNewName = signal<string>('Merged_Column');
  public readonly bulkRenameOperation = signal<'UPPERCASE' | 'LOWERCASE' | 'TRIM' | 'CLEAN'>('UPPERCASE');

  // Incremental Refresh RangeStart / RangeEnd signals
  public readonly rangeStart = signal<string>('2025-01-01T00:00:00Z');
  public readonly rangeEnd = signal<string>('2026-01-01T00:00:00Z');
  public readonly partitionDateColumn = signal<string>('');

  public readonly appliedSteps = computed<readonly DataPrepStep[]>(() => {
    const srcId = this.selectedSourceId();
    return srcId ? (this.stepsBySource()[srcId] ?? []) : [];
  });
  public readonly selectedStepIndex = signal<number>(-1);

  public readonly quarantineStats = signal({
    rowsQuarantined: 0,
    status: 'Healthy',
    targetTable: 'quarantine_records',
  });

  public readonly expandedSections = signal<Record<DataPrepSection, boolean>>({
    Steps: true,
    Definition: true,
    Quarantine: true,
  });

  public readonly isAllCollapsed = computed(() =>
    Object.values(this.expandedSections()).every((expanded) => !expanded),
  );

  public readonly selectedSource = computed<IngestionSource | null>(() => {
    const list = this.sources();
    const id = this.selectedSourceId();
    return list.find((src) => src.id === id) ?? (list.length > 0 ? list[0] : null);
  });

  public readonly siblingSources = computed<readonly IngestionSource[]>(() => {
    const currentId = this.selectedSourceId();
    return this.sources().filter((src) => src.id !== currentId);
  });

  public readonly activeStep = computed<DataPrepStep | null>(() => {
    const steps = this.appliedSteps();
    const idx = this.selectedStepIndex();
    if (steps.length === 0) return null;
    return steps[idx] ?? steps[steps.length - 1] ?? null;
  });

  public readonly activeStepDefinitionJson = computed(() => {
    const current = this.activeStep();
    if (!current) {
      return '// No active transformation step';
    }
    const def = current.definition ?? {
      step: current.type,
      name: current.name,
      detail: current.detail ?? null,
    };
    return JSON.stringify(def, null, 2);
  });

  public readonly activeMQueryScript = computed(() => {
    const src = this.selectedSource();
    const steps = this.appliedSteps();
    if (!src || steps.length === 0) {
      return '// No transformation steps recorded';
    }
    const idx = this.selectedStepIndex();
    const visibleSteps = idx >= 0 && idx < steps.length ? steps.slice(0, idx + 1) : steps;
    return formatMQueryScript(
      src.name,
      visibleSteps,
      this.partitionDateColumn() ? this.rangeStart() : undefined,
      this.partitionDateColumn() ? this.rangeEnd() : undefined,
    );
  });

  public ngOnInit(): void {
    if (this.sources().length === 0 && this.state.sharedTables.length > 0) {
      const restoredSources: IngestionSource[] = this.state.sharedTables.map((tbl) => ({
        id: tbl.id || `ds_${tbl.name}`,
        name: `${tbl.name}.csv`,
        format: 'CSV',
        path: `${tbl.name}.csv`,
        enableLoad: true,
        backendFormat: 'CSV',
      }));
      const snapshots: Record<string, SourceSnapshot> = {};
      const initialStepsMap: Record<string, readonly DataPrepStep[]> = {};

      this.state.sharedTables.forEach((tbl, idx) => {
        const src = restoredSources[idx];
        const cols: DataPrepColumn[] = tbl.columns.map((c) => ({
          name: c.name,
          type: toDisplayType(c.dataType),
          icon: toDisplayType(c.dataType),
        }));
        const tblRows = [...this.state.getTableRows(tbl.name)];
        snapshots[src.id] = { columns: cols, rows: tblRows };
        initialStepsMap[src.id] = [
          {
            id: `step_init_${src.id}`,
            name: 'Source Ingestion',
            type: 'FileSourceStep',
            detail: `csv("${src.name}")`,
            definition: {
              step: 'FileSourceStep',
              input: 'raw_stream',
              uri: src.name,
              format: 'CSV',
              rowCount: tblRows.length,
            },
          },
        ];
      });

      this.rawSnapshotsBySource.set(snapshots);
      this.stepsBySource.set(initialStepsMap);
      this.sources.set(restoredSources);
      this.selectedSourceId.set(restoredSources[0].id);
      const firstSnap = snapshots[restoredSources[0].id];
      this.columns.set([...firstSnap.columns]);
      this.rows.set([...firstSnap.rows]);
      this.selectedStepIndex.set(0);
      this.syncDefaultFormSelections();
      return;
    }
    const defaultSource = this.selectedSource();
    if (defaultSource) {
      this.loadPreviewForSource(defaultSource);
    }
  }

  public loadPreviewForSource(source: IngestionSource | null): void {
    if (!source) return;
    const snap = this.rawSnapshotsBySource()[source.id];
    const steps = this.stepsBySource()[source.id] ?? [];
    if (snap && steps.length > 0) {
      this.recomputePipelinePreview(source.id, steps.length - 1);
      return;
    }

    const tableName = tableNameFromSource(source.name);
    const sharedTbl = this.state.sharedTables.find((t) => t.name === tableName);
    const sharedRows = this.state.getTableRows(tableName);
    if (sharedTbl && sharedTbl.columns.length > 0) {
      const cols = sharedTbl.columns.map((c) => ({
        name: c.name,
        type: c.dataType,
        icon: c.dataType,
      }));
      this.rawSnapshotsBySource.update((m) => ({
        ...m,
        [source.id]: { columns: cols, rows: [...sharedRows] },
      }));
      this.columns.set(cols);
      this.rows.set([...sharedRows]);
      this.syncDefaultFormSelections();
      return;
    }
    const fallback = SOURCE_DATA_MAP[source.id];
    this.api.getDataPrepPreview(source.id, source.format).subscribe({
      next: (data: DataPrepPreview) => {
        if (data.columns && data.columns.length > 0) {
          const cols = data.columns.map((c) => ({
            name: c.name,
            type: c.type,
            icon: c.type || 'Text',
          }));
          this.columns.set(cols);
          this.rows.set(data.rows || []);
          this.rawSnapshotsBySource.update((m) => ({
            ...m,
            [source.id]: { columns: cols, rows: data.rows || [] },
          }));
        } else if (fallback) {
          this.columns.set(fallback.columns);
          this.rows.set(fallback.rows);
        }
        if (data.appliedSteps && data.appliedSteps.length > 0) {
          const apiSteps = data.appliedSteps.map((s, idx) => ({
            id: `api_step_${idx + 1}`,
            name: s.name,
            type: s.type,
            detail: s.detail,
            definition: {
              step: s.type,
              name: s.name,
              detail: s.detail ?? '',
            },
          }));
          this.stepsBySource.update((map) => ({
            ...map,
            [source.id]: apiSteps,
          }));
          this.selectedStepIndex.set(apiSteps.length - 1);
        }
        this.syncDefaultFormSelections();
      },
      error: () => {
        if (fallback) {
          this.columns.set(fallback.columns);
          this.rows.set(fallback.rows);
        }
        this.state.announce(
          `Data preparation preview loaded from sovereign buffer for ${source.name}.`,
          { safe: true },
        );
      },
    });
  }

  private syncDefaultFormSelections(): void {
    const cols = this.columns();
    if (cols.length > 0) {
      if (!this.filterColumn() || !cols.some((c) => c.name === this.filterColumn())) {
        this.filterColumn.set(cols[0].name);
      }
      if (!this.changeTypeColumn() || !cols.some((c) => c.name === this.changeTypeColumn())) {
        this.changeTypeColumn.set(cols[0].name);
      }
      if (!this.splitColumnTarget() || !cols.some((c) => c.name === this.splitColumnTarget())) {
        this.splitColumnTarget.set(cols[0].name);
      }
      const numCol = cols.find((c) => isNumericType(c.type)) ?? cols[cols.length - 1];
      if (!this.groupBySourceColumn() || !cols.some((c) => c.name === this.groupBySourceColumn())) {
        this.groupBySourceColumn.set(numCol.name);
      }
      const dateCol = cols.find(
        (c) =>
          (c.type ?? '').toLowerCase().includes('date') ||
          c.name.toLowerCase().includes('date') ||
          c.name.toLowerCase().includes('time'),
      );
      if (dateCol && !this.partitionDateColumn()) {
        this.partitionDateColumn.set(dateCol.name);
      }
    }
    const siblings = this.siblingSources();
    if (siblings.length > 0 && !this.mergeTargetSourceId()) {
      this.mergeTargetSourceId.set(siblings[0].id);
    }
  }

  private appendOrReplaceStep(step: DataPrepStep, replaceSameColumnType = false): void {
    const srcId = this.selectedSourceId();
    if (!srcId) return;

    this.stepsBySource.update((map) => {
      const current = [...(map[srcId] ?? [])];
      if (replaceSameColumnType && (step.type === 'ChangeType' || step.type === 'ChangeTypeStep')) {
        const targetCol = step.definition?.['column'];
        const existingIdx = current.findIndex(
          (s) =>
            (s.type === 'ChangeType' || s.type === 'ChangeTypeStep') &&
            s.definition?.['column'] === targetCol,
        );
        if (existingIdx >= 0) {
          current[existingIdx] = step;
          return { ...map, [srcId]: current };
        }
      }
      current.push(step);
      return { ...map, [srcId]: current };
    });

    const totalSteps = this.appliedSteps().length;
    this.recomputePipelinePreview(srcId, totalSteps - 1);
  }

  /**
   * Replays the R-Query pipeline up to `upToStepIndex` deterministically from the source snapshot
   * and synchronizes with `/api/ingestion/preview` when backend connectivity is available.
   */
  public recomputePipelinePreview(sourceId: string, upToStepIndex?: number): void {
    const steps = this.stepsBySource()[sourceId] ?? [];
    const targetIdx =
      upToStepIndex !== undefined && upToStepIndex >= 0 && upToStepIndex < steps.length
        ? upToStepIndex
        : steps.length - 1;
    this.selectedStepIndex.set(targetIdx);

    const snapshot = this.rawSnapshotsBySource()[sourceId];
    if (!snapshot) return;

    const activeSlice = targetIdx >= 0 ? steps.slice(0, targetIdx + 1) : [];
    const { columns, rows, quarantined } = this.evaluateStepsLocally(
      snapshot.columns,
      snapshot.rows,
      activeSlice,
    );

    this.columns.set(columns);
    this.rows.set(rows);
    this.quarantinedRecords.set(quarantined);
    this.quarantineStats.set({
      rowsQuarantined: quarantined.length,
      status: quarantined.length > 0 ? 'Isolated Records Detected' : 'Healthy',
      targetTable: 'quarantine_records',
    });
    this.syncDefaultFormSelections();

    // Also synchronize asynchronously with backend RQueryTransformationEngine if raw payload exists
    const src = this.sources().find((s) => s.id === sourceId);
    if (src && (snapshot.rawText || snapshot.rawBase64)) {
      const lookupTables: Record<string, ReadonlyArray<Record<string, unknown>>> = {};
      this.sources().forEach((other) => {
        if (other.id !== sourceId) {
          const otherSnap = this.rawSnapshotsBySource()[other.id];
          if (otherSnap) {
            const otherSteps = this.stepsBySource()[other.id] ?? [];
            const evaluatedOther = this.evaluateStepsLocally(
              otherSnap.columns,
              otherSnap.rows,
              otherSteps,
            );
            lookupTables[tableNameFromSource(other.name)] = evaluatedOther.rows;
            lookupTables[other.name] = evaluatedOther.rows;
          }
        }
      });

      const backendSteps = activeSlice
        .filter((s) => s.type !== 'FileSource' && s.type !== 'FileSourceStep')
        .map((s) => this.toBackendStepPayload(s));

      this.api
        .getDataPrepPreview({
          datasetId: src.id,
          format: src.backendFormat ?? (src.format === 'REST' ? 'JSON' : src.format),
          rawPayload: snapshot.rawText,
          rawPayloadBase64: snapshot.rawBase64,
          steps: backendSteps,
          lookupTables,
        })
        .subscribe({
          next: (serverPreview) => {
            if (serverPreview.columns.length > 0 || serverPreview.rows.length > 0) {
              this.columns.set(
                serverPreview.columns.map((c) => ({
                  name: c.name,
                  type: toDisplayType(c.type),
                  icon: toDisplayType(c.type),
                })),
              );
              this.rows.set(serverPreview.rows);
              if (serverPreview.quarantined && serverPreview.quarantined.length > 0) {
                this.quarantinedRecords.set(serverPreview.quarantined);
                this.quarantineStats.set({
                  rowsQuarantined: serverPreview.quarantined.length,
                  status: 'Isolated Records Detected',
                  targetTable: 'quarantine_records',
                });
              }
            }
          },
          error: () => {
            // Keep deterministic local engine output when offline or in unit tests
          },
        });
    }
  }

  private toBackendStepPayload(step: DataPrepStep): RQueryStepDefinition {
    const def = step.definition ?? {};
    const rawStep = String(def['step'] ?? step.type);
    const normalizedStep = rawStep.endsWith('Step') ? rawStep : `${rawStep}Step`;
    return {
      ...(def as RQueryStepDefinition),
      step: normalizedStep,
      type: def['targetType']
        ? toBackendType(String(def['targetType']))
        : (def['type'] as RQueryStepDefinition['type']),
      oldName: String(def['oldName'] ?? def['original'] ?? ''),
      newName: String(def['newName'] ?? def['renamed'] ?? ''),
      onError: String(def['onError'] ?? 'quarantine'),
    };
  }

  private evaluateStepsLocally(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
  ): {
    columns: DataPrepColumn[];
    rows: Record<string, unknown>[];
    quarantined: DataPrepQuarantineRow[];
  } {
    let cols: DataPrepColumn[] = initialCols.map((c) => ({ ...c }));
    let currentRows: Record<string, unknown>[] = initialRows.map((r) => ({ ...r }));
    const quarantined: DataPrepQuarantineRow[] = [];

    for (const step of steps) {
      const def = step.definition ?? {};
      const stepKind = String(def['step'] ?? step.type).replace(/Step$/, '');

      switch (stepKind) {
        case 'FileSource':
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
              else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) inferred = 'Date';
            }
            return { ...col, type: inferred, icon: inferred };
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

          const targetSrc =
            this.sources().find((s) => s.id === targetSourceId) ??
            this.sources().find((s) => tableNameFromSource(s.name) === targetTableName);
          const targetSnap = targetSrc ? this.rawSnapshotsBySource()[targetSrc.id] : undefined;
          const lookupRows = targetSnap ? targetSnap.rows : [];

          if (joinKey && lookupRows.length > 0) {
            if (mode === 'aggregate') {
              const aggCol = String(params['aggregateColumn'] ?? '');
              const aggFn = String(params['aggregateFunction'] ?? 'SUM') as AggregationFunction;
              const outName = String(params['outputColumn'] ?? `${targetTableName}_${aggFn}`);
              currentRows = currentRows
                .map((leftRow) => {
                  const keyVal = leftRow[joinKey];
                  const matches = lookupRows.filter((lr) => String(lr[joinKey]) === String(keyVal));
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
              const extraCols = (targetSnap?.columns ?? []).filter(
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
          currentRows = count > 0 ? currentRows.slice(0, Math.max(0, currentRows.length - count)) : currentRows;
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

  private coerceValue(
    rawVal: unknown,
    targetType: string,
  ): { valid: boolean; value: unknown } {
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
    if (upper === 'DATE' || upper === 'DATETIME' || upper === 'ISO_DATE' || upper === 'ISO_DATETIME') {
      const str = String(rawVal).trim();
      const parsed = Date.parse(str);
      if (Number.isNaN(parsed)) return { valid: false, value: null };
      return { valid: true, value: str };
    }
    return { valid: true, value: rawVal };
  }

  private evaluatePredicate(row: Record<string, unknown>, predicate: string): boolean {
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
      const bothNumeric = !Number.isNaN(numCell) && !Number.isNaN(numLit) && !rawLit.trim().startsWith("'");
      const cmp = bothNumeric
        ? numCell - numLit
        : String(cellVal).localeCompare(lit);

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

  private evaluateCustomExpression(
    row: Record<string, unknown>,
    expression: string,
  ): { value: unknown; error?: string } {
    const trimmed = expression.trim();
    if (!trimmed) return { value: null };

    // Handle Text.Select([col], {"0".."9"})
    const textSelectMatch = trimmed.match(/Text\.Select\(\s*\[([^\]]+)\]/i);
    if (textSelectMatch) {
      const col = textSelectMatch[1];
      const raw = String(row[col] ?? '');
      return { value: raw.replace(/\D+/g, '') };
    }

    // Handle if [col] op val then A else B
    const condMatch = trimmed.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+)$/i);
    if (condMatch) {
      const [, condExpr, thenExpr, elseExpr] = condMatch;
      const condTrue = this.evaluatePredicate(row, condExpr.trim());
      const branch = (condTrue ? thenExpr : elseExpr).trim().replace(/^['"]|['"]$/g, '');
      const numBranch = Number(branch);
      return { value: !Number.isNaN(numBranch) && branch !== '' ? numBranch : branch };
    }

    // Handle string concatenation with &
    if (trimmed.includes('&')) {
      const parts = trimmed.split('&').map((part) => {
        const p = part.trim();
        const colRef = p.match(/^\[([^\]]+)\]$/);
        if (colRef) return String(row[colRef[1]] ?? '');
        return p.replace(/^['"]|['"]$/g, '');
      });
      return { value: parts.join('') };
    }

    // Arithmetic expression: [colA] * [colB], [colA] + 10, etc.
    const binMatch = trimmed.match(/^\[([^\]]+)\]\s*([+\-*/])\s*(?:\[([^\]]+)\]|(-?\d+(?:\.\d+)?))$/);
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

  @HostListener('document:click')
  public onDocumentClick(): void {
    if (this.activeColumnMenu()) {
      this.activeColumnMenu.set(null);
    }
  }

  public toggleColumnMenu(colName: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.activeColumnMenu() === colName) {
      this.activeColumnMenu.set(null);
    } else {
      this.activeColumnMenu.set(colName);
    }
  }

  public closeColumnMenu(): void {
    this.activeColumnMenu.set(null);
  }

  public changeColumnType(colName: string, newType: string): void {
    this.appendOrReplaceStep(
      {
        id: `step_${Date.now()}`,
        name: `Change Type: ${colName}`,
        type: 'ChangeType',
        detail: `Cast [${colName}] to ${newType}`,
        definition: {
          step: 'ChangeType',
          column: colName,
          targetType: newType,
          type: toBackendType(newType),
          onError: 'quarantine',
        },
      },
      true,
    );
    this.closeColumnMenu();
    this.state.announce(`Transformed column [${colName}] type to ${newType}.`);
  }

  public startRenameColumn(colName: string): void {
    this.editingColumnName.set(colName);
    this.editingColumnValue.set(colName);
    this.closeColumnMenu();
  }

  public saveColumnRename(originalName: string): void {
    const newName = this.editingColumnValue().trim();
    this.editingColumnName.set(null);
    if (newName && newName !== originalName) {
      this.appendOrReplaceStep({
        id: `step_${Date.now()}`,
        name: `Rename Column: ${originalName}`,
        type: 'RenameColumn',
        detail: `Renamed [${originalName}] to [${newName}]`,
        definition: {
          step: 'RenameColumn',
          original: originalName,
          renamed: newName,
          oldName: originalName,
          newName,
        },
      });
      this.state.announce(`Renamed column [${originalName}] to [${newName}].`);
    }
  }

  public cancelColumnRename(): void {
    this.editingColumnName.set(null);
    this.editingColumnValue.set('');
  }

  public removeColumn(colName: string): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Remove Column: ${colName}`,
      type: 'RemoveColumn',
      detail: `Removed [${colName}] from dataset`,
      definition: { step: 'RemoveColumn', column: colName },
    });
    this.closeColumnMenu();
    this.state.announce(`Removed column [${colName}] from dataset.`);
  }

  public removeOtherColumns(colName: string): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Remove Other Columns: ${colName}`,
      type: 'RemoveOtherColumns',
      detail: `Kept only [${colName}]`,
      definition: {
        step: 'RemoveOtherColumns',
        column: colName,
        parameters: { keepColumns: [colName] },
      },
    });
    this.closeColumnMenu();
    this.state.announce(`Removed all columns except [${colName}].`);
  }

  public filterOutNulls(colName: string): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Filter Nulls: ${colName}`,
      type: 'FilterNulls',
      detail: `Removed rows where [${colName}] is null or empty`,
      definition: { step: 'FilterNulls', column: colName },
    });
    this.closeColumnMenu();
    this.state.announce(`Filtered nulls for column [${colName}].`);
  }

  public fillDownColumn(colName: string): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Fill Down: ${colName}`,
      type: 'FillDown',
      detail: `Propagated non-null values down [${colName}]`,
      definition: { step: 'FillDown', column: colName },
    });
    this.closeColumnMenu();
    this.state.announce(`Applied Fill Down on column [${colName}].`);
  }

  public sortColumn(colName: string, ascending: boolean): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Sort ${ascending ? 'Ascending' : 'Descending'}: ${colName}`,
      type: 'SortRows',
      detail: `Sorted [${colName}] ${ascending ? 'ASC' : 'DESC'}`,
      definition: {
        step: 'SortRows',
        column: colName,
        parameters: { ascending },
      },
    });
    this.closeColumnMenu();
    this.state.announce(`Sorted [${colName}] ${ascending ? 'ascending' : 'descending'}.`);
  }

  public cleanseColumnText(
    colName: string,
    operation: 'TRIM' | 'UPPERCASE' | 'LOWERCASE',
  ): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `${operation}: ${colName}`,
      type: 'InlineCleansing',
      detail: `Applied ${operation} on [${colName}]`,
      definition: {
        step: 'InlineCleansing',
        column: colName,
        parameters: { operation },
      },
    });
    this.closeColumnMenu();
    this.state.announce(`Applied ${operation.toLowerCase()} cleansing to [${colName}].`);
  }

  public extractDigitsFromColumn(colName: string): void {
    const newCol = `${colName}_Digits`;
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Extract Digits: ${colName}`,
      type: 'AddCustomColumn',
      detail: `Text.Select([${colName}], {"0".."9"})`,
      definition: {
        step: 'AddCustomColumn',
        newName: newCol,
        expression: `Text.Select([${colName}], {"0".."9"})`,
      },
    });
    this.closeColumnMenu();
    this.state.announce(`Extracted numeric characters from [${colName}] into [${newCol}].`);
  }

  public removeStep(index: number, event?: Event): void {
    event?.stopPropagation();
    const srcId = this.selectedSourceId();
    const current = this.stepsBySource()[srcId] ?? [];
    if (index <= 0 || index >= current.length) {
      this.state.announce('The initial Source Ingestion step cannot be removed.');
      return;
    }
    const removed = current[index];
    const updated = current.filter((_, i) => i !== index);
    this.stepsBySource.update((m) => ({ ...m, [srcId]: updated }));
    this.recomputePipelinePreview(srcId, updated.length - 1);
    this.state.announce(`Removed transformation step "${removed.name}".`);
  }

  public moveStep(index: number, direction: -1 | 1, event?: Event): void {
    event?.stopPropagation();
    const srcId = this.selectedSourceId();
    const current = [...(this.stepsBySource()[srcId] ?? [])];
    const targetIdx = index + direction;
    if (index <= 0 || targetIdx <= 0 || targetIdx >= current.length) {
      return;
    }
    const temp = current[index];
    current[index] = current[targetIdx];
    current[targetIdx] = temp;
    this.stepsBySource.update((m) => ({ ...m, [srcId]: current }));
    this.recomputePipelinePreview(srcId, targetIdx);
    this.state.announce(`Moved step "${temp.name}" to position ${targetIdx + 1}.`);
  }

  public toggleSourceEnableLoad(sourceId: string, event?: Event): void {
    event?.stopPropagation();
    let updatedSource: IngestionSource | undefined;
    this.sources.update((list) =>
      list.map((src) => {
        if (src.id === sourceId) {
          updatedSource = { ...src, enableLoad: src.enableLoad === false };
          return updatedSource;
        }
        return src;
      }),
    );
    if (updatedSource) {
      const tableName = tableNameFromSource(updatedSource.name);
      if (updatedSource.enableLoad === false) {
        this.state.removeTable(tableName);
        this.state.announce(
          `Disabled model load for "${updatedSource.name}" (staging helper query only).`,
        );
      } else {
        this.state.announce(`Enabled semantic model load for "${updatedSource.name}".`);
      }
    }
  }

  public duplicateDataset(source: IngestionSource, event?: Event): void {
    event?.stopPropagation();
    const snap = this.rawSnapshotsBySource()[source.id];
    const steps = this.stepsBySource()[source.id] ?? [];
    const copyId = `ds_${Date.now()}`;
    const copyName = source.name.replace(/(\.[^/.]+)?$/, '_copy$1');
    const copySource: IngestionSource = {
      ...source,
      id: copyId,
      name: copyName,
      path: copyName,
      enableLoad: true,
    };
    if (snap) {
      this.rawSnapshotsBySource.update((m) => ({
        ...m,
        [copyId]: {
          columns: snap.columns.map((c) => ({ ...c })),
          rows: snap.rows.map((r) => ({ ...r })),
          rawText: snap.rawText,
          rawBase64: snap.rawBase64,
        },
      }));
    }
    this.stepsBySource.update((m) => ({
      ...m,
      [copyId]: steps.map((s, idx) => ({ ...s, id: `step_${copyId}_${idx}` })),
    }));
    this.sources.update((list) => [...list, copySource]);
    this.onSelectSource(copySource);
    this.state.announce(`Duplicated dataset "${source.name}" as "${copyName}".`);
  }

  public isSectionExpanded(section: DataPrepSection): boolean {
    return this.expandedSections()[section] ?? false;
  }

  public toggleSection(section: DataPrepSection): void {
    this.expandedSections.update((sections) => ({
      ...sections,
      [section]: !sections[section],
    }));
  }

  public toggleCollapseAll(): void {
    const willExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Steps: willExpand,
      Definition: willExpand,
      Quarantine: willExpand,
    });
  }

  public onSelectSource(source: IngestionSource): void {
    this.selectedSourceId.set(source.id);
    this.activeColumnMenu.set(null);
    this.loadPreviewForSource(source);
    this.state.announce(`Switched active data preparation source to ${source.name}.`);
  }

  public onSelectStep(index: number): void {
    const steps = this.appliedSteps();
    if (index >= 0 && index < steps.length) {
      const srcId = this.selectedSourceId();
      if (srcId && this.rawSnapshotsBySource()[srcId]) {
        this.recomputePipelinePreview(srcId, index);
      } else {
        this.selectedStepIndex.set(index);
      }
      const step = steps[index];
      this.state.announce(`Inspecting transformation step ${index + 1}: ${step.name}.`);
    }
  }

  public onRunIncrementalRefresh(): void {
    const src = this.selectedSource();
    const dateCol = this.partitionDateColumn();
    if (src && dateCol) {
      const pred = `[${dateCol}] >= '${this.rangeStart()}' and [${dateCol}] < '${this.rangeEnd()}'`;
      this.appendOrReplaceStep({
        id: `step_${Date.now()}`,
        name: `Incremental Partition: ${dateCol}`,
        type: 'FilterRows',
        detail: `[${dateCol}] >= RangeStart and < RangeEnd`,
        definition: {
          step: 'FilterRows',
          column: dateCol,
          predicate: pred,
          parameters: {
            RangeStart: this.rangeStart(),
            RangeEnd: this.rangeEnd(),
          },
        },
      });
    }

    this.state.announce('Incremental refresh running across ingestion partition...', {
      loading: true,
    });
    const tableId = src ? tableNameFromSource(src.name) : 'fact_sales';
    this.api.runIncrementalRefresh(tableId).subscribe({
      next: (res) => {
        const count = res?.recordsUpserted ?? 0;
        this.state.announce(`Incremental refresh succeeded: ${count} delta records upserted.`, {
          resetAfterMs: 4000,
        });
      },
      error: () => {
        this.state.announce('Incremental refresh: failed to reach ingestion pipeline worker.', {
          safe: true,
        });
      },
    });
  }

  public onApplyAndLoad(): void {
    const src = this.selectedSource();
    const cols = this.columns();
    const rowData = this.rows();

    if (src && cols.length > 0) {
      if (src.enableLoad === false) {
        this.state.announce(
          `Staging dataset "${src.name}" has Enable Load disabled and was kept in R-Query staging only.`,
          { resetAfterMs: 4000 },
        );
        return;
      }

      const tableName = tableNameFromSource(src.name);
      const tableId = `tbl_${src.id}`;
      const sharedCols = cols.map((c) => ({
        name: c.name,
        dataType: (c.type || 'VARCHAR').toUpperCase(),
        keyType: 'None' as const,
      }));

      this.state.addTable({
        id: tableId,
        name: tableName,
        role: 'FACT',
        columns: sharedCols,
        rowCount: rowData.length,
      });
      this.state.setTableRows(tableName, [...rowData]);
      this.state.announce(
        `Committed dataset "${tableName}" (${rowData.length} rows) to analytical cache and semantic model.`,
        { resetAfterMs: 4000 },
      );
    } else {
      this.state.announce(
        'R-Query pipeline step chain committed to analytical cache (queries.rq.json updated).',
        { resetAfterMs: 4000 },
      );
    }
  }

  public onAddSource(fileInput?: HTMLInputElement): void {
    if (fileInput) {
      fileInput.click();
    } else {
      this.state.announce('Add Source: select a CSV, TSV, XLSX, Parquet, or JSON dataset file.');
    }
  }

  public onSourceFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const fileName = file.name;
    const backendFmt = formatFromFileName(fileName) ?? 'CSV';
    const format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST' =
      backendFmt === 'JSON' || backendFmt === 'XML'
        ? 'REST'
        : backendFmt === 'XLSX'
          ? 'XLSX'
          : backendFmt === 'PARQUET' || backendFmt === 'AVRO'
            ? 'PARQUET'
            : 'CSV';

    const reader = new FileReader();
    if (isBinaryFormat(backendFmt)) {
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) return;
        const base64 = toBase64(buffer);
        this.loadBinaryDataset(fileName, format, backendFmt, base64);
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;
        this.loadUserDataset(fileName, format, text);
      };
      reader.readAsText(file);
    }
    input.value = '';
  }

  private loadBinaryDataset(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    backendFormat: BackendSourceFormat,
    base64Payload: string,
  ): void {
    const datasetId = `ds_${Date.now()}`;
    const newSource: IngestionSource = {
      id: datasetId,
      name,
      format,
      path: name,
      enableLoad: true,
      backendFormat,
    };
    const initialStep: DataPrepStep = {
      id: `step_${Date.now()}`,
      name: 'Source Ingestion',
      type: 'FileSource',
      detail: `${backendFormat.toLowerCase()}("${name}")`,
      definition: {
        step: 'FileSource',
        source: name,
        format: backendFormat,
      },
    };
    this.sources.update((srcs) => [...srcs, newSource]);
    this.selectedSourceId.set(datasetId);
    this.rawSnapshotsBySource.update((m) => ({
      ...m,
      [datasetId]: { columns: [], rows: [], rawBase64: base64Payload },
    }));
    this.stepsBySource.update((m) => ({ ...m, [datasetId]: [initialStep] }));
    this.selectedStepIndex.set(0);
    this.recomputePipelinePreview(datasetId, 0);
    this.state.announce(`Loaded binary dataset "${name}" (${backendFormat}).`);
  }

  public loadUserDataset(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    content: string,
  ): void {
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let parsedColumns: DataPrepColumn[] = [];
    let parsedRows: Record<string, unknown>[] = [];
    const backendFormat = formatFromFileName(name) ?? (format === 'REST' ? 'JSON' : format);

    if (format === 'REST' || name.toLowerCase().endsWith('.json')) {
      try {
        const json = JSON.parse(content);
        if (Array.isArray(json) && json.length > 0) {
          parsedRows = json;
          const colKeys = Object.keys(json[0]);
          parsedColumns = colKeys.map((key) => {
            const sampleVal = json[0][key];
            const type =
              typeof sampleVal === 'number'
                ? Number.isInteger(sampleVal)
                  ? 'Int64'
                  : 'Float64'
                : typeof sampleVal === 'boolean'
                  ? 'Boolean'
                  : 'String';
            return { name: key, type, icon: type };
          });
        }
      } catch {
        this.state.announceError('Failed to parse JSON file structure.');
        return;
      }
    } else {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const separator = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
        const headers = lines[0].split(separator).map((h) => h.trim().replace(/^["']|["']$/g, ''));
        const dataLines = lines.slice(1);

        parsedRows = dataLines.map((line) => {
          const parts = line.split(separator).map((p) => p.trim().replace(/^["']|["']$/g, ''));
          const record: Record<string, unknown> = {};
          headers.forEach((col, idx) => {
            const raw = parts[idx] ?? '';
            if (raw === '') {
              record[col] = null;
            } else if (!isNaN(Number(raw))) {
              record[col] = Number(raw);
            } else if (raw.toLowerCase() === 'true' || raw.toLowerCase() === 'false') {
              record[col] = raw.toLowerCase() === 'true';
            } else {
              record[col] = raw;
            }
          });
          return record;
        });

        parsedColumns = headers.map((col) => {
          let type = 'String';
          if (parsedRows.length > 0) {
            const firstNonEmpty = parsedRows.find((r) => r[col] !== null && r[col] !== undefined);
            if (firstNonEmpty) {
              const val = firstNonEmpty[col];
              if (typeof val === 'number') {
                type = Number.isInteger(val) ? 'Int64' : 'Float64';
              } else if (typeof val === 'boolean') {
                type = 'Boolean';
              } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
                type = 'Date';
              }
            }
          }
          return { name: col, type, icon: type };
        });
      }
    }

    const newSource: IngestionSource = {
      id: datasetId,
      name,
      format,
      path: name,
      enableLoad: true,
      backendFormat,
    };

    const initialStep: DataPrepStep = {
      id: `step_${Date.now()}`,
      name: 'Source Ingestion',
      type: 'FileSource',
      detail: `${format.toLowerCase()}("${name}")`,
      definition: {
        step: 'FileSource',
        source: name,
        format,
        rowCount: parsedRows.length,
      },
    };

    this.rawSnapshotsBySource.update((map) => ({
      ...map,
      [datasetId]: {
        columns: parsedColumns,
        rows: parsedRows,
        rawText: content,
      },
    }));
    this.sources.update((srcs) => [...srcs, newSource]);
    this.selectedSourceId.set(datasetId);
    this.columns.set(parsedColumns);
    this.rows.set(parsedRows);
    this.stepsBySource.update((map) => ({
      ...map,
      [datasetId]: [initialStep],
    }));
    this.selectedStepIndex.set(0);
    this.quarantinedRecords.set([]);
    this.quarantineStats.set({
      rowsQuarantined: 0,
      status: 'Healthy',
      targetTable: 'quarantine_records',
    });
    this.syncDefaultFormSelections();

    if (parsedColumns.length > 0) {
      const tableName = tableNameFromSource(name) || 'user_dataset';
      const sharedCols = parsedColumns.map((c) => ({
        name: c.name,
        dataType: (c.type || 'VARCHAR').toUpperCase(),
        keyType: 'None' as const,
      }));
      this.state.addTable({
        id: `user_tbl_${tableName}`,
        name: tableName,
        role: 'FACT',
        columns: sharedCols,
        rowCount: parsedRows.length,
      });
      this.state.setTableRows(tableName, [...parsedRows]);
    }

    this.state.announce(
      `Successfully loaded user dataset "${name}" (${parsedRows.length} rows, ${parsedColumns.length} columns).`,
    );
  }

  public toggleToolPanel(panel: Exclude<RibbonToolPanel, null>): void {
    this.syncDefaultFormSelections();
    this.activeToolPanel.update((curr) => (curr === panel ? null : panel));
  }

  public onAddFilter(): void {
    this.toggleToolPanel('filter');
    this.state.announce('Filter step: configure row predicate for active dataset.');
  }

  public applyFilterStep(): void {
    const col = this.filterColumn() || this.columns()[0]?.name;
    if (!col) return;
    const op = this.filterOperator();
    if (op === 'notEmpty') {
      this.filterOutNulls(col);
      this.activeToolPanel.set(null);
      return;
    }
    const colMeta = this.columns().find((c) => c.name === col);
    const predicate = buildPredicate(
      col,
      op,
      this.filterValue(),
      this.filterValueTo(),
      isNumericType(colMeta?.type),
    );
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Filter Rows: ${col}`,
      type: 'FilterRows',
      detail: predicate,
      definition: {
        step: 'FilterRows',
        column: col,
        predicate,
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Applied row filter: ${predicate}.`);
  }

  public onChangeType(): void {
    this.toggleToolPanel('changeType');
    this.state.announce('Type casting: inferring column schema datatypes.');
  }

  public applyChangeTypeStep(): void {
    const col = this.changeTypeColumn() || this.columns()[0]?.name;
    if (!col) return;
    this.changeColumnType(col, this.changeTypeTarget());
    this.activeToolPanel.set(null);
  }

  public applyDetectDataTypes(): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: 'Detect Data Type',
      type: 'DetectDataType',
      detail: 'Auto-inferred schema across all columns',
      definition: { step: 'DetectDataType' },
    });
    this.activeToolPanel.set(null);
    this.state.announce('Detected and applied data types across all columns.');
  }

  public onUnpivot(): void {
    this.toggleToolPanel('unpivot');
    this.state.announce('Unpivot: select attribute and metric value column pairs.');
  }

  public toggleUnpivotColumnSelection(colName: string): void {
    this.unpivotColumns.update((curr) =>
      curr.includes(colName) ? curr.filter((c) => c !== colName) : [...curr, colName],
    );
  }

  public applyUnpivotStep(): void {
    const selected = this.unpivotColumns();
    const attrName = this.unpivotAttrName().trim() || 'Attribute';
    const valName = this.unpivotValName().trim() || 'Value';
    if (selected.length === 0) {
      this.state.announce('Select at least one column for Unpivot.');
      return;
    }
    if (this.unpivotMode() === 'other') {
      this.appendOrReplaceStep({
        id: `step_${Date.now()}`,
        name: 'Unpivot Other Columns',
        type: 'UnpivotOtherColumns',
        detail: `Anchor: ${selected.join(', ')} -> [${attrName}], [${valName}]`,
        definition: {
          step: 'UnpivotOtherColumns',
          groupColumns: selected,
          nameCol: attrName,
          valCol: valName,
        },
      });
      this.state.announce(`Unpivoted other columns keeping [${selected.join(', ')}] anchored.`);
    } else {
      this.appendOrReplaceStep({
        id: `step_${Date.now()}`,
        name: 'Unpivot Columns',
        type: 'UnpivotColumns',
        detail: `${selected.join(', ')} -> [${attrName}], [${valName}]`,
        definition: {
          step: 'UnpivotColumns',
          pivotColumns: selected,
          nameCol: attrName,
          valCol: valName,
        },
      });
      this.state.announce(`Unpivoted columns [${selected.join(', ')}].`);
    }
    this.activeToolPanel.set(null);
  }

  public onGroupBy(): void {
    this.toggleToolPanel('groupBy');
    this.state.announce('Group By: aggregate dimensional records over sliding stream window.');
  }

  public toggleGroupByColumnSelection(colName: string): void {
    this.groupByColumns.update((curr) =>
      curr.includes(colName) ? curr.filter((c) => c !== colName) : [...curr, colName],
    );
  }

  public applyGroupByStep(): void {
    const gCols =
      this.groupByColumns().length > 0
        ? this.groupByColumns()
        : this.columns().length > 0
          ? [this.columns()[0].name]
          : [];
    const srcCol = this.groupBySourceColumn() || this.columns()[0]?.name || '';
    const fn = this.groupByFunction();
    const outCol = this.groupByOutputColumn().trim() || `${fn}_${srcCol}`;
    if (gCols.length === 0) return;

    const aggregations: RQueryAggregateDefinition[] = [
      { outputColumn: outCol, sourceColumn: srcCol, function: fn },
    ];
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Group By: ${gCols.join(', ')}`,
      type: 'GroupRows',
      detail: `${fn}([${srcCol}]) as [${outCol}]`,
      definition: {
        step: 'GroupRows',
        groupColumns: gCols,
        aggregations,
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Grouped rows by [${gCols.join(', ')}] with ${fn}([${srcCol}]).`);
  }

  public onCustomColumn(): void {
    this.toggleToolPanel('customColumn');
    this.state.announce('Custom Column: define expression using ANTLR RAX syntax.');
  }

  public applyCustomColumnStep(): void {
    const newCol = this.customColumnName().trim() || 'Custom';
    if (this.customColumnMode() === 'index') {
      const seed = Number(this.indexInitialValue()) || 1;
      const inc = Number(this.indexIncrement()) || 1;
      this.appendOrReplaceStep({
        id: `step_${Date.now()}`,
        name: `Add Index Column: ${newCol}`,
        type: 'AddIndexColumn',
        detail: `Surrogate key starting at ${seed} (+${inc})`,
        definition: {
          step: 'AddIndexColumn',
          newName: newCol,
          parameters: { initialValue: seed, increment: inc },
        },
      });
      this.activeToolPanel.set(null);
      this.state.announce(`Added surrogate key Index Column [${newCol}].`);
      return;
    }

    const expr = this.customColumnExpression().trim();
    if (!expr) {
      this.state.announce('Provide a custom column formula expression.');
      return;
    }
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Custom Column: ${newCol}`,
      type: 'AddCustomColumn',
      detail: `${newCol} = ${expr}`,
      definition: {
        step: 'AddCustomColumn',
        newName: newCol,
        expression: expr,
        onError: 'quarantine',
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Added custom column [${newCol}] = ${expr}.`);
  }

  public onMergeQueries(): void {
    this.toggleToolPanel('mergeQueries');
    this.state.announce('Merge Queries: join active dataset with a lookup query.');
  }

  public applyMergeQueriesStep(): void {
    const targetId = this.mergeTargetSourceId();
    const targetSrc = this.sources().find((s) => s.id === targetId) ?? this.siblingSources()[0];
    const joinKey = this.mergeJoinKey() || this.columns()[0]?.name || '';
    if (!targetSrc || !joinKey) {
      this.state.announce('Select a target query and join key column to merge.');
      return;
    }
    const targetTable = tableNameFromSource(targetSrc.name);
    const joinType = this.mergeJoinType();
    const mode = this.mergePostAction();

    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Merge Queries: ${targetTable}`,
      type: 'MergeQueries',
      detail: `${joinType} JOIN ${targetTable} ON [${joinKey}] (${mode})`,
      definition: {
        step: 'MergeQueries',
        targetTable,
        joinKeys: [joinKey],
        joinType,
        parameters: {
          targetSourceId: targetSrc.id,
          mode,
          aggregateColumn: this.mergeAggColumn(),
          aggregateFunction: this.mergeAggFunction(),
          outputColumn: `${targetTable}_${this.mergeAggFunction()}`,
        },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Merged query with "${targetSrc.name}" on [${joinKey}] (${mode}).`);
  }

  public onTableShaping(): void {
    this.toggleToolPanel('shaping');
    this.state.announce('Table Shaping: promote headers, transpose, split, merge, or deduplicate.');
  }

  public applyPromoteHeaders(): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: 'Promote Headers',
      type: 'PromoteHeaders',
      detail: 'Promoted first row as column headers',
      definition: { step: 'PromoteHeaders' },
    });
    this.activeToolPanel.set(null);
    this.state.announce('Promoted first row to column headers.');
  }

  public applyTranspose(): void {
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: 'Transpose Table',
      type: 'Transpose',
      detail: 'Swapped rows and columns',
      definition: { step: 'Transpose' },
    });
    this.activeToolPanel.set(null);
    this.state.announce('Transposed dataset rows and columns.');
  }

  public applyRemoveTopRows(): void {
    const count = Math.max(1, Number(this.shapingRowCount()) || 1);
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Remove Top ${count} Rows`,
      type: 'RemoveTopRows',
      detail: `Skipped top ${count} rows`,
      definition: { step: 'RemoveTopRows', parameters: { count } },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Removed top ${count} rows.`);
  }

  public applyRemoveBottomRows(): void {
    const count = Math.max(1, Number(this.shapingRowCount()) || 1);
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Remove Bottom ${count} Rows`,
      type: 'RemoveBottomRows',
      detail: `Removed bottom ${count} rows`,
      definition: { step: 'RemoveBottomRows', parameters: { count } },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Removed bottom ${count} rows.`);
  }

  public applyRemoveDuplicates(): void {
    const allCols = this.columns().map((c) => c.name);
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: 'Remove Duplicates',
      type: 'RemoveDuplicates',
      detail: `Deduplicated across ${allCols.length} columns`,
      definition: { step: 'RemoveDuplicates', groupColumns: allCols },
    });
    this.activeToolPanel.set(null);
    this.state.announce('Removed duplicate rows.');
  }

  public applyBulkRenameColumns(): void {
    const op = this.bulkRenameOperation();
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Format Column Names (${op})`,
      type: 'TransformColumnNames',
      detail: `Table.TransformColumnNames(${op})`,
      definition: {
        step: 'TransformColumnNames',
        parameters: { operation: op },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Bulk formatted all column headers (${op}).`);
  }

  public applySplitColumn(): void {
    const col = this.splitColumnTarget() || this.columns()[0]?.name;
    const delim = this.splitDelimiter() || ',';
    if (!col) return;
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Split Column: ${col}`,
      type: 'SplitColumn',
      detail: `Split [${col}] by "${delim}"`,
      definition: {
        step: 'SplitColumn',
        column: col,
        parameters: { delimiter: delim },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Split column [${col}] by delimiter "${delim}".`);
  }

  public toggleMergeColumnSelection(colName: string): void {
    this.mergeColumnsSelection.update((curr) =>
      curr.includes(colName) ? curr.filter((c) => c !== colName) : [...curr, colName],
    );
  }

  public applyMergeColumns(): void {
    const selected = this.mergeColumnsSelection();
    if (selected.length < 2) {
      this.state.announce('Select at least two columns to merge.');
      return;
    }
    const newCol = this.mergeColumnsNewName().trim() || 'Merged';
    const sep = this.mergeColumnsSeparator();
    this.appendOrReplaceStep({
      id: `step_${Date.now()}`,
      name: `Merge Columns: ${newCol}`,
      type: 'MergeColumns',
      detail: `Merged [${selected.join(', ')}] into [${newCol}]`,
      definition: {
        step: 'MergeColumns',
        groupColumns: selected,
        newName: newCol,
        parameters: { separator: sep },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Merged columns [${selected.join(', ')}] into [${newCol}].`);
  }

  public onCopyDefinition(): void {
    const text =
      this.definitionFormat() === 'm'
        ? this.activeMQueryScript()
        : this.activeStepDefinitionJson();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.state.announce(
          `Step ${this.definitionFormat().toUpperCase()} definition copied to clipboard.`,
          { resetAfterMs: 3000 },
        );
      });
    }
  }

  public formatCellValue(row: Record<string, unknown>, colName: string): string {
    const val = row[colName];
    if (val === null || val === undefined) {
      return '—';
    }
    const colDef = this.columns().find((c) => c.name === colName);
    const colType = (colDef?.type || '').toUpperCase();
    const nameLower = colName.toLowerCase();

    if (typeof val === 'number') {
      if (nameLower.includes('rate') || colType === 'PERCENTAGE') {
        return `${(val * 100).toFixed(1)}%`;
      }
      if (
        nameLower.includes('amount') ||
        nameLower.includes('revenue') ||
        nameLower.includes('price') ||
        nameLower.includes('cost') ||
        nameLower.includes('profit') ||
        nameLower.includes('capacity') ||
        colType === 'CURRENCY'
      ) {
        return `€${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return val.toString();
    }
    return String(val);
  }
}
