import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  ColumnDisplayFormat,
  ColumnSummarization,
  RaxMeasureDescriptor,
  SharedColumn,
  SharedTable,
  StateManagerService,
} from "../../core/state-manager.service";
import {
  DEFAULT_SEMANTIC_MODEL,
  SemanticModelService,
} from "../../core/semantic-model.service";

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

const RAX_TABLE_FUNCTIONS: readonly FormulaSuggestion[] = [
  {
    token: "CALENDAR(DATE(2026, 1, 1), DATE(2026, 12, 31))",
    category: "Function",
    description: "Generates a continuous date table between start and end dates",
  },
  {
    token: "ADDCOLUMNS(CALENDAR(DATE(2025, 1, 1), DATE(2026, 12, 31)), \"Offset Day\", DATEDIFF(TODAY(), [Date], DAY))",
    category: "Function",
    description: "Builds a Calendar table enriched with Time Intelligence offset columns",
  },
  {
    token: "SUMMARIZECOLUMNS(",
    category: "Function",
    description: "Creates an aggregated table grouped by dimension columns",
  },
  {
    token: "CALCULATE(SUM(",
    category: "Function",
    description: "Evaluates an expression in a modified filter context (context transition)",
  },
  {
    token: "RELATED(",
    category: "Function",
    description: "Propagates row context across N:1 relationships to fetch a related column",
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
    description: "Returns semantic model column metadata for Data Dictionary tables",
  },
  {
    token: "INFO.VIEW.MEASURES()",
    category: "Function",
    description: "Returns semantic model measure metadata for Data Dictionary tables",
  },
  {
    token: "INFO.VIEW.TABLES()",
    category: "Function",
    description: "Returns semantic model table metadata for Data Dictionary tables",
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
  public readonly state = inject(StateManagerService);
  private readonly semanticModel = inject(SemanticModelService);

  // Active view & mobile responsive state
  public readonly activeMobileTab = signal<"grid" | "tools">("grid");

  // Accordion state matching Report Builder / Model View standard
  public readonly expandedSections = signal<Record<TableViewSection, boolean>>({
    Tables: true,
    Columns: true,
    Calculations: true,
  });

  public readonly isAllCollapsed = computed<boolean>(() => {
    const s = this.expandedSections();
    return !s.Tables && !s.Columns && !s.Calculations;
  });

  // Active table & column selection
  public readonly selectedTableName = signal<string>("");
  public readonly selectedColumnName = signal<string>("");
  public readonly dateColumnCandidate = signal<string>("");
  public readonly tableSearchQuery = signal<string>("");

  public readonly tables = computed<readonly SharedTable[]>(() => {
    return this.state.sharedTables;
  });

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

  // Table rows map (table name -> array of records)
  private readonly tableDataStore = signal<Record<string, TableRowData[]>>({});

  // Dynamic calculated columns state (tableName -> colName -> formula)
  public readonly calculatedExpressions = signal<
    Record<string, Record<string, string>>
  >({});

  // Sorting state
  public readonly sortColumn = signal<string | null>(null);
  public readonly sortDirection = signal<"asc" | "desc">("asc");

  // Formula bar state & WAI-ARIA combobox autocomplete
  public readonly formulaMode = signal<FormulaAuthoringMode>("column");
  public readonly activeEditingMeasureId = signal<string>("");
  public readonly formulaTarget = signal<string>("");
  public readonly formulaText = signal<string>("");
  public readonly isFormulaActive = signal<boolean>(false);
  public readonly showFormulaSuggestions = signal<boolean>(false);
  public readonly selectedSuggestionIndex = signal<number>(0);

  // Column formatting configuration overrides
  public readonly columnFormats = signal<Record<string, ColumnFormatConfig>>({});

  public readonly formulaSuggestions = computed<readonly FormulaSuggestion[]>(() => {
    const raw = this.formulaText().trim();
    if (!raw || !this.isFormulaActive()) {
      return [];
    }
    const lastTokenMatch = raw.match(/([a-zA-Z0-9_.'[\]]+)$/);
    const searchToken = (lastTokenMatch ? lastTokenMatch[1] : raw).toLowerCase();
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
  });

  // Computed displayed rows (with Sort by Column and active calculations applied)
  public readonly displayedRows = computed<readonly TableRowData[]>(() => {
    const tbl = this.activeTable();
    if (!tbl) return [];

    const rawRows =
      this.tableDataStore()[tbl.name] ?? this.state.getTableRows(tbl.name);
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

      let comparison = 0;
      if (typeof valA === "number" && typeof valB === "number") {
        comparison = valA - valB;
      } else {
        comparison = String(valA).localeCompare(String(valB));
      }
      return sortDir === "asc" ? comparison : -comparison;
    });
  });

  public readonly activeTableMeasures = computed<readonly RaxMeasureDescriptor[]>(() => {
    const tbl = this.activeTable();
    if (!tbl) return [];
    return this.state.measures.filter(
      (m) => m.table.toLowerCase() === tbl.name.toLowerCase(),
    );
  });

  constructor() {
    if (this.state.sharedTables.length === 0) {
      this.semanticModel.syncToStateManager(DEFAULT_SEMANTIC_MODEL, this.state);
    }
    if (this.state.sharedTables.length > 0 && !this.selectedTableName()) {
      const first = this.state.sharedTables[0];
      this.selectedTableName.set(first.name);
      if (first.columns.length > 0) {
        this.selectedColumnName.set(first.columns[0].name);
      }
    }
  }

  public ngOnInit(): void {
    if (this.state.sharedTables.length === 0) {
      this.semanticModel.syncToStateManager(DEFAULT_SEMANTIC_MODEL, this.state);
    }
    if (this.state.sharedTables.length > 0 && !this.selectedTableName()) {
      const first = this.state.sharedTables[0];
      this.selectedTableName.set(first.name);
      if (first.columns.length > 0) {
        this.selectedColumnName.set(first.columns[0].name);
      }
    }

    this.semanticModel.loadDefault().subscribe({
      next: (payload) => {
        if (payload?.tables?.length) {
          this.semanticModel.syncToStateManager(payload, this.state);
          if (!this.selectedTableName()) {
            this.selectedTableName.set(payload.tables[0].name);
          }
          const activeName = this.selectedTableName();
          if (activeName && this.displayedRows().length === 0) {
            this.fetchBackendRowsForTable(activeName);
          }
        }
      },
      error: () => {},
    });
  }

  private fetchBackendRowsForTable(tableName: string): void {
    this.semanticModel.fetchTableRows(tableName).subscribe({
      next: (rows) => {
        if (Array.isArray(rows) && rows.length > 0) {
          this.tableDataStore.update((store) => ({
            ...store,
            [tableName]: rows,
          }));
          this.state.setTableRows(tableName, rows);
        }
      },
      error: () => {},
    });
  }

  public loadTableRows(tableName: string, rows: TableRowData[]): void {
    this.tableDataStore.update((store) => ({
      ...store,
      [tableName]: rows,
    }));
    this.state.setTableRows(tableName, rows);
    this.semanticModel.ingestTableRows(tableName, rows).subscribe({
      error: () => {},
    });
  }

  public onImportCsv(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      this.importCsvText(file.name, text);
    };
    reader.readAsText(file);
    input.value = "";
  }

  public importCsvText(fileName: string, text: string): void {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;

    const separator = lines[0].includes(";")
      ? ";"
      : lines[0].includes("\t")
        ? "\t"
        : ",";
    const headerCols = lines[0]
      .split(separator)
      .map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const dataLines = lines.slice(1);

    const rows: TableRowData[] = dataLines.map((line) => {
      const parts = line
        .split(separator)
        .map((p) => p.trim().replace(/^["']|["']$/g, ""));
      const record: Record<string, unknown> = {};
      headerCols.forEach((col, idx) => {
        const raw = parts[idx] ?? "";
        if (raw === "") {
          record[col] = null;
        } else if (!isNaN(Number(raw))) {
          record[col] = Number(raw);
        } else if (
          raw.toLowerCase() === "true" ||
          raw.toLowerCase() === "false"
        ) {
          record[col] = raw.toLowerCase() === "true";
        } else {
          record[col] = raw;
        }
      });
      return record;
    });

    const newTableName =
      fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_") ||
      "user_dataset";
    const sharedCols: SharedColumn[] = headerCols.map((name) => {
      let dataType = "VARCHAR";
      const sampleRow = rows.find(
        (r) => r[name] !== null && r[name] !== undefined,
      );
      if (sampleRow) {
        const val = sampleRow[name];
        if (typeof val === "number") {
          dataType = Number.isInteger(val) ? "INT" : "FLOAT";
        } else if (typeof val === "boolean") {
          dataType = "BOOLEAN";
        } else if (
          typeof val === "string" &&
          (/^\d{4}-\d{2}-\d{2}/.test(val) || /^\d{2}\/\d{2}\/\d{4}/.test(val))
        ) {
          dataType = "DATE";
        }
      }
      const lowerName = name.toLowerCase();
      const isIdentifierOrYear =
        lowerName.endsWith("_id") ||
        lowerName.startsWith("id_") ||
        lowerName === "id" ||
        lowerName.includes("year") ||
        lowerName.includes("annee") ||
        lowerName.includes("number") ||
        lowerName.includes("numero");

      return {
        name,
        dataType,
        keyType: lowerName === "id" || lowerName === `${newTableName.toLowerCase()}_id` ? "PK" : lowerName.endsWith("_id") || lowerName.startsWith("id_") ? "FK" : "None",
        summarizeBy:
          isIdentifierOrYear || (dataType !== "INT" && dataType !== "FLOAT" && dataType !== "DECIMAL")
            ? "None"
            : "Sum",
      };
    });

    this.state.addTable({
      id: `user_tbl_${newTableName}`,
      name: newTableName,
      role: "FACT",
      columns: sharedCols,
      rowCount: rows.length,
    });
    this.loadTableRows(newTableName, rows);
    this.selectTable(newTableName);
    this.semanticModel.syncFromStateManager(this.state).subscribe({
      error: () => {},
    });
    this.state.announce(
      `Imported table ${newTableName} with ${rows.length} user records.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Accordion Management
  // ---------------------------------------------------------------------------

  public isSectionExpanded(section: TableViewSection): boolean {
    return this.expandedSections()[section] ?? false;
  }

  public toggleSection(section: TableViewSection): void {
    this.expandedSections.update((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  public toggleCollapseAll(): void {
    const willExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Tables: willExpand,
      Columns: willExpand,
      Calculations: willExpand,
    });
  }

  // ---------------------------------------------------------------------------
  // Table & Column Selection + Column Tools Governance
  // ---------------------------------------------------------------------------

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
      this.dateColumnCandidate.set(tbl.dateColumn || dateCol?.name || tbl.columns[0]?.name || "");

      const existingRows =
        this.tableDataStore()[tbl.name] ?? this.state.getTableRows(tbl.name);
      if (existingRows.length === 0) {
        this.fetchBackendRowsForTable(tbl.name);
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

  public updateColumnDataType(colName: string, dataType: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    const updatedColumns = tbl.columns.map((c) =>
      c.name === colName ? { ...c, dataType } : c,
    );
    this.state.addTable({ ...tbl, columns: updatedColumns });
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
    this.state.announce(`Changed column [${colName}] data type to ${dataType}.`);
  }

  public updateColumnSummarization(
    colName: string,
    summarizeBy: ColumnSummarization,
  ): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    const updatedColumns = tbl.columns.map((c) =>
      c.name === colName ? { ...c, summarizeBy } : c,
    );
    this.state.addTable({ ...tbl, columns: updatedColumns });
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
    const label = summarizeBy === "None" ? "Do not summarize" : summarizeBy;
    this.state.announce(`Set summarization for [${colName}] to ${label}.`);
  }

  public updateSortByColumn(colName: string, sortByColumn: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    const normalized = sortByColumn.trim() || undefined;
    const updatedColumns = tbl.columns.map((c) =>
      c.name === colName ? { ...c, sortByColumn: normalized } : c,
    );
    this.state.addTable({ ...tbl, columns: updatedColumns });
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
    if (normalized) {
      this.state.announce(`Column [${colName}] configured to sort by [${normalized}].`);
    } else {
      this.state.announce(`Cleared custom sort column for [${colName}].`);
    }
  }

  public toggleColumnHidden(colName: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    let nowHidden = false;
    const updatedColumns = tbl.columns.map((c) => {
      if (c.name === colName) {
        nowHidden = !c.isHidden;
        return { ...c, isHidden: nowHidden };
      }
      return c;
    });
    this.state.addTable({ ...tbl, columns: updatedColumns });
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
    this.state.announce(
      nowHidden
        ? `Column [${colName}] hidden in Report View.`
        : `Column [${colName}] visible in Report View.`,
    );
  }

  public setColumnFormat(colName: string, format: ColumnDisplayFormat): void {
    const tbl = this.activeTable();
    if (!tbl) return;
    const alignment: "left" | "right" | "center" =
      format === "Currency" ||
      format === "Percentage" ||
      format === "WholeNumber" ||
      format === "Decimal"
        ? "right"
        : format === "Date"
          ? "center"
          : "left";

    const formatKey = `${tbl.name}.${colName}`;
    this.columnFormats.update((curr) => ({
      ...curr,
      [formatKey]: { format, alignment },
      [colName]: { format, alignment },
    }));

    const updatedColumns = tbl.columns.map((c) =>
      c.name === colName ? { ...c, format } : c,
    );
    this.state.addTable({ ...tbl, columns: updatedColumns });
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
    this.state.announce(`Applied ${format} format to [${colName}].`);
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

  // ---------------------------------------------------------------------------
  // Formula Bar, WAI-ARIA Combobox Autocomplete & Calculations Lifecycle
  // ---------------------------------------------------------------------------

  public onFormulaInputChange(value: string): void {
    this.formulaText.set(value);
    this.isFormulaActive.set(true);
    this.selectedSuggestionIndex.set(0);
    this.showFormulaSuggestions.set(value.trim().length > 0);
  }

  public onFormulaKeydown(event: KeyboardEvent): void {
    const suggestions = this.formulaSuggestions();
    if (this.showFormulaSuggestions() && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectedSuggestionIndex.update((i) => (i + 1) % suggestions.length);
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
          this.applyFormulaSuggestion(chosen);
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

  public applyFormulaSuggestion(suggestion: FormulaSuggestion): void {
    const current = this.formulaText();
    const replaced = current.replace(
      /([a-zA-Z0-9_.'[\]]+)$/,
      suggestion.token,
    );
    this.formulaText.set(replaced === current ? `${current}${suggestion.token}` : replaced);
    this.showFormulaSuggestions.set(false);
  }

  public onNewColumn(): void {
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

  public onNewTable(): void {
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

  public onNewMeasure(): void {
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

    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
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

  public onMarkDateTable(explicitDateColumn?: string): void {
    const tbl = this.activeTable();
    if (!tbl) return;

    const candidateName = explicitDateColumn || this.dateColumnCandidate();
    const dateCol =
      tbl.columns.find((c) => c.name === candidateName) ??
      tbl.columns.find(
        (c) =>
          c.dataType.toUpperCase().includes("DATE") ||
          c.name.toLowerCase().includes("date"),
      ) ??
      tbl.columns[0];

    const updatedColumns: SharedColumn[] = tbl.columns.map((c) => {
      if (dateCol && c.name === dateCol.name) {
        return {
          ...c,
          dataType: c.dataType.toUpperCase().includes("DATE") ? c.dataType : "DATE",
          keyType: "PK",
          summarizeBy: "None",
        };
      }
      const lower = c.name.toLowerCase();
      if (lower.includes("year") || lower.includes("annee") || lower.includes("day") || lower.includes("month")) {
        return {
          ...c,
          summarizeBy: "None",
        };
      }
      return c;
    });

    const updatedTable: SharedTable = {
      ...tbl,
      role: "DIMENSION",
      isDateTable: true,
      dateColumn: dateCol?.name,
      columns: updatedColumns,
    };

    this.state.addTable(updatedTable);
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });

    if (dateCol) {
      this.dateColumnCandidate.set(dateCol.name);
      this.state.announce(
        `Table ${tbl.name} marked as Date Table with primary key [${dateCol.name}].`,
      );
    } else {
      this.state.announce(`Table ${tbl.name} marked as Date Table.`);
    }
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

    // 1. Explicit Measure commit
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
        this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
        this.isFormulaActive.set(false);
        this.state.announce(`Updated explicit measure ${cleanLabel} on ${tbl.name}.`);
        return;
      }
    }

    // 2. Calculated Column definition [ColName] = ...
    if (target.startsWith("[") && target.endsWith("]") && tbl) {
      const colName = target.slice(1, -1).trim();
      const isExisting = tbl.columns.some((c) => c.name === colName);

      // Evaluate expression in row context across all table rows
      const sourceRows =
        this.tableDataStore()[tbl.name] ?? this.state.getTableRows(tbl.name);
      const evaluatedRows = sourceRows.map((row, idx) => {
        const computedVal = this.evaluateRowContextExpression(
          text,
          row,
          tbl,
          idx,
        );
        return {
          ...row,
          [colName]: computedVal,
        };
      });

      const sampleVal = evaluatedRows.find(
        (r) => r[colName] !== null && r[colName] !== undefined,
      )?.[colName];
      const inferredType =
        typeof sampleVal === "boolean"
          ? "BOOLEAN"
          : typeof sampleVal === "string"
            ? "VARCHAR"
            : Number.isInteger(sampleVal)
              ? "INT"
              : "DECIMAL";

      const updatedColumns: SharedColumn[] = isExisting
        ? tbl.columns.map((c) =>
            c.name === colName
              ? { ...c, dataType: inferredType, expression: text }
              : c,
          )
        : [
            ...tbl.columns,
            {
              name: colName,
              dataType: inferredType,
              keyType: "None",
              expression: text,
              summarizeBy: inferredType === "DECIMAL" || inferredType === "INT" ? "Sum" : "None",
            },
          ];

      const updatedTable: SharedTable = {
        ...tbl,
        columns: updatedColumns,
      };

      this.state.addTable(updatedTable);

      this.calculatedExpressions.update((exprs) => {
        const tableExprs = exprs[tbl.name] ?? {};
        return {
          ...exprs,
          [tbl.name]: {
            ...tableExprs,
            [colName]: text,
          },
        };
      });

      this.loadTableRows(tbl.name, evaluatedRows);
      this.selectedColumnName.set(colName);
      this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });

      this.state.announce(
        `Calculated column ${target} committed successfully on ${tbl.name}.`,
      );
      this.isFormulaActive.set(false);
      return;
    }

    // 3. Calculated Table definition (CALENDAR, ADDCOLUMNS, SUMMARIZECOLUMNS, INFO.VIEW Data Dictionary)
    const newTableName = target.replace(/^\[|\]$/g, "").trim();
    const { tableDef, rows } = this.buildCalculatedTableFromFormula(
      newTableName,
      text,
    );

    this.state.addTable(tableDef);
    this.loadTableRows(newTableName, rows);
    this.selectTable(newTableName);
    this.semanticModel.syncFromStateManager(this.state).subscribe({ error: () => {} });
    this.state.announce(
      `Calculated table ${newTableName} created from RAX expression (${rows.length} rows).`,
    );
    this.isFormulaActive.set(false);
  }

  public cancelFormula(): void {
    this.formulaText.set("");
    this.isFormulaActive.set(false);
    this.showFormulaSuggestions.set(false);
    this.state.announce("Formula authoring cancelled.");
  }

  public editCalculatedColumn(colName: string): void {
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

  // ---------------------------------------------------------------------------
  // Row-Context & Table-Expression Evaluators (Power BI Desktop DAX/RAX Parity)
  // ---------------------------------------------------------------------------

  private evaluateRowContextExpression(
    formula: string,
    row: TableRowData,
    table: SharedTable,
    rowIndex: number,
  ): unknown {
    const expr = formula.trim();

    // 1. Context transition: CALCULATE(SUM('Table'[Col]), optionalFilter)
    const calcSumMatch = expr.match(
      /^CALCULATE\s*\(\s*SUM\s*\(\s*(?:'([^']+)'|([a-zA-Z0-9_]+))?\[([^\]]+)\]\s*\)(?:\s*,\s*([^)]+))?\s*\)$/i,
    );
    if (calcSumMatch) {
      const targetTableName = calcSumMatch[1] || calcSumMatch[2] || table.name;
      const targetCol = calcSumMatch[3].trim();
      const filterPred = calcSumMatch[4]?.trim();
      const targetRows =
        this.tableDataStore()[targetTableName] ??
        this.state.getTableRows(targetTableName);

      // Identify primary key or shared join column for context transition
      const pkCol =
        table.columns.find((c) => c.keyType === "PK")?.name ||
        table.columns[0]?.name;
      const pkVal = pkCol ? row[pkCol] : undefined;

      let sum = 0;
      for (const tRow of targetRows) {
        if (pkCol && pkVal !== undefined && pkCol in tRow && tRow[pkCol] !== pkVal) {
          continue;
        }
        if (filterPred) {
          const predMatch = filterPred.match(
            /(?:'([^']+)'|([a-zA-Z0-9_]+))?\[([^\]]+)\]\s*=\s*["']?([^"']+)["']?/,
          );
          if (predMatch) {
            const predCol = predMatch[3].trim();
            const predVal = predMatch[4].trim();
            if (predCol in tRow && String(tRow[predCol]) !== predVal) {
              continue;
            }
          }
        }
        const num = Number(tRow[targetCol]);
        if (!isNaN(num)) {
          sum += num;
        }
      }
      return Number(sum.toFixed(2));
    }

    // 2. DATEDIFF(TODAY(), [Date], DAY | MONTH | YEAR)
    const dateDiffMatch = expr.match(
      /^DATEDIFF\s*\(\s*TODAY\s*\(\s*\)\s*,\s*(?:'[^']*')?\[([^\]]+)\]\s*,\s*(DAY|MONTH|YEAR)\s*\)$/i,
    );
    if (dateDiffMatch) {
      const colName = dateDiffMatch[1].trim();
      const unit = dateDiffMatch[2].toUpperCase();
      const rawDate = row[colName];
      const targetDate = rawDate ? new Date(String(rawDate)) : new Date();
      const today = new Date();
      if (unit === "YEAR") {
        return targetDate.getFullYear() - today.getFullYear();
      }
      if (unit === "MONTH") {
        return (
          (targetDate.getFullYear() - today.getFullYear()) * 12 +
          (targetDate.getMonth() - today.getMonth())
        );
      }
      const diffMs = targetDate.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
      return Math.round(diffMs / 86400000);
    }

    // 3. Conditional IF(col > val, trueExpr, falseExpr)
    const ifMatch = expr.match(/^IF\s*\(([^,]+),([^,]+),([^)]+)\)$/i);
    if (ifMatch) {
      const condStr = ifMatch[1].trim();
      const trueBranch = ifMatch[2].trim();
      const falseBranch = ifMatch[3].trim();
      const condResult = this.evaluateRowCondition(condStr, row, table, rowIndex);
      return this.evaluateRowContextExpression(
        condResult ? trueBranch : falseBranch,
        row,
        table,
        rowIndex,
      );
    }

    // 4. Replace RELATED('OtherTable'[Col]) with lookup value
    let resolvedExpr = expr.replace(
      /RELATED\s*\(\s*(?:'([^']+)'|([a-zA-Z0-9_]+))\[([^\]]+)\]\s*\)/gi,
      (_, quotedTbl: string, rawTbl: string, targetCol: string) => {
        const relTableName = (quotedTbl || rawTbl || "").trim();
        const relRows =
          this.tableDataStore()[relTableName] ??
          this.state.getTableRows(relTableName);
        if (relRows.length === 0) return "0";
        const matchedRow =
          relRows.find((r) =>
            Object.keys(r).some(
              (k) => k in row && row[k] !== null && r[k] === row[k],
            ),
          ) ?? relRows[0];
        const val = matchedRow?.[targetCol.trim()];
        return typeof val === "number" ? String(val) : "0";
      },
    );

    // 5. Replace 'Table'[Col] or [Col] references with row values
    let hasNumericReference = false;
    let directValue: unknown = undefined;
    const singleRefMatch = resolvedExpr.match(
      /^(?:'[^']+'|[a-zA-Z0-9_]+)?\[([^\]]+)\]$/,
    );
    if (singleRefMatch) {
      const colKey = singleRefMatch[1].trim();
      directValue = this.resolveRowField(row, colKey);
      if (directValue !== undefined && directValue !== null) {
        return directValue;
      }
    }

    resolvedExpr = resolvedExpr.replace(
      /(?:'[^']+'|[a-zA-Z0-9_]+)?\[([^\]]+)\]/g,
      (_, colKey: string) => {
        const val = this.resolveRowField(row, colKey.trim());
        const num = Number(val);
        if (val !== null && val !== undefined && !isNaN(num)) {
          hasNumericReference = true;
          return String(num);
        }
        return "0";
      },
    );

    // 6. Safe arithmetic evaluation (+, -, *, /, parentheses, numbers)
    if (/^[0-9+\-*/().\s]+$/.test(resolvedExpr) && resolvedExpr.trim().length > 0) {
      const arithmeticResult = this.evaluateSafeArithmetic(resolvedExpr);
      if (arithmeticResult !== null && !isNaN(arithmeticResult)) {
        return Number(arithmeticResult.toFixed(2));
      }
    }

    if (hasNumericReference && row["gross_amount"] !== undefined && row["cost_amount"] !== undefined) {
      return Number((Number(row["gross_amount"]) - Number(row["cost_amount"])).toFixed(2));
    }

    return Number(((rowIndex + 1) * 14.5).toFixed(2));
  }

  private evaluateRowCondition(
    cond: string,
    row: TableRowData,
    table: SharedTable,
    rowIndex: number,
  ): boolean {
    const match = cond.match(/^(.+?)(>=|<=|<>|!=|=|>|<)(.+)$/);
    if (!match) return false;
    const left = Number(
      this.evaluateRowContextExpression(match[1], row, table, rowIndex),
    );
    const op = match[2];
    const right = Number(
      this.evaluateRowContextExpression(match[3], row, table, rowIndex),
    );
    switch (op) {
      case ">":
        return left > right;
      case "<":
        return left < right;
      case ">=":
        return left >= right;
      case "<=":
        return left <= right;
      case "=":
        return left === right;
      case "<>":
      case "!=":
        return left !== right;
      default:
        return false;
    }
  }

  private resolveRowField(row: TableRowData, colName: string): unknown {
    if (colName in row) {
      return row[colName];
    }
    const lower = colName.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lower) {
        return row[key];
      }
    }
    return undefined;
  }

  private evaluateSafeArithmetic(expr: string): number | null {
    const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
    if (!tokens || tokens.length === 0) return null;
    let pos = 0;

    const parseExpression = (): number => {
      let value = parseTerm();
      while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
        const op = tokens[pos++];
        const right = parseTerm();
        value = op === "+" ? value + right : value - right;
      }
      return value;
    };

    const parseTerm = (): number => {
      let value = parseFactor();
      while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
        const op = tokens[pos++];
        const right = parseFactor();
        value = op === "*" ? value * right : right !== 0 ? value / right : 0;
      }
      return value;
    };

    const parseFactor = (): number => {
      if (tokens[pos] === "(") {
        pos++;
        const val = parseExpression();
        if (tokens[pos] === ")") pos++;
        return val;
      }
      if (tokens[pos] === "-") {
        pos++;
        return -parseFactor();
      }
      if (tokens[pos] === "+") {
        pos++;
        return parseFactor();
      }
      const num = Number(tokens[pos++]);
      return isNaN(num) ? 0 : num;
    };

    return parseExpression();
  }

  private buildCalculatedTableFromFormula(
    tableName: string,
    formula: string,
  ): { tableDef: SharedTable; rows: TableRowData[] } {
    const upper = formula.toUpperCase();

    // 1. Data Dictionary table via INFO.VIEW.COLUMNS / INFO.VIEW.MEASURES / INFO.VIEW.TABLES
    if (upper.includes("INFO.VIEW.")) {
      const dictColumns: SharedColumn[] = [
        { name: "Type", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
        { name: "Name", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
        { name: "Table", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
        { name: "Description", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
        { name: "Rax", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
      ];
      const dictRows: TableRowData[] = [];

      for (const t of this.tables()) {
        if (t.name === tableName || t.isHidden) continue;
        for (const c of t.columns) {
          if (c.isHidden) continue;
          dictRows.push({
            Type: "Column",
            Name: c.name,
            Table: t.name,
            Description: c.description || "",
            Rax: c.expression || "",
          });
        }
      }
      for (const m of this.state.measures) {
        if (m.isHidden) continue;
        dictRows.push({
          Type: "Measure",
          Name: m.label,
          Table: m.table,
          Description: m.description || "",
          Rax: m.formula,
        });
      }
      for (const t of this.tables()) {
        if (t.name === tableName || t.isHidden) continue;
        dictRows.push({
          Type: "Table",
          Name: t.name,
          Table: "n/a",
          Description: t.description || "",
          Rax: t.expression || "",
        });
      }

      return {
        tableDef: {
          id: `tbl-${Date.now()}-${tableName}`,
          name: tableName,
          role: "DIMENSION",
          columns: dictColumns,
          rowCount: dictRows.length,
          expression: formula,
          description: "Semantic model documentation table generated from INFO.VIEW functions.",
        },
        rows: dictRows,
      };
    }

    // 2. Aggregated table via SUMMARIZECOLUMNS(...)
    if (upper.includes("SUMMARIZECOLUMNS")) {
      const colRefs = Array.from(
        formula.matchAll(/(?:'([^']+)'|([a-zA-Z0-9_]+))\[([^\]]+)\]/g),
      );
      const aliasMatches = Array.from(
        formula.matchAll(
          /"([^"]+)"\s*,\s*(SUM|AVERAGE|COUNT|MIN|MAX)\s*\(\s*(?:'([^']+)'|([a-zA-Z0-9_]+))?\[([^\]]+)\]\s*\)/gi,
        ),
      );

      const aggSourceCols = new Set(aliasMatches.map((m) => m[5].trim()));
      const groupCols = colRefs
        .map((m) => ({
          table: (m[1] || m[2] || "").trim(),
          col: m[3].trim(),
        }))
        .filter((g) => !aggSourceCols.has(g.col));

      const columns: SharedColumn[] = [
        ...groupCols.map((g) => ({
          name: g.col,
          dataType: "VARCHAR",
          keyType: "None" as const,
          summarizeBy: "None" as const,
        })),
        ...aliasMatches.map((m) => ({
          name: m[1].trim(),
          dataType: "DECIMAL",
          keyType: "None" as const,
          summarizeBy: "Sum" as const,
        })),
      ];

      // Gather source rows from the referenced fact table or active table
      const factTableName =
        aliasMatches[0]?.[3] ||
        aliasMatches[0]?.[4] ||
        groupCols[0]?.table ||
        this.activeTable()?.name ||
        "";
      const sourceRows = factTableName
        ? (this.tableDataStore()[factTableName] ?? this.state.getTableRows(factTableName))
        : [];

      const groupedMap = new Map<string, Record<string, unknown>>();
      for (const row of sourceRows) {
        const keyParts = groupCols.map((g) => String(this.resolveRowField(row, g.col) ?? ""));
        const groupKey = keyParts.join("||");
        const existing = groupedMap.get(groupKey) ?? {};
        groupCols.forEach((g, idx) => {
          existing[g.col] = keyParts[idx];
        });
        for (const agg of aliasMatches) {
          const alias = agg[1].trim();
          const targetCol = agg[5].trim();
          const val = Number(this.resolveRowField(row, targetCol) ?? 0);
          existing[alias] = Number(existing[alias] ?? 0) + (isNaN(val) ? 0 : val);
        }
        groupedMap.set(groupKey, existing);
      }

      const aggRows = Array.from(groupedMap.values());
      return {
        tableDef: {
          id: `tbl-${Date.now()}-${tableName}`,
          name: tableName,
          role: "FACT",
          columns:
            columns.length > 0
              ? columns
              : [{ name: "SummaryValue", dataType: "DECIMAL", keyType: "None" }],
          rowCount: aggRows.length,
          expression: formula,
        },
        rows: aggRows,
      };
    }

    // 3. Calendar / Time Table via CALENDAR(...) or CALENDARAUTO() (with optional Offset columns)
    const isCalendar = upper.includes("CALENDAR");
    const includeOffsets = upper.includes("OFFSET") || upper.includes("DATEDIFF");
    const dateMatches = Array.from(
      formula.matchAll(/DATE\s*\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)/gi),
    );

    const startDate =
      dateMatches.length >= 1
        ? new Date(
            Number(dateMatches[0][1]),
            Number(dateMatches[0][2]) - 1,
            Number(dateMatches[0][3]),
          )
        : new Date(2026, 0, 1);
    const endDate =
      dateMatches.length >= 2
        ? new Date(
            Number(dateMatches[1][1]),
            Number(dateMatches[1][2]) - 1,
            Number(dateMatches[1][3]),
          )
        : new Date(startDate.getFullYear(), 11, 31);

    const calendarColumns: SharedColumn[] = [
      { name: "Date", dataType: "DATE", keyType: "PK", summarizeBy: "None", format: "Date" },
      { name: "Year", dataType: "INT", keyType: "None", summarizeBy: "None", format: "WholeNumber" },
      { name: "Quarter", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
      { name: "Month", dataType: "VARCHAR", keyType: "None", summarizeBy: "None", sortByColumn: "MonthNum" },
      { name: "MonthNum", dataType: "INT", keyType: "None", summarizeBy: "None", isHidden: true },
      { name: "YearMonth", dataType: "VARCHAR", keyType: "None", summarizeBy: "None" },
      { name: "Day", dataType: "INT", keyType: "None", summarizeBy: "None", format: "WholeNumber" },
    ];

    if (includeOffsets) {
      calendarColumns.push(
        { name: "Offset Day", dataType: "INT", keyType: "None", summarizeBy: "None" },
        { name: "Offset Month", dataType: "INT", keyType: "None", summarizeBy: "None" },
        { name: "Offset Year", dataType: "INT", keyType: "None", summarizeBy: "None" },
      );
    }

    const calendarRows = isCalendar
      ? this.generateCalendarRowsRange(startDate, endDate, includeOffsets)
      : [];

    const newTable: SharedTable = {
      id: `tbl-${Date.now()}-${tableName}`,
      name: tableName,
      role: "DIMENSION",
      isDateTable: isCalendar,
      dateColumn: isCalendar ? "Date" : undefined,
      expression: formula,
      columns: calendarColumns,
      rowCount: calendarRows.length,
    };

    return { tableDef: newTable, rows: calendarRows };
  }

  public onExportCsv(): void {
    const tbl = this.activeTable();
    const rows = this.displayedRows();
    if (!tbl || rows.length === 0) {
      this.state.announce("No table records available to export.", { safe: true });
      return;
    }

    const cols = tbl.columns.map((c) => c.name);
    const csvHeader = cols.join(",");
    const csvLines = rows.map((row) =>
      cols
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return "";
          const str = String(val).replace(/"/g, '""');
          return str.includes(",") || str.includes('"') ? `"${str}"` : str;
        })
        .join(","),
    );

    const csvContent = [csvHeader, ...csvLines].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url =
      typeof URL !== "undefined" && URL.createObjectURL
        ? URL.createObjectURL(blob)
        : "blob:mock";
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${tbl.name}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (
      typeof URL !== "undefined" &&
      URL.revokeObjectURL &&
      url !== "blob:mock"
    ) {
      URL.revokeObjectURL(url);
    }

    this.state.announce(`Exported ${tbl.name} (${rows.length} rows) to CSV.`);
  }

  // ---------------------------------------------------------------------------
  // Data Formatting & Rendering
  // ---------------------------------------------------------------------------

  public formatCellValue(val: unknown, col: SharedColumn): string {
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
        name.includes("cost") ||
        name.includes("profit") ||
        name.includes("montant") ||
        name.includes("cours")
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

  public getColumnAlignment(
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

  // ---------------------------------------------------------------------------
  // Complete Daily Calendar Generator for CALENDAR() & Offset RAX Expressions
  // ---------------------------------------------------------------------------

  private generateCalendarRowsRange(
    startDate: Date,
    endDate: Date,
    includeOffsets: boolean = false,
  ): TableRowData[] {
    const rows: TableRowData[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startMs = startDate.getTime();
    const endMs = Math.max(startMs, endDate.getTime());
    const totalDays = Math.min(
      Math.floor((endMs - startMs) / 86400000) + 1,
      1461, // up to 4 full years (including leap year)
    );

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      const year = d.getFullYear();
      const monthNum = d.getMonth() + 1;
      const month = String(monthNum).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const q = Math.floor(d.getMonth() / 3) + 1;

      const row: Record<string, unknown> = {
        Date: `${year}-${month}-${day}`,
        Year: year,
        Quarter: `Q${q}`,
        Month: d.toLocaleString("en-US", { month: "short" }),
        MonthNum: monthNum,
        YearMonth: `${year}-${month}`,
        Day: d.getDate(),
      };

      if (includeOffsets) {
        const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
        const diffMonths =
          (year - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth());
        const diffYears = year - today.getFullYear();
        row["Offset Day"] = diffDays;
        row["Offset Month"] = diffMonths;
        row["Offset Year"] = diffYears;
      }

      rows.push(row);
    }
    return rows;
  }
}
