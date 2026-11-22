import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { AuthService } from "../auth/auth.service";
import {
  ANONYMOUS_STORAGE_SCOPE,
  DEFAULT_PROJECT_DESCRIPTOR,
  EMPTY_MEASURE,
  MEASURES_STORAGE_KEY,
  TABLES_STORAGE_KEY,
  TABLE_ROWS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
} from "./state.constants";
import type {
  CanvasVisualItem,
  ColumnDisplayFormat,
  ColumnSummarization,
  ExchangeLogEntry,
  ExchangeLogLevel,
  FilterClause,
  FilterOp,
  FilterValue,
  LegacyMediaQueryList,
  ProjectDescriptor,
  RaxMeasureDescriptor,
  RaxStudioDiagnostic,
  RaxStudioQueryResult,
  SharedColumn,
  SharedTable,
  StoredWorkspaceState,
  ThemeMode,
  ThemePreference,
} from "./state.interface";

export { THEME_STORAGE_KEY } from "./state.constants";
export type {
  CanvasVisualItem,
  ColumnDisplayFormat,
  ColumnSummarization,
  ExchangeLogEntry,
  ExchangeLogLevel,
  FilterClause,
  FilterOp,
  FilterValue,
  LegacyMediaQueryList,
  ProjectDescriptor,
  RaxMeasureDescriptor,
  RaxStudioDiagnostic,
  RaxStudioQueryResult,
  SharedColumn,
  SharedTable,
  StoredWorkspaceState,
  ThemeMode,
  ThemePreference,
} from "./state.interface";

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

  public selectedValue(dimension: string, fallback = "All"): string {
    const clause = this.clauses.get(dimension);
    if (!clause || clause.values.length === 0) {
      return fallback;
    }
    return String(clause.values[0]);
  }

  public contextHash(): string {
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

@Injectable({ providedIn: "root" })
export class StateManagerService {
  private readonly destroyRef = inject(DestroyRef, { optional: true });
  private readonly authService = inject(AuthService, { optional: true });
  private storageScope = this.readScope();

  // Filter context state
  private readonly filterState = signal<CompositeFilterContext>(
    new CompositeFilterContext(),
  );
  public readonly activeFilters = this.filterState.asReadonly();
  public readonly selectedRegion = computed(() =>
    this.filterState().selectedValue("Region", "All"),
  );

  // Project state
  public readonly projects: readonly ProjectDescriptor[] = [
    DEFAULT_PROJECT_DESCRIPTOR,
  ];
  private readonly initialWorkspace = this.storedWorkspace();
  public readonly activeProject = signal<ProjectDescriptor>(
    this.initialWorkspace.project,
  );
  public readonly watermarkTimestamp = signal<string>(
    this.initialWorkspace.project.watermark,
  );

  // Report pages and canvas visuals state
  public readonly reportPages = signal<string[]>(this.initialWorkspace.pages);
  public readonly activePage = signal<string>(this.initialWorkspace.activePage);
  private readonly pageVisualsSignal = signal<
    Record<string, CanvasVisualItem[]>
  >(this.initialWorkspace.visuals);
  public readonly activePageVisuals = computed<CanvasVisualItem[]>(() => {
    const pageName = this.activePage();
    return this.pageVisualsSignal()[pageName] ?? [];
  });

  // RAX Measures state
  private readonly measuresSignal = signal<RaxMeasureDescriptor[]>(
    this.storedMeasures(),
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
    this.storedTables(),
  );
  public get sharedTables(): readonly SharedTable[] {
    return this.sharedTablesSignal();
  }

  // Single RAX Studio Query Editor state (persisted across workspace route navigation)
  public readonly raxQueryContent = signal<string>(
    "EVALUATE\nINFO.VIEW.TABLES()",
  );
  public readonly raxLastResult = signal<RaxStudioQueryResult | null>(null);

  // Shared table rows store (tableName -> rows array) populated by user ingestion / imports
  private readonly sharedTableRowsSignal = signal<Record<string, readonly Record<string, unknown>[]>>(
    this.storedRows(),
  );
  public readonly tableRowsMap = this.sharedTableRowsSignal.asReadonly();
  public tableRows(tableName: string): readonly Record<string, unknown>[] {
    if (!tableName) {
      return [];
    }
    const map = this.sharedTableRowsSignal();
    if (map[tableName]) {
      return map[tableName];
    }
    const lower = tableName.trim().toLowerCase();
    for (const [key, rows] of Object.entries(map)) {
      if (key.toLowerCase() === lower) {
        return rows;
      }
    }
    return [];
  }
  public setRows(tableName: string, rows: readonly Record<string, unknown>[]): void {
    this.sharedTableRowsSignal.update((current) => {
      const updated = {
        ...current,
        [tableName]: rows,
      };
      this.persistRows(updated);
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
  public setCanvas(
    width: number,
    height: number,
    preset = "Custom",
  ): void {
    this.canvasDimensions.set({ width, height, preset });
  }

  // Theme Management state
  public readonly themePreference = signal<ThemePreference>(
    this.storedTheme(),
  );
  public readonly systemTheme = signal<ThemeMode>(this.systemMode());
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
    this.initTheme();

    effect(() => {
      const userId = this.authService?.currentUser()?.id ?? null;
      this.switchScope(userId);
    });

    effect(() => {
      this.persistWorkspace({
        project: this.activeProject(),
        pages: this.reportPages(),
        activePage: this.activePage(),
        visuals: this.pageVisualsSignal(),
      });
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
      this.cleanupTheme();
    });
  }

  private switchScope(userId: string | null): void {
    const nextScope = userId || ANONYMOUS_STORAGE_SCOPE;
    if (nextScope === this.storageScope) {
      return;
    }

    this.storageScope = nextScope;
    this.sharedTablesSignal.set(this.storedTables());
    this.sharedTableRowsSignal.set(this.storedRows());
    this.measuresSignal.set(this.storedMeasures());
    this.activeMeasureId.set("");
    this.customFormulaText.set("");

    const workspace = this.storedWorkspace();
    this.activeProject.set(workspace.project);
    this.watermarkTimestamp.set(workspace.project.watermark);
    this.reportPages.set(workspace.pages);
    this.activePage.set(workspace.activePage);
    this.pageVisualsSignal.set(workspace.visuals);
    this.filterState.set(new CompositeFilterContext());
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

  public createProject(customName?: string): void {
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

  public setProject(
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

  public updateStatus(statusPill: string, watermark?: string): void {
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

  public pageVisuals(pageName: string): CanvasVisualItem[] {
    return this.pageVisualsSignal()[pageName] ?? [];
  }

  public addPage(): void {
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

  public renamePage(oldName: string, newName: string): boolean {
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

  public removePage(pageName: string): boolean {
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

  public reorderPages(fromIndex: number, toIndex: number): void {
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

  public movePage(pageName: string, direction: "left" | "right"): void {
    const currentPages = this.reportPages();
    const pageIndex = currentPages.indexOf(pageName);
    if (pageIndex === -1) {
      return;
    }
    const targetIndex = direction === "left" ? pageIndex - 1 : pageIndex + 1;
    this.reorderPages(pageIndex, targetIndex);
  }

  // ---------------------------------------------------------------------------
  // Canvas Visual Operations
  // ---------------------------------------------------------------------------

  public addVisual(archetype = "Bar"): CanvasVisualItem {
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

  public toggleWidth(visualId: string): void {
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

  public removeVisual(visualId: string): void {
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

  public renameVisual(
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

  public updateMetric(
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

  public updateSort(
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

  public updateWells(
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

  public firstMetric(
    metricValue: string,
    metricLabel?: string,
    metricSubtext?: string,
  ): void {
    const activePageName = this.activePage();
    const visualList = this.pageVisualsSignal()[activePageName] ?? [];
    if (visualList.length > 0) {
      this.updateMetric(
        visualList[0].id,
        metricValue,
        metricLabel,
        metricSubtext,
      );
    }
  }

  public clearVisuals(): void {
    const activePageName = this.activePage();
    this.pageVisualsSignal.update((pages) => ({
      ...pages,
      [activePageName]: [],
    }));
    this.announce(`Cleared canvas for ${activePageName}.`);
  }

  public reorderVisuals(
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

  public moveVisual(
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
      this.reorderVisuals(index, targetIndex);
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

  public setTheme(preference: ThemePreference): void {
    this.themePreference.set(preference);
    this.persistTheme(preference);

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
    this.setTheme(nextMode);
  }

  public resetTheme(): void {
    this.setTheme("system");
  }

  public setPrinting(isPrinting: boolean): void {
    this.isPrintingLightMode.set(isPrinting);
  }

  // ---------------------------------------------------------------------------
  // UI Windows and Drawers
  // ---------------------------------------------------------------------------

  public toggleDrawer(force?: boolean): void {
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
    options?: {
      loading?: boolean;
      error?: boolean;
      resetAfterMs?: number;
      safe?: boolean;
    },
  ): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    const trimmed = message.trim();
    const normalized = trimmed.toLowerCase();
    const isLoading =
      options?.loading ??
      (normalized.startsWith("loading") ||
        normalized.startsWith("exporting") ||
        normalized.includes("rendering"));
    const isError =
      options?.error ??
      /(error|failed|failure|unable to|cannot|denied|invalid|rejected|corrupt|unrecognized|malformed|blocked)/.test(
        normalized,
      );
    const formattedMessage = isError
      ? this.formatError(trimmed)
      : trimmed || "Ready";

    this.isLoading.set(isLoading);
    this.statusIsError.set(isError);
    this.statusMessage.set(formattedMessage);
    this.liveAnnouncement.set(formattedMessage);

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
      const trimmed = message.trim();
      const normalized = trimmed.toLowerCase();
      const isError =
        /(error|failed|failure|unable to|cannot|denied|invalid|rejected|corrupt|unrecognized|malformed|blocked)/.test(
          normalized,
        );
      const formattedMessage = isError
        ? this.formatError(trimmed)
        : trimmed;
      this.statusIsError.set(isError);
      this.statusMessage.set(formattedMessage);
      this.liveAnnouncement.set(formattedMessage);
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
    this.setStatus(exchangeStatus, {
      error: level === "error",
      safe: true,
    });
  }

  public announce(
    message: string,
    options?: {
      loading?: boolean;
      error?: boolean;
      resetAfterMs?: number;
      safe?: boolean;
    },
  ): void {
    this.setStatus(message, options);
  }

  public announceError(actionOrMessage: string, cause?: unknown): void {
    const cleanAction = actionOrMessage.trim().replace(/[.!?]+$/, "");
    const extractedReason = this.errorReason(cause);

    if (!extractedReason) {
      const hasFailureVerb =
        /\b(error|failed|failure|unable to|cannot|denied|invalid|rejected|corrupt|unrecognized|malformed|blocked|requires)\b/i.test(
          cleanAction,
        );
      const finalMsg = hasFailureVerb
        ? `${cleanAction}.`
        : `${cleanAction} failed.`;
      this.setStatus(finalMsg, { error: true });
      return;
    }

    const cleanReason = extractedReason.trim().replace(/[.!?]+$/, "");
    const hasFailureVerb = /\b(failed|failure|error)\b$/i.test(cleanAction);
    const prefix = hasFailureVerb ? cleanAction : `${cleanAction} failed`;
    this.setStatus(`${prefix}: ${cleanReason}.`, { error: true });
  }

  // ---------------------------------------------------------------------------
  // Private Helper Methods
  // ---------------------------------------------------------------------------

  private storedMeasures(): RaxMeasureDescriptor[] {
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
          this.scopedKey(MEASURES_STORAGE_KEY),
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

  private storedTables(): SharedTable[] {
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
          this.scopedKey(TABLES_STORAGE_KEY),
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

  private storedRows(): Record<string, readonly Record<string, unknown>[]> {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(
          this.scopedKey(TABLE_ROWS_STORAGE_KEY),
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

  private persistRows(
    rowsByTable: Record<string, readonly Record<string, unknown>[]>,
  ): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(
          this.scopedKey(TABLE_ROWS_STORAGE_KEY),
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
          this.scopedKey(MEASURES_STORAGE_KEY),
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
          this.scopedKey(TABLES_STORAGE_KEY),
          JSON.stringify(tableList),
        );
      } catch {
        // Safe fallback in storage restricted environments
      }
    }
  }

  private storedWorkspace(): StoredWorkspaceState {
    const fallback: StoredWorkspaceState = {
      project: this.projects[0],
      pages: ["Page 1"],
      activePage: "Page 1",
      visuals: { "Page 1": [] },
    };
    if (typeof window === "undefined" || !window.localStorage) {
      return fallback;
    }
    try {
      const raw = window.localStorage.getItem(
        this.scopedKey(WORKSPACE_STORAGE_KEY),
      );
      if (!raw) {
        return fallback;
      }
      const parsed = JSON.parse(raw) as Partial<StoredWorkspaceState>;
      const pages =
        Array.isArray(parsed.pages) && parsed.pages.length > 0
          ? parsed.pages
          : fallback.pages;
      const activePage =
        typeof parsed.activePage === "string" && pages.includes(parsed.activePage)
          ? parsed.activePage
          : pages[0];
      return {
        project: parsed.project?.filename ? parsed.project : fallback.project,
        pages,
        activePage,
        visuals:
          parsed.visuals && typeof parsed.visuals === "object"
            ? parsed.visuals
            : fallback.visuals,
      };
    } catch {
      return fallback;
    }
  }

  private persistWorkspace(workspace: StoredWorkspaceState): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(
          this.scopedKey(WORKSPACE_STORAGE_KEY),
          JSON.stringify(workspace),
        );
      } catch {
        // Safe fallback in storage restricted environments
      }
    }
  }

  private readScope(): string {
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

  private scopedKey(baseKey: string): string {
    return `${baseKey}:${encodeURIComponent(this.storageScope)}`;
  }

  private storedTheme(): ThemePreference {
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

  private persistTheme(preference: ThemePreference): void {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // Safe fallback in sandboxed iframe or private browsing
      }
    }
  }

  private systemMode(): ThemeMode {
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

  private initTheme(): void {
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

  private cleanupTheme(): void {
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

  private formatError(message: string): string {
    const cleaned = message.replace(/\s+/g, " ").trim();
    return cleaned || "Operation failed.";
  }

  private errorReason(cause: unknown): string {
    if (!cause) {
      return "";
    }
    if (typeof cause === "string") {
      return cause.trim();
    }
    if (typeof cause === "object") {
      const record = cause as Record<string, unknown>;
      const nestedError = record["error"];
      if (typeof nestedError === "string" && nestedError.trim()) {
        return nestedError.trim();
      }
      if (nestedError && typeof nestedError === "object") {
        const nestedRec = nestedError as Record<string, unknown>;
        const detail =
          nestedRec["detail"] ?? nestedRec["message"] ?? nestedRec["error"];
        if (typeof detail === "string" && detail.trim()) {
          return detail.trim();
        }
      }
      if (
        typeof record["status"] === "number" &&
        record["status"] > 0 &&
        typeof record["statusText"] === "string"
      ) {
        const msg =
          typeof record["message"] === "string" &&
          !record["message"].startsWith("Http failure response")
            ? `: ${record["message"]}`
            : "";
        return `HTTP ${record["status"]} ${record["statusText"]}${msg}`.trim();
      }
      if (typeof record["message"] === "string" && record["message"].trim()) {
        return record["message"].trim();
      }
    }
    return String(cause).trim();
  }
}
