import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { DataPrepQuarantineRow } from "../../services/api.service";
import { StateManagerService } from "../../core/state/state.service";
import { IngestionService } from "../../core/ingestion/ingestion.service";
import {
  IngestionSource,
  SourceFormat,
} from "../../core/ingestion/ingestion.interface";
import { FILTER_OPERATORS } from "../../core/prep/prep.constants";
import {
  AggregationFunction,
  DataPrepColumn,
  DataPrepStep,
  FilterOperator,
  JoinKind,
  RQueryAggregateDefinition,
  StepEvaluationResult,
} from "../../core/prep/prep.interface";

export type DataPrepSection = "Steps" | "Definition" | "Quarantine";
export type RibbonToolPanel =
  | null
  | "filter"
  | "changeType"
  | "unpivot"
  | "groupBy"
  | "customColumn"
  | "mergeQueries"
  | "shaping"
  | "incrementalRefresh";

export const INITIAL_INGESTION_SOURCES: readonly IngestionSource[] = [];
export const INITIAL_PREP_STEPS: readonly DataPrepStep[] = [];

@Component({
  selector: "rc-data-prep",
  templateUrl: "./data-prep.component.html",
  styleUrl: "./data-prep.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "(document:click)": "closeMenu()",
  },
})
export class DataPrepComponent implements OnInit {
  private readonly state = inject(StateManagerService);
  private readonly destroyRef = inject(DestroyRef);
  public readonly ingestion = inject(IngestionService);

  public readonly filterOperators = FILTER_OPERATORS;
  public readonly activeMobileTab = signal<"data" | "tools">("data");
  public readonly sources = this.ingestion.sources;
  public readonly selectedSourceId = this.ingestion.selectedSourceId;
  public readonly stepsBySource = this.ingestion.stepsBySource;
  private readonly rawSnapshotsBySource = this.ingestion.rawSnapshotsBySource;

  public readonly activeColumnMenu = signal<string | null>(null);
  public readonly editingColumnName = signal<string | null>(null);
  public readonly editingColumnValue = signal<string>("");

  public readonly columns = signal<readonly DataPrepColumn[]>([]);
  public readonly rows = signal<readonly Record<string, unknown>[]>([]);
  public readonly quarantinedRecords = signal<readonly DataPrepQuarantineRow[]>(
    [],
  );

  public readonly activeMQueryScript = signal<string>(
    "// No transformation steps recorded",
  );
  public readonly activeStepFormula = signal<string>("");

  public readonly activeToolPanel = signal<RibbonToolPanel>(null);
  public readonly definitionFormat = signal<"json" | "m">("json");

  public readonly filterColumn = signal<string>("");
  public readonly filterOperator = signal<FilterOperator>("equals");
  public readonly filterValue = signal<string>("");
  public readonly filterValueTo = signal<string>("");

  public readonly changeTypeColumn = signal<string>("");
  public readonly changeTypeTarget = signal<string>("FLOAT64");

  public readonly unpivotMode = signal<"selected" | "other">("selected");
  public readonly unpivotColumns = signal<readonly string[]>([]);
  public readonly unpivotAttrName = signal<string>("Attribute");
  public readonly unpivotValName = signal<string>("Value");

  public readonly groupByColumns = signal<readonly string[]>([]);
  public readonly groupBySourceColumn = signal<string>("");
  public readonly groupByFunction = signal<AggregationFunction>("SUM");
  public readonly groupByOutputColumn = signal<string>("Aggregated_Value");

  public readonly customColumnMode = signal<"expression" | "index">(
    "expression",
  );
  public readonly customColumnName = signal<string>("Custom_Metric");
  public readonly customColumnExpression = signal<string>("");
  public readonly indexInitialValue = signal<number>(1);
  public readonly indexIncrement = signal<number>(1);

  public readonly mergeTargetSourceId = signal<string>("");
  public readonly mergeJoinKey = signal<string>("");
  public readonly mergeJoinType = signal<JoinKind>("LEFT");
  public readonly mergePostAction = signal<"expand" | "aggregate">("expand");
  public readonly mergeAggColumn = signal<string>("");
  public readonly mergeAggFunction = signal<AggregationFunction>("SUM");

  public readonly shapingRowCount = signal<number>(1);
  public readonly splitColumnTarget = signal<string>("");
  public readonly splitDelimiter = signal<string>(",");
  public readonly mergeColumnsSelection = signal<readonly string[]>([]);
  public readonly mergeColumnsSeparator = signal<string>(" ");
  public readonly mergeColumnsNewName = signal<string>("Merged_Column");
  public readonly bulkRenameOperation = signal<
    "UPPERCASE" | "LOWERCASE" | "TRIM" | "CLEAN"
  >("UPPERCASE");

  public readonly rangeStart = signal<string>("2025-01-01T00:00:00Z");
  public readonly rangeEnd = signal<string>("2026-01-01T00:00:00Z");
  public readonly rangeActive = signal<boolean>(false);
  public readonly partitionDateColumn = signal<string>("");
  public readonly selectedStepIndex = signal<number>(-1);

  public readonly quarantineStats = signal({
    rowsQuarantined: 0,
    status: "Healthy",
    targetTable: "quarantine_records",
  });

  public readonly expandedSections = signal<Record<DataPrepSection, boolean>>({
    Steps: true,
    Definition: true,
    Quarantine: true,
  });

  public readonly appliedSteps = computed<readonly DataPrepStep[]>(() => {
    const srcId = this.selectedSourceId();
    return srcId ? (this.stepsBySource()[srcId] ?? []) : [];
  });

  public readonly isAllCollapsed = computed(() =>
    Object.values(this.expandedSections()).every((expanded) => !expanded),
  );

  public readonly selectedSource = computed<IngestionSource | null>(() => {
    const list = this.sources();
    const id = this.selectedSourceId();
    return (
      list.find((src) => src.id === id) ?? (list.length > 0 ? list[0] : null)
    );
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
      return "// No active transformation step";
    }
    const def = current.definition ?? {
      step: current.type,
      name: current.name,
      detail: current.detail ?? null,
    };
    return JSON.stringify(def, null, 2);
  });

  constructor() {
    effect(() => {
      const sync = this.ingestion.pipelineSync();
      if (sync && this.rawSnapshotsBySource()[sync.sourceId]) {
        this.previewPipeline(sync.sourceId, sync.stepIndex);
      }
    });
  }

  public ngOnInit(): void {
    this.initSources();
  }

  public loadPreview(source: IngestionSource | null): void {
    if (!source) return;
    const snap = this.rawSnapshotsBySource()[source.id];
    const steps = this.stepsBySource()[source.id] ?? [];
    if (snap && steps.length > 0) {
      this.previewPipeline(source.id, steps.length - 1);
      return;
    }
    if (this.hydrateFromCache(source)) {
      return;
    }
    this.fetchPreview(source, steps);
  }

  public previewPipeline(sourceId: string, upToStepIndex?: number): void {
    const steps = this.stepsBySource()[sourceId] ?? [];
    const targetIdx =
      upToStepIndex !== undefined &&
      upToStepIndex >= 0 &&
      upToStepIndex < steps.length
        ? upToStepIndex
        : steps.length - 1;
    this.selectedStepIndex.set(targetIdx);

    const snapshot = this.rawSnapshotsBySource()[sourceId];
    if (!snapshot) return;

    const activeSlice = targetIdx >= 0 ? steps.slice(0, targetIdx + 1) : [];
    const src = this.sources().find((s) => s.id === sourceId) ?? null;
    const includeRange =
      Boolean(this.partitionDateColumn()) || this.rangeActive();
    const start = includeRange ? this.rangeStart() : undefined;
    const end = includeRange ? this.rangeEnd() : undefined;

    this.ingestion
      .evaluateSteps(
        snapshot.columns,
        snapshot.rows,
        activeSlice,
        src,
        start,
        end,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.applyEvaluation(res),
        error: (err: unknown) =>
          this.state.announceError("Pipeline preview", err),
      });
  }

  public toggleMenu(colName: string, event: MouseEvent): void {
    event.stopPropagation();
    this.activeColumnMenu.update((curr) => (curr === colName ? null : colName));
  }

  public closeMenu(): void {
    if (this.activeColumnMenu()) {
      this.activeColumnMenu.set(null);
    }
  }

  public changeType(colName: string, newType: string): void {
    this.addStep(
      {
        id: `step_${Date.now()}`,
        name: `Change Type: ${colName}`,
        type: "ChangeType",
        detail: `Cast [${colName}] to ${newType}`,
        definition: {
          step: "ChangeType",
          column: colName,
          targetType: newType,
          type: newType,
          onError: "quarantine",
        },
      },
      true,
    );
    this.closeMenu();
    this.announceQuarantine(
      `Transformed column [${colName}] type to ${newType}`,
    );
  }

  public startRename(colName: string): void {
    this.editingColumnName.set(colName);
    this.editingColumnValue.set(colName);
    this.closeMenu();
  }

  public saveRename(originalName: string): void {
    if (this.editingColumnName() !== originalName) return;
    const newName = this.editingColumnValue().trim();
    this.editingColumnName.set(null);
    if (newName && newName !== originalName) {
      this.addStep({
        id: `step_${Date.now()}`,
        name: `Rename Column: ${originalName}`,
        type: "RenameColumn",
        detail: `Renamed [${originalName}] to [${newName}]`,
        definition: {
          step: "RenameColumn",
          original: originalName,
          renamed: newName,
          oldName: originalName,
          newName,
        },
      });
      this.state.announce(`Renamed column [${originalName}] to [${newName}].`);
    }
  }

  public cancelRename(): void {
    this.editingColumnName.set(null);
    this.editingColumnValue.set("");
  }

  public removeColumn(colName: string): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Remove Column: ${colName}`,
      type: "RemoveColumn",
      detail: `Removed [${colName}] from dataset`,
      definition: { step: "RemoveColumn", column: colName },
    });
    this.closeMenu();
    this.state.announce(`Removed column [${colName}] from dataset.`);
  }

  public keepColumn(colName: string): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Remove Other Columns: ${colName}`,
      type: "RemoveOtherColumns",
      detail: `Kept only [${colName}]`,
      definition: {
        step: "RemoveOtherColumns",
        column: colName,
        parameters: { keepColumns: [colName] },
      },
    });
    this.closeMenu();
    this.state.announce(`Removed all columns except [${colName}].`);
  }

  public filterNulls(colName: string): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Filter Nulls: ${colName}`,
      type: "FilterNulls",
      detail: `Removed rows where [${colName}] is null or empty`,
      definition: { step: "FilterNulls", column: colName },
    });
    this.closeMenu();
    this.state.announce(`Filtered nulls for column [${colName}].`);
  }

  public fillDown(colName: string): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Fill Down: ${colName}`,
      type: "FillDown",
      detail: `Propagated non-null values down [${colName}]`,
      definition: { step: "FillDown", column: colName },
    });
    this.closeMenu();
    this.state.announce(`Applied Fill Down on column [${colName}].`);
  }

  public sortColumn(colName: string, ascending: boolean): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Sort ${ascending ? "Ascending" : "Descending"}: ${colName}`,
      type: "SortRows",
      detail: `Sorted [${colName}] ${ascending ? "ASC" : "DESC"}`,
      definition: {
        step: "SortRows",
        column: colName,
        parameters: { ascending },
      },
    });
    this.closeMenu();
    this.state.announce(
      `Sorted [${colName}] ${ascending ? "ascending" : "descending"}.`,
    );
  }

  public cleanseText(
    colName: string,
    operation: "TRIM" | "UPPERCASE" | "LOWERCASE",
  ): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: `${operation}: ${colName}`,
      type: "InlineCleansing",
      detail: `Applied ${operation} on [${colName}]`,
      definition: {
        step: "InlineCleansing",
        column: colName,
        parameters: { operation },
      },
    });
    this.closeMenu();
    this.state.announce(
      `Applied ${operation.toLowerCase()} cleansing to [${colName}].`,
    );
  }

  public extractDigits(colName: string): void {
    const newCol = `${colName}_Digits`;
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Extract Digits: ${colName}`,
      type: "AddCustomColumn",
      detail: `Text.Select([${colName}], {"0".."9"})`,
      definition: {
        step: "AddCustomColumn",
        newName: newCol,
        expression: `Text.Select([${colName}], {"0".."9"})`,
      },
    });
    this.closeMenu();
    this.state.announce(
      `Extracted numeric characters from [${colName}] into [${newCol}].`,
    );
  }

  public removeStep(index: number, event?: Event): void {
    event?.stopPropagation();
    const srcId = this.selectedSourceId();
    const { removed, nextIndex } = this.ingestion.removeStep(srcId, index);
    if (!removed) {
      this.state.announce(
        "The initial Source Ingestion step cannot be removed.",
      );
      return;
    }
    this.previewPipeline(srcId, nextIndex);
    this.state.announce(`Removed transformation step "${removed.name}".`);
  }

  public moveStep(index: number, direction: -1 | 1, event?: Event): void {
    event?.stopPropagation();
    const srcId = this.selectedSourceId();
    const { moved, targetIndex } = this.ingestion.moveStep(
      srcId,
      index,
      direction,
    );
    if (!moved) {
      return;
    }
    this.previewPipeline(srcId, targetIndex);
    this.state.announce(
      `Moved step "${moved.name}" to position ${targetIndex + 1}.`,
    );
  }

  public toggleLoad(sourceId: string, event?: Event): void {
    event?.stopPropagation();
    const updated = this.ingestion.toggleLoad(sourceId);
    if (!updated) return;
    if (updated.enableLoad === false) {
      this.state.announce(
        `Disabled model load for "${updated.name}" (staging helper query only).`,
      );
    } else {
      this.state.announce(`Enabled semantic model load for "${updated.name}".`);
    }
  }

  public duplicateDataset(source: IngestionSource, event?: Event): void {
    event?.stopPropagation();
    const copySource = this.ingestion.duplicateDataset(source);
    this.selectSource(copySource);
    this.state.announce(
      `Duplicated dataset "${source.name}" as "${copySource.name}".`,
    );
  }

  public isExpanded(section: DataPrepSection): boolean {
    return this.expandedSections()[section] ?? false;
  }

  public toggleSection(section: DataPrepSection): void {
    this.expandedSections.update((sections) => ({
      ...sections,
      [section]: !sections[section],
    }));
  }

  public toggleAll(): void {
    const willExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Steps: willExpand,
      Definition: willExpand,
      Quarantine: willExpand,
    });
  }

  public selectSource(source: IngestionSource): void {
    this.selectedSourceId.set(source.id);
    this.activeColumnMenu.set(null);
    this.loadPreview(source);
    this.state.announce(
      `Switched active data preparation source to ${source.name}.`,
    );
  }

  public selectStep(index: number): void {
    const steps = this.appliedSteps();
    if (index >= 0 && index < steps.length) {
      const srcId = this.selectedSourceId();
      if (srcId && this.rawSnapshotsBySource()[srcId]) {
        this.previewPipeline(srcId, index);
      } else {
        this.selectedStepIndex.set(index);
      }
      const step = steps[index];
      this.state.announce(
        `Inspecting transformation step ${index + 1}: ${step.name}.`,
      );
    }
  }

  public applyRange(): void {
    this.rangeActive.set(true);
    const srcId = this.selectedSourceId();
    if (srcId) {
      this.previewPipeline(srcId, this.selectedStepIndex());
    }
    this.activeToolPanel.set(null);
    this.state.announce(
      `Applied RangeStart (${this.rangeStart()}) and RangeEnd (${this.rangeEnd()}) parameters.`,
    );
  }

  public runRefresh(): void {
    const src = this.selectedSource();
    const dateCol = this.partitionDateColumn();
    this.state.announce(
      "Incremental refresh running across ingestion partition...",
      { loading: true },
    );
    const tableId = src ? src.tableName || src.name : "";
    this.ingestion
      .runRefresh(src, dateCol, this.rangeStart(), this.rangeEnd())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (src && dateCol) {
            this.previewPipeline(src.id, this.appliedSteps().length - 1);
          }
          const count = res?.recordsUpserted ?? 0;
          this.state.announce(
            `Incremental refresh succeeded: ${count} delta records upserted.`,
            { resetAfterMs: 4000 },
          );
        },
        error: (err: unknown) => {
          this.state.announceError(
            `Incremental refresh on "${tableId || "active dataset"}"`,
            err instanceof Error && err.message
              ? err
              : "unable to reach ingestion pipeline worker",
          );
        },
      });
  }

  public applyLoad(): void {
    const src = this.selectedSource();
    const rowData = this.rows();
    const result = this.ingestion.applyLoad(src, this.columns(), rowData);
    if (result.status === "disabled" && src) {
      this.state.announce(
        `Staging dataset "${src.name}" has Enable Load disabled and was kept in R-Query staging only.`,
        { resetAfterMs: 4000 },
      );
    } else if (result.status === "loaded") {
      this.state.announce(
        `Committed dataset "${result.tableName}" (${rowData.length} rows) to analytical cache and semantic model.`,
        { resetAfterMs: 4000 },
      );
    } else {
      this.state.announce(
        "R-Query pipeline step chain committed to analytical cache (queries.rq.json updated).",
        { resetAfterMs: 4000 },
      );
    }
  }

  public copyFormula(): void {
    const formula = this.activeStepFormula();
    if (formula && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(formula).then(() => {
        this.state.announce("Step formula copied to clipboard.", {
          resetAfterMs: 3000,
        });
      });
    }
  }

  public loadDataset(
    name: string,
    format: SourceFormat,
    content: string,
  ): void {
    this.ingestion
      .loadDirect(name, format, content)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        this.selectedStepIndex.set(0);
        this.applyEvaluation({
          columns: res.columns,
          rows: res.rows,
          quarantined: [],
          mQueryScript: res.mQueryScript,
          activeStepFormula: res.activeStepFormula,
        });
      });
  }

  public togglePanel(panel: Exclude<RibbonToolPanel, null>): void {
    this.syncSelections();
    this.activeToolPanel.update((curr) => (curr === panel ? null : panel));
  }

  public openFilter(): void {
    this.togglePanel("filter");
    this.state.announce(
      "Filter step: configure row predicate for active dataset.",
    );
  }

  public applyFilter(): void {
    const col = this.filterColumn() || this.columns()[0]?.name;
    if (!col) return;
    const op = this.filterOperator();
    if (op === "notEmpty") {
      this.filterNulls(col);
      this.activeToolPanel.set(null);
      return;
    }
    const colMeta = this.columns().find((c) => c.name === col);
    const val = this.filterValue().trim();
    const valTo = this.filterValueTo().trim();
    const isNumeric = colMeta?.numeric === true;
    const predicate = this.buildPredicate(col, op, val, valTo, isNumeric);
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Filter Rows: ${col}`,
      type: "FilterRows",
      detail: predicate,
      definition: {
        step: "FilterRows",
        column: col,
        predicate,
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Applied row filter on [${col}].`);
  }

  private buildPredicate(
    col: string,
    op: Exclude<FilterOperator, "notEmpty">,
    val: string,
    valTo: string,
    numeric: boolean,
  ): string {
    const lit = (raw: string): string =>
      numeric && /^[+-]?\d+(\.\d+)?$/.test(raw)
        ? raw
        : `'${raw.replace(/'/g, "")}'`;
    if (op === "between") {
      return `[${col}] >= ${lit(val)} and [${col}] < ${lit(valTo)}`;
    }
    const sym: Record<
      Exclude<FilterOperator, "between" | "notEmpty">,
      string
    > = {
      equals: "==",
      notEquals: "!=",
      greaterThan: ">",
      greaterOrEqual: ">=",
      lessThan: "<",
      lessOrEqual: "<=",
    };
    return `[${col}] ${sym[op]} ${lit(val)}`;
  }

  public openTypes(): void {
    this.togglePanel("changeType");
    this.state.announce("Type casting: inferring column schema datatypes.");
  }

  public applyType(): void {
    const col = this.changeTypeColumn() || this.columns()[0]?.name;
    if (!col) return;
    this.changeType(col, this.changeTypeTarget());
    this.activeToolPanel.set(null);
  }

  public detectTypes(): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: "Detect Data Type",
      type: "DetectDataType",
      detail: "Auto-inferred schema across all columns",
      definition: { step: "DetectDataType" },
    });
    this.activeToolPanel.set(null);
    this.state.announce("Detected and applied data types across all columns.");
  }

  public openUnpivot(): void {
    this.togglePanel("unpivot");
    this.state.announce(
      "Unpivot: select attribute and metric value column pairs.",
    );
  }

  public toggleUnpivot(colName: string): void {
    this.unpivotColumns.update((curr) =>
      curr.includes(colName)
        ? curr.filter((c) => c !== colName)
        : [...curr, colName],
    );
  }

  public applyUnpivot(): void {
    const selected = this.unpivotColumns();
    const attrName = this.unpivotAttrName().trim() || "Attribute";
    const valName = this.unpivotValName().trim() || "Value";
    if (selected.length === 0) {
      this.state.announce("Select at least one column for Unpivot.");
      return;
    }
    const isOther = this.unpivotMode() === "other";
    this.addStep({
      id: `step_${Date.now()}`,
      name: isOther ? "Unpivot Other Columns" : "Unpivot Columns",
      type: isOther ? "UnpivotOtherColumns" : "UnpivotColumns",
      detail: isOther
        ? `Anchor: ${selected.join(", ")} -> [${attrName}], [${valName}]`
        : `${selected.join(", ")} -> [${attrName}], [${valName}]`,
      definition: isOther
        ? {
            step: "UnpivotOtherColumns",
            groupColumns: selected,
            nameCol: attrName,
            valCol: valName,
          }
        : {
            step: "UnpivotColumns",
            pivotColumns: selected,
            nameCol: attrName,
            valCol: valName,
          },
    });
    this.activeToolPanel.set(null);
    this.state.announce(
      isOther
        ? `Unpivoted other columns keeping [${selected.join(", ")}] anchored.`
        : `Unpivoted columns [${selected.join(", ")}].`,
    );
  }

  public openGroup(): void {
    this.togglePanel("groupBy");
    this.state.announce(
      "Group By: aggregate dimensional records over sliding stream window.",
    );
  }

  public toggleGroup(colName: string): void {
    this.groupByColumns.update((curr) =>
      curr.includes(colName)
        ? curr.filter((c) => c !== colName)
        : [...curr, colName],
    );
  }

  public applyGroup(): void {
    const gCols =
      this.groupByColumns().length > 0
        ? this.groupByColumns()
        : this.columns().length > 0
          ? [this.columns()[0].name]
          : [];
    const srcCol = this.groupBySourceColumn() || this.columns()[0]?.name || "";
    const fn = this.groupByFunction();
    const outCol = this.groupByOutputColumn().trim() || `${fn}_${srcCol}`;
    if (gCols.length === 0) return;

    const aggregations: RQueryAggregateDefinition[] = [
      { outputColumn: outCol, sourceColumn: srcCol, function: fn },
    ];
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Group By: ${gCols.join(", ")}`,
      type: "GroupRows",
      detail: `${fn}([${srcCol}]) as [${outCol}]`,
      definition: {
        step: "GroupRows",
        groupColumns: gCols,
        aggregations,
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(
      `Grouped rows by [${gCols.join(", ")}] with ${fn}([${srcCol}]).`,
    );
  }

  public openCustom(): void {
    this.togglePanel("customColumn");
    this.state.announce(
      "Custom Column: define expression using ANTLR RAX syntax.",
    );
  }

  public applyCustom(): void {
    const newCol = this.customColumnName().trim() || "Custom";
    if (this.customColumnMode() === "index") {
      this.addIndexStep(newCol);
      return;
    }
    const expr = this.customColumnExpression().trim();
    if (!expr) {
      this.state.announce("Provide a custom column formula expression.");
      return;
    }
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Custom Column: ${newCol}`,
      type: "AddCustomColumn",
      detail: `${newCol} = ${expr}`,
      definition: {
        step: "AddCustomColumn",
        newName: newCol,
        expression: expr,
        onError: "quarantine",
      },
    });
    this.activeToolPanel.set(null);
    this.announceQuarantine(`Added custom column [${newCol}] = ${expr}`);
  }

  public openMerge(): void {
    this.togglePanel("mergeQueries");
    this.state.announce(
      "Merge Queries: join active dataset with a lookup query.",
    );
  }

  public applyMerge(): void {
    const targetId = this.mergeTargetSourceId();
    const targetSrc =
      this.sources().find((s) => s.id === targetId) ?? this.siblingSources()[0];
    const joinKey = this.mergeJoinKey() || this.columns()[0]?.name || "";
    if (!targetSrc || !joinKey) {
      this.state.announce(
        "Select a target query and join key column to merge.",
      );
      return;
    }
    const targetTable = targetSrc.tableName || targetSrc.name;
    const joinType = this.mergeJoinType();
    const mode = this.mergePostAction();

    this.addStep({
      id: `step_${Date.now()}`,
      name: `Merge Queries: ${targetTable}`,
      type: "MergeQueries",
      detail: `${joinType} JOIN ${targetTable} ON [${joinKey}] (${mode})`,
      definition: {
        step: "MergeQueries",
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
    this.state.announce(
      `Merged query with "${targetSrc.name}" on [${joinKey}] (${mode}).`,
    );
  }

  public openShaping(): void {
    this.togglePanel("shaping");
    this.state.announce(
      "Table Shaping: promote headers, transpose, split, merge, or deduplicate.",
    );
  }

  public promoteHeaders(): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: "Promote Headers",
      type: "PromoteHeaders",
      detail: "Promoted first row as column headers",
      definition: { step: "PromoteHeaders" },
    });
    this.activeToolPanel.set(null);
    this.state.announce("Promoted first row to column headers.");
  }

  public transposeTable(): void {
    this.addStep({
      id: `step_${Date.now()}`,
      name: "Transpose Table",
      type: "Transpose",
      detail: "Swapped rows and columns",
      definition: { step: "Transpose" },
    });
    this.activeToolPanel.set(null);
    this.state.announce("Transposed dataset rows and columns.");
  }

  public removeTop(): void {
    const count = Math.max(1, Number(this.shapingRowCount()) || 1);
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Remove Top ${count} Rows`,
      type: "RemoveTopRows",
      detail: `Skipped top ${count} rows`,
      definition: { step: "RemoveTopRows", parameters: { count } },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Removed top ${count} rows.`);
  }

  public removeBottom(): void {
    const count = Math.max(1, Number(this.shapingRowCount()) || 1);
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Remove Bottom ${count} Rows`,
      type: "RemoveBottomRows",
      detail: `Removed bottom ${count} rows`,
      definition: { step: "RemoveBottomRows", parameters: { count } },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Removed bottom ${count} rows.`);
  }

  public removeDuplicates(): void {
    const allCols = this.columns().map((c) => c.name);
    this.addStep({
      id: `step_${Date.now()}`,
      name: "Remove Duplicates",
      type: "RemoveDuplicates",
      detail: `Deduplicated across ${allCols.length} columns`,
      definition: { step: "RemoveDuplicates", groupColumns: allCols },
    });
    this.activeToolPanel.set(null);
    this.state.announce("Removed duplicate rows.");
  }

  public bulkRename(): void {
    const op = this.bulkRenameOperation();
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Format Column Names (${op})`,
      type: "TransformColumnNames",
      detail: `Table.TransformColumnNames(${op})`,
      definition: {
        step: "TransformColumnNames",
        parameters: { operation: op },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Bulk formatted all column headers (${op}).`);
  }

  public splitColumn(): void {
    const col = this.splitColumnTarget() || this.columns()[0]?.name;
    const delim = this.splitDelimiter() || ",";
    if (!col) return;
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Split Column: ${col}`,
      type: "SplitColumn",
      detail: `Split [${col}] by "${delim}"`,
      definition: {
        step: "SplitColumn",
        column: col,
        parameters: { delimiter: delim },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Split column [${col}] by delimiter "${delim}".`);
  }

  public toggleCombine(colName: string): void {
    this.mergeColumnsSelection.update((curr) =>
      curr.includes(colName)
        ? curr.filter((c) => c !== colName)
        : [...curr, colName],
    );
  }

  public combineColumns(): void {
    const selected = this.mergeColumnsSelection();
    if (selected.length < 2) {
      this.state.announce("Select at least two columns to merge.");
      return;
    }
    const newCol = this.mergeColumnsNewName().trim() || "Merged";
    const sep = this.mergeColumnsSeparator();
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Merge Columns: ${newCol}`,
      type: "MergeColumns",
      detail: `Merged [${selected.join(", ")}] into [${newCol}]`,
      definition: {
        step: "MergeColumns",
        groupColumns: selected,
        newName: newCol,
        parameters: { separator: sep },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(
      `Merged columns [${selected.join(", ")}] into [${newCol}].`,
    );
  }

  public copyDefinition(): void {
    const text =
      this.definitionFormat() === "m"
        ? this.activeMQueryScript()
        : this.activeStepDefinitionJson();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.state.announce(
          `Step ${this.definitionFormat().toUpperCase()} definition copied to clipboard.`,
          { resetAfterMs: 3000 },
        );
      });
    }
  }

  public formatCell(row: Record<string, unknown>, colName: string): string {
    const val = row[colName];
    if (val === null || val === undefined) {
      return "—";
    }
    if (typeof val !== "number") {
      return String(val);
    }
    const colDef = this.columns().find((c) => c.name === colName);
    const colType = (colDef?.displayType || colDef?.type || "").toUpperCase();
    const nameLower = colName.toLowerCase();

    if (nameLower.includes("rate") || colType === "PERCENTAGE") {
      return `${(val * 100).toFixed(1)}%`;
    }
    if (this.isCurrency(nameLower, colType)) {
      return `€${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return val.toString();
  }

  public readValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  public readTyped<T extends string>(event: Event): T {
    return this.readValue(event) as T;
  }

  public readNumber(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  private initSources(): void {
    if (this.ingestion.restoreTables()) {
      const firstId = this.selectedSourceId();
      const firstSnap = this.rawSnapshotsBySource()[firstId];
      if (firstSnap) {
        this.columns.set([...firstSnap.columns]);
        this.rows.set([...firstSnap.rows]);
      }
      this.selectedStepIndex.set(0);
      this.syncSelections();
      return;
    }
    const defaultSource = this.selectedSource();
    if (defaultSource) {
      this.loadPreview(defaultSource);
    }
  }

  private hydrateFromCache(source: IngestionSource): boolean {
    const tableName = source.tableName || source.name;
    const sharedTbl = this.state.sharedTables.find((t) => t.name === tableName);
    if (!sharedTbl || sharedTbl.columns.length === 0) {
      return false;
    }
    const sharedRows = this.state.tableRows(tableName);
    const cols: DataPrepColumn[] = sharedTbl.columns.map((c) => ({
      name: c.name,
      type: c.dataType,
      displayType: c.dataType,
      icon: c.dataType,
    }));
    this.rawSnapshotsBySource.update((m) => ({
      ...m,
      [source.id]: { columns: cols, rows: [...sharedRows], tableName },
    }));
    this.columns.set(cols);
    this.rows.set([...sharedRows]);
    this.syncSelections();
    return true;
  }

  private fetchPreview(
    source: IngestionSource,
    steps: readonly DataPrepStep[],
  ): void {
    const tableName = source.tableName || source.name;
    this.ingestion
      .evaluateSteps([], [], steps, source)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.columns.length > 0) {
            this.rawSnapshotsBySource.update((m) => ({
              ...m,
              [source.id]: {
                columns: res.columns,
                rows: res.rows,
                tableName: res.tableName || tableName,
              },
            }));
          }
          this.applyEvaluation(res);
        },
        error: () => {
          this.state.announce(
            `Data preparation preview loaded from sovereign buffer for ${source.name}.`,
            { safe: true },
          );
        },
      });
  }

  private applyEvaluation(res: StepEvaluationResult): void {
    this.columns.set(res.columns);
    this.rows.set(res.rows);
    this.quarantinedRecords.set(res.quarantined);
    this.quarantineStats.set({
      rowsQuarantined: res.quarantined.length,
      status:
        res.quarantined.length > 0 ? "Isolated Records Detected" : "Healthy",
      targetTable: "quarantine_records",
    });
    if (res.mQueryScript !== undefined) {
      this.activeMQueryScript.set(res.mQueryScript);
    }
    if (res.activeStepFormula !== undefined) {
      this.activeStepFormula.set(res.activeStepFormula);
    }
    this.syncSelections();
  }

  private syncSelections(): void {
    const cols = this.columns();
    if (cols.length > 0) {
      const firstCol = cols[0].name;
      if (!cols.some((c) => c.name === this.filterColumn())) {
        this.filterColumn.set(firstCol);
      }
      if (!cols.some((c) => c.name === this.changeTypeColumn())) {
        this.changeTypeColumn.set(firstCol);
      }
      if (!cols.some((c) => c.name === this.splitColumnTarget())) {
        this.splitColumnTarget.set(firstCol);
      }
      const numCol =
        cols.find((c) => c.numeric === true) ?? cols[cols.length - 1];
      if (!cols.some((c) => c.name === this.groupBySourceColumn())) {
        this.groupBySourceColumn.set(numCol.name);
      }
      const dateCol = cols.find((c) => this.isDateCol(c));
      if (dateCol && !this.partitionDateColumn()) {
        this.partitionDateColumn.set(dateCol.name);
      }
    }
    const siblings = this.siblingSources();
    if (siblings.length > 0 && !this.mergeTargetSourceId()) {
      this.mergeTargetSourceId.set(siblings[0].id);
    }
  }

  private isDateCol(col: DataPrepColumn): boolean {
    const typeLower = (col.displayType ?? col.type ?? "").toLowerCase();
    const nameLower = col.name.toLowerCase();
    return (
      typeLower.includes("date") ||
      nameLower.includes("date") ||
      nameLower.includes("time")
    );
  }

  private addStep(step: DataPrepStep, replaceSameColumnType = false): void {
    const srcId = this.selectedSourceId();
    if (!srcId) return;
    const latestIdx = this.ingestion.upsertStep(
      srcId,
      step,
      replaceSameColumnType,
    );
    if (latestIdx >= 0) {
      this.previewPipeline(srcId, latestIdx);
    }
  }

  private addIndexStep(newCol: string): void {
    const seed = Number(this.indexInitialValue()) || 1;
    const inc = Number(this.indexIncrement()) || 1;
    this.addStep({
      id: `step_${Date.now()}`,
      name: `Add Index Column: ${newCol}`,
      type: "AddIndexColumn",
      detail: `Surrogate key starting at ${seed} (+${inc})`,
      definition: {
        step: "AddIndexColumn",
        newName: newCol,
        parameters: { initialValue: seed, increment: inc },
      },
    });
    this.activeToolPanel.set(null);
    this.state.announce(`Added surrogate key Index Column [${newCol}].`);
  }

  private announceQuarantine(prefix: string): void {
    const quarantined = this.quarantinedRecords();
    if (quarantined.length > 0) {
      const firstErr = quarantined[0];
      this.state.announce(
        `${prefix}: ${quarantined.length} row(s) quarantined (e.g., Row ${firstErr.sourceLineNumber}: ${firstErr.errorReason}).`,
        { error: true },
      );
      return;
    }
    this.state.announce(`${prefix}.`);
  }

  private isCurrency(nameLower: string, colType: string): boolean {
    return (
      colType === "CURRENCY" ||
      nameLower.includes("amount") ||
      nameLower.includes("revenue") ||
      nameLower.includes("price") ||
      nameLower.includes("cost") ||
      nameLower.includes("profit") ||
      nameLower.includes("capacity")
    );
  }
}
