import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DEFAULT_SEMANTIC_MODEL,
  SemanticModelService,
} from "../../core/semantic-model.service";
import {
  RaxMeasureDescriptor,
  SharedColumn,
  SharedTable,
  StateManagerService,
} from "../../core/state-manager.service";
import { RaxQueryService } from "../../core/rax-query.service";

export interface RaxDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly line: number;
  readonly startColumn: number;
  readonly errorCode: string;
  readonly message: string;
}

export interface RaxQueryResult {
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly routedEngine: "DUCKDB" | "MYSQL";
  readonly executionTimeMs: number;
  readonly executedSql: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly rows: Array<Record<string, any>>;
}

export interface RaxQueryTab {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly isExecuting: boolean;
  readonly lastResult: RaxQueryResult | null;
  readonly diagnostics: readonly RaxDiagnostic[];
  readonly statusText: string;
}

export interface RaxSnippet {
  readonly label: string;
  readonly category: "Metadata (INFO)" | "Evaluation" | "TMDL";
  readonly code: string;
}

export interface RaxAutocompleteItem {
  readonly label: string;
  readonly insertText: string;
  readonly kind: "Keyword" | "Function" | "Table" | "Measure";
}

export type RaxDockSection =
  | "Tables"
  | "Measures"
  | "Templates"
  | "SchemaFunctions";

const FALLBACK_TABLES: readonly SharedTable[] = (
  DEFAULT_SEMANTIC_MODEL.tables ?? []
).map((table, index) => ({
  id: `tbl-${index}-${table.name}`,
  name: table.name,
  role: table.role,
  description: table.description ?? "",
  columns: table.columns.map((col) => ({
    name: col.name,
    dataType: col.dataType,
    keyType: col.isPrimaryKey ? "PK" : col.isForeignKey ? "FK" : "None",
    description: col.description ?? "",
    isHidden: !!col.isHidden,
  })),
  rowCount: table.estimatedRows ?? 10,
}));

const FALLBACK_MEASURES: readonly RaxMeasureDescriptor[] = (
  DEFAULT_SEMANTIC_MODEL.measures ?? []
).map((measure) => ({
  id: measure.id,
  label: measure.label,
  formula: measure.formula,
  table: measure.table,
  description: measure.description ?? "",
  formatString: measure.formatString ?? "",
}));

const RAX_KEYWORDS: readonly string[] = [
  "EVALUATE",
  "DEFINE",
  "MEASURE",
  "VAR",
  "RETURN",
  "ASC",
  "DESC",
  "SUMMARIZECOLUMNS",
  "CALCULATE",
  "FILTER",
  "ALL",
  "ALLEXCEPT",
  "ALLSELECTED",
  "REMOVEFILTERS",
  "KEEPFILTERS",
  "VALUES",
  "DISTINCT",
  "UNION",
  "ROW",
  "ADDCOLUMNS",
  "SELECTCOLUMNS",
  "TOPN",
  "SUM",
  "SUMX",
  "AVERAGE",
  "AVERAGEX",
  "DIVIDE",
  "COUNT",
  "COUNTROWS",
  "DISTINCTCOUNT",
  "MIN",
  "MAX",
  "IF",
  "SWITCH",
  "TRUE",
  "FALSE",
  "NOT",
  "RELATED",
  "USERELATIONSHIP",
  "CROSSFILTER",
  "TREATAS",
  "SELECTEDVALUE",
  "CONCATENATEX",
];

const INFO_SCHEMA_FUNCTIONS: readonly string[] = [
  "INFO.VIEW.TABLES()",
  "INFO.VIEW.MEASURES()",
  "INFO.VIEW.COLUMNS()",
  "INFO.VIEW.RELATIONSHIPS()",
  "INFO.PARTITIONS()",
  "INFO.CALCDEPENDENCY()",
  "INFO.STORAGETABLECOLUMNS()",
];

@Component({
  selector: "rc-rax-requests",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./rax-requests.component.html",
  styleUrl: "./rax-requests.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RaxRequestsComponent implements OnInit {
  private readonly state = inject(StateManagerService);
  private readonly semanticModelService = inject(SemanticModelService);
  private readonly raxQueryService = inject(RaxQueryService);

  private readonly queryEditorRef =
    viewChild<ElementRef<HTMLTextAreaElement>>("queryEditor");
  private readonly editorGutterRef =
    viewChild<ElementRef<HTMLDivElement>>("editorGutter");

  public syncGutterScroll(): void {
    const textarea = this.queryEditorRef()?.nativeElement;
    const gutter = this.editorGutterRef()?.nativeElement;
    if (textarea && gutter) {
      gutter.scrollTop = textarea.scrollTop;
    }
  }

  private tabSequence = 1;

  public readonly tabs = signal<RaxQueryTab[]>([
    {
      id: "query-tab-1",
      name: "Query 1.rax",
      content: "EVALUATE\nINFO.VIEW.TABLES()",
      isExecuting: false,
      lastResult: null,
      diagnostics: [],
      statusText: "Ready",
    },
  ]);

  public readonly activeTabId = signal<string>("query-tab-1");
  public readonly bottomActiveTab = signal<"results" | "problems" | "plan">(
    "results",
  );
  public readonly activeMobileTab = signal<"editor" | "explorer">("editor");
  public readonly sidebarOpen = signal<boolean>(true);
  public readonly sidebarFilter = signal<string>("");
  public readonly expandedSections = signal<Record<RaxDockSection, boolean>>({
    Tables: true,
    Measures: true,
    Templates: false,
    SchemaFunctions: false,
  });

  // Find & Replace Bar State (Power BI DAX Query View Search & Replace)
  public readonly findReplaceOpen = signal<boolean>(false);
  public readonly findText = signal<string>("");
  public readonly replaceText = signal<string>("");

  // WAI-ARIA Combobox Autocomplete State
  public readonly autocompleteOpen = signal<boolean>(false);
  public readonly autocompleteIndex = signal<number>(0);
  public readonly cursorToken = signal<string>("");

  public readonly isAllCollapsed = computed(() =>
    Object.values(this.expandedSections()).every((expanded) => !expanded),
  );
  public readonly expandedTables = signal<Record<string, boolean>>({});

  public readonly schemaFunctionButtons: readonly string[] =
    INFO_SCHEMA_FUNCTIONS;

  public readonly quickSnippets: readonly RaxSnippet[] = [
    {
      label: "List Model Tables (INFO.VIEW.TABLES)",
      category: "Metadata (INFO)",
      code: "EVALUATE\nINFO.VIEW.TABLES()",
    },
    {
      label: "List Semantic Measures (INFO.VIEW.MEASURES)",
      category: "Metadata (INFO)",
      code: 'EVALUATE\nSELECTCOLUMNS(\n  INFO.VIEW.MEASURES(),\n  "Table", [Table],\n  "Name", [Name],\n  "Description", [Description],\n  "Dax", [Expression]\n)',
    },
    {
      label: "Inspect Table Columns (INFO.VIEW.COLUMNS)",
      category: "Metadata (INFO)",
      code: "EVALUATE\nINFO.VIEW.COLUMNS()",
    },
    {
      label: "Inspect DuckDB Partitions (INFO.PARTITIONS)",
      category: "Metadata (INFO)",
      code: 'EVALUATE\nSELECTCOLUMNS(\n  INFO.PARTITIONS(),\n  "Table", [Table],\n  "Partition", [PartitionName],\n  "Mode", [Mode],\n  "Engine", [Engine],\n  "Rows", [Rows],\n  "Refreshed", [RefreshedTime]\n)',
    },
    {
      label: "Analyze Measure Dependencies (INFO.CALCDEPENDENCY)",
      category: "Metadata (INFO)",
      code: 'EVALUATE\nSELECTCOLUMNS(\n  FILTER(INFO.CALCDEPENDENCY(), [OBJECT_TYPE] = "MEASURE"),\n  "Table", [TABLE],\n  "Name", [OBJECT],\n  "Dax", [EXPRESSION],\n  "Referenced Table", [REFERENCED_TABLE],\n  "Referenced Object", [REFERENCED_OBJECT],\n  "Referenced Type", [REFERENCED_OBJECT_TYPE]\n)',
    },
    {
      label: "Inspect Column Storage Size (INFO.STORAGETABLECOLUMNS)",
      category: "Metadata (INFO)",
      code: 'EVALUATE\nSELECTCOLUMNS(\n  INFO.STORAGETABLECOLUMNS(),\n  "Table", [DIMENSION_NAME],\n  "Column", [ATTRIBUTE_NAME],\n  "Size KB", [SizeKB]\n)\nORDER BY [Size KB] DESC',
    },
    {
      label: "Build Unified Data Dictionary (UNION + INFO.VIEW)",
      category: "Metadata (INFO)",
      code: 'Data Dictionary =\nVAR _columns = SELECTCOLUMNS(FILTER(INFO.VIEW.COLUMNS(), NOT([IsHidden])), "Type", "Column", "Name", [Name], "Table", [Table], "Description", [Description], "Dax", [Expression])\nVAR _measures = SELECTCOLUMNS(FILTER(INFO.VIEW.MEASURES(), NOT([IsHidden])), "Type", "Measure", "Name", [Name], "Table", [Table], "Description", [Description], "Dax", [Expression])\nVAR _tables = SELECTCOLUMNS(FILTER(INFO.VIEW.TABLES(), NOT([IsHidden])), "Type", "Table", "Name", [Name], "Table", "n/a", "Description", [Description], "Dax", [Expression])\nRETURN\nUNION(_columns, _measures, _tables)',
    },
    {
      label: "Summarize Metrics by Dimension (SUMMARIZECOLUMNS)",
      category: "Evaluation",
      code: 'EVALUATE\nSUMMARIZECOLUMNS(\n  \'dim_region\'[region_name],\n  "Gross Revenue", [Gross Revenue],\n  "Net Revenue", [Net Revenue]\n)\nORDER BY [Gross Revenue] DESC',
    },
    {
      label: "Define & Evaluate Ad-Hoc KPI Measure",
      category: "Evaluation",
      code: "DEFINE\n  MEASURE 'fact_transactions'[Net Margin] = SUM('fact_transactions'[net_amount]) - SUM('fact_transactions'[cost_amount])\nEVALUATE\nROW(\"Net Margin\", [Net Margin])",
    },
    {
      label: "Step-by-Step Variable Evaluation (VAR / RETURN)",
      category: "Evaluation",
      code: "EVALUATE\nVAR BaseTotal = SUM('fact_transactions'[gross_amount])\nVAR DiscountTotal = SUM('fact_transactions'[discount_amount])\nVAR NetResult = BaseTotal - DiscountTotal\nRETURN\nROW(\"Base Total\", BaseTotal, \"Net Result\", NetResult)",
    },
    {
      label: "TMDL Measure Definition & Description Script",
      category: "TMDL",
      code: "createOrReplace\n  table 'fact_transactions'\n    /// Gross transaction amount aggregated across active records\n    measure 'Gross Revenue' = CALCULATE(SUM('fact_transactions'[gross_amount]))\n      formatString: \"#,0.00\"",
    },
  ];

  public readonly activeTab = computed<RaxQueryTab>(() => {
    const list = this.tabs();
    return list.find((tab) => tab.id === this.activeTabId()) ?? list[0];
  });

  public readonly hasModelDefinableContent = computed<boolean>(() => {
    const content = this.activeTab().content.trim().toUpperCase();
    return (
      content.startsWith("CREATEORREPLACE") ||
      content.startsWith("TABLE ") ||
      /\bDEFINE\s+MEASURE\b/.test(content) ||
      /\bMEASURE\s+(?:'[^']+'|[A-Z0-9_]+)?\[[^\]]+\]\s*=/.test(content)
    );
  });

  public readonly lineNumbers = computed<number[]>(() => {
    const lineCount = Math.max(
      1,
      this.activeTab().content.split(/\r?\n/).length,
    );
    return Array.from({ length: lineCount }, (_, index) => index + 1);
  });

  public readonly resultColumns = computed<string[]>(() => {
    const rows = this.activeTab().lastResult?.rows;
    if (!rows || rows.length === 0) {
      return [];
    }
    return Object.keys(rows[0]);
  });

  private readonly availableTables = computed<readonly SharedTable[]>(() =>
    this.state.sharedTables.length > 0
      ? this.state.sharedTables
      : FALLBACK_TABLES,
  );

  private readonly availableMeasures = computed<
    readonly RaxMeasureDescriptor[]
  >(() =>
    this.state.measures.length > 0 ? this.state.measures : FALLBACK_MEASURES,
  );

  public readonly filteredTables = computed<readonly SharedTable[]>(() => {
    const term = this.sidebarFilter().trim().toLowerCase();
    const tables = this.availableTables();
    if (!term) {
      return tables;
    }
    return tables.filter(
      (table) =>
        table.name.toLowerCase().includes(term) ||
        table.columns.some((col) => col.name.toLowerCase().includes(term)),
    );
  });

  public readonly filteredMeasures = computed<readonly RaxMeasureDescriptor[]>(
    () => {
      const term = this.sidebarFilter().trim().toLowerCase();
      const measures = this.availableMeasures();
      if (!term) {
        return measures;
      }
      return measures.filter(
        (measure) =>
          measure.label.toLowerCase().includes(term) ||
          measure.table.toLowerCase().includes(term) ||
          (measure.description ?? "").toLowerCase().includes(term),
      );
    },
  );

  public readonly autocompleteSuggestions = computed<
    readonly RaxAutocompleteItem[]
  >(() => {
    const token = this.cursorToken().trim().toUpperCase();
    if (!this.autocompleteOpen() || token.length < 2) {
      return [];
    }
    const items: RaxAutocompleteItem[] = [];

    for (const fn of INFO_SCHEMA_FUNCTIONS) {
      if (fn.toUpperCase().includes(token)) {
        items.push({ label: fn, insertText: fn, kind: "Function" });
      }
    }
    for (const kw of RAX_KEYWORDS) {
      if (kw.startsWith(token) && kw !== token) {
        items.push({ label: kw, insertText: kw, kind: "Keyword" });
      }
    }
    for (const table of this.availableTables()) {
      if (table.name.toUpperCase().includes(token)) {
        const needsQuotes = /[^a-zA-Z0-9_]/.test(table.name);
        const ref = needsQuotes ? `'${table.name}'` : table.name;
        items.push({ label: table.name, insertText: ref, kind: "Table" });
      }
    }
    for (const measure of this.availableMeasures()) {
      if (measure.label.toUpperCase().includes(token)) {
        items.push({
          label: `[${measure.label}]`,
          insertText: `[${measure.label}]`,
          kind: "Measure",
        });
      }
    }
    return items.slice(0, 8);
  });

  public ngOnInit(): void {
    if (
      this.state.sharedTables.length === 0 ||
      this.state.measures.length === 0
    ) {
      this.semanticModelService.loadDefault().subscribe((payload) => {
        this.semanticModelService.syncToStateManager(payload, this.state);
      });
    }
  }

  @HostListener("window:keydown", ["$event"])
  public onGlobalKeydown(event: KeyboardEvent): void {
    if (
      event.key === "F5" ||
      ((event.ctrlKey || event.metaKey) && event.key === "Enter")
    ) {
      event.preventDefault();
      this.runQuery();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      this.formatQuery();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
      event.preventDefault();
      this.toggleFindReplace();
    }
  }

  public onEditorKeydown(event: KeyboardEvent): void {
    const suggestions = this.autocompleteSuggestions();
    if (!this.autocompleteOpen() || suggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.autocompleteIndex.update((idx) => (idx + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.autocompleteIndex.update(
        (idx) => (idx - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Tab") {
      event.preventDefault();
      this.applyAutocompleteSuggestion(
        suggestions[this.autocompleteIndex()] ?? suggestions[0],
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.autocompleteOpen.set(false);
    }
  }

  public applyAutocompleteSuggestion(item: RaxAutocompleteItem): void {
    const textarea = this.queryEditorRef()?.nativeElement;
    const current = this.activeTab().content;
    if (textarea && typeof textarea.selectionStart === "number") {
      const pos = textarea.selectionStart;
      const before = current.slice(0, pos);
      const after = current.slice(pos);
      const tokenMatch = before.match(/[A-Za-z0-9_.'[]+$/);
      const tokenStart = tokenMatch ? pos - tokenMatch[0].length : pos;
      const updated = current.slice(0, tokenStart) + item.insertText + after;
      this.updateActiveContent(updated);
      this.autocompleteOpen.set(false);
      setTimeout(() => {
        textarea.focus();
        const nextCursor = tokenStart + item.insertText.length;
        textarea.setSelectionRange(nextCursor, nextCursor);
      }, 0);
      return;
    }
    this.insertTextAtCursor(item.insertText);
    this.autocompleteOpen.set(false);
  }

  public selectTab(tabId: string): void {
    this.activeTabId.set(tabId);
  }

  public addNewTab(): void {
    this.tabSequence += 1;
    const newId = `query-tab-${this.tabSequence}`;
    const newTab: RaxQueryTab = {
      id: newId,
      name: `Query ${this.tabSequence}.rax`,
      content: "EVALUATE\nINFO.VIEW.TABLES()",
      isExecuting: false,
      lastResult: null,
      diagnostics: [],
      statusText: "Ready",
    };
    this.tabs.update((current) => [...current, newTab]);
    this.activeTabId.set(newId);
    this.state.announce(`Opened query tab ${newTab.name}`);
  }

  public closeTab(tabId: string, event?: Event): void {
    event?.stopPropagation();
    const currentTabs = this.tabs();
    if (currentTabs.length <= 1) {
      return;
    }
    const closingIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex === -1) {
      return;
    }
    const remaining = currentTabs.filter((tab) => tab.id !== tabId);
    this.tabs.set(remaining);

    if (this.activeTabId() === tabId) {
      const nextTab = remaining[Math.max(0, closingIndex - 1)] ?? remaining[0];
      this.activeTabId.set(nextTab.id);
    }
  }

  public updateActiveContent(content: string): void {
    this.patchActiveTab({ content });
    const textarea = this.queryEditorRef()?.nativeElement;
    if (textarea && typeof textarea.selectionStart === "number") {
      const before = content.slice(0, textarea.selectionStart);
      const match = before.match(/[A-Za-z0-9_.]+$/);
      if (match && match[0].length >= 2) {
        this.cursorToken.set(match[0]);
        this.autocompleteIndex.set(0);
        this.autocompleteOpen.set(true);
        return;
      }
    }
    this.autocompleteOpen.set(false);
    this.cursorToken.set("");
  }

  public clearEditor(): void {
    this.autocompleteOpen.set(false);
    this.cursorToken.set("");
    this.patchActiveTab({
      content: "",
      diagnostics: [],
      statusText: "Editor cleared",
    });
    this.state.announce("Query editor cleared.");
  }

  public toggleFindReplace(): void {
    this.findReplaceOpen.update((open) => !open);
  }

  public replaceAllInEditor(): void {
    const target = this.findText();
    if (!target) {
      return;
    }
    const replacement = this.replaceText();
    const current = this.activeTab().content;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    const matches = current.match(regex);
    const count = matches ? matches.length : 0;
    if (count === 0) {
      this.patchActiveTab({
        statusText: `No occurrences of "${target}" found`,
      });
      return;
    }
    const updated = current.replace(regex, replacement);
    this.patchActiveTab({
      content: updated,
      statusText: `Replaced ${count} occurrence(s) of "${target}"`,
    });
    this.state.announce(`Replaced ${count} occurrence(s) in active RAX query.`);
  }

  public toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  public isSectionExpanded(section: RaxDockSection): boolean {
    return !!this.expandedSections()[section];
  }

  public toggleSection(section: RaxDockSection): void {
    this.expandedSections.update((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }

  public toggleCollapseAll(): void {
    const shouldExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Tables: shouldExpand,
      Measures: shouldExpand,
      Templates: shouldExpand,
      SchemaFunctions: shouldExpand,
    });
  }

  public toggleTableExpand(tableName: string): void {
    this.expandedTables.update((current) => ({
      ...current,
      [tableName]: !current[tableName],
    }));
  }

  public applySnippet(snippet: RaxSnippet | undefined): void {
    if (!snippet) {
      return;
    }
    this.patchActiveTab({
      content: snippet.code,
      diagnostics: [],
      statusText: `Loaded template: ${snippet.label}`,
    });
    this.state.announce(`Loaded RAX template ${snippet.label}`);
  }

  public insertTextAtCursor(text: string): void {
    const current = this.activeTab().content;
    const textarea = this.queryEditorRef()?.nativeElement;
    if (textarea && typeof textarea.selectionStart === "number") {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd ?? start;
      const updated = current.slice(0, start) + text + current.slice(end);
      this.updateActiveContent(updated);
      setTimeout(() => {
        textarea.focus();
        const cursor = start + text.length;
        textarea.setSelectionRange(cursor, cursor);
      }, 0);
      return;
    }

    const separator = current && !current.endsWith("\n") ? " " : "";
    this.updateActiveContent(`${current}${separator}${text}`);
  }

  public insertTableColumn(table: SharedTable, columnName: string): void {
    const needsQuotes = /[^a-zA-Z0-9_]/.test(table.name);
    const tableRef = needsQuotes ? `'${table.name}'` : table.name;
    this.insertTextAtCursor(`${tableRef}[${columnName}]`);
  }

  public insertMeasure(measure: RaxMeasureDescriptor): void {
    this.insertTextAtCursor(`[${measure.label}]`);
  }

  public quickEvaluateMeasure(
    measure: RaxMeasureDescriptor,
    event?: Event,
  ): void {
    event?.stopPropagation();
    const query = `EVALUATE\nROW("${measure.label}", ${measure.formula})`;
    this.updateActiveContent(query);
    this.runQuery();
  }

  /**
   * Power BI DAX Query View parity: "Define all measures of this model"
   * Generates a DEFINE block with every measure in the semantic model and an EVALUATE ROW summary.
   */
  public defineAllMeasures(event?: Event): void {
    event?.stopPropagation();
    const measures = this.availableMeasures();
    if (measures.length === 0) {
      const fallbackTable =
        this.availableTables()[0]?.name ?? "fact_transactions";
      const template = `DEFINE\n  MEASURE '${fallbackTable}'[Total Records] = COUNTROWS('${fallbackTable}')\n\nEVALUATE\nROW("Total Records", [Total Records])`;
      this.patchActiveTab({
        content: template,
        diagnostics: [],
        statusText: "Generated measure definition template",
      });
      return;
    }

    const defineLines = measures.map((m) => {
      const tableName =
        m.table || this.availableTables()[0]?.name || "Measures Table";
      const descComment = m.description ? `  /// ${m.description}\n` : "";
      return `${descComment}  MEASURE '${tableName}'[${m.label}] = ${m.formula}`;
    });
    const rowArgs = measures
      .map((m) => `"${m.label}", [${m.label}]`)
      .join(",\n  ");
    const script = `DEFINE\n${defineLines.join("\n")}\n\nEVALUATE\nROW(\n  ${rowArgs}\n)`;

    this.patchActiveTab({
      content: script,
      diagnostics: [],
      statusText: `Defined all ${measures.length} model measure(s)`,
    });
    this.state.announce(
      `Generated DEFINE script for ${measures.length} measure(s).`,
    );
  }

  /**
   * Power BI TMDL View parity: Generates live TMDL code for all measures in the model,
   * preserving /// descriptions and formatString properties.
   */
  public generateModelTmdl(event?: Event): void {
    event?.stopPropagation();
    const measures = this.availableMeasures();
    const fallbackTable = this.availableTables()[0]?.name ?? "Measures Table";

    if (measures.length === 0) {
      const emptyTmdl = `createOrReplace\n  table '${fallbackTable}'\n    /// Explicit measure description\n    measure 'Sample Measure' = COUNTROWS('${fallbackTable}')\n      formatString: "#,0"`;
      this.patchActiveTab({
        content: emptyTmdl,
        diagnostics: [],
        statusText: "Generated TMDL template",
      });
      return;
    }

    const grouped = new Map<string, RaxMeasureDescriptor[]>();
    for (const m of measures) {
      const tName = m.table || fallbackTable;
      const list = grouped.get(tName) ?? [];
      list.push(m);
      grouped.set(tName, list);
    }

    const lines: string[] = ["createOrReplace"];
    for (const [tableName, tableMeasures] of grouped.entries()) {
      lines.push(`  table '${tableName}'`);
      for (const m of tableMeasures) {
        if (m.description) {
          lines.push(`    /// ${m.description}`);
        }
        lines.push(`    measure '${m.label}' = ${m.formula}`);
        if (m.formatString) {
          lines.push(`      formatString: "${m.formatString}"`);
        }
      }
    }

    this.patchActiveTab({
      content: lines.join("\n"),
      diagnostics: [],
      statusText: `Generated TMDL script for ${measures.length} measure(s)`,
    });
    this.state.announce(
      `Generated TMDL definition script for ${measures.length} measure(s).`,
    );
  }

  /**
   * Parses DEFINE MEASURE or TMDL createOrReplace blocks (including /// descriptions)
   * and persists the measures into the semantic model (CodeLens "Update model" / TMDL Apply).
   */
  public applyToModel(): number {
    const content = this.activeTab().content.trim();
    if (!content) {
      return 0;
    }
    const appliedCount = this.extractAndSaveMeasuresFromScript(content);
    if (appliedCount > 0) {
      this.patchActiveTab({
        statusText: `Applied ${appliedCount} measure(s) to semantic model`,
      });
      this.state.announce(
        `Updated semantic model with ${appliedCount} measure(s).`,
      );
    }
    return appliedCount;
  }

  /**
   * Materializes the active tabular result (such as Data Dictionary or SUMMARIZECOLUMNS)
   * into the semantic model as a calculated table.
   */
  public materializeResultAsTable(): void {
    const result = this.activeTab().lastResult;
    const cols = this.resultColumns();
    if (!result || result.rows.length === 0 || cols.length === 0) {
      return;
    }

    const rawContent = this.activeTab().content.trim();
    const assignMatch = rawContent.match(
      /^([A-Za-z0-9_À-ÿ\s-]+?)\s*=\s*(?:VAR\b|SUMMARIZECOLUMNS\b|SELECTCOLUMNS\b|UNION\b|FILTER\b)/i,
    );
    const tableName = assignMatch
      ? assignMatch[1].trim()
      : rawContent.toUpperCase().includes("INFO.VIEW.")
        ? "Data Dictionary"
        : `Calculated_Table_${this.availableTables().length + 1}`;

    const sampleRow = result.rows[0];
    const sharedCols: SharedColumn[] = cols.map((colName) => {
      const val = sampleRow[colName];
      const dataType =
        typeof val === "number"
          ? "DOUBLE"
          : typeof val === "boolean"
            ? "BOOLEAN"
            : "VARCHAR";
      return {
        name: colName,
        dataType,
        keyType: "None",
      };
    });

    this.state.addTable({
      id: `user-tbl-calc-${Date.now()}`,
      name: tableName,
      role: "DIMENSION",
      columns: sharedCols,
      rowCount: result.rows.length,
      description: "Calculated table materialized from RAX Requests",
      expression: rawContent,
    });
    this.state.setTableRows(tableName, result.rows);
    this.patchActiveTab({
      statusText: `Materialized table "${tableName}" (${result.rows.length} rows)`,
    });
    this.state.announce(
      `Materialized calculated table ${tableName} into semantic model.`,
    );
  }

  public formatQuery(): void {
    const raw = this.activeTab().content;
    if (!raw.trim()) {
      return;
    }

    const protectedSegments: string[] = [];
    let masked = raw.replace(
      /(\/\/\/[^\r\n]*|\/\/[^\r\n]*|--[^\r\n]*|'[^']*'|"[^"]*"|\[[^\]]*\])/g,
      (match) => {
        const token = `__RC_SEG_${protectedSegments.length}__`;
        protectedSegments.push(match);
        return token;
      },
    );

    masked = masked
      .replace(/\binfo\.view\.tables\b/gi, "INFO.VIEW.TABLES")
      .replace(/\binfo\.view\.measures\b/gi, "INFO.VIEW.MEASURES")
      .replace(/\binfo\.view\.columns\b/gi, "INFO.VIEW.COLUMNS")
      .replace(/\binfo\.view\.relationships\b/gi, "INFO.VIEW.RELATIONSHIPS")
      .replace(/\binfo\.partitions\b/gi, "INFO.PARTITIONS")
      .replace(/\binfo\.calcdependency\b/gi, "INFO.CALCDEPENDENCY")
      .replace(/\binfo\.storagetablecolumns\b/gi, "INFO.STORAGETABLECOLUMNS")
      .replace(/\border\s+by\b/gi, "ORDER BY")
      .replace(/\bgroup\s+by\b/gi, "GROUP BY")
      .replace(/\bstart\s+at\b/gi, "START AT")
      .replace(/\bcreateorreplace\b/gi, "createOrReplace");

    for (const keyword of RAX_KEYWORDS) {
      const pattern = new RegExp(`\\b${keyword}\\b`, "gi");
      masked = masked.replace(pattern, keyword);
    }

    const isTmdl = /^\s*createOrReplace\b/i.test(masked);
    if (isTmdl) {
      const tmdlLines = masked
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .join("\n")
        .trim();
      const restoredTmdl = tmdlLines.replace(
        /__RC_SEG_(\d+)__/g,
        (_, idx: string) => protectedSegments[Number(idx)] ?? "",
      );
      this.patchActiveTab({
        content: restoredTmdl,
        statusText: "Formatted TMDL script",
      });
      this.state.announce("Formatted TMDL script.");
      return;
    }

    masked = masked
      .replace(/[ \t]+/g, " ")
      .replace(/([^\n])\s+(DEFINE|EVALUATE|VAR|RETURN|ORDER BY)\b/g, "$1\n$2")
      .replace(/\bDEFINE\s+MEASURE\b/g, "DEFINE\n  MEASURE");

    const rawLines = masked
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line, idx, arr) =>
          line.length > 0 || (idx > 0 && arr[idx - 1].length > 0),
      );

    let parenDepth = 0;
    const indentedLines: string[] = [];
    for (const line of rawLines) {
      if (!line) {
        indentedLines.push("");
        continue;
      }
      const leadingClosers = (line.match(/^\)+/) ?? [""])[0].length;
      const effectiveDepth = Math.max(0, parenDepth - leadingClosers);
      const isTopDirective = /^(DEFINE|EVALUATE|RETURN|ORDER BY)\b/.test(line);
      const isMeasureOrVar = /^(MEASURE)\b/.test(line);
      const indentSpaces = isTopDirective
        ? 0
        : isMeasureOrVar
          ? Math.max(2, effectiveDepth * 2)
          : effectiveDepth * 2;
      indentedLines.push(" ".repeat(indentSpaces) + line);

      for (const ch of line) {
        if (ch === "(") {
          parenDepth += 1;
        } else if (ch === ")") {
          parenDepth = Math.max(0, parenDepth - 1);
        }
      }
    }

    const formatted = indentedLines
      .join("\n")
      .trim()
      .replace(
        /__RC_SEG_(\d+)__/g,
        (_, idx: string) => protectedSegments[Number(idx)] ?? "",
      );

    this.patchActiveTab({
      content: formatted,
      statusText: "Formatted RAX query",
    });
    this.state.announce("Formatted RAX query.");
  }

  public validateQuery(): RaxDiagnostic[] {
    const content = this.activeTab().content;
    if (!content.trim()) {
      this.patchActiveTab({
        diagnostics: [],
        statusText: "Ready",
      });
      return [];
    }
    const diagnostics = this.analyzeSyntax(content);
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const statusText = hasErrors
      ? `Validation found ${diagnostics.length} problem(s)`
      : diagnostics.length > 0
        ? `Syntax valid (${diagnostics.length} warning)`
        : "Syntax valid (0 problems)";
    this.patchActiveTab({
      diagnostics,
      statusText,
    });
    if (diagnostics.length > 0) {
      this.bottomActiveTab.set("problems");
    }
    this.state.announce(statusText);
    return diagnostics;
  }

  public runQuery(): void {
    const tab = this.activeTab();
    if (tab.isExecuting) {
      return;
    }

    if (!tab.content.trim()) {
      this.patchActiveTab({
        diagnostics: [],
        statusText: "Enter a RAX or TMDL expression to execute",
      });
      return;
    }

    const diagnostics = this.analyzeSyntax(tab.content);
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    if (hasErrors) {
      this.patchActiveTab({
        diagnostics,
        statusText: `Execution blocked: ${diagnostics.length} syntax error(s)`,
      });
      this.bottomActiveTab.set("problems");
      this.state.announce(
        `RAX execution blocked due to ${diagnostics.length} syntax error(s).`,
      );
      return;
    }

    const localResult = this.tryEvaluateLocalQuery(tab.content);
    if (localResult) {
      const summary = `Completed in ${localResult.executionTimeMs} ms (${localResult.rows.length} row(s), ${localResult.routedEngine})`;
      this.patchActiveTab({
        diagnostics,
        isExecuting: false,
        lastResult: localResult,
        statusText: summary,
      });
      this.bottomActiveTab.set("results");
      this.state.announce(summary);
      return;
    }

    const targetTabId = tab.id;
    this.patchTabById(targetTabId, {
      diagnostics,
      isExecuting: true,
      statusText: "Executing RAX query...",
    });

    this.raxQueryService
      .executeMeasureQuery("rax-studio-query", tab.content, "rax-studio")
      .subscribe((result) => {
        const summary = `Completed in ${result.executionTimeMs} ms (${result.rows.length} row(s), ${result.routedEngine})`;
        this.patchTabById(targetTabId, {
          isExecuting: false,
          lastResult: result,
          statusText: summary,
        });
        this.bottomActiveTab.set("results");
      });
  }

  public exportResultsCsv(): void {
    const result = this.activeTab().lastResult;
    const cols = this.resultColumns();
    if (
      !result ||
      result.rows.length === 0 ||
      cols.length === 0 ||
      typeof document === "undefined"
    ) {
      return;
    }

    const escapeCsv = (val: unknown): string => {
      const str = val === null || val === undefined ? "" : String(val);
      return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [
      cols.map(escapeCsv).join(","),
      ...result.rows.map((row) =>
        cols.map((col) => escapeCsv(row[col])).join(","),
      ),
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rax-results-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.state.announce(`Exported ${result.rows.length} row(s) to CSV.`);
  }

  private tryEvaluateLocalQuery(rawQuery: string): RaxQueryResult | null {
    const normalized = rawQuery.trim();
    const upper = normalized.toUpperCase();

    // 1. Unified Data Dictionary (UNION of INFO.VIEW.COLUMNS, INFO.VIEW.MEASURES, INFO.VIEW.TABLES)
    if (
      upper.includes("UNION(") &&
      upper.includes("INFO.VIEW.COLUMNS") &&
      upper.includes("INFO.VIEW.MEASURES")
    ) {
      const colRows = this.buildInfoColumnsRows()
        .filter((r) => !r["IsHidden"])
        .map((r) => ({
          Type: "Column",
          Name: r["Name"],
          Table: r["Table"],
          Description: r["Description"],
          Dax: r["Expression"],
        }));
      const measureRows = this.buildInfoMeasuresRows()
        .filter((r) => !r["IsHidden"])
        .map((r) => ({
          Type: "Measure",
          Name: r["Name"],
          Table: r["Table"],
          Description: r["Description"],
          Dax: r["Expression"],
        }));
      const tableRows = this.buildInfoTablesRows()
        .filter((r) => !r["IsHidden"] && r["Name"] !== "Data Dictionary")
        .map((r) => ({
          Type: "Table",
          Name: r["Name"],
          Table: "n/a",
          Description: r["Description"],
          Dax: r["Expression"],
        }));
      const rows = [...colRows, ...measureRows, ...tableRows];
      return {
        cacheKey: "meta-info-data-dictionary",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 3,
        executedSql:
          "SELECT Type, Name, Table, Description, Dax FROM information_schema.rax_data_dictionary;",
        rows,
      };
    }

    // 2. INFO.CALCDEPENDENCY()
    if (upper.includes("INFO.CALCDEPENDENCY")) {
      const baseRows = this.buildInfoCalcDependencyRows();
      const rows = this.applySelectColumnsAndOrder(normalized, baseRows);
      return {
        cacheKey: "meta-info-calcdependency",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 2,
        executedSql:
          "SELECT OBJECT_TYPE, TABLE, OBJECT, EXPRESSION, REFERENCED_TABLE, REFERENCED_OBJECT, REFERENCED_OBJECT_TYPE, REFERENCED_EXPRESSION FROM information_schema.rax_dependencies;",
        rows,
      };
    }

    // 3. INFO.STORAGETABLECOLUMNS()
    if (upper.includes("INFO.STORAGETABLECOLUMNS")) {
      const baseRows = this.buildInfoStorageTableColumnsRows();
      const rows = this.applySelectColumnsAndOrder(normalized, baseRows);
      return {
        cacheKey: "meta-info-storage-columns",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 2,
        executedSql:
          "SELECT DIMENSION_NAME, ATTRIBUTE_NAME, DATA_TYPE, DICTIONARY_SIZE, SizeKB FROM duckdb_column_storage() ORDER BY DICTIONARY_SIZE DESC;",
        rows,
      };
    }

    // 4. INFO.VIEW.RELATIONSHIPS()
    if (upper.includes("INFO.VIEW.RELATIONSHIPS")) {
      const tables = this.availableTables();
      const fkRows: Array<Record<string, unknown>> = [];
      const pkTableByCol = new Map<string, string>();
      for (const t of tables) {
        for (const c of t.columns) {
          if (c.keyType === "PK") {
            pkTableByCol.set(c.name.toLowerCase(), t.name);
          }
        }
      }
      for (const t of tables) {
        for (const c of t.columns) {
          if (c.keyType === "FK") {
            const targetTable =
              pkTableByCol.get(c.name.toLowerCase()) ??
              tables.find((other) => other.name !== t.name)?.name ??
              "";
            fkRows.push({
              Name: `${t.name}_${c.name}`,
              FromTable: t.name,
              FromColumn: c.name,
              ToTable: targetTable,
              ToColumn: c.name,
              Cardinality: "MANY_TO_ONE",
              CrossFilterDirection: "SINGLE",
              IsActive: true,
            });
          }
        }
      }
      return {
        cacheKey: "meta-info-relationships",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 2,
        executedSql:
          "SELECT Name, FromTable, FromColumn, ToTable, ToColumn, Cardinality, CrossFilterDirection, IsActive FROM information_schema.rax_relationships;",
        rows: this.applySelectColumnsAndOrder(normalized, fkRows),
      };
    }

    // 5. INFO.VIEW.TABLES()
    if (upper.includes("INFO.VIEW.TABLES")) {
      const baseRows = this.buildInfoTablesRows();
      const rows = this.applySelectColumnsAndOrder(normalized, baseRows);
      return {
        cacheKey: "meta-info-tables",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 2,
        executedSql:
          "SELECT table_id AS ID, table_name AS Name, table_role AS Role, column_count AS ColumnsCount, 'DUCKDB_COLUMNAR' AS StorageMode, description AS Description FROM information_schema.rax_tables;",
        rows,
      };
    }

    // 6. INFO.VIEW.MEASURES()
    if (upper.includes("INFO.VIEW.MEASURES")) {
      const baseRows = this.buildInfoMeasuresRows();
      const rows = this.applySelectColumnsAndOrder(normalized, baseRows);
      return {
        cacheKey: "meta-info-measures",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 2,
        executedSql:
          "SELECT measure_id AS ID, measure_name AS Name, home_table AS Table, rax_expression AS Expression, description AS Description FROM information_schema.rax_measures;",
        rows,
      };
    }

    // 7. INFO.VIEW.COLUMNS()
    if (upper.includes("INFO.VIEW.COLUMNS")) {
      const baseRows = this.buildInfoColumnsRows();
      const rows = this.applySelectColumnsAndOrder(normalized, baseRows);
      return {
        cacheKey: "meta-info-columns",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 3,
        executedSql:
          "SELECT table_name AS Table, column_name AS Name, data_type AS DataType, key_type AS KeyType, description AS Description, is_hidden AS IsHidden FROM information_schema.columns;",
        rows,
      };
    }

    // 8. INFO.PARTITIONS()
    if (upper.includes("INFO.PARTITIONS")) {
      const refreshedAt = new Date().toISOString();
      const baseRows = this.availableTables().map((table) => ({
        Table: table.name,
        Name: `${table.name}_p2026`,
        PartitionName: `${table.name}_p2026`,
        QueryDefinition: `SELECT * FROM ${table.name}`,
        Type: 1,
        Mode: "Import (Parquet)",
        Engine: "DUCKDB",
        Rows: table.rowCount ?? 1000,
        RefreshedTime: refreshedAt,
        State: "READY",
      }));
      const rows = this.applySelectColumnsAndOrder(normalized, baseRows);
      return {
        cacheKey: "meta-info-partitions",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 2,
        executedSql:
          "SELECT table_name AS Table, partition_name AS PartitionName, mode AS Mode, engine AS Engine, row_count AS Rows, refreshed_time AS RefreshedTime, state AS State FROM duckdb_partitions();",
        rows,
      };
    }

    // 9. TMDL DDL Transaction (createOrReplace / table / model)
    if (
      upper.startsWith("CREATEORREPLACE") ||
      upper.startsWith("TABLE ") ||
      upper.startsWith("MODEL ")
    ) {
      const appliedCount = this.extractAndSaveMeasuresFromScript(normalized);
      return {
        cacheKey: "tmdl-ddl-preview",
        cacheHit: false,
        routedEngine: "DUCKDB",
        executionTimeMs: 4,
        executedSql:
          "-- TMDL DDL Metadata Transaction\nCOMMIT SEMANTIC CATALOG OBJECTS;",
        rows: [
          {
            Operation: "createOrReplace",
            Target: "Semantic Model Catalog",
            MeasuresUpdated: appliedCount,
            Status: "VALIDATED",
          },
        ],
      };
    }

    // 10. Local evaluation of DEFINE MEASURE / SUMMARIZECOLUMNS / ROW when in-memory table rows exist
    if (upper.includes("DEFINE") && /\bMEASURE\b/i.test(normalized)) {
      this.extractAndSaveMeasuresFromScript(normalized);
    }

    const localDataResult = this.tryEvaluateAgainstLoadedRows(normalized);
    if (localDataResult) {
      return localDataResult;
    }

    return null;
  }

  private buildInfoTablesRows(): Array<Record<string, unknown>> {
    return this.availableTables().map((table, index) => ({
      ID: index + 1,
      Name: table.name,
      Role: table.role,
      ColumnsCount: table.columns.length,
      StorageMode: "DUCKDB_COLUMNAR",
      Description: table.description ?? "",
      Expression: table.expression ?? "",
      IsHidden: table.isHidden ?? false,
    }));
  }

  private buildInfoMeasuresRows(): Array<Record<string, unknown>> {
    return this.availableMeasures().map((measure, index) => ({
      ID: index + 1,
      Name: measure.label,
      Table: measure.table,
      Expression: measure.formula,
      Description: measure.description ?? "",
      FormatString: measure.formatString ?? "",
      IsHidden: measure.isHidden ?? false,
    }));
  }

  private buildInfoColumnsRows(): Array<Record<string, unknown>> {
    return this.availableTables().flatMap((table) =>
      table.columns.map((col) => ({
        Table: table.name,
        Name: col.name,
        DataType: col.dataType,
        KeyType: col.keyType ?? "None",
        Description: col.description ?? "",
        IsHidden: col.isHidden ?? false,
        Expression: col.expression ?? "",
      })),
    );
  }

  private buildInfoCalcDependencyRows(): Array<Record<string, unknown>> {
    const measures = this.availableMeasures();
    const measuresByName = new Map<string, RaxMeasureDescriptor>();
    for (const m of measures) {
      measuresByName.set(m.label.toLowerCase(), m);
    }

    const rows: Array<Record<string, unknown>> = [];
    const refPattern = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))?\[([^\]]+)\]/g;

    for (const m of measures) {
      const expr = m.formula || "";
      let match: RegExpExecArray | null;
      refPattern.lastIndex = 0;
      while ((match = refPattern.exec(expr)) !== null) {
        const refTable = match[1] ?? match[2] ?? "";
        const refObj = match[3] ?? "";
        const targetMeasure = !refTable
          ? measuresByName.get(refObj.toLowerCase())
          : undefined;

        rows.push({
          OBJECT_TYPE: "MEASURE",
          TABLE: m.table,
          OBJECT: m.label,
          EXPRESSION: expr,
          REFERENCED_TABLE: targetMeasure
            ? targetMeasure.table
            : refTable || m.table,
          REFERENCED_OBJECT: targetMeasure ? targetMeasure.label : refObj,
          REFERENCED_OBJECT_TYPE: targetMeasure ? "MEASURE" : "COLUMN",
          REFERENCED_EXPRESSION: targetMeasure ? targetMeasure.formula : "",
        });
      }
    }
    return rows;
  }

  private buildInfoStorageTableColumnsRows(): Array<Record<string, unknown>> {
    const rows = this.availableTables().flatMap((table) => {
      const rowCount = Math.max(100, table.rowCount ?? 1000);
      return table.columns.map((col) => {
        const bytesPerVal = col.dataType.toUpperCase().includes("CHAR")
          ? 32
          : 8;
        const dictBytes = Math.max(1024, rowCount * bytesPerVal);
        const sizeKb = Math.round((dictBytes / 1024) * 100) / 100;
        return {
          DIMENSION_NAME: table.name,
          Table: table.name,
          ATTRIBUTE_NAME: col.name,
          Colonne: col.name,
          DATA_TYPE: col.dataType,
          DICTIONARY_SIZE: dictBytes,
          SizeKB: sizeKb,
          Taille: sizeKb,
        };
      });
    });
    return rows.sort(
      (a, b) => Number(b["DICTIONARY_SIZE"]) - Number(a["DICTIONARY_SIZE"]),
    );
  }

  /**
   * Applies SELECTCOLUMNS projection and ORDER BY sorting when wrapping an INFO.* function.
   */
  private applySelectColumnsAndOrder(
    query: string,
    baseRows: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    let result = [...baseRows];

    if (/SELECTCOLUMNS\s*\(/i.test(query) && result.length > 0) {
      const pairRegex = /"([^"]+)"\s*,\s*\[([^\]]+)\]/g;
      const mappings: Array<{ alias: string; col: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = pairRegex.exec(query)) !== null) {
        mappings.push({ alias: match[1], col: match[2] });
      }
      if (mappings.length > 0) {
        result = result.map((row) => {
          const projected: Record<string, unknown> = {};
          for (const { alias, col } of mappings) {
            const key =
              Object.keys(row).find(
                (k) => k.toLowerCase() === col.toLowerCase(),
              ) ?? col;
            projected[alias] = row[key] ?? "";
          }
          return projected;
        });
      }
    }

    const orderMatch = query.match(
      /ORDER\s+BY\s+(?:[A-Za-z0-9_']+)?\[([^\]]+)\]\s*(ASC|DESC)?/i,
    );
    if (orderMatch && result.length > 1) {
      const targetCol = orderMatch[1];
      const isDesc = (orderMatch[2] ?? "ASC").toUpperCase() === "DESC";
      const resolvedKey =
        Object.keys(result[0]).find(
          (k) => k.toLowerCase() === targetCol.toLowerCase(),
        ) ?? targetCol;
      result.sort((a, b) => {
        const va = a[resolvedKey];
        const vb = b[resolvedKey];
        if (typeof va === "number" && typeof vb === "number") {
          return isDesc ? vb - va : va - vb;
        }
        const cmp = String(va ?? "").localeCompare(String(vb ?? ""));
        return isDesc ? -cmp : cmp;
      });
    }

    return result;
  }

  /**
   * Parses both TMDL (createOrReplace / table / /// description / measure / formatString)
   * and DAX Query View (DEFINE MEASURE 'table'[Name] = ...) blocks and saves them to StateManagerService.
   */
  private extractAndSaveMeasuresFromScript(script: string): number {
    let savedCount = 0;
    const defaultTable = this.availableTables()[0]?.name ?? "fact_transactions";

    if (/^\s*(createOrReplace|table\s+)/im.test(script)) {
      let currentTable = defaultTable;
      let pendingDesc: string[] = [];
      let lastMeasure: RaxMeasureDescriptor | null = null;

      for (const rawLine of script.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed.startsWith("///")) {
          const commentText = trimmed.slice(3).trim();
          if (commentText) {
            pendingDesc.push(commentText);
          }
          continue;
        }
        const tableMatch = trimmed.match(
          /^table\s+(?:'([^']+)'|([A-Za-z0-9_ -]+))$/i,
        );
        if (tableMatch) {
          currentTable = (tableMatch[1] ?? tableMatch[2]).trim();
          pendingDesc = [];
          continue;
        }
        const measureMatch = trimmed.match(
          /^measure\s+(?:'([^']+)'|([A-Za-z0-9_ -]+))\s*=\s*(.+)$/i,
        );
        if (measureMatch) {
          const label = (measureMatch[1] ?? measureMatch[2]).trim();
          const formula = measureMatch[3].trim();
          const existing = this.availableMeasures().find(
            (m) => m.label.toLowerCase() === label.toLowerCase(),
          );
          const descriptor: RaxMeasureDescriptor = {
            id:
              existing?.id ??
              `m-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            label,
            formula,
            table: currentTable,
            description:
              pendingDesc.length > 0
                ? pendingDesc.join(" ")
                : existing?.description,
            formatString: existing?.formatString,
          };
          this.state.saveMeasure(descriptor);
          lastMeasure = descriptor;
          pendingDesc = [];
          savedCount += 1;
          continue;
        }
        const fmtMatch = trimmed.match(/^formatString:\s*"([^"]*)"$/i);
        if (fmtMatch && lastMeasure) {
          const updated: RaxMeasureDescriptor = {
            ...lastMeasure,
            formatString: fmtMatch[1],
          };
          this.state.saveMeasure(updated);
          lastMeasure = updated;
        }
      }
      return savedCount;
    }

    // Parse DEFINE MEASURE declarations (with optional preceding /// comments)
    const defineRegex =
      /(?:((?:^\s*\/\/\/[^\r\n]*\r?\n)+))?\s*MEASURE\s+(?:'([^']+)'|([A-Za-z0-9_]+))?\[([^\]]+)\]\s*=\s*(.+?)(?=\n\s*(?:\/\/\/|MEASURE\b|EVALUATE\b)|$)/gims;
    let match: RegExpExecArray | null;
    while ((match = defineRegex.exec(script)) !== null) {
      const rawComments = match[1] ?? "";
      const parsedDesc = rawComments
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("///"))
        .map((l) => l.slice(3).trim())
        .join(" ")
        .trim();
      const table = (match[2] ?? match[3] ?? defaultTable).trim();
      const label = match[4].trim();
      const formula = match[5].trim();
      const existing = this.availableMeasures().find(
        (m) => m.label.toLowerCase() === label.toLowerCase(),
      );
      this.state.saveMeasure({
        id:
          existing?.id ??
          `m-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label,
        formula,
        table,
        description: parsedDesc || existing?.description,
        formatString: existing?.formatString,
      });
      savedCount += 1;
    }
    return savedCount;
  }

  /**
   * Evaluates SUMMARIZECOLUMNS against loaded table rows in StateManagerService when present.
   */
  private tryEvaluateAgainstLoadedRows(query: string): RaxQueryResult | null {
    const sumColsMatch = query.match(
      /SUMMARIZECOLUMNS\s*\(\s*(?:'([^']+)'|([A-Za-z0-9_]+))\[([^\]]+)\]\s*,\s*"([^"]+)"\s*,\s*(.+)\)/is,
    );
    if (!sumColsMatch) {
      return null;
    }
    const groupTable = (sumColsMatch[1] ?? sumColsMatch[2]).trim();
    const groupCol = sumColsMatch[3].trim();
    const metricAlias = sumColsMatch[4].trim();
    const tableRows = this.state.getTableRows(groupTable);
    if (!tableRows || tableRows.length === 0) {
      return null;
    }

    const groups = new Map<string, number>();
    for (const row of tableRows) {
      const keyVal = String(row[groupCol] ?? "Unspecified");
      groups.set(keyVal, (groups.get(keyVal) ?? 0) + 1);
    }

    const rows = Array.from(groups.entries()).map(([k, count]) => ({
      [groupCol]: k,
      [metricAlias]: count,
    }));

    return {
      cacheKey: `local-summarize-${groupTable}-${groupCol}`,
      cacheHit: false,
      routedEngine: "DUCKDB",
      executionTimeMs: 3,
      executedSql: `SELECT ${groupCol}, COUNT(*) AS "${metricAlias}" FROM ${groupTable} GROUP BY ${groupCol};`,
      rows,
    };
  }

  private analyzeSyntax(query: string): RaxDiagnostic[] {
    const diagnostics: RaxDiagnostic[] = [];
    const trimmed = query.trim();

    if (!trimmed) {
      return diagnostics;
    }

    const stack: Array<{ char: string; line: number; col: number }> = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const closers = new Set([")", "]", "}"]);

    const lines = query.split(/\r?\n/);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx];
      let inSingle = false;
      let inDouble = false;

      if (
        lineText.trimStart().startsWith("//") ||
        lineText.trimStart().startsWith("--")
      ) {
        continue;
      }

      for (let colIdx = 0; colIdx < lineText.length; colIdx++) {
        const ch = lineText[colIdx];
        if (ch === "'" && !inDouble) {
          inSingle = !inSingle;
          continue;
        }
        if (ch === '"' && !inSingle) {
          inDouble = !inDouble;
          continue;
        }
        if (inSingle || inDouble) {
          continue;
        }

        if (pairs[ch]) {
          stack.push({ char: ch, line: lineIdx + 1, col: colIdx + 1 });
        } else if (closers.has(ch)) {
          const last = stack.pop();
          if (!last || pairs[last.char] !== ch) {
            diagnostics.push({
              severity: "error",
              line: lineIdx + 1,
              startColumn: colIdx + 1,
              errorCode: "ERR_RAX_SYNTAX",
              message: `Unexpected closing '${ch}' token.`,
            });
          }
        }
      }

      if (inSingle || inDouble) {
        diagnostics.push({
          severity: "error",
          line: lineIdx + 1,
          startColumn: 1,
          errorCode: "ERR_RAX_SYNTAX",
          message: "Unterminated string or identifier literal.",
        });
      }
    }

    for (const unclosed of stack) {
      diagnostics.push({
        severity: "error",
        line: unclosed.line,
        startColumn: unclosed.col,
        errorCode: "ERR_RAX_SYNTAX",
        message: `Unclosed '${unclosed.char}' delimiter.`,
      });
    }

    if (
      trimmed.toUpperCase().includes("FILTER(ALL(") &&
      !trimmed.includes("[")
    ) {
      diagnostics.push({
        severity: "warning",
        line: 1,
        startColumn: 1,
        errorCode: "WARN_INEFFICIENT_TABLE_FILTER",
        message:
          "Filtering an entire table via FILTER(ALL(Table), ...) degrades DuckDB SIMD vectorization; filter only the specific column.",
      });
    }

    return diagnostics;
  }

  private patchActiveTab(patch: Partial<RaxQueryTab>): void {
    this.patchTabById(this.activeTab().id, patch);
  }

  private patchTabById(tabId: string, patch: Partial<RaxQueryTab>): void {
    this.tabs.update((list) =>
      list.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
    );
  }
}
