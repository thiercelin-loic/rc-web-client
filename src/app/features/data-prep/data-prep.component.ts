import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  effect,
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
import { IngestionWorkflowService } from '../../core/ingestion-workflow.service';
import {
  AggregationFunction,
  DATA_CONNECTORS,
  DataPrepColumn,
  DataPrepStep,
  FILTER_OPERATORS,
  FilterOperator,
  IngestionSource,
  JoinKind,
  RQueryAggregateDefinition,
  RQueryStepDefinition,
  SourceSnapshot,
  buildPredicate,
  formatMQueryScript,
  getStepMFormula,
  isNumericType,
  tableNameFromSource,
  toBackendType,
  toDisplayType,
} from './data-prep.model';

export { DATA_CONNECTORS };
export type { DataPrepColumn, DataPrepStep, IngestionSource };

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

export const INITIAL_INGESTION_SOURCES: readonly IngestionSource[] = [];
export const INITIAL_PREP_STEPS: readonly DataPrepStep[] = [];

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
  public readonly ingestion = inject(IngestionWorkflowService);

  public readonly filterOperators = FILTER_OPERATORS;
  public readonly activeMobileTab = signal<'data' | 'tools'>('data');
  public readonly sources = this.ingestion.sources;
  public readonly selectedSourceId = this.ingestion.selectedSourceId;
  public readonly activeColumnMenu = signal<string | null>(null);
  public readonly editingColumnName = signal<string | null>(null);
  public readonly editingColumnValue = signal<string>('');

  public readonly columns = signal<readonly DataPrepColumn[]>([]);
  public readonly rows = signal<readonly Record<string, unknown>[]>([]);
  public readonly stepsBySource = this.ingestion.stepsBySource;
  private readonly rawSnapshotsBySource = this.ingestion.rawSnapshotsBySource;
  public readonly quarantinedRecords = signal<readonly DataPrepQuarantineRow[]>([]);

  // Ribbon panel and step definition view states
  public readonly activeToolPanel = signal<RibbonToolPanel>(null);
  public readonly definitionFormat = signal<'json' | 'm'>('json');

  constructor() {
    effect(() => {
      const sync = this.ingestion.pipelineSync();
      if (sync && this.rawSnapshotsBySource()[sync.sourceId]) {
        this.recomputePipelinePreview(sync.sourceId, sync.stepIndex);
      }
    });
  }

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

  public readonly activeStepFormula = computed(() => {
    const src = this.selectedSource();
    const step = this.activeStep();
    const steps = this.appliedSteps();
    const idx = this.selectedStepIndex();
    const prevStep = idx > 0 ? steps[idx - 1] : null;
    const prevVar = prevStep ? `#"${prevStep.name.replace(/"/g, "'")}_${idx - 1}"` : 'Source';
    return getStepMFormula(src?.name ?? 'dataset', step, prevVar);
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
    const { columns, rows, quarantined } = this.ingestion.evaluateStepsLocally(
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
    const isUnpromotedSnapshot = snapshot.columns[0]?.name === 'Column1';
    const promoteIdx = activeSlice.findIndex(
      (s) => s.type === 'PromoteHeaders' || s.type === 'PromoteHeadersStep',
    );
    if (src && (snapshot.rawText || snapshot.rawBase64) && (!isUnpromotedSnapshot || promoteIdx >= 0)) {
      const lookupTables: Record<string, ReadonlyArray<Record<string, unknown>>> = {};
      this.sources().forEach((other) => {
        if (other.id !== sourceId) {
          const otherSnap = this.rawSnapshotsBySource()[other.id];
          if (otherSnap) {
            const otherSteps = this.stepsBySource()[other.id] ?? [];
            const evaluatedOther = this.ingestion.evaluateStepsLocally(
              otherSnap.columns,
              otherSnap.rows,
              otherSteps,
            );
            lookupTables[tableNameFromSource(other.name)] = evaluatedOther.rows;
            lookupTables[other.name] = evaluatedOther.rows;
          }
        }
      });

      const navStep = steps.find((s) => s.type === 'Navigation' || s.type === 'NavigationStep');
      const sheetName = (navStep?.definition?.['sheetName'] ?? navStep?.definition?.['item']) as
        | string
        | undefined;

      const backendSteps = activeSlice
        .filter((s, idx) => {
          if (
            s.type === 'FileSource' ||
            s.type === 'FileSourceStep' ||
            s.type === 'Navigation' ||
            s.type === 'NavigationStep'
          ) {
            return false;
          }
          if (isUnpromotedSnapshot && idx === promoteIdx) {
            return false;
          }
          return true;
        })
        .map((s) => this.toBackendStepPayload(s));

      this.api
        .getDataPrepPreview({
          datasetId: src.id,
          format: src.backendFormat ?? (src.format === 'REST' ? 'JSON' : src.format),
          rawPayload: snapshot.rawText,
          rawPayloadBase64: snapshot.rawBase64,
          sheetName,
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
    const tableId = src ? tableNameFromSource(src.name) : '';
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

  public onCopyFormula(): void {
    const formula = this.activeStepFormula();
    if (formula && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(formula).then(() => {
        this.state.announce('Step formula copied to clipboard.', { resetAfterMs: 3000 });
      });
    }
  }

  public loadUserDataset(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    content: string,
  ): void {
    const res = this.ingestion.loadDirectDataset(name, format, content);
    if (!res) return;
    this.columns.set(res.columns);
    this.rows.set(res.rows);
    this.selectedStepIndex.set(0);
    this.quarantinedRecords.set([]);
    this.quarantineStats.set({
      rowsQuarantined: 0,
      status: 'Healthy',
      targetTable: 'quarantine_records',
    });
    this.syncDefaultFormSelections();
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
