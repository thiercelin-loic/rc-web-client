import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { switchMap } from "rxjs";
import {
  DEFAULT_SEMANTIC_MODEL,
  SemanticModelService,
} from "../../core/model/model.service";
import { RaxService } from "../../core/rax/rax.service";
import {
  ColumnDisplayFormat,
  ColumnSummarization,
  RaxMeasureDescriptor,
  SharedColumn,
  SharedTable,
  StateManagerService,
} from "../../core/state/state.service";

export type TableViewSection = "Tables" | "Columns" | "Calculations";
export type FormulaAuthoringMode = "column" | "table" | "measure";

export interface TableRowData {
  readonly [columnName: string]: unknown;
}

export interface ColumnFormatConfig {
  readonly format: ColumnDisplayFormat;
  readonly alignment: "left" | "right" | "center";
}

export interface FormulaSuggestion {
  readonly token: string;
  readonly category: "Function" | "Column" | "Measure" | "Table";
  readonly description: string;
}

const STANDARD_DATA_TYPES: readonly string[] = [
  "STRING",
  "VARCHAR",
  "INT64",
  "INT",
  "FLOAT64",
  "FLOAT",
  "DECIMAL",
  "DATE",
  "DATETIME",
  "BOOLEAN",
];

const RAX_TABLE_FUNCTIONS: readonly FormulaSuggestion[] = [
  {
    token: "CALENDAR(DATE(2026, 1, 1), DATE(2026, 12, 31))",
    category: "Function",
    description:
      "Generates a continuous date table between start and end dates",
  },
  {
    token:
      'ADDCOLUMNS(CALENDAR(DATE(2025, 1, 1), DATE(2026, 12, 31)), "Offset Day", DATEDIFF(TODAY(), [Date], DAY))',
    category: "Function",
    description:
      "Builds a Calendar table enriched with Time Intelligence offset columns",
  },
  {
    token: "SUMMARIZECOLUMNS(",
    category: "Function",
    description: "Creates an aggregated table grouped by dimension columns",
  },
  {
    token: "CALCULATE(SUM(",
    category: "Function",
    description:
      "Evaluates an expression in a modified filter context (context transition)",
  },
  {
    token: "RELATED(",
    category: "Function",
    description:
      "Propagates row context across N:1 relationships to fetch a related column",
  },
  {
    token: "SUMX(",
    category: "Function",
    description: "Row-by-row iterator sum over a table expression",
  },
  {
    token: "AVERAGEX(",
    category: "Function",
    description: "Row-by-row iterator average over a table expression",
  },
  {
    token: "INFO.VIEW.COLUMNS()",
    category: "Function",
    description:
      "Returns semantic model column metadata for Data Dictionary tables",
  },
  {
    token: "INFO.VIEW.MEASURES()",
    category: "Function",
    description:
      "Returns semantic model measure metadata for Data Dictionary tables",
  },
  {
    token: "INFO.VIEW.TABLES()",
    category: "Function",
    description:
      "Returns semantic model table metadata for Data Dictionary tables",
  },
];

@Component({
  selector: "rc-table-view",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./table-view.component.html",
  styleUrl: "./table-view.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableViewComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly semanticModel = inject(SemanticModelService);
  private readonly rax = inject(RaxService);
  public readonly state = inject(StateManagerService);

  private readonly tableDataStore = signal<
    Readonly<Record<string, readonly TableRowData[]>>
  >({});

  public readonly activeMobileTab = signal<"grid" | "tools">("grid");
  public readonly expandedSections = signal<Record<TableViewSection, boolean>>({
    Tables: true,
    Columns: true,
    Calculations: true,
  });

  public readonly isAllCollapsed = computed<boolean>(() => {
    const s = this.expandedSections();
    return !s.Tables && !s.Columns && !s.Calculations;
  });

  public readonly selectedTableName = signal<string>("");
  public readonly selectedColumnName = signal<string>("");
  public readonly dateColumnCandidate = signal<string>("");
  public readonly tableSearchQuery = signal<string>("");

  public readonly tables = computed<readonly SharedTable[]>(
    () => this.state.sharedTables,
  );

  public readonly filteredTables = computed<readonly SharedTable[]>(() => {
    const query = this.tableSearchQuery().trim().toLowerCase();
    if (!query) {
      return this.tables();
    }
    return this.tables().filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.role.toLowerCase().includes(query),
    );
  });

  public readonly activeTable = computed<SharedTable | null>(() => {
    const selected = this.selectedTableName();
    const all = this.tables();
    if (selected) {
      const match = all.find((t) => t.name === selected);
      if (match) return match;
    }
    return all.length > 0 ? all[0] : null;
  });

  public readonly activeColumns = computed<readonly SharedColumn[]>(() => {
    const tbl = this.activeTable();
    return tbl ? tbl.columns : [];
  });

  public readonly selectedColumn = computed<SharedColumn | null>(() => {
    const cols = this.activeColumns();
    const target = this.selectedColumnName();
    if (target) {
      const match = cols.find((c) => c.name === target);
      if (match) return match;
    }
    return cols.length > 0 ? cols[0] : null;
  });

  public readonly effectiveDateColumn = computed<string>(() => {
    const explicit = this.dateColumnCandidate();
    if (explicit) return explicit;
    const tbl = this.activeTable();
    if (!tbl || !tbl.columns.length) return "";
    const dateCol = tbl.columns.find(
      (c) =>
        c.dataType.toUpperCase().includes("DATE") ||
        c.name.toLowerCase().includes("date"),
    );
    return tbl.dateColumn || dateCol?.name || tbl.columns[0]?.name || "";
  });

  public readonly calculatedExpressions = this.rax.expressions;
  public readonly lastError = this.semanticModel.lastError;

  public readonly sortColumn = signal<string | null>(null);
  public readonly sortDirection = signal<"asc" | "desc">("asc");

  public readonly formulaMode = signal<FormulaAuthoringMode>("column");
  public readonly activeEditingMeasureId = signal<string>("");
  public readonly formulaTarget = signal<string>("");
  public readonly formulaText = signal<string>("");
  public readonly isFormulaActive = signal<boolean>(false);
  public readonly showFormulaSuggestions = signal<boolean>(false);
  public readonly selectedSuggestionIndex = signal<number>(0);

  public readonly columnFormats = signal<
    Readonly<Record<string, ColumnFormatConfig>>
  >({});

  public readonly formulaSuggestions = computed<readonly FormulaSuggestion[]>(
    () => {
      const raw = this.formulaText().trim();
      if (!raw || !this.isFormulaActive()) {
        return [];
      }
      const lastTokenMatch = raw.match(/([a-zA-Z0-9_.'[\]]+)$/);
      const searchToken = (
        lastTokenMatch ? lastTokenMatch[1] : raw
      ).toLowerCase();
      if (!searchToken) {
        return [];
      }

      const candidates: FormulaSuggestion[] = [...RAX_TABLE_FUNCTIONS];
      for (const tbl of this.tables()) {
        candidates.push({
          token: `'${tbl.name}'`,
          category: "Table",
          description: `Model table (${tbl.columns.length} columns)`,
        });
        for (const col of tbl.columns) {
          candidates.push({
            token: `'${tbl.name}'[${col.name}]`,
            category: "Column",
            description: `${tbl.name} column (${col.dataType})`,
          });
        }
      }
      for (const m of this.state.measures) {
        candidates.push({
          token: `[${m.label}]`,
          category: "Measure",
          description: `Explicit measure on ${m.table}: ${m.formula}`,
        });
      }

      return candidates
        .filter(
          (item) =>
            item.token.toLowerCase().includes(searchToken) ||
            item.description.toLowerCase().includes(searchToken),
        )
        .slice(0, 8);
    },
  );

  public readonly displayedRows = computed<readonly TableRowData[]>(() => {
    const tbl = this.activeTable();
    if (!tbl) return [];

    const rawRows =
      this.tableDataStore()[tbl.name] ?? this.state.tableRows(tbl.name);
    const sortColName = this.sortColumn();
    const sortDir = this.sortDirection();

    if (!sortColName) return rawRows;

    const colMeta = tbl.columns.find((c) => c.name === sortColName);
    const effectiveSortKey = colMeta?.sortByColumn || sortColName;

    return [...rawRows].sort((a, b) => {
      const valA = a[effectiveSortKey] ?? a[sortColName];
      const valB = b[effectiveSortKey] ?? b[sortColName];

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const comparison =
        typeof valA === "number" && typeof valB === "number"
          ? valA - valB
          : String(valA).localeCompare(String(valB));
      return sortDir === "asc" ? comparison : -comparison;
    });
  });

  public readonly activeTableMeasures = computed<
    readonly RaxMeasureDescriptor[]
  >(() => {
    const tbl = this.activeTable();
    if (!tbl) return [];
    return this.state.measures.filter(
      (m) => m.table.toLowerCase() === tbl.name.toLowerCase(),
    );
  });

  constructor() {
    this.initSelection();
  }

  public ngOnInit(): void {
    this.initSelection();
    this.semanticModel
      .loadDefault()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload) => {
          const backendNames = new Set(
            (payload?.tables ?? []).map((t) => t.name.toLowerCase()),
          );
          const unsyncedLocal = this.state.sharedTables.filter(
            (t) => !backendNames.has(t.name.toLowerCase()),
          );

          if (payload?.tables?.length) {
            this.semanticModel.applyPayload(payload);
            for (const localTbl of unsyncedLocal) {
              this.state.addTable(localTbl);
            }
            if (!this.selectedTableName()) {
              this.selectedTableName.set(payload.tables[0].name);
            }
          }

          if (unsyncedLocal.length > 0) {
            this.syncBackend(unsyncedLocal);
          }

          const activeName = this.selectedTableName();
          if (activeName && this.displayedRows().length === 0) {
            this.fetchRows(activeName);
          }
        },
        error: (err: unknown) => {
          console.warn("[TableViewComponent] Default model load failed:", err);
        },
      });
  }

  public clearError(): void {
    this.semanticModel.clearError();
  }

  private syncBackend(tablesToIngest: readonly SharedTable[]): void {
    this.semanticModel
      .pushState(this.state)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (!res) return;
          for (const tbl of tablesToIngest) {
            const rows =
              this.tableDataStore()[tbl.name] ??
              this.state.tableRows(tbl.name);
            if (rows.length > 0) {
              this.semanticModel
                .ingestRows(tbl.name, rows)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe();
            }
          }
        },
        error: (err: unknown) => {
          console.warn("[TableViewComponent] Schema sync failed:", err);
        },
      });
  }

  private initSelection(): void {
    if (this.state.sharedTables.length === 0) {
      this.semanticModel.pullState(DEFAULT_SEMANTIC_MODEL, this.state);
    }
    if (this.state.sharedTables.length > 0 && !this.selectedTableName()) {
      const first = this.state.sharedTables[0];
      this.selectedTableName.set(first.name);
      if (first.columns.length > 0) {
        this.selectedColumnName.set(first.columns[0].name);
        const dateCol = first.columns.find(
          (c) =>
            c.dataType.toUpperCase().includes("DATE") ||
            c.name.toLowerCase().includes("date"),
        );
        this.dateColumnCandidate.set(
          first.dateColumn || dateCol?.name || first.columns[0]?.name || "",
        );
      }
    }
  }

  private fetchRows(tableName: string): void {
    this.semanticModel
      .fetchRows(tableName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          if (Array.isArray(rows) && rows.length > 0) {
            this.tableDataStore.update((store) => ({
              ...store,
              [tableName]: rows,
            }));
            this.state.setRows(tableName, rows);
          }
        },
        error: () => {},
      });
  }

  public loadRows(tableName: string, rows: readonly TableRowData[]): void {
    this.tableDataStore.update((store) => ({
      ...store,
      [tableName]: rows,
    }));
    this.state.setRows(tableName, rows);
    this.semanticModel
      .ingestRows(tableName, rows)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => {} });
  }

  public sectionExpanded(section: TableViewSection): boolean {
    return this.expandedSections()[section] ?? false;
  }

  public toggleSection(section: TableViewSection): void {
    this.expandedSections.update((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  public toggleAll(): void {
    const willExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Tables: willExpand,
      Columns: willExpand,
      Calculations: willExpand,
    });
  }

  public selectTable(tableName: string): void {
    this.selectedTableName.set(tableName);
    this.sortColumn.set(null);
    this.sortDirection.set("asc");
    const tbl = this.tables().find((t) => t.name === tableName);
    if (tbl) {
      this.formulaTarget.set(tbl.name);
      this.formulaText.set(tbl.expression || "");
      this.isFormulaActive.set(false);
      this.showFormulaSuggestions.set(false);
      this.selectedColumnName.set(tbl.columns[0]?.name || "");
      const dateCol = tbl.columns.find(
        (c) =>
          c.dataType.toUpperCase().includes("DATE") ||
          c.name.toLowerCase().includes("date"),
      );
      this.dateColumnCandidate.set(
        tbl.dateColumn || dateCol?.name || tbl.columns[0]?.name || "",
      );

      const existingRows =
        this.tableDataStore()[tbl.name] ?? this.state.tableRows(tbl.name);
      if (existingRows.length === 0) {
        this.fetchRows(tbl.name);
      }
      this.state.announce(
        `Inspecting table ${tableName} (${this.displayedRows().length} rows).`,
      );
    }
  }

  public selectColumn(columnName: string): void {
    this.selectedColumnName.set(columnName);
    const tbl = this.activeTable();
    if (!tbl) return;
    const col = tbl.columns.find((c) => c.name === columnName);
    if (col) {
      const expr =
        this.calculatedExpressions()[tbl.name]?.[columnName] || col.expression;
      if (expr) {
        this.formulaMode.set("column");
        this.formulaTarget.set(`[${columnName}]`);
        this.formulaText.set(expr);
      }
    }
  }

  public updateType(colName: string, dataType: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    this.semanticModel.clearError();
    this.semanticModel
      .patchColumn({ tableName: tbl.name, columnName: colName, dataType })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        this.state.announce(
          `Changed column [${colName}] data type to ${dataType}.`,
        );
      });
  }

  public columnType(col: SharedColumn): string {
    const raw = (col.dataType || "STRING").toUpperCase();
    if (STANDARD_DATA_TYPES.includes(raw)) return raw;
    if (raw.includes("CHAR") || raw.includes("TEXT") || raw.includes("STRING"))
      return "STRING";
    if (raw.includes("INT")) return raw.includes("64") ? "INT64" : "INT";
    if (raw.includes("FLOAT") || raw.includes("DOUBLE"))
      return raw.includes("64") ? "FLOAT64" : "FLOAT";
    if (raw.includes("DEC") || raw.includes("NUMERIC")) return "DECIMAL";
    if (raw.includes("DATE") || raw.includes("TIME"))
      return raw.includes("TIME") ? "DATETIME" : "DATE";
    if (raw.includes("BOOL")) return "BOOLEAN";
    return raw;
  }

  public customType(dataType: string | undefined): boolean {
    if (!dataType) return false;
    return !STANDARD_DATA_TYPES.includes(dataType.toUpperCase());
  }

  public updateSummarization(
    colName: string,
    summarizeBy: ColumnSummarization,
  ): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    this.semanticModel.clearError();
    this.semanticModel
      .patchColumn({ tableName: tbl.name, columnName: colName, summarizeBy })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const label = summarizeBy === "None" ? "Do not summarize" : summarizeBy;
        this.state.announce(`Set summarization for [${colName}] to ${label}.`);
      });
  }

  public updateSort(colName: string, sortByColumn: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    this.semanticModel.clearError();
    const normalized = sortByColumn.trim() || null;
    this.semanticModel
      .patchColumn({
        tableName: tbl.name,
        columnName: colName,
        sortByColumn: normalized,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        if (normalized) {
          this.state.announce(
            `Column [${colName}] configured to sort by [${normalized}].`,
          );
        } else {
          this.state.announce(`Cleared custom sort column for [${colName}].`);
        }
      });
  }

  public toggleHidden(colName: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    this.semanticModel.clearError();
    const current = tbl.columns.find((c) => c.name === colName);
    const nowHidden = !current?.isHidden;
    this.semanticModel
      .patchColumn({
        tableName: tbl.name,
        columnName: colName,
        isHidden: nowHidden,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        this.state.announce(
          nowHidden
            ? `Column [${colName}] hidden in Report View.`
            : `Column [${colName}] visible in Report View.`,
        );
      });
  }

  public setFormat(colName: string, format: ColumnDisplayFormat): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    this.semanticModel.clearError();
    const alignment: "left" | "right" | "center" =
      format === "Currency" ||
      format === "Percentage" ||
      format === "WholeNumber" ||
      format === "Decimal"
        ? "right"
        : format === "Date"
          ? "center"
          : "left";

    const prevFormats = this.columnFormats();
    const formatKey = `${tbl.name}.${colName}`;
    this.columnFormats.update((curr) => ({
      ...curr,
      [formatKey]: { format, alignment },
      [colName]: { format, alignment },
    }));

    this.semanticModel
      .patchColumn({ tableName: tbl.name, columnName: colName, format })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) {
          this.columnFormats.set(prevFormats);
          return;
        }
        this.state.announce(`Applied ${format} format to [${colName}].`);
      });
  }

  public toggleSort(columnName: string): void {
    this.selectColumn(columnName);
    if (this.sortColumn() === columnName) {
      if (this.sortDirection() === "asc") {
        this.sortDirection.set("desc");
        this.state.announce(`Sorted ${columnName} descending.`);
      } else {
        this.sortColumn.set(null);
        this.sortDirection.set("asc");
        this.state.announce(`Cleared sort on ${columnName}.`);
      }
    } else {
      this.sortColumn.set(columnName);
      this.sortDirection.set("asc");
      this.state.announce(`Sorted ${columnName} ascending.`);
    }
  }

  public inputFormula(value: string): void {
    this.formulaText.set(value);
    this.isFormulaActive.set(true);
    this.selectedSuggestionIndex.set(0);
    this.showFormulaSuggestions.set(value.trim().length > 0);
  }

  public keydownFormula(event: KeyboardEvent): void {
    const suggestions = this.formulaSuggestions();
    if (this.showFormulaSuggestions() && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectedSuggestionIndex.update(
          (i) => (i + 1) % suggestions.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.selectedSuggestionIndex.update(
          (i) => (i - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const chosen = suggestions[this.selectedSuggestionIndex()];
        if (chosen) {
          this.applySuggestion(chosen);
        }
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.showFormulaSuggestions.set(false);
      this.commitFormula();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (this.showFormulaSuggestions()) {
        this.showFormulaSuggestions.set(false);
      } else {
        this.cancelFormula();
      }
    }
  }

  public applySuggestion(suggestion: FormulaSuggestion): void {
    const current = this.formulaText();
    const replaced = current.replace(/([a-zA-Z0-9_.'[\]]+)$/, suggestion.token);
    this.formulaText.set(
      replaced === current ? `${current}${suggestion.token}` : replaced,
    );
    this.showFormulaSuggestions.set(false);
  }

  public createColumn(): void {
    const tbl = this.activeTable();
    if (!tbl) return;

    const baseColName = "NewColumn";
    let colName = baseColName;
    let counter = 1;
    while (tbl.columns.some((c) => c.name === colName)) {
      colName = `${baseColName}_${counter++}`;
    }

    const firstCol = tbl.columns[0]?.name || "column";
    this.formulaMode.set("column");
    this.formulaTarget.set(`[${colName}]`);
    this.formulaText.set(`'${tbl.name}'[${firstCol}]`);
    this.isFormulaActive.set(true);
    this.showFormulaSuggestions.set(false);
    this.state.announce(
      `Authoring calculated column ${colName} for table ${tbl.name}.`,
    );
  }

  public createTable(): void {
    const baseName = "CalculatedTable";
    let tblName = baseName;
    let counter = 1;
    while (this.tables().some((t) => t.name === tblName)) {
      tblName = `${baseName}_${counter++}`;
    }

    this.formulaMode.set("table");
    this.formulaTarget.set(tblName);
    this.formulaText.set("CALENDAR(DATE(2026, 1, 1), DATE(2026, 12, 31))");
    this.isFormulaActive.set(true);
    this.showFormulaSuggestions.set(false);
    this.state.announce(`Authoring calculated table ${tblName}.`);
  }

  public createMeasure(): void {
    const tbl = this.activeTable();
    if (!tbl) return;

    const measureId = `m-${Date.now()}`;
    const label = `Measure ${this.state.measures.length + 1}`;
    const firstCol = tbl.columns[0]?.name || "id";
    const formula = `CALCULATE(COUNT('${tbl.name}'[${firstCol}]))`;

    this.state.saveMeasure({
      id: measureId,
      label,
      formula,
      table: tbl.name,
    });

    this.formulaMode.set("measure");
    this.activeEditingMeasureId.set(measureId);
    this.formulaTarget.set(label);
    this.formulaText.set(formula);
    this.isFormulaActive.set(true);
    this.showFormulaSuggestions.set(false);

    this.semanticModel
      .pushState(this.state)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => {} });
    this.state.announce(`Created new measure ${label} on ${tbl.name}.`);
  }

  public editMeasure(measure: RaxMeasureDescriptor): void {
    this.formulaMode.set("measure");
    this.activeEditingMeasureId.set(measure.id);
    this.formulaTarget.set(measure.label);
    this.formulaText.set(measure.formula);
    this.isFormulaActive.set(true);
    this.showFormulaSuggestions.set(false);
    this.state.announce(`Editing explicit measure ${measure.label}.`);
  }

  public markDate(explicitDateColumn?: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;

    const candidateName =
      explicitDateColumn ||
      this.effectiveDateColumn() ||
      this.dateColumnCandidate();
    this.semanticModel
      .markDate(tbl.name, true, candidateName || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const updated = this.state.sharedTables.find((t) => t.name === tbl.name);
        const resolvedCol = updated?.dateColumn || candidateName;
        if (resolvedCol) {
          this.dateColumnCandidate.set(resolvedCol);
          this.state.announce(
            `Table ${tbl.name} marked as Date Table with primary key [${resolvedCol}].`,
          );
        } else {
          this.state.announce(`Table ${tbl.name} marked as Date Table.`);
        }
      });
  }

  public commitFormula(): void {
    const text = this.formulaText().trim();
    const target = this.formulaTarget().trim();
    const tbl = this.activeTable();

    this.showFormulaSuggestions.set(false);

    if (!target || !text) {
      this.isFormulaActive.set(false);
      return;
    }

    if (this.formulaMode() === "measure" && tbl && !target.startsWith("[")) {
      const upperText = text.toUpperCase();
      const isTableGeneratingExpr =
        upperText.startsWith("CALENDAR") ||
        upperText.startsWith("ADDCOLUMNS") ||
        upperText.startsWith("SUMMARIZECOLUMNS") ||
        upperText.includes("INFO.VIEW.");

      if (!isTableGeneratingExpr) {
        const measureId = this.activeEditingMeasureId() || `m-${Date.now()}`;
        const cleanLabel = target.replace(/^\[|\]$/g, "");
        this.state.saveMeasure({
          id: measureId,
          label: cleanLabel,
          formula: text,
          table: tbl.name,
        });
        this.semanticModel
          .pushState(this.state)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({ error: () => {} });
        this.isFormulaActive.set(false);
        this.state.announce(
          `Updated explicit measure ${cleanLabel} on ${tbl.name}.`,
        );
        return;
      }
    }

    if (target.startsWith("[") && target.endsWith("]") && tbl) {
      const colName = target.slice(1, -1).trim();
      const sourceRows =
        this.tableDataStore()[tbl.name] ?? this.state.tableRows(tbl.name);
      this.semanticModel.clearError();

      this.semanticModel
        .ensureTable(tbl.name)
        .pipe(
          switchMap(() =>
            this.rax.evalColumn({
              modelId: this.semanticModel.modelId(),
              tableName: tbl.name,
              columnName: colName,
              formula: text,
              rows: sourceRows,
            }),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: (res) => {
            this.semanticModel.markTable(tbl.name);
            this.loadRows(tbl.name, res.rows);
            this.selectedColumnName.set(colName);
            this.semanticModel
              .pushState(this.state)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                error: (err: unknown) =>
                  console.warn("[TableViewComponent] pushState failed:", err),
              });
            this.state.announce(
              `Calculated column ${target} committed successfully on ${tbl.name}.`,
            );
            this.isFormulaActive.set(false);
          },
          error: (err: unknown) => {
            console.warn(
              "[TableViewComponent] Calculated column evaluation error:",
              err,
            );
          },
        });
      return;
    }

    const newTableName = target.replace(/^\[|\]$/g, "").trim();
    const upperExpr = text.toUpperCase();
    const isTableFormula =
      this.formulaMode() === "table" ||
      upperExpr.includes("CALENDAR") ||
      upperExpr.includes("ADDCOLUMNS") ||
      upperExpr.includes("SUMMARIZECOLUMNS") ||
      upperExpr.includes("INFO.");
    /** Route untyped formula bar edits to calculated column when formulaMode is column and active table exists. */
    if (!isTableFormula && this.formulaMode() === "column" && tbl) {
      const sourceRows =
        this.tableDataStore()[tbl.name] ?? this.state.tableRows(tbl.name);
      this.semanticModel.clearError();
      this.semanticModel
        .ensureTable(tbl.name)
        .pipe(
          switchMap(() =>
            this.rax.evalColumn({
              modelId: this.semanticModel.modelId(),
              tableName: tbl.name,
              columnName: newTableName,
              formula: text,
              rows: sourceRows,
            }),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: (res) => {
            this.semanticModel.markTable(tbl.name);
            this.loadRows(tbl.name, res.rows);
            this.selectedColumnName.set(newTableName);
            this.semanticModel
              .pushState(this.state)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                error: (err: unknown) =>
                  console.warn("[TableViewComponent] pushState failed:", err),
              });
            this.state.announce(
              `Calculated column [${newTableName}] committed successfully on ${tbl.name}.`,
            );
            this.isFormulaActive.set(false);
          },
          error: (err: unknown) => {
            console.warn(
              "[TableViewComponent] Calculated column evaluation error:",
              err,
            );
          },
        });
      return;
    }

    this.semanticModel.clearError();
    this.rax
      .evalTable({
        modelId: this.semanticModel.modelId(),
        tableName: newTableName,
        formula: text,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const resolvedName = res.table.name || newTableName;
          this.semanticModel.markTable(resolvedName);
          this.loadRows(resolvedName, res.rows);
          this.selectTable(resolvedName);
          this.semanticModel
            .pushState(this.state)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              error: (err: unknown) =>
                console.warn("[TableViewComponent] pushState failed:", err),
            });
          this.state.announce(
            `Calculated table ${resolvedName} created from RAX expression (${res.rows.length} rows).`,
          );
          this.isFormulaActive.set(false);
        },
        error: (err: unknown) => {
          console.warn(
            "[TableViewComponent] Calculated table evaluation error:",
            err,
          );
        },
      });
  }

  public cancelFormula(): void {
    this.formulaText.set("");
    this.isFormulaActive.set(false);
    this.showFormulaSuggestions.set(false);
    this.state.announce("Formula authoring cancelled.");
  }

  public editColumn(colName: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;

    const existingExpr =
      this.calculatedExpressions()[tbl.name]?.[colName] ||
      tbl.columns.find((c) => c.name === colName)?.expression ||
      `'${tbl.name}'[${colName}]`;
    this.formulaMode.set("column");
    this.formulaTarget.set(`[${colName}]`);
    this.formulaText.set(existingExpr);
    this.isFormulaActive.set(true);
    this.selectedColumnName.set(colName);
  }

  public formatCell(val: unknown, col: SharedColumn): string {
    if (val === null || val === undefined) {
      return "—";
    }

    const tblName = this.activeTable()?.name || "";
    const explicitFormat =
      this.columnFormats()[`${tblName}.${col.name}`]?.format ??
      this.columnFormats()[col.name]?.format ??
      col.format;

    if (typeof val === "number") {
      if (explicitFormat === "Currency") {
        return `€${val.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      }
      if (explicitFormat === "Percentage") {
        return `${(val * 100).toFixed(1)}%`;
      }
      if (explicitFormat === "WholeNumber") {
        return Math.round(val).toLocaleString("en-US");
      }
      if (explicitFormat === "Decimal") {
        return val.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      }

      const type = col.dataType.toUpperCase();
      const name = col.name.toLowerCase();

      if (
        name.includes("amount") ||
        name.includes("revenue") ||
        name.includes("price") ||
        name.includes("prix") ||
        name.includes("cost") ||
        name.includes("cout") ||
        name.includes("coût") ||
        name.includes("profit") ||
        name.includes("montant") ||
        name.includes("cours") ||
        name.includes("chiffre") ||
        name.includes("affaires") ||
        name.includes("total") ||
        name.includes("eur") ||
        name.includes("usd")
      ) {
        return `€${val.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      }
      if (
        name.includes("pct") ||
        name.includes("rate") ||
        name.includes("margin")
      ) {
        return `${(val * 100).toFixed(1)}%`;
      }
      if (
        name.includes("year") ||
        name.includes("annee") ||
        col.summarizeBy === "None"
      ) {
        return String(val);
      }
      if (type.includes("INT") || Number.isInteger(val)) {
        return val.toLocaleString("en-US");
      }
      return val.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    if (typeof val === "boolean") {
      return val ? "True" : "False";
    }

    return String(val);
  }

  public columnAlignment(
    col: SharedColumn,
  ): "text-start" | "text-end" | "text-center" {
    const tblName = this.activeTable()?.name || "";
    const explicitAlign =
      this.columnFormats()[`${tblName}.${col.name}`]?.alignment ??
      this.columnFormats()[col.name]?.alignment;
    if (explicitAlign === "right") return "text-end";
    if (explicitAlign === "center") return "text-center";
    if (explicitAlign === "left") return "text-start";

    const type = col.dataType.toUpperCase();
    if (
      type.includes("INT") ||
      type.includes("DECIMAL") ||
      type.includes("FLOAT") ||
      type.includes("BIGINT")
    ) {
      return "text-end";
    }
    if (type.includes("BOOL") || type.includes("DATE")) {
      return "text-center";
    }
    return "text-start";
  }
}
