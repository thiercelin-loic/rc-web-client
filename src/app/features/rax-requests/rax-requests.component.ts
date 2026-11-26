import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { HttpErrorResponse } from "@angular/common/http";
import { Subject, debounceTime, distinctUntilChanged } from "rxjs";
import {
  DEFAULT_SEMANTIC_MODEL,
  SemanticModelService,
} from "../../core/model/model.service";
import {
  RaxMeasureDescriptor,
  RaxStudioQueryResult,
  SharedColumn,
  SharedTable,
  StateManagerService,
} from "../../core/state/state.service";
import {
  DiagnosticMarker,
  QueryExecutionResult,
  RaxDiagnostic,
  RaxMonacoMarkerData,
  RaxProblemDetail,
  RaxService,
} from "../../core/rax/rax.service";

export type { RaxDiagnostic, RaxMonacoMarkerData, RaxProblemDetail };

export interface RaxQueryTab {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly isExecuting: boolean;
  readonly lastResult: RaxStudioQueryResult | null;
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
  readonly kind: "Keyword" | "Function" | "Table" | "Column" | "Measure";
  readonly signature?: string;
  readonly doc?: string;
}

export type RaxDockSection =
  | "Tables"
  | "Measures"
  | "Templates"
  | "SchemaFunctions";

const RAX_KEYWORDS: readonly string[] = [
  "EVALUATE",
  "DEFINE",
  "MEASURE",
  "VAR",
  "RETURN",
  "ASC",
  "DESC",
  "ORDER BY",
  "TRUE",
  "FALSE",
  "NOT",
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
  imports: [],
  templateUrl: "./rax-requests.component.html",
  styleUrl: "./rax-requests.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "(window:keydown)": "onKeydown($event)",
  },
})
export class RaxRequestsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = inject(StateManagerService);
  private readonly semanticModel = inject(SemanticModelService);
  private readonly rax = inject(RaxService);

  private readonly queryEditor =
    viewChild<ElementRef<HTMLTextAreaElement>>("queryEditor");
  private readonly editorGutter =
    viewChild<ElementRef<HTMLDivElement>>("editorGutter");

  public readonly queryContent = this.state.raxQueryContent;
  public readonly isExecuting = signal<boolean>(false);
  public readonly lastResult = this.state.raxLastResult;
  public readonly diagnostics = signal<readonly RaxDiagnostic[]>([]);
  public readonly monacoMarkers = signal<readonly RaxMonacoMarkerData[]>([]);
  public readonly errorBanner = signal<RaxProblemDetail | null>(null);
  public readonly statusText = signal<string>("Ready");
  public readonly bottomActiveTab = signal<"results" | "problems" | "plan">(
    "results",
  );
  public readonly findText = signal<string>("");
  public readonly replaceText = signal<string>("");

  private readonly editorInput$ = new Subject<string>();

  protected readonly activeMobileTab = signal<"editor" | "explorer">("editor");
  protected readonly sidebarOpen = signal<boolean>(true);
  protected readonly sidebarFilter = signal<string>("");
  protected readonly expandedSections = signal<Record<RaxDockSection, boolean>>(
    {
      Tables: true,
      Measures: true,
      Templates: false,
      SchemaFunctions: false,
    },
  );
  protected readonly expandedTables = signal<Record<string, boolean>>({});
  protected readonly findReplaceOpen = signal<boolean>(false);
  protected readonly autocompleteOpen = signal<boolean>(false);
  protected readonly autocompleteIndex = signal<number>(0);
  protected readonly cursorToken = signal<string>("");
  protected readonly schemaFunctions: readonly string[] = INFO_SCHEMA_FUNCTIONS;

  public readonly isAllCollapsed = computed(() =>
    Object.values(this.expandedSections()).every((expanded) => !expanded),
  );

  public readonly activeTab = computed<RaxQueryTab>(() => ({
    id: "query-editor",
    name: "Query.rax",
    content: this.queryContent(),
    isExecuting: this.isExecuting(),
    lastResult: this.lastResult(),
    diagnostics: this.diagnostics(),
    statusText: this.statusText(),
  }));

  protected readonly hasDefinable = computed<boolean>(() => {
    const content = this.activeTab().content.trim().toUpperCase();
    return (
      content.startsWith("CREATEORREPLACE") ||
      content.startsWith("TABLE ") ||
      /\bDEFINE\s+MEASURE\b/.test(content) ||
      /\bMEASURE\s+(?:'[^']+'|[A-Z0-9_]+)?\[[^\]]+\]\s*=/.test(content)
    );
  });

  protected readonly lineNumbers = computed<number[]>(() => {
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

  private readonly availableTables = computed<readonly SharedTable[]>(
    () => this.state.sharedTables,
  );

  private readonly availableMeasures = computed<
    readonly RaxMeasureDescriptor[]
  >(() => this.state.measures);

  protected readonly filteredTables = computed<readonly SharedTable[]>(() => {
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

  protected readonly filteredMeasures = computed<
    readonly RaxMeasureDescriptor[]
  >(() => {
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
  });

  public readonly quickSnippets = computed<readonly RaxSnippet[]>(() => {
    const tables = this.availableTables();
    const isNumeric = (dataType: string): boolean =>
      /INT|DOUBLE|DECIMAL|FLOAT|NUMBER|NUMERIC/i.test(dataType);
    const isText = (dataType: string): boolean =>
      /CHAR|TEXT|STRING/i.test(dataType);

    const primaryTable =
      tables.find((t) => t.columns.some((c) => isNumeric(c.dataType))) ??
      tables[0];

    const snippets: RaxSnippet[] = [
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
    ];

    if (primaryTable && primaryTable.columns.length > 0) {
      const tName = primaryTable.name;
      const numCols = primaryTable.columns.filter((c) => isNumeric(c.dataType));
      const textCols = primaryTable.columns.filter((c) => isText(c.dataType));
      const numCol1 = numCols[0]?.name ?? primaryTable.columns[0].name;
      const numCol2 = numCols[1]?.name ?? numCol1;
      const groupTable =
        textCols.length > 0
          ? primaryTable
          : (tables.find((t) => t.columns.some((c) => isText(c.dataType))) ??
            primaryTable);
      const groupColName =
        textCols[0]?.name ??
        groupTable.columns.find((c) => isText(c.dataType))?.name ??
        groupTable.columns[0]?.name ??
        numCol1;

      snippets.push(
        {
          label: "Summarize Records by Column (SUMMARIZECOLUMNS)",
          category: "Evaluation",
          code: `EVALUATE\nSUMMARIZECOLUMNS(\n  '${groupTable.name}'[${groupColName}],\n  "Total ${numCol1}", SUM('${tName}'[${numCol1}]),\n  "Record Count", COUNTROWS('${tName}')\n)\nORDER BY [Total ${numCol1}] DESC`,
        },
        {
          label: "Define and Evaluate Ad-Hoc Measure",
          category: "Evaluation",
          code: `DEFINE\n  MEASURE '${tName}'[Net Metric] = SUM('${tName}'[${numCol1}]) - SUM('${tName}'[${numCol2}])\nEVALUATE\nROW("Net Metric", [Net Metric])`,
        },
        {
          label: "Step-by-Step Variable Evaluation (VAR / RETURN)",
          category: "Evaluation",
          code: `EVALUATE\nVAR BaseTotal = SUM('${tName}'[${numCol1}])\nVAR RowTotal = COUNTROWS('${tName}')\nVAR AvgPerRow = DIVIDE(BaseTotal, RowTotal, 0)\nRETURN\nROW("Base Total", BaseTotal, "Row Count", RowTotal, "Average", AvgPerRow)`,
        },
        {
          label: "TMDL Measure Definition Script",
          category: "TMDL",
          code: `createOrReplace\n  table '${tName}'\n    /// Aggregated total across active records\n    measure 'Total ${numCol1}' = CALCULATE(SUM('${tName}'[${numCol1}]))\n      formatString: "#,0.00"`,
        },
      );
    }

    return snippets;
  });

  protected readonly autocompleteSuggestions = computed<
    readonly RaxAutocompleteItem[]
  >(() => {
    const token = this.cursorToken().trim().toUpperCase();
    if (!this.autocompleteOpen() || token.length < 2) {
      return [];
    }
    const items: RaxAutocompleteItem[] = [];
    const seen = new Set<string>();

    for (const entry of this.rax.catalog()) {
      if (entry.label.toUpperCase().includes(token)) {
        const key = `Function:${entry.label}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            label: entry.label,
            insertText: entry.label,
            kind: "Function",
            signature: entry.signature,
            doc: entry.doc,
          });
        }
      }
    }
    for (const fn of INFO_SCHEMA_FUNCTIONS) {
      if (fn.toUpperCase().includes(token)) {
        const key = `Function:${fn}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ label: fn, insertText: fn, kind: "Function" });
        }
      }
    }
    for (const kw of RAX_KEYWORDS) {
      if (kw.startsWith(token) && kw !== token) {
        items.push({ label: kw, insertText: kw, kind: "Keyword" });
      }
    }
    for (const table of this.availableTables()) {
      const needsQuotes = /[^a-zA-Z0-9_]/.test(table.name);
      const ref = needsQuotes ? `'${table.name}'` : table.name;
      if (table.name.toUpperCase().includes(token)) {
        items.push({ label: table.name, insertText: ref, kind: "Table" });
      }
      for (const col of table.columns) {
        const colRef = `${ref}[${col.name}]`;
        if (
          col.name.toUpperCase().includes(token) ||
          colRef.toUpperCase().includes(token)
        ) {
          items.push({ label: colRef, insertText: colRef, kind: "Column" });
        }
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
    this.rax.loadCatalog().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

    this.editorInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.validateQuery();
      });

    if (
      this.state.sharedTables.length === 0 ||
      this.state.measures.length === 0
    ) {
      this.semanticModel
        .loadDefault()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((payload) => {
          this.semanticModel.pullState(payload, this.state);
        });
    }
  }

  protected syncGutter(): void {
    const textarea = this.queryEditor()?.nativeElement;
    const gutter = this.editorGutter()?.nativeElement;
    if (textarea && gutter) {
      gutter.scrollTop = textarea.scrollTop;
    }
  }

  protected targetValue(event: Event): string {
    return (
      (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ??
      ""
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
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
      this.toggleReplace();
    }
  }

  protected editorKeydown(event: KeyboardEvent): void {
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
      this.applySuggestion(
        suggestions[this.autocompleteIndex()] ?? suggestions[0],
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.autocompleteOpen.set(false);
    }
  }

  protected applySuggestion(item: RaxAutocompleteItem): void {
    const textarea = this.queryEditor()?.nativeElement;
    const current = this.activeTab().content;
    if (textarea && typeof textarea.selectionStart === "number") {
      const pos = textarea.selectionStart;
      const before = current.slice(0, pos);
      const after = current.slice(pos);
      const tokenMatch = before.match(/[A-Za-z0-9_.'[]+$/);
      const tokenStart = tokenMatch ? pos - tokenMatch[0].length : pos;
      const updated = current.slice(0, tokenStart) + item.insertText + after;
      this.updateContent(updated);
      this.autocompleteOpen.set(false);
      setTimeout(() => {
        textarea.focus();
        const nextCursor = tokenStart + item.insertText.length;
        textarea.setSelectionRange(nextCursor, nextCursor);
      }, 0);
      return;
    }
    this.insertText(item.insertText);
    this.autocompleteOpen.set(false);
  }

  public updateContent(content: string): void {
    this.patchTab({ content });
    this.editorInput$.next(content);
    const textarea = this.queryEditor()?.nativeElement;
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
    this.errorBanner.set(null);
    this.monacoMarkers.set([]);
    this.patchTab({
      content: "",
      diagnostics: [],
      statusText: "Editor cleared",
    });
    this.state.announce("Query editor cleared.");
  }

  public clearError(): void {
    this.errorBanner.set(null);
  }

  protected toggleReplace(): void {
    this.findReplaceOpen.update((open) => !open);
  }

  public replaceAll(): void {
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
      this.patchTab({
        statusText: `No occurrences of "${target}" found`,
      });
      return;
    }
    this.patchTab({
      content: current.replace(regex, replacement),
      statusText: `Replaced ${count} occurrence(s) of "${target}"`,
    });
    this.state.announce(`Replaced ${count} occurrence(s) in active RAX query.`);
  }

  protected toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  public sectionExpanded(section: RaxDockSection): boolean {
    return !!this.expandedSections()[section];
  }

  public toggleSection(section: RaxDockSection): void {
    this.expandedSections.update((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }

  public toggleAll(): void {
    const shouldExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Tables: shouldExpand,
      Measures: shouldExpand,
      Templates: shouldExpand,
      SchemaFunctions: shouldExpand,
    });
  }

  protected toggleTable(tableName: string): void {
    this.expandedTables.update((current) => ({
      ...current,
      [tableName]: !current[tableName],
    }));
  }

  protected applySnippet(snippet: RaxSnippet | undefined): void {
    if (!snippet) {
      return;
    }
    this.patchTab({
      content: snippet.code,
      diagnostics: [],
      statusText: `Loaded template: ${snippet.label}`,
    });
    this.state.announce(`Loaded RAX template ${snippet.label}`);
  }

  protected insertText(text: string): void {
    const current = this.activeTab().content;
    const textarea = this.queryEditor()?.nativeElement;
    if (textarea && typeof textarea.selectionStart === "number") {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd ?? start;
      const updated = current.slice(0, start) + text + current.slice(end);
      this.updateContent(updated);
      setTimeout(() => {
        textarea.focus();
        const cursor = start + text.length;
        textarea.setSelectionRange(cursor, cursor);
      }, 0);
      return;
    }
    const separator = current && !current.endsWith("\n") ? " " : "";
    this.updateContent(`${current}${separator}${text}`);
  }

  protected insertColumn(table: SharedTable, columnName: string): void {
    const needsQuotes = /[^a-zA-Z0-9_]/.test(table.name);
    const tableRef = needsQuotes ? `'${table.name}'` : table.name;
    this.insertText(`${tableRef}[${columnName}]`);
  }

  protected insertMeasure(measure: RaxMeasureDescriptor): void {
    this.insertText(`[${measure.label}]`);
  }

  protected evalMeasure(measure: RaxMeasureDescriptor, event?: Event): void {
    event?.stopPropagation();
    const query = `EVALUATE\nROW("${measure.label}", ${measure.formula})`;
    this.updateContent(query);
    this.runQuery();
  }

  public defineMeasures(event?: Event): void {
    event?.stopPropagation();
    if (
      this.availableMeasures().length === 0 &&
      this.availableTables().length === 0
    ) {
      this.patchTab({
        diagnostics: [],
        statusText:
          "Load a table in the semantic model to generate measure definitions",
      });
      this.state.announce(
        "No tables or measures available in the active semantic model.",
      );
      return;
    }
    this.errorBanner.set(null);
    this.rax
      .defineMeasures(this.semanticModel.modelId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.patchTab({
            content: response.script,
            diagnostics: [],
            statusText: "Generated measure definitions script",
          });
          this.state.announce("Generated DEFINE script for model measures.");
        },
        error: (err: unknown) => {
          this.surfaceProblem("Generate DEFINE script", err);
        },
      });
  }

  public generateTmdl(event?: Event): void {
    event?.stopPropagation();
    if (
      this.availableMeasures().length === 0 &&
      this.availableTables().length === 0
    ) {
      this.patchTab({
        diagnostics: [],
        statusText: "Load a table in the semantic model to generate TMDL",
      });
      this.state.announce(
        "No tables or measures available in the active semantic model.",
      );
      return;
    }
    this.errorBanner.set(null);
    this.rax
      .generateTmdl(this.semanticModel.modelId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.patchTab({
            content: response.tmdlScript,
            diagnostics: [],
            statusText: "Generated TMDL definition script",
          });
          this.state.announce("Generated TMDL definition script.");
        },
        error: (err: unknown) => {
          this.surfaceProblem("Generate TMDL script", err);
        },
      });
  }

  public applyModel(): void {
    const content = this.activeTab().content.trim();
    if (!content) {
      return;
    }
    this.errorBanner.set(null);
    this.rax
      .applyMeasures(content, this.semanticModel.modelId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.patchTab({
            statusText: `Applied ${response.appliedCount} measure(s) to semantic model`,
          });
          this.state.announce(
            `Updated semantic model with ${response.appliedCount} measure(s).`,
          );
        },
        error: (err: unknown) => {
          this.surfaceProblem("Apply measures", err);
        },
      });
  }

  protected materializeTable(): void {
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
      return { name: colName, dataType, keyType: "None" };
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
    this.state.setRows(tableName, result.rows);
    this.patchTab({
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
    this.errorBanner.set(null);
    this.rax
      .formatScript(raw)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.patchTab({
            content: response.formattedScript,
            statusText: "Formatted RAX script",
          });
          this.state.announce("Formatted RAX query.");
        },
        error: (err: unknown) => {
          this.surfaceProblem("Format RAX query", err);
        },
      });
  }

  public validateQuery(): void {
    const content = this.activeTab().content;
    if (!content.trim()) {
      this.monacoMarkers.set([]);
      this.patchTab({
        diagnostics: [],
        statusText: "Ready",
      });
      return;
    }
    const activeSchema =
      this.availableTables().length > 0 || this.availableMeasures().length > 0
        ? this.semanticModel.buildPayload(this.semanticModel.toPayload())
        : null;
    this.rax
      .validateScript(
        content,
        "New Measure",
        this.semanticModel.modelId(),
        activeSchema,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (!result) {
            this.monacoMarkers.set([]);
            this.patchTab({ diagnostics: [], statusText: "Ready" });
            return;
          }
          const markers: RaxMonacoMarkerData[] = result.diagnostics.map((d) =>
            this.toMarker(d),
          );
          this.monacoMarkers.set(markers);
          const diagnostics: RaxDiagnostic[] = result.diagnostics.map((d) => {
            const sev = (d.severity ?? "error").toLowerCase();
            return {
              severity:
                sev === "warning" || sev === "info" ? sev : "error",
              line: d.line ?? 1,
              startColumn: d.startColumn ?? d.column ?? 1,
              length: d.length ?? 1,
              errorCode: d.errorCode ?? d.code ?? "ERR_RAX_SYNTAX",
              message: d.message ?? "",
            };
          });
          const errors = diagnostics.filter((d) => d.severity === "error");
          const statusText =
            errors.length > 0
              ? `Validation found ${diagnostics.length} problem(s) — [${errors[0].errorCode}] Line ${errors[0].line}: ${errors[0].message}`
              : diagnostics.length > 0
                ? `Syntax valid (${diagnostics.length} warning: ${diagnostics[0].message})`
                : "Syntax valid (0 problems)";
          this.patchTab({ diagnostics, statusText });
          if (diagnostics.length > 0) {
            this.bottomActiveTab.set("problems");
          }
          this.state.announce(statusText, { error: errors.length > 0 });
        },
        error: (err: unknown) => {
          this.surfaceProblem("Validate RAX query", err);
        },
      });
  }

  public runQuery(): void {
    const tab = this.activeTab();
    if (tab.isExecuting) {
      return;
    }
    this.errorBanner.set(null);
    this.patchTab({
      diagnostics: [],
      isExecuting: true,
      statusText: "Executing RAX query...",
    });

    this.rax
      .executeScript(tab.content, this.semanticModel.modelId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.handleResult(result),
        error: (err: unknown) => this.handleError(err),
      });
  }

  protected exportCsv(): void {
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

  private handleResult(result: QueryExecutionResult): void {
    this.errorBanner.set(null);
    const mutableResult: RaxStudioQueryResult = {
      cacheKey: result.cacheKey,
      cacheHit: result.cacheHit,
      routedEngine: result.routedEngine,
      executionTimeMs: result.executionTimeMs,
      executedSql: result.executedSql,
      rows: result.rows.map((row) => ({ ...row })),
    };
    const summary = `Completed in ${result.executionTimeMs} ms (${result.rows.length} row(s), ${result.routedEngine})`;
    this.patchTab({
      isExecuting: false,
      lastResult: mutableResult,
      statusText: summary,
    });
    this.bottomActiveTab.set("results");
    this.state.announce(summary);
  }

  private handleError(err: unknown): void {
    const problem = this.extractProblem(err);
    this.errorBanner.set(problem);
    const errorCode = problem.errorCode ?? "ERR_RAX_EXECUTION";
    const diagnostic: RaxDiagnostic = {
      severity: "error",
      line: 1,
      startColumn: 1,
      errorCode,
      message: problem.detail,
    };
    this.patchTab({
      isExecuting: false,
      diagnostics: [diagnostic],
      statusText: `Execution failed — [${errorCode}] ${problem.detail}`,
    });
    this.bottomActiveTab.set("problems");
    this.state.announceError("RAX query execution", err);
  }

  private surfaceProblem(action: string, err: unknown): void {
    const problem = this.extractProblem(err);
    this.errorBanner.set(problem);
    const codeTag = problem.errorCode ? `[${problem.errorCode}] ` : "";
    this.patchTab({
      statusText: `${action} failed — ${codeTag}${problem.detail}`,
    });
    this.state.announceError(action, err);
  }

  private extractProblem(err: unknown): RaxProblemDetail {
    const httpErr = err instanceof HttpErrorResponse ? err : null;
    const rawBody = httpErr?.error;
    const bodyObj =
      rawBody && typeof rawBody === "object"
        ? (rawBody as Record<string, unknown>)
        : null;
    const detail =
      (typeof bodyObj?.["detail"] === "string" && bodyObj["detail"].trim()
        ? bodyObj["detail"].trim()
        : null) ??
      (typeof bodyObj?.["message"] === "string" && bodyObj["message"].trim()
        ? bodyObj["message"].trim()
        : null) ??
      (typeof rawBody === "string" && rawBody.trim() ? rawBody.trim() : null) ??
      (err instanceof Error ? err.message : "RAX request failed");
    const errorCode =
      typeof bodyObj?.["errorCode"] === "string" && bodyObj["errorCode"].trim()
        ? bodyObj["errorCode"].trim()
        : undefined;
    const title =
      typeof bodyObj?.["title"] === "string" && bodyObj["title"].trim()
        ? bodyObj["title"].trim()
        : httpErr?.statusText || "Request Error";
    return {
      title,
      status: httpErr?.status,
      detail,
      errorCode,
    };
  }

  private toMarker(d: DiagnosticMarker): RaxMonacoMarkerData {
    const line = d.line ?? 1;
    const startCol = d.startColumn ?? d.column ?? 1;
    const len = Math.max(1, d.length ?? 1);
    const rawSev = (d.severity ?? "ERROR").toUpperCase();
    const severity: RaxMonacoMarkerData["severity"] =
      rawSev === "WARNING" || rawSev === "INFO" ? rawSev : "ERROR";
    return {
      startLineNumber: line,
      startColumn: startCol,
      endLineNumber: line,
      endColumn: d.endColumn ?? startCol + len,
      severity,
      code: d.errorCode ?? d.code ?? "ERR_RAX_SYNTAX",
      message: d.message ?? "",
    };
  }

  private patchTab(patch: Partial<RaxQueryTab>): void {
    if (patch.content !== undefined) {
      this.queryContent.set(patch.content);
    }
    if (patch.isExecuting !== undefined) {
      this.isExecuting.set(patch.isExecuting);
    }
    if (patch.lastResult !== undefined) {
      this.lastResult.set(patch.lastResult);
    }
    if (patch.diagnostics !== undefined) {
      this.diagnostics.set(patch.diagnostics);
    }
    if (patch.statusText !== undefined) {
      this.statusText.set(patch.statusText);
    }
  }
}
