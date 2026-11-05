import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { AuthService } from "./auth.service";

export type FilterOp = "EQ" | "IN" | "NEQ" | "BETWEEN";
export type FilterValue = string | number | boolean;

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "rc_theme_preference";
const MEASURES_STORAGE_KEY = "rc_measures_state";
const TABLES_STORAGE_KEY = "rc_tables_state";
const TABLE_ROWS_STORAGE_KEY = "rc_table_rows_state";
const ANONYMOUS_STORAGE_SCOPE = "anonymous";

export interface FilterClause {
  readonly dimension: string;
  readonly operator: FilterOp;
  readonly values: readonly FilterValue[];
}

/**
 * Immutable composite filter context evaluated by the RAX ContextEvaluator.
 */
export class CompositeFilterContext {
  constructor(
    public readonly clauses: ReadonlyMap<string, FilterClause> = new Map(),
  ) {}

  public withFilter(
    dimension: string,
    operator: FilterOp,
    values: readonly FilterValue[],
  ): CompositeFilterContext {
    const nextClauses = new Map(this.clauses);
    nextClauses.set(dimension, {
      dimension,
      operator,
      values: [...values],
    });
    return new CompositeFilterContext(nextClauses);
  }

  public withoutFilter(dimension: string): CompositeFilterContext {
    const nextClauses = new Map(this.clauses);
    nextClauses.delete(dimension);
    return new CompositeFilterContext(nextClauses);
  }

  public getSelectedValue(dimension: string, fallback = "All"): string {
    const clause = this.clauses.get(dimension);
    if (!clause || clause.values.length === 0) {
      return fallback;
    }
    return String(clause.values[0]);
  }

  public toContextHash(): string {
    const entries = Array.from(this.clauses.entries())
      .map(
        ([dimension, clause]) =>
          `${dimension}:${clause.operator}:${clause.values.join(",")}`,
      )
      .sort()
      .join("|");

    let hash = 2166136261;
    for (let index = 0; index < entries.length; index++) {
      hash ^= entries.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

export interface ProjectDescriptor {
  readonly filename: string;
  readonly statusPill: string;
  readonly branch: string;
  readonly watermark: string;
}

export interface RaxMeasureDescriptor {
  readonly id: string;
  readonly label: string;
  readonly formula: string;
  readonly table: string;
  readonly description?: string;
  readonly formatString?: string;
  readonly isHidden?: boolean;
}

const EMPTY_MEASURE: RaxMeasureDescriptor = {
  id: "",
  label: "No measure selected",
  formula: "",
  table: "",
};

export type ExchangeLogLevel = "request" | "success" | "error";

export interface ExchangeLogEntry {
  readonly id: number;
  readonly level: ExchangeLogLevel;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly durationMs: number;
  readonly timestamp: string;
}

export type ColumnSummarization =
  | "None"
  | "Sum"
  | "Average"
  | "Min"
  | "Max"
  | "Count"
  | "DistinctCount";

export type ColumnDisplayFormat =
  | "General"
  | "Currency"
  | "Percentage"
  | "Date"
  | "WholeNumber"
  | "Decimal";

export interface SharedColumn {
  readonly name: string;
  readonly dataType: string;
  readonly keyType?: "PK" | "FK" | "None";
  readonly description?: string;
  readonly isHidden?: boolean;
  readonly displayFolder?: string;
  readonly expression?: string;
  readonly summarizeBy?: ColumnSummarization;
  readonly sortByColumn?: string;
  readonly format?: ColumnDisplayFormat;
}

export interface SharedTable {
  readonly id: string;
  readonly name: string;
  readonly role: "FACT" | "DIMENSION";
  readonly columns: readonly SharedColumn[];
  readonly rowCount?: number;
  readonly description?: string;
  readonly isHidden?: boolean;
  readonly expression?: string;
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
}

export interface CanvasVisualItem {
  readonly id: string;
  title: string;
  archetype: string;
  width: "half" | "full";
  metricLabel: string;
  metricValue: string;
  metricSubtext: string;
  sortBy?: "value" | "axis";
  sortOrder?: "asc" | "desc";
  fieldWells?: Record<string, string[]>;
}

interface LegacyMediaQueryList {
  addListener?: (
    listener: (event: MediaQueryListEvent | MediaQueryList) => void,
  ) => void;
  removeListener?: (
    listener: (event: MediaQueryListEvent | MediaQueryList) => void,
  ) => void;
}

@Injectable({ providedIn: "root" })
export class StateManagerService {
  private readonly destroyRef = inject(DestroyRef, { optional: true });
  private readonly authService = inject(AuthService, { optional: true });
  private storageScope = this.getStorageScope();

  // Filter context state
  private readonly filterState = signal<CompositeFilterContext>(
    new CompositeFilterContext(),
  );
  public readonly activeFilters = this.filterState.asReadonly();
  public readonly selectedRegion = computed(() =>
    this.filterState().getSelectedValue("Region", "All"),
  );

  // Project state
  public readonly projects: readonly ProjectDescriptor[] = [
    {
      filename: "Untitled Project.rcp",
      statusPill: "draft [unsaved]",
      branch: "workspace/main",
      watermark: "00:00",
    },
  ];
  public readonly activeProject = signal<ProjectDescriptor>(this.projects[0]);
  public readonly watermarkTimestamp = signal<string>("00:00");

  // Report pages and canvas visuals state
  public readonly reportPages = signal<string[]>(["Page 1"]);
  public readonly activePage = signal<string>("Page 1");
  private readonly pageVisualsSignal = signal<
    Record<string, CanvasVisualItem[]>
  >({
    "Page 1": [],
  });
  public readonly activePageVisuals = computed<CanvasVisualItem[]>(() => {
    const pageName = this.activePage();
    return this.pageVisualsSignal()[pageName] ?? [];
  });

  // RAX Measures state
  private readonly measuresSignal = signal<RaxMeasureDescriptor[]>(
    this.getStoredMeasures(),
  );
  public get measures(): readonly RaxMeasureDescriptor[] {
    return this.measuresSignal();
  }
  public readonly activeMeasureId = signal<string>("");
  public readonly customFormulaText = signal<string>("");
  public readonly activeMeasure = computed(
    () =>
      this.measures.find((measure) => measure.id === this.activeMeasureId()) ??
      EMPTY_MEASURE,
  );

  // Semantic Tables state
  private readonly sharedTablesSignal = signal<SharedTable[]>(
    this.getStoredTables(),
  );
  public get sharedTables(): readonly SharedTable[] {
    return this.sharedTablesSignal();
  }

  // Shared table rows store (tableName -> rows array) populated by user ingestion / imports
  private readonly sharedTableRowsSignal = signal<Record<string, readonly Record<string, unknown>[]>>(
    this.getStoredTableRows(),
  );
  public readonly tableRowsMap = this.sharedTableRowsSignal.asReadonly();
  public getTableRows(tableName: string): readonly Record<string, unknown>[] {
    return this.sharedTableRowsSignal()[tableName] ?? [];
  }
  public setTableRows(tableName: string, rows: readonly Record<string, unknown>[]): void {
    this.sharedTableRowsSignal.update((current) => {
      const updated = {
        ...current,
        [tableName]: rows,
      };
      this.persistTableRows(updated);
      return updated;
    });
  }

  // Canvas dimensions state
  public readonly canvasDimensions = signal<{
    width: number;
    height: number;
    preset: string;
  }>({
    width: 1280,
    height: 720,
    preset: "16:9",
  });
  public setCanvasDimensions(
    width: number,
    height: number,
    preset = "Custom",
  ): void {
    this.canvasDimensions.set({ width, height, preset });
  }

  // Theme Management state
  public readonly themePreference = signal<ThemePreference>(
    this.getStoredThemePreference(),
  );
  public readonly systemTheme = signal<ThemeMode>(this.detectSystemTheme());
  public readonly isSystemTheme = computed<boolean>(
    () => this.themePreference() === "system",
  );
  public readonly isPrintingLightMode = signal<boolean>(false);
  public readonly theme = computed<ThemeMode>(() => {
    if (this.isPrintingLightMode()) {
      return "light";
    }
    const preference = this.themePreference();
    return preference === "system" ? this.systemTheme() : preference;
  });

  // UI Drawers state
  public readonly mobileDrawerOpen = signal<boolean>(false);

  // Status and Telemetry Logs state
  public readonly liveAnnouncement = signal<string>(
    "Workspace initialized — blank authoring canvas ready.",
  );
  public readonly statusMessage = signal<string>("Ready");
  public readonly isLoading = signal<boolean>(false);
  public readonly statusIsError = signal<boolean>(false);
  public readonly exchangeLogs = signal<readonly ExchangeLogEntry[]>([]);
  public readonly latestExchange = computed(
    () => this.exchangeLogs()[0] ?? null,
  );

  // Internal listeners and counters
  private mediaQueryList: MediaQueryList | null = null;
  private mediaQueryListener:
    | ((event: MediaQueryListEvent | MediaQueryList) => void)
    | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private exchangeSequence = 0;

  constructor() {
    this.initializeSystemThemeListener();

    effect(() => {
      const userId = this.authService?.currentUser()?.id ?? null;
      this.switchStorageScope(userId);
    });

    effect(() => {
      const activeTheme = this.theme();
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-bs-theme", activeTheme);
      }
    });

    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-bs-theme", this.theme());
    }

    this.destroyRef?.onDestroy(() => {
      this.cleanupSystemThemeListener();
    });
  }

  private switchStorageScope(userId: string | null): void {
    const nextScope = userId || ANONYMOUS_STORAGE_SCOPE;
    if (nextScope === this.storageScope) {
      return;
    }

    this.storageScope = nextScope;
    this.sharedTablesSignal.set(this.getStoredTables());
    this.sharedTableRowsSignal.set(this.getStoredTableRows());
    this.measuresSignal.set(this.getStoredMeasures());
    this.activeMeasureId.set("");
    this.customFormulaText.set("");
  }

  // ---------------------------------------------------------------------------
  // Filter Management
  // ---------------------------------------------------------------------------

  public applyFilter(
    dimension: string,
    operator: FilterOp,
    values: FilterValue[],
  ): void {
    this.filterState.update((currentContext) =>
      currentContext.withFilter(dimension, operator, values),
    );
    this.announce(
      `Filter updated: ${dimension} ${operator} ${values.join(", ")}`,
    );
  }

  public resetFilters(): void {
    this.filterState.set(new CompositeFilterContext());
    this.announce("All report filters cleared.");
  }

  public removeFilter(dimension: string): void {
    this.filterState.update((currentContext) =>
      currentContext.withoutFilter(dimension),
    );
    this.announce(`Filter removed for dimension: ${dimension}`);
  }

  // ---------------------------------------------------------------------------
  // Project Management
  // ---------------------------------------------------------------------------

  public selectProject(filename: string): void {
    const project = this.projects.find((item) => item.filename === filename);
    if (project) {
      this.activeProject.set(project);
      this.watermarkTimestamp.set(project.watermark);
      this.filterState.set(new CompositeFilterContext());
      this.announce(`Switched workspace project to ${project.filename}`);
    }
  }

  public createNewProject(customName?: string): void {
    const filename = customName
      ? customName.endsWith(".rcp")
        ? customName
        : `${customName}.rcp`
      : "Untitled Project.rcp";

    const newDescriptor: ProjectDescriptor = {
      filename,
      statusPill: "draft [unsaved]",
      branch: "workspace/main",
      watermark: "00:00",
    };
    this.activeProject.set(newDescriptor);
    this.reportPages.set(["Page 1"]);
    this.activePage.set("Page 1");
    this.pageVisualsSignal.set({ "Page 1": [] });
    this.filterState.set(new CompositeFilterContext());
    this.announce(`Created new project ${filename}`);
  }

  public renameProject(newFilename: string): boolean {
    const trimmed = newFilename.trim();
    if (!trimmed) {
      return false;
    }
    const cleanFilename = trimmed.endsWith(".rcp") ? trimmed : `${trimmed}.rcp`;
    const current = this.activeProject();
    if (current.filename === cleanFilename) {
      return false;
    }
    this.activeProject.set({
      ...current,
      filename: cleanFilename,
      statusPill: "draft [unsaved]",
    });
    this.announce(`Renamed project to ${cleanFilename}`);
    return true;
  }

  public setProjectState(
    descriptor: ProjectDescriptor,
    pages: string[],
    visuals: Record<string, CanvasVisualItem[]>,
    measures?: RaxMeasureDescriptor[],
  ): void {
    this.activeProject.set(descriptor);
    if (pages && pages.length > 0) {
      this.reportPages.set([...pages]);
      this.activePage.set(pages[0]);
    }
    if (visuals) {
      this.pageVisualsSignal.set({ ...visuals });
    }
    if (measures && measures.length > 0) {
      this.measuresSignal.set([...measures]);
      this.persistMeasures(measures);
    }
    this.filterState.set(new CompositeFilterContext());
    this.announce(`Loaded workspace project ${descriptor.filename}`);
  }

  public updateProjectStatus(statusPill: string, watermark?: string): void {
    const current = this.activeProject();
    this.activeProject.set({
      ...current,
      statusPill,
      watermark: watermark ?? current.watermark,
    });
  }

  // ---------------------------------------------------------------------------
  // Page Management
  // ---------------------------------------------------------------------------

  public selectPage(pageName: string): void {
    if (this.activePage() === pageName) {
      return;
    }
    this.activePage.set(pageName);
    this.announce(`Navigated to report page: ${pageName}`);
  }

  public getVisualsForPage(pageName: string): CanvasVisualItem[] {
    return this.pageVisualsSignal()[pageName] ?? [];
  }

  public addReportPage(): void {
    const currentPages = this.reportPages();
    let pageCounter = currentPages.length + 1;
    let nextName = `Page ${pageCounter}`;
    while (currentPages.includes(nextName)) {
      pageCounter++;
      nextName = `Page ${pageCounter}`;
    }
    this.reportPages.set([...currentPages, nextName]);
    this.pageVisualsSignal.update((pages) => ({
      ...pages,
      [nextName]: [],
    }));
    this.activePage.set(nextName);
    this.announce(`Created and activated report page ${nextName}`);
  }

  public renameReportPage(oldName: string, newName: string): boolean {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      return false;
    }
    const currentPages = this.reportPages();
    const pageIndex = currentPages.indexOf(oldName);
    if (pageIndex === -1) {
      return false;
    }
    const isDuplicate = currentPages.some(
      (name, idx) =>
        idx !== pageIndex && name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (isDuplicate) {
      this.announce(`Report page name "${trimmed}" already exists.`);
      return false;
    }

    const updatedPages = [...currentPages];
    updatedPages[pageIndex] = trimmed;
    this.reportPages.set(updatedPages);

    this.pageVisualsSignal.update((pages) => {
      const pageCopy = { ...pages };
      const visuals = pageCopy[oldName] ?? [];
      delete pageCopy[oldName];
      pageCopy[trimmed] = visuals;
      return pageCopy;
    });

    if (this.activePage() === oldName) {
      this.activePage.set(trimmed);
    }
    this.announce(`Renamed report page "${oldName}" to "${trimmed}".`);
    return true;
  }

  public removeReportPage(pageName: string): boolean {
    const currentPages = this.reportPages();
    if (currentPages.length <= 1) {
      this.announce("Cannot remove the only report page in the report.");
      return false;
    }
    const pageIndex = currentPages.indexOf(pageName);
    if (pageIndex === -1) {
      return false;
    }
    const updatedPages = currentPages.filter((name) => name !== pageName);
    this.reportPages.set(updatedPages);

    this.pageVisualsSignal.update((pages) => {
      const pageCopy = { ...pages };
      delete pageCopy[pageName];
      return pageCopy;
    });

    if (this.activePage() === pageName) {
      const nextIndex = Math.max(0, pageIndex - 1);
      const nextActive = updatedPages[nextIndex] ?? updatedPages[0];
      this.activePage.set(nextActive);
    }
    this.announce(`Removed report page "${pageName}".`);
    return true;
  }

  public reorderReportPages(fromIndex: number, toIndex: number): void {
    const currentPages = this.reportPages();
    if (
      fromIndex < 0 ||
      fromIndex >= currentPages.length ||
      toIndex < 0 ||
      toIndex >= currentPages.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const updatedPages = [...currentPages];
    const [movedPage] = updatedPages.splice(fromIndex, 1);
    updatedPages.splice(toIndex, 0, movedPage);
    this.reportPages.set(updatedPages);
    this.announce(
      `Moved report page "${movedPage}" to position ${toIndex + 1}.`,
    );
  }

  public moveReportPage(pageName: string, direction: "left" | "right"): void {
    const currentPages = this.reportPages();
    const pageIndex = currentPages.indexOf(pageName);
    if (pageIndex === -1) {
      return;
    }
    const targetIndex = direction === "left" ? pageIndex - 1 : pageIndex + 1;
    this.reorderReportPages(pageIndex, targetIndex);
  }

  // ---------------------------------------------------------------------------
  // Canvas Visual Operations
  // ---------------------------------------------------------------------------

  public addVisualToActivePage(archetype = "Bar"): CanvasVisualItem {
    const activePageName = this.activePage();
    const currentVisuals = this.pageVisualsSignal()[activePageName] ?? [];
    const visualCount = currentVisuals.length + 1;
    const visualId = `visual-${Date.now()}-${visualCount}`;
    const newVisual: CanvasVisualItem = {
      id: visualId,
      title: `Visual ${visualCount} - ${archetype}`,
      archetype,
      width: "half",
      metricLabel: "No data connected",
      metricValue: "-",
      metricSubtext: "Connect a data source to configure this visual",
    };
    this.pageVisualsSignal.update((pages) => ({
      ...pages,
      [activePageName]: [...(pages[activePageName] ?? []), newVisual],
    }));
    this.announce(`Added ${archetype} visual to ${activePageName}.`);
    return newVisual;
  }

  public toggleVisualWidthOnActivePage(visualId: string): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = pages[activePageName] ?? [];
      return {
        ...pages,
        [activePageName]: visualList.map((visual) =>
          visual.id === visualId
            ? { ...visual, width: visual.width === "full" ? "half" : "full" }
            : visual,
        ),
      };
    });
  }

  public removeVisualFromActivePage(visualId: string): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = pages[activePageName] ?? [];
      return {
        ...pages,
        [activePageName]: visualList.filter((visual) => visual.id !== visualId),
      };
    });
    this.announce("Visual removed from canvas.");
  }

  public updateVisualTitleOnActivePage(
    visualId: string,
    newTitle: string,
  ): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = pages[activePageName] ?? [];
      return {
        ...pages,
        [activePageName]: visualList.map((visual) =>
          visual.id === visualId ? { ...visual, title: newTitle } : visual,
        ),
      };
    });
  }

  public updateVisualMetric(
    visualId: string,
    metricValue: string,
    metricLabel?: string,
    metricSubtext?: string,
  ): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = pages[activePageName] ?? [];
      return {
        ...pages,
        [activePageName]: visualList.map((visual) =>
          visual.id === visualId
            ? {
                ...visual,
                metricValue,
                metricLabel: metricLabel ?? visual.metricLabel,
                metricSubtext: metricSubtext ?? visual.metricSubtext,
              }
            : visual,
        ),
      };
    });
  }

  public updateVisualSort(
    visualId: string,
    sortBy?: "value" | "axis",
    sortOrder?: "asc" | "desc",
  ): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = pages[activePageName] ?? [];
      return {
        ...pages,
        [activePageName]: visualList.map((visual) =>
          visual.id === visualId
            ? {
                ...visual,
                sortBy,
                sortOrder,
              }
            : visual,
        ),
      };
    });
  }

  public updateVisualFieldWells(
    visualId: string,
    fieldWells: Record<string, string[]>,
  ): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = pages[activePageName] ?? [];
      return {
        ...pages,
        [activePageName]: visualList.map((visual) =>
          visual.id === visualId
            ? {
                ...visual,
                fieldWells: { ...fieldWells },
              }
            : visual,
        ),
      };
    });
  }

  public updateFirstVisualMetric(
    metricValue: string,
    metricLabel?: string,
    metricSubtext?: string,
  ): void {
    const activePageName = this.activePage();
    const visualList = this.pageVisualsSignal()[activePageName] ?? [];
    if (visualList.length > 0) {
      this.updateVisualMetric(
        visualList[0].id,
        metricValue,
        metricLabel,
        metricSubtext,
      );
    }
  }

  public clearActivePageVisuals(): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => ({
      ...pages,
      [activePageName]: [],
    }));
    this.announce(`Cleared canvas for ${activePageName}.`);
  }

  public reorderVisualsOnActivePage(
    previousIndex: number,
    currentIndex: number,
  ): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => {
      const visualList = [...(pages[activePageName] ?? [])];
      if (
        previousIndex < 0 ||
        previousIndex >= visualList.length ||
        currentIndex < 0 ||
        currentIndex >= visualList.length ||
        previousIndex === currentIndex
      ) {
        return pages;
      }
      const [movedItem] = visualList.splice(previousIndex, 1);
      visualList.splice(currentIndex, 0, movedItem);
      return {
        ...pages,
        [activePageName]: visualList,
      };
    });
    this.announce(`Reordered visuals on ${activePageName}.`);
  }

  public moveVisualOnActivePage(
    visualId: string,
    direction: "earlier" | "later",
  ): void {
    const activePageName = this.activePage();
    const visualList = this.pageVisualsSignal()[activePageName] ?? [];
    const index = visualList.findIndex((v) => v.id === visualId);
    if (index === -1) {
      return;
    }
    const targetIndex = direction === "earlier" ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < visualList.length) {
      this.reorderVisualsOnActivePage(index, targetIndex);
    }
  }

  // ---------------------------------------------------------------------------
  // RAX Measure Operations
  // ---------------------------------------------------------------------------

  public selectMeasure(measureId: string): void {
    const measure = this.measures.find((item) => item.id === measureId);
    if (measure) {
      this.activeMeasureId.set(measure.id);
      this.customFormulaText.set(measure.formula);
      this.announce(`Selected RAX measure ${measure.label}`);
    }
  }

  public updateFormula(newFormula: string): void {
    this.customFormulaText.set(newFormula);
  }

  public saveMeasure(measure: RaxMeasureDescriptor): void {
    this.measuresSignal.update((measureList) => {
      const existingIndex = measureList.findIndex(
        (item) => item.id === measure.id,
      );
      let updatedList: RaxMeasureDescriptor[];
      if (existingIndex >= 0) {
        const copy = [...measureList];
        copy[existingIndex] = measure;
        updatedList = copy;
      } else {
        updatedList = [...measureList, measure];
      }
      this.persistMeasures(updatedList);
      return updatedList;
    });
    this.activeMeasureId.set(measure.id);
    this.announce(`Saved RAX measure ${measure.label}`);
  }

  public removeMeasure(measureId: string): void {
    const existingMeasure = this.measuresSignal().find(
      (measure) => measure.id === measureId,
    );
    this.measuresSignal.update((measureList) => {
      const updatedList = measureList.filter(
        (measure) => measure.id !== measureId,
      );
      this.persistMeasures(updatedList);
      return updatedList;
    });
    if (this.activeMeasureId() === measureId) {
      this.activeMeasureId.set("");
      this.customFormulaText.set("");
    }
    this.announce(`Removed RAX measure ${existingMeasure?.label ?? measureId}`);
  }

  // ---------------------------------------------------------------------------
  // Semantic Tables Operations
  // ---------------------------------------------------------------------------

  public syncTables(tables: readonly SharedTable[]): void {
    const tableList = [...tables];
    this.sharedTablesSignal.set(tableList);
    this.persistTables(tableList);
    this.announce(`Synchronized ${tableList.length} tables to semantic model.`);
  }

  public addTable(table: SharedTable): void {
    this.sharedTablesSignal.update((currentTables) => {
      const existingIndex = currentTables.findIndex(
        (t) => t.name.toLowerCase() === table.name.toLowerCase(),
      );
      let updatedTables: SharedTable[];
      if (existingIndex >= 0) {
        const copy = [...currentTables];
        copy[existingIndex] = table;
        updatedTables = copy;
      } else {
        updatedTables = [...currentTables, table];
      }
      this.persistTables(updatedTables);
      return updatedTables;
    });
    this.announce(`Added table ${table.name} to semantic model.`);
  }

  public removeTable(tableName: string): void {
    this.sharedTablesSignal.update((currentTables) => {
      const updatedTables = currentTables.filter(
        (t) => t.name.toLowerCase() !== tableName.toLowerCase(),
      );
      this.persistTables(updatedTables);
      return updatedTables;
    });
    this.announce(`Removed table ${tableName} from semantic model.`);
  }

  // ---------------------------------------------------------------------------
  // Theme Management
  // ---------------------------------------------------------------------------

  public setThemePreference(preference: ThemePreference): void {
    this.themePreference.set(preference);
    this.persistThemePreference(preference);

    const resolvedTheme = this.theme();
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-bs-theme", resolvedTheme);
    }
    const announcement =
      preference === "system"
        ? `Interface color mode set to follow system (${this.systemTheme()} mode active).`
        : `Switched interface color mode to ${preference} theme.`;
    this.announce(announcement);
  }

  public toggleTheme(): void {
    const nextMode: ThemeMode = this.theme() === "light" ? "dark" : "light";
    this.setThemePreference(nextMode);
  }

  public resetThemeToSystem(): void {
    this.setThemePreference("system");
  }

  public setPrintingLightMode(isPrinting: boolean): void {
    this.isPrintingLightMode.set(isPrinting);
  }

  // ---------------------------------------------------------------------------
  // UI Windows and Drawers
  // ---------------------------------------------------------------------------

  public toggleMobileDrawer(force?: boolean): void {
    this.mobileDrawerOpen.update((open) =>
      force !== undefined ? force : !open,
    );
  }

  // ---------------------------------------------------------------------------
  // Refresh & Status Notifications
  // ---------------------------------------------------------------------------

  public refreshWatermark(): void {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    this.watermarkTimestamp.set(`${hours}:${minutes}`);
    this.announce(
      `Incremental refresh watermark updated locally to ${hours}:${minutes}.`,
    );
  }

  public setStatus(
    message: string,
    options?: { loading?: boolean; resetAfterMs?: number; safe?: boolean },
  ): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    const normalized = message.toLowerCase();
    const isLoading =
      options?.loading ??
      (normalized.startsWith("loading") ||
        normalized.startsWith("exporting") ||
        normalized.includes("rendering"));
    const isError =
      /(error|failed|failure|unable to|cannot|denied|invalid|rejected)/.test(
        normalized,
      );
    const safeMessage =
      isError && !options?.safe ? this.toSafeErrorMessage(message) : message;

    this.isLoading.set(isLoading);
    this.statusIsError.set(isError);
    this.statusMessage.set(safeMessage);
    this.liveAnnouncement.set(safeMessage);

    const resetAfterMs = options?.resetAfterMs ?? 0;
    if (resetAfterMs > 0) {
      this.statusTimer = setTimeout(() => {
        this.statusMessage.set("Ready");
        this.statusIsError.set(false);
        this.isLoading.set(false);
        this.statusTimer = null;
      }, resetAfterMs);
    }
  }

  public setLoading(loading: boolean, message?: string): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    this.isLoading.set(loading);
    if (message) {
      const normalized = message.toLowerCase();
      const isError =
        /(error|failed|failure|unable to|cannot|denied|invalid|rejected)/.test(
          normalized,
        );
      const safeMessage = isError ? this.toSafeErrorMessage(message) : message;
      this.statusIsError.set(isError);
      this.statusMessage.set(safeMessage);
      this.liveAnnouncement.set(safeMessage);
    } else if (!loading) {
      this.statusMessage.set("Ready");
      this.statusIsError.set(false);
    }
  }

  public recordExchange(
    level: ExchangeLogLevel,
    method: string,
    url: string,
    status: number | null,
    durationMs: number,
  ): void {
    const entry: ExchangeLogEntry = {
      id: ++this.exchangeSequence,
      level,
      method,
      url,
      status,
      durationMs: Math.max(0, Math.round(durationMs)),
      timestamp: new Date().toISOString(),
    };
    this.exchangeLogs.update((logs) => [entry, ...logs].slice(0, 20));

    const exchangeStatus =
      level === "request"
        ? `${method} request sent.`
        : level === "success"
          ? `${method} request completed successfully (${status ?? "unknown status"}) in ${entry.durationMs} ms.`
          : `${method} request failed (${status ?? "network error"}) after ${entry.durationMs} ms.`;
    this.setStatus(exchangeStatus, { safe: true });
  }

  public announce(
    message: string,
    options?: { loading?: boolean; resetAfterMs?: number; safe?: boolean },
  ): void {
    this.setStatus(message, options);
  }

  public announceError(action: string): void {
    this.setStatus(`${action}: failed`);
  }

  // ---------------------------------------------------------------------------
  // Private Helper Methods
  // ---------------------------------------------------------------------------

  private getStoredMeasures(): RaxMeasureDescriptor[] {
    const legacyMeasureIds = new Set([
      "m-net-sales",
      "m-net-sales-yoy",
      "m-operating-margin",
      "m-gross-revenue",
      "m-net-revenue",
      "m-margin-pct",
    ]);
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(
          this.getScopedStorageKey(MEASURES_STORAGE_KEY),
        );
        if (stored) {
          const parsed: RaxMeasureDescriptor[] = JSON.parse(stored);
          const filtered = parsed.filter((m) => !legacyMeasureIds.has(m.id));
          if (filtered.length !== parsed.length) {
            this.persistMeasures(filtered);
          }
          return filtered;
        }
      } catch {
        return [];
      }
    }
    return [];
  }

  private getStoredTables(): SharedTable[] {
    const legacyTableNames = new Set([
      "fact_store_sales",
      "fact_transactions",
      "dim_calendar",
      "dim_customer",
      "dim_sku",
      "dim_region",
      "dim_category",
    ]);
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(
          this.getScopedStorageKey(TABLES_STORAGE_KEY),
        );
        if (stored) {
          const parsed: SharedTable[] = JSON.parse(stored);
          const filtered = parsed.filter(
            (t) =>
              !(
                legacyTableNames.has(t.name) &&
                !t.id?.startsWith("user_tbl_") &&
                !t.id?.startsWith("user-")
              ),
          );
          if (filtered.length !== parsed.length) {
            this.persistTables(filtered);
          }
          return filtered;
        }
      } catch {
        return [];
      }
    }
    return [];
  }

  private getStoredTableRows(): Record<string, readonly Record<string, unknown>[]> {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(
          this.getScopedStorageKey(TABLE_ROWS_STORAGE_KEY),
        );
        if (stored) {
          return JSON.parse(stored);
        }
      } catch {
        return {};
      }
    }
    return {};
  }

  private persistTableRows(
    rowsByTable: Record<string, readonly Record<string, unknown>[]>,
  ): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(
          this.getScopedStorageKey(TABLE_ROWS_STORAGE_KEY),
          JSON.stringify(rowsByTable),
        );
      } catch {
        // Safe fallback in storage restricted environments
      }
    }
  }

  private persistMeasures(measureList: readonly RaxMeasureDescriptor[]): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(
          this.getScopedStorageKey(MEASURES_STORAGE_KEY),
          JSON.stringify(measureList),
        );
      } catch {
        // Safe fallback in storage restricted environments
      }
    }
  }

  private persistTables(tableList: readonly SharedTable[]): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(
          this.getScopedStorageKey(TABLES_STORAGE_KEY),
          JSON.stringify(tableList),
        );
      } catch {
        // Safe fallback in storage restricted environments
      }
    }
  }

  private getStorageScope(): string {
    if (typeof window === "undefined" || !window.localStorage) {
      return ANONYMOUS_STORAGE_SCOPE;
    }

    const storedUser =
      window.localStorage.getItem("rc_user") ||
      window.sessionStorage.getItem("rc_user");
    if (!storedUser) {
      return ANONYMOUS_STORAGE_SCOPE;
    }

    try {
      const user = JSON.parse(storedUser) as { id?: string };
      return user.id?.trim() || ANONYMOUS_STORAGE_SCOPE;
    } catch {
      return ANONYMOUS_STORAGE_SCOPE;
    }
  }

  private getScopedStorageKey(baseKey: string): string {
    return `${baseKey}:${encodeURIComponent(this.storageScope)}`;
  }

  private getStoredThemePreference(): ThemePreference {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") {
          return stored;
        }
      } catch {
        return "system";
      }
    }
    return "system";
  }

  private persistThemePreference(preference: ThemePreference): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // Safe fallback in sandboxed iframe or private browsing
      }
    }
  }

  private detectSystemTheme(): ThemeMode {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      } catch {
        return "light";
      }
    }
    return "light";
  }

  private initializeSystemThemeListener(): void {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      try {
        this.mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
        this.mediaQueryListener = (
          event: MediaQueryListEvent | MediaQueryList,
        ) => {
          this.systemTheme.set(event.matches ? "dark" : "light");
        };
        if (this.mediaQueryList.addEventListener) {
          this.mediaQueryList.addEventListener(
            "change",
            this.mediaQueryListener,
          );
        } else {
          const legacyMql = this
            .mediaQueryList as unknown as LegacyMediaQueryList;
          if (legacyMql.addListener) {
            legacyMql.addListener(this.mediaQueryListener);
          }
        }
      } catch {
        // Safe fallback in test or non-browser environments
      }
    }
  }

  private cleanupSystemThemeListener(): void {
    if (this.mediaQueryList && this.mediaQueryListener) {
      if (this.mediaQueryList.removeEventListener) {
        this.mediaQueryList.removeEventListener(
          "change",
          this.mediaQueryListener,
        );
      } else {
        const legacyMql = this
          .mediaQueryList as unknown as LegacyMediaQueryList;
        if (legacyMql.removeListener) {
          legacyMql.removeListener(this.mediaQueryListener);
        }
      }
    }
  }

  private toSafeErrorMessage(message: string): string {
    const action = message
      .split(":", 1)[0]
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.!?]+$/, "");
    const failureLabel = /\b(failed|failure|error)\b$/i.test(action)
      ? action
      : `${action} failed`;
    return `${failureLabel || "The requested action failed"}. Please try again or contact support.`;
  }
}
