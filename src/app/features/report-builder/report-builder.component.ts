import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { CommonModule, DecimalPipe, NgTemplateOutlet } from "@angular/common";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
} from "@angular/cdk/drag-drop";

import {
  CanvasVisualItem,
  FilterClause,
  FilterOp,
  FilterValue,
  StateManagerService,
} from "../../core/state-manager.service";
import { ExportService } from "../../core/export.service";
import { SemanticModelService } from "../../core/semantic-model.service";
import { IngestionWorkflowService } from "../../core/ingestion-workflow.service";
import {
  RaxQueryService,
  VisualQueryRequestOptions,
} from "../../core/rax-query.service";
import {
  ChartCanvasComponent,
  ChartCanvasPayload,
  LegendPosition,
} from "../../shared/chart-canvas.component";

export type { CanvasVisualItem };

export const VISUAL_ARCHETYPES = [
  "Bar",
  "Line",
  "Area",
  "Geo Map",
  "Donut",
  "Matrix",
  "Gauge",
  "RAX MeasureCard",
  "Slicer",
] as const;

export type VisualArchetype = (typeof VISUAL_ARCHETYPES)[number];

export const TOOLS_TABS = [
  "Visualizations",
  "Filters",
  "Data Fields",
  "Format",
] as const;

export type ToolsTab = (typeof TOOLS_TABS)[number];

export type CanvasPreset = "16:9" | "4:3" | "Letter" | "Tooltip" | "Custom";

export interface CanvasDimensions {
  readonly width: number;
  readonly height: number;
}

export interface CanvasPresetConfig {
  readonly id: CanvasPreset;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly description: string;
}

export const CANVAS_PRESET_CONFIGS: Record<CanvasPreset, CanvasPresetConfig> = {
  "16:9": {
    id: "16:9",
    label: "16:9 (Default)",
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    description: "Standard computer screens and presentations (1280 × 720 px)",
  },
  "4:3": {
    id: "4:3",
    label: "4:3",
    width: 960,
    height: 720,
    aspectRatio: "4:3",
    description: "Older screens or document embedding (960 × 720 px)",
  },
  Letter: {
    id: "Letter",
    label: "Letter",
    width: 816,
    height: 1056,
    aspectRatio: "11:14 (Portrait)",
    description: "Reports intended for printing or PDF export (816 × 1056 px)",
  },
  Tooltip: {
    id: "Tooltip",
    label: "Tooltip",
    width: 320,
    height: 240,
    aspectRatio: "4:3",
    description: "Custom pop-up windows that appear on hover (320 × 240 px)",
  },
  Custom: {
    id: "Custom",
    label: "Custom",
    width: 1920,
    height: 1080,
    aspectRatio: "Custom",
    description: "Full HD displays, wall dashboards, or scrolling pages",
  },
};

export type ReportColorPalette =
  | "neutral"
  | "amber"
  | "charcoal"
  | "blue"
  | "emerald"
  | "custom";

export interface ColorPalettePreset {
  readonly id: ReportColorPalette;
  readonly label: string;
  readonly color: string;
}

export const COLOR_PALETTE_PRESETS: readonly ColorPalettePreset[] = [
  { id: "neutral", label: "Neutral Contrast (White / Black)", color: "#000000" },
  { id: "amber", label: "Amber (#FF981A)", color: "#FF981A" },
  { id: "charcoal", label: "Charcoal (#333333)", color: "#333333" },
  { id: "blue", label: "Cobalt Blue (#2563EB)", color: "#2563EB" },
  { id: "emerald", label: "Emerald Green (#059669)", color: "#059669" },
  { id: "custom", label: "Custom Color...", color: "#2563EB" },
] as const;

export interface FieldWellSlot {
  readonly id: string;
  readonly label: string;
  readonly role: "measure" | "dimension";
  readonly hint: string;
}

export const ARCHETYPE_FIELD_SLOTS: Record<
  VisualArchetype,
  readonly FieldWellSlot[]
> = {
  Bar: [
    {
      id: "values",
      label: "Values (Y-Axis)",
      role: "measure",
      hint: "Drop measure or metric",
    },
    {
      id: "category",
      label: "Category (X-Axis)",
      role: "dimension",
      hint: "Drop category dimension",
    },
    {
      id: "breakdown",
      label: "Breakdown (Legend)",
      role: "dimension",
      hint: "Drop breakdown grouping",
    },
  ],
  Line: [
    {
      id: "values",
      label: "Values (Y-Axis)",
      role: "measure",
      hint: "Drop continuous measure",
    },
    {
      id: "category",
      label: "X-Axis (Time/Date)",
      role: "dimension",
      hint: "Drop timeline or date dimension",
    },
    {
      id: "breakdown",
      label: "Legend (Series)",
      role: "dimension",
      hint: "Drop series grouping",
    },
  ],
  Area: [
    {
      id: "values",
      label: "Values (Y-Axis)",
      role: "measure",
      hint: "Drop cumulative measure",
    },
    {
      id: "category",
      label: "X-Axis (Timeline)",
      role: "dimension",
      hint: "Drop timeline dimension",
    },
    {
      id: "breakdown",
      label: "Legend",
      role: "dimension",
      hint: "Drop segment dimension",
    },
  ],
  "Geo Map": [
    {
      id: "location",
      label: "Location",
      role: "dimension",
      hint: "Drop territory or region",
    },
    {
      id: "values",
      label: "Bubble Size (Metric)",
      role: "measure",
      hint: "Drop numeric measure",
    },
    {
      id: "color",
      label: "Color Saturation",
      role: "dimension",
      hint: "Drop category dimension",
    },
  ],
  Donut: [
    {
      id: "values",
      label: "Values",
      role: "measure",
      hint: "Drop proportion measure",
    },
    {
      id: "category",
      label: "Legend / Slices",
      role: "dimension",
      hint: "Drop category dimension",
    },
  ],
  Matrix: [
    {
      id: "rows",
      label: "Rows",
      role: "dimension",
      hint: "Drop row hierarchy dimension",
    },
    {
      id: "columns",
      label: "Columns",
      role: "dimension",
      hint: "Drop column dimension",
    },
    {
      id: "values",
      label: "Values",
      role: "measure",
      hint: "Drop measure or metric",
    },
  ],
  Gauge: [
    {
      id: "values",
      label: "Value (Needle)",
      role: "measure",
      hint: "Drop primary measure",
    },
    {
      id: "target",
      label: "Target Value",
      role: "measure",
      hint: "Drop target measure",
    },
    {
      id: "min",
      label: "Minimum Bound",
      role: "measure",
      hint: "Drop minimum bound measure",
    },
    {
      id: "max",
      label: "Maximum Bound",
      role: "measure",
      hint: "Drop maximum bound measure",
    },
  ],
  "RAX MeasureCard": [
    {
      id: "measure",
      label: "Measure Expression",
      role: "measure",
      hint: "Select or drop a calculated RAX measure",
    },
  ],
  Slicer: [
    {
      id: "category",
      label: "Field (Dimension)",
      role: "dimension",
      hint: "Drop dimension to slice canvas",
    },
  ],
};

export const DEFAULT_FIELD_WELLS: readonly string[] = [];

/** Result of evaluating the bound Field Wells of one visual against live dataset rows. */
export interface VisualDataset {
  readonly dimensionKeys: readonly string[];
  readonly measureKeys: readonly string[];
  readonly measureLabels: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface VisualStatus {
  readonly label: string;
  readonly value: string;
  readonly subtext: string;
}

export interface MatrixTable {
  readonly dimensionHeaders: readonly string[];
  readonly measureHeaders: readonly string[];
  readonly rows: readonly {
    readonly key: string;
    readonly dimensions: readonly string[];
    readonly cells: readonly number[];
  }[];
  readonly totals: readonly number[];
}

interface ResolvedMeasureField {
  readonly expression: string;
  readonly table: string | undefined;
  readonly label: string;
}

const COUNT_ROWS_FIELD: ResolvedMeasureField = {
  expression: "COUNTROWS()",
  table: undefined,
  label: "Row count",
};

const SERIES_PALETTE_TAIL: readonly string[] = [
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#06B6D4",
  "#F59E0B",
  "#EC4899",
];

const NUMERIC_TYPE_PATTERN = /int|dec|num|float|double|real|money|long/i;

@Component({
  selector: "rc-report-builder",
  standalone: true,
  imports: [
    CommonModule,
    DecimalPipe,
    RouterLink,
    FormsModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    NgTemplateOutlet,
    ChartCanvasComponent,
  ],
  templateUrl: "./report-builder.component.html",
  styleUrl: "./report-builder.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportBuilderComponent implements OnInit {
  public readonly state = inject(StateManagerService);
  public readonly exportService = inject(ExportService);
  public readonly ingestion = inject(IngestionWorkflowService);
  private readonly semanticModelService = inject(SemanticModelService);
  private readonly raxQuery = inject(RaxQueryService);

  public readonly expandedTables = signal<Record<string, boolean>>({});

  /** Rows returned by the backend query endpoint, keyed by visual id. */
  public readonly visualQueryResults = signal<
    Record<string, readonly Record<string, unknown>[]>
  >({});
  private readonly dispatchedQuerySignatures = new Map<string, string>();

  public readonly showVisualTitle = signal<boolean>(true);
  public readonly showGridlines = signal<boolean>(true);
  public readonly highlightCallouts = signal<boolean>(true);
  public readonly legendPosition = signal<LegendPosition>("top");

  constructor() {
    effect(() => {
      const dimensions = this.activeCanvasDimensions();
      const preset = this.selectedCanvasPreset();
      untracked(() =>
        this.state.setCanvasDimensions(
          dimensions.width,
          dimensions.height,
          preset,
        ),
      );
    });

    effect(() => {
      const requests = this.backendQueryRequests();
      untracked(() => this.dispatchBackendQueries(requests));
    });
  }

  public setShowVisualTitle(visible: boolean): void {
    this.showVisualTitle.set(visible);
    this.state.announce(
      visible ? "Visual titles shown." : "Visual titles hidden.",
    );
  }

  public setShowGridlines(visible: boolean): void {
    this.showGridlines.set(visible);
    this.state.announce(
      visible ? "Chart gridlines shown." : "Chart gridlines hidden.",
    );
  }

  public setHighlightCallouts(enabled: boolean): void {
    this.highlightCallouts.set(enabled);
    this.state.announce(
      enabled ? "Key callouts highlighted." : "Key callout highlighting off.",
    );
  }

  public setLegendPosition(position: LegendPosition): void {
    this.legendPosition.set(position);
    this.state.announce(
      position === "hidden"
        ? "Chart legend hidden."
        : `Chart legend moved to ${position}.`,
    );
  }

  public ngOnInit(): void {
    if (this.state.sharedTables.length === 0) {
      this.semanticModelService.loadDefault().subscribe({
        next: (payload) => {
          this.semanticModelService.syncToStateManager(payload, this.state);
        },
        error: () => {},
      });
    }
  }

  public readonly toolsTabs = TOOLS_TABS;
  public readonly visualArchetypes = VISUAL_ARCHETYPES;
  public readonly activeToolsTab = signal<ToolsTab>("Visualizations");
  public readonly activeStudioTab = this.activeToolsTab;
  public readonly selectedArchetype = signal<VisualArchetype>("Bar");
  public readonly assignedSlotFields = signal<Record<string, string[]>>({});

  public readonly canvasPresets = Object.values(CANVAS_PRESET_CONFIGS);
  public readonly selectedCanvasPreset = signal<CanvasPreset>("16:9");
  public readonly customCanvasWidth = signal<number>(1920);
  public readonly customCanvasHeight = signal<number>(1080);

  public readonly activeCanvasDimensions = computed<CanvasDimensions>(() => {
    const preset = this.selectedCanvasPreset();
    if (preset === "Custom") {
      const rawW = Number(this.customCanvasWidth());
      const rawH = Number(this.customCanvasHeight());
      const validW =
        !isNaN(rawW) && rawW > 0 ? Math.max(100, Math.min(4000, rawW)) : 1920;
      const validH =
        !isNaN(rawH) && rawH > 0 ? Math.max(100, Math.min(4000, rawH)) : 1080;
      return { width: validW, height: validH };
    }
    const config =
      CANVAS_PRESET_CONFIGS[preset] ?? CANVAS_PRESET_CONFIGS["16:9"];
    return { width: config.width, height: config.height };
  });

  public setCanvasPreset(preset: CanvasPreset): void {
    this.selectedCanvasPreset.set(preset);
  }

  public updateCustomCanvasWidth(width: number | string): void {
    const parsed = typeof width === "number" ? width : parseInt(width, 10);
    if (!isNaN(parsed)) {
      this.customCanvasWidth.set(parsed);
    }
  }

  public updateCustomCanvasHeight(height: number | string): void {
    const parsed = typeof height === "number" ? height : parseInt(height, 10);
    if (!isNaN(parsed)) {
      this.customCanvasHeight.set(parsed);
    }
  }

  public applyFullHdCustomTip(): void {
    this.selectedCanvasPreset.set("Custom");
    this.customCanvasWidth.set(1920);
    this.customCanvasHeight.set(1080);
  }

  public readonly colorPalettePresets = COLOR_PALETTE_PRESETS;
  public readonly selectedPalette = signal<ReportColorPalette>("neutral");
  public readonly customColor = signal<string>("#2563EB");

  public readonly activePaletteColor = computed<string>(() => {
    const palette = this.selectedPalette();
    const isDark = this.state.theme() === "dark";
    switch (palette) {
      case "neutral":
        return isDark ? "#FFFFFF" : "#000000";
      case "amber":
        return "#FF981A";
      case "charcoal":
        return isDark ? "#E2E8F0" : "#333333";
      case "blue":
        return "#2563EB";
      case "emerald":
        return "#059669";
      case "custom":
        return this.customColor() || (isDark ? "#FFFFFF" : "#000000");
      default:
        return isDark ? "#FFFFFF" : "#000000";
    }
  });

  public readonly activePaletteSubtle = computed<string>(() => {
    const palette = this.selectedPalette();
    const isDark = this.state.theme() === "dark";
    switch (palette) {
      case "neutral":
        return isDark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.08)";
      case "amber":
        return "rgba(255, 152, 26, 0.25)";
      case "charcoal":
        return isDark ? "rgba(226, 232, 240, 0.18)" : "rgba(51, 51, 51, 0.15)";
      case "blue":
        return "rgba(37, 99, 235, 0.20)";
      case "emerald":
        return "rgba(5, 150, 105, 0.20)";
      case "custom": {
        const hex = this.customColor();
        if (/^#([A-Fa-f0-9]{6})$/.test(hex)) {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.25 : 0.15})`;
        }
        return hex;
      }
      default:
        return isDark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.08)";
    }
  });

  public setPalette(palette: ReportColorPalette): void {
    this.selectedPalette.set(palette);
  }

  public setCustomColor(color: string): void {
    this.customColor.set(color);
  }

  public readonly expandedSections = signal<Record<ToolsTab, boolean>>({
    Visualizations: true,
    Filters: false,
    "Data Fields": false,
    Format: false,
  });

  public readonly isAllCollapsed = computed<boolean>(() => {
    const sections = this.expandedSections();
    return Object.values(sections).every((isOpen) => !isOpen);
  });

  public isSectionExpanded(tab: ToolsTab): boolean {
    return !!this.expandedSections()[tab];
  }

  public toggleSection(tab: ToolsTab): void {
    const willOpen = !this.expandedSections()[tab];
    this.expandedSections.update((current) => ({
      ...current,
      [tab]: willOpen,
    }));
    if (willOpen) {
      this.activeToolsTab.set(tab);
    }
  }

  public toggleCollapseAll(): void {
    const allCollapsed = this.isAllCollapsed();
    this.expandedSections.set({
      Visualizations: allCollapsed,
      Filters: allCollapsed,
      "Data Fields": allCollapsed,
      Format: allCollapsed,
    });
  }

  public readonly activeArchetypeSlots = computed<readonly FieldWellSlot[]>(
    () => {
      const archetype = this.selectedArchetype();
      return ARCHETYPE_FIELD_SLOTS[archetype] ?? ARCHETYPE_FIELD_SLOTS.Bar;
    },
  );

  public readonly hasAssignedWells = computed<boolean>(() => {
    const assigned = this.assignedSlotFields();
    return Object.values(assigned).some((fields) => fields.length > 0);
  });

  public readonly fieldWells = computed<string[]>(() => {
    return this.activeArchetypeSlots().map(
      (slot) => `${slot.label}: ${slot.hint}`,
    );
  });

  public readonly isFilterDropdownOpen = signal<boolean>(false);
  public readonly selectedFilterDimension = signal<string>("");
  public readonly customDimensionInput = signal<string>("");
  public readonly selectedFilterOperator = signal<FilterOp>("EQ");
  public readonly filterValueInput = signal<string>("");

  public readonly availableDimensions = computed<readonly string[]>(() => {
    const tables = this.state.sharedTables;
    const dimensions: string[] = [];
    for (const table of tables) {
      for (const column of table.columns) {
        dimensions.push(`${table.name}.${column.name}`);
      }
    }
    return dimensions;
  });

  public readonly canApplyFilter = computed<boolean>(() => {
    const rawDimension = this.selectedFilterDimension();
    const hasValidDimension =
      rawDimension === "Custom..." || this.availableDimensions().length === 0
        ? this.customDimensionInput().trim().length > 0
        : rawDimension.trim().length > 0;
    return hasValidDimension && this.filterValueInput().trim().length > 0;
  });

  public readonly userVisuals = this.state.activePageVisuals;

  public readonly activeFilterList = computed<readonly FilterClause[]>(() =>
    Array.from(this.state.activeFilters().clauses.values()),
  );

  public readonly hasActiveFilters = computed<boolean>(
    () => this.activeFilterList().length > 0,
  );

  public readonly hasVisuals = computed<boolean>(
    () => this.userVisuals().length > 0,
  );

  public readonly selectedVisualId = signal<string | null>(null);
  public readonly activeVisualMenuId = signal<string | null>(null);

  public readonly selectedVisual = computed<CanvasVisualItem | null>(() => {
    const id = this.selectedVisualId();
    if (!id) {
      return null;
    }
    return this.userVisuals().find((v) => v.id === id) ?? null;
  });

  public selectVisual(id: string | null): void {
    this.selectedVisualId.set(id);
    if (!id) {
      this.assignedSlotFields.set({});
      return;
    }
    const visual = this.userVisuals().find((item) => item.id === id);
    if (!visual) {
      return;
    }
    if (this.isValidArchetype(visual.archetype)) {
      this.selectedArchetype.set(visual.archetype);
    }
    this.assignedSlotFields.set(this.cloneWells(visual.fieldWells));
  }

  private cloneWells(
    wells: Record<string, string[]> | undefined,
  ): Record<string, string[]> {
    const copy: Record<string, string[]> = {};
    for (const [slotId, fields] of Object.entries(wells ?? {})) {
      copy[slotId] = [...fields];
    }
    return copy;
  }

  /** Writes the working wells to the component and persists them on the selected visual. */
  private commitWells(next: Record<string, string[]>): void {
    this.assignedSlotFields.set(next);
    const visualId = this.selectedVisualId();
    if (visualId) {
      this.state.updateVisualFieldWells(visualId, next);
    }
  }

  public toggleVisualMenu(id: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.activeVisualMenuId.update((current) => (current === id ? null : id));
  }

  public closeVisualMenu(): void {
    this.activeVisualMenuId.set(null);
  }

  public isFirstVisual(id: string): boolean {
    const visuals = this.userVisuals();
    return visuals.length > 0 && visuals[0].id === id;
  }

  public isLastVisual(id: string): boolean {
    const visuals = this.userVisuals();
    return visuals.length > 0 && visuals[visuals.length - 1].id === id;
  }

  public onDropVisual(event: CdkDragDrop<CanvasVisualItem[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.state.reorderVisualsOnActivePage(
        event.previousIndex,
        event.currentIndex,
      );
    }
  }

  public moveVisualEarlier(visualId: string): void {
    this.state.moveVisualOnActivePage(visualId, "earlier");
    this.closeVisualMenu();
  }

  public moveVisualLater(visualId: string): void {
    this.state.moveVisualOnActivePage(visualId, "later");
    this.closeVisualMenu();
  }

  public addVisual(archetype: VisualArchetype | string = "Bar"): void {
    const hadSelection = this.selectedVisualId() !== null;
    const pendingWells = hadSelection
      ? {}
      : this.cloneWells(this.assignedSlotFields());
    const newVisual = this.state.addVisualToActivePage(archetype);
    if (newVisual) {
      this.selectedVisualId.set(newVisual.id);
      if (this.isValidArchetype(newVisual.archetype)) {
        this.selectedArchetype.set(newVisual.archetype);
      }
      this.commitWells(pendingWells);
    }
  }

  public selectArchetypeAndAdd(archetype: VisualArchetype | string): void {
    if (this.isValidArchetype(archetype)) {
      this.selectedArchetype.set(archetype);
    }
    this.addVisual(archetype);
  }

  public toggleVisualWidth(id: string): void {
    this.state.toggleVisualWidthOnActivePage(id);
  }

  public removeVisual(id: string): void {
    if (this.selectedVisualId() === id) {
      this.selectedVisualId.set(null);
      this.assignedSlotFields.set({});
    }
    this.state.removeVisualFromActivePage(id);
    this.dispatchedQuerySignatures.delete(id);
    this.closeVisualMenu();
  }

  public updateVisualTitle(id: string, newTitle: string): void {
    this.state.updateVisualTitleOnActivePage(id, newTitle);
  }

  public switchToolsTab(tab: ToolsTab): void {
    this.activeToolsTab.set(tab);
    this.expandedSections.update((current) => ({
      ...current,
      [tab]: true,
    }));
  }

  public getSlotFields(slotId: string): readonly string[] {
    return this.assignedSlotFields()[slotId] ?? [];
  }

  public removeFieldFromSlot(slotId: string, fieldName: string): void {
    const current = this.assignedSlotFields();
    const existing = current[slotId] ?? [];
    this.commitWells({
      ...current,
      [slotId]: existing.filter((field) => field !== fieldName),
    });
  }

  public assignFieldToSlot(slotId: string, fieldName: string): void {
    const trimmed = fieldName.trim();
    if (!trimmed) {
      return;
    }
    const current = this.assignedSlotFields();
    const existing = current[slotId] ?? [];
    if (existing.includes(trimmed)) {
      return;
    }
    const isSingleFieldArchetype = ["Gauge", "Slicer", "RAX MeasureCard"].includes(
      this.selectedArchetype(),
    );
    this.commitWells({
      ...current,
      [slotId]: isSingleFieldArchetype ? [trimmed] : [...existing, trimmed],
    });
  }

  public clearAllFieldWells(): void {
    this.commitWells({});
  }

  public isMeasureField(field: string): boolean {
    return this.state.measures.some((measure) => measure.id === field);
  }

  public getFieldDisplayLabel(field: string): string {
    return (
      this.state.measures.find((measure) => measure.id === field)?.label ??
      field
    );
  }

  public readonly fieldWellDropListIds = computed<string[]>(() =>
    this.activeArchetypeSlots().map((slot) => `field-well-${slot.id}`),
  );

  /** Source lists in the Data Fields tree never accept dropped items. */
  public readonly denyDropEntry = (): boolean => false;

  public isTableExpanded(tableName: string): boolean {
    return !!this.expandedTables()[tableName];
  }

  public toggleTableExpanded(tableName: string): void {
    this.expandedTables.update((current) => ({
      ...current,
      [tableName]: !current[tableName],
    }));
  }

  public quickAssignField(fullFieldName: string, colName: string): void {
    const lower = colName.toLowerCase();
    const tablePart = fullFieldName.includes(".")
      ? fullFieldName.split(".")[0]
      : "";
    const tableMeta = this.state.sharedTables.find(
      (t) => t.name.toLowerCase() === tablePart.toLowerCase(),
    );
    const colMeta = tableMeta?.columns.find(
      (c) => c.name.toLowerCase() === lower,
    );
    const isNumericType = colMeta
      ? NUMERIC_TYPE_PATTERN.test(colMeta.dataType)
      : false;
    const isMetric =
      isNumericType ||
      lower.includes("amount") ||
      lower.includes("volume") ||
      lower.includes("cost") ||
      lower.includes("rev") ||
      lower.includes("price") ||
      lower.includes("units");

    const slots = this.activeArchetypeSlots();
    const preferredRole = isMetric ? "measure" : "dimension";
    const matchingSlot =
      slots.find((s) => s.role === preferredRole) ?? slots[0];
    const slotId = matchingSlot ? matchingSlot.id : isMetric ? "values" : "category";
    this.assignFieldToSlot(slotId, fullFieldName);
  }

  public assignMeasureToVisual(measureId: string): void {
    this.state.selectMeasure(measureId);
    const slots = this.activeArchetypeSlots();
    const measureSlot =
      slots.find((s) => s.role === "measure") ?? slots[0];
    if (measureSlot) {
      this.assignFieldToSlot(measureSlot.id, measureId);
    }
  }

  public readonly selectedFilterCategories = signal<string[]>([]);
  public readonly selectedFilterCategory = computed<string | null>(() => {
    const cats = this.selectedFilterCategories();
    return cats.length > 0 ? cats.join(", ") : null;
  });

  public readonly activeSlicerDimension = computed<string>(() => {
    const slicerVisual = this.userVisuals().find(
      (v) => v.archetype === "Slicer",
    );
    const slots = this.resolveWellsForVisual(slicerVisual);
    const boundCategory = slots["category"]?.[0];
    if (boundCategory) {
      return boundCategory;
    }
    for (const table of this.state.sharedTables) {
      const rows = this.state.tableRowsMap()[table.name] ?? [];
      if (rows.length > 0) {
        const stringCol =
          table.columns.find((c) => !NUMERIC_TYPE_PATTERN.test(c.dataType)) ??
          table.columns[0];
        if (stringCol) {
          return `${table.name}.${stringCol.name}`;
        }
      }
    }
    return "Category";
  });

  public get slicerCategories(): readonly string[] {
    const dim = this.activeSlicerDimension();
    const dotIdx = dim.indexOf(".");
    const tableName =
      dotIdx > 0
        ? dim.slice(0, dotIdx)
        : this.state.sharedTables.find(
            (t) => (this.state.tableRowsMap()[t.name] ?? []).length > 0,
          )?.name;
    const colName = dotIdx > 0 ? dim.slice(dotIdx + 1) : dim;
    if (!tableName) {
      return [];
    }
    const rows = this.state.tableRowsMap()[tableName] ?? [];
    const distinct = new Set<string>();
    for (const row of rows) {
      const val =
        row[colName] ??
        row[dim] ??
        Object.entries(row).find(
          ([k]) => k.toLowerCase() === colName.toLowerCase(),
        )?.[1];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        distinct.add(String(val));
      }
    }
    return Array.from(distinct);
  }

  public isCategorySelected(cat: string): boolean {
    if (cat === "All") {
      return this.selectedFilterCategories().length === 0;
    }
    return this.selectedFilterCategories().includes(cat);
  }

  public selectFilterCategory(cat: string | null, event?: MouseEvent): void {
    const slicerDim = this.activeSlicerDimension();
    if (!cat || cat === "All") {
      this.selectedFilterCategories.set([]);
      this.state.removeFilter(slicerDim);
      this.state.removeFilter("Category");
      this.state.announce(
        "Cross-filter cleared. Showing all dimensional records.",
      );
      return;
    }

    const isMulti = event?.ctrlKey || event?.metaKey || event?.shiftKey;
    let next: string[];

    if (isMulti) {
      const current = this.selectedFilterCategories();
      if (current.includes(cat)) {
        next = current.filter((c) => c !== cat);
      } else {
        next = [...current, cat];
      }
    } else {
      const current = this.selectedFilterCategories();
      if (current.length === 1 && current[0] === cat) {
        next = [];
      } else {
        next = [cat];
      }
    }

    this.selectedFilterCategories.set(next);
    if (next.length === 0) {
      this.state.removeFilter(slicerDim);
      this.state.removeFilter("Category");
      this.state.announce(
        "Cross-filter cleared. Showing all dimensional records.",
      );
    } else if (next.length === 1) {
      this.state.applyFilter(slicerDim, "EQ", [next[0]]);
      this.state.announce(`Cross-filtering report by: ${next[0]}`);
    } else {
      this.state.applyFilter(slicerDim, "IN", next);
      this.state.announce(`Cross-filtering report by: ${next.join(", ")}`);
    }
  }

  private resolveWellsForVisual(
    visual?: CanvasVisualItem | null,
  ): Record<string, string[]> {
    if (!visual) {
      return this.assignedSlotFields();
    }
    if (visual.fieldWells && Object.keys(visual.fieldWells).length > 0) {
      return visual.fieldWells;
    }
    if (this.selectedVisualId() === visual.id || !this.selectedVisualId()) {
      return this.assignedSlotFields();
    }
    return {};
  }

  private resolveMeasureField(fieldRef: string | undefined): ResolvedMeasureField {
    if (!fieldRef) {
      const activeMeasure = this.state.activeMeasure();
      if (activeMeasure.id && activeMeasure.formula) {
        return {
          expression: activeMeasure.formula,
          table: activeMeasure.table || undefined,
          label: activeMeasure.label,
        };
      }
      return COUNT_ROWS_FIELD;
    }
    const measure = this.state.measures.find(
      (m) => m.id === fieldRef || m.label === fieldRef,
    );
    if (measure) {
      return {
        expression: measure.formula || `${measure.table}.${measure.label}`,
        table: measure.table || undefined,
        label: measure.label,
      };
    }
    const dotIdx = fieldRef.indexOf(".");
    if (dotIdx > 0) {
      return {
        expression: fieldRef,
        table: fieldRef.slice(0, dotIdx),
        label: fieldRef.slice(dotIdx + 1),
      };
    }
    return {
      expression: fieldRef,
      table: undefined,
      label: fieldRef,
    };
  }

  private buildVisualQueryOptions(
    visual: CanvasVisualItem,
  ): VisualQueryRequestOptions | null {
    const slots = this.resolveWellsForVisual(visual);
    const valueFields = [
      ...(slots["values"] ?? []),
      ...(slots["measure"] ?? []),
    ];
    const groupFields = [
      ...(slots["category"] ?? []),
      ...(slots["location"] ?? []),
      ...(slots["rows"] ?? []),
      ...(slots["columns"] ?? []),
      ...(slots["breakdown"] ?? []),
      ...(slots["color"] ?? []),
    ];

    const hasTableRows = Object.values(this.state.tableRowsMap()).some(
      (rows) => rows.length > 0,
    );
    if (valueFields.length === 0 && groupFields.length === 0 && !hasTableRows) {
      return null;
    }

    const resolvedMeasure = this.resolveMeasureField(valueFields[0]);
    const defaultDim =
      groupFields.length > 0
        ? groupFields
        : this.inferDefaultDimensionForVisual(visual, resolvedMeasure.table);

    const slicerSelected = this.selectedFilterCategories();
    const externalSlicerFilters: Record<string, readonly unknown[]> = {};
    if (slicerSelected.length > 0) {
      externalSlicerFilters[this.activeSlicerDimension()] = slicerSelected;
    }

    const measureObj = valueFields[0]
      ? this.state.measures.find((m) => m.id === valueFields[0])
      : undefined;

    return {
      visualId: visual.id,
      measureId: measureObj?.id,
      raxExpression: resolvedMeasure.expression,
      factTableName: resolvedMeasure.table,
      groupByColumns:
        visual.archetype === "RAX MeasureCard" ||
        visual.archetype === "Card" ||
        visual.archetype === "Gauge"
          ? []
          : defaultDim,
      externalSlicerFilters,
    };
  }

  private inferDefaultDimensionForVisual(
    visual: CanvasVisualItem,
    preferredTable?: string,
  ): string[] {
    if (
      visual.archetype === "RAX MeasureCard" ||
      visual.archetype === "Card" ||
      visual.archetype === "Gauge"
    ) {
      return [];
    }
    const table =
      (preferredTable
        ? this.state.sharedTables.find((t) => t.name === preferredTable)
        : undefined) ??
      this.state.sharedTables.find(
        (t) => (this.state.tableRowsMap()[t.name] ?? []).length > 0,
      );
    if (!table) {
      return [];
    }
    const dimCol =
      table.columns.find((c) => !NUMERIC_TYPE_PATTERN.test(c.dataType)) ??
      table.columns[0];
    return dimCol ? [`${table.name}.${dimCol.name}`] : [];
  }

  private readonly backendQueryRequests = computed<
    readonly VisualQueryRequestOptions[]
  >(() => {
    // Track dependencies reactively
    this.activeFilterList();
    this.selectedFilterCategories();
    this.assignedSlotFields();
    this.state.tableRowsMap();
    const visuals = this.userVisuals();
    const requests: VisualQueryRequestOptions[] = [];
    for (const visual of visuals) {
      if (!this.hasExplicitFieldBinding(visual)) {
        continue;
      }
      const opts = this.buildVisualQueryOptions(visual);
      if (opts) {
        requests.push(opts);
      }
    }
    return requests;
  });

  private hasExplicitFieldBinding(visual: CanvasVisualItem): boolean {
    return Object.values(this.resolveWellsForVisual(visual)).some(
      (fields) => fields.length > 0,
    );
  }

  private dispatchBackendQueries(
    requests: readonly VisualQueryRequestOptions[],
  ): void {
    const filterHash = this.state.activeFilters().toContextHash();
    for (const req of requests) {
      const signature = JSON.stringify({
        req,
        filterHash,
      });
      if (this.dispatchedQuerySignatures.get(req.visualId) === signature) {
        continue;
      }
      this.dispatchedQuerySignatures.set(req.visualId, signature);
      this.raxQuery.executeVisualQuery(req).subscribe({
        next: (result) => {
          if (result && Array.isArray(result.rows) && result.rows.length > 0) {
            this.visualQueryResults.update((current) => ({
              ...current,
              [req.visualId]: result.rows,
            }));
          }
        },
        error: () => {},
      });
    }
  }

  private evaluateVisualRows(
    visual: CanvasVisualItem,
  ): Array<Record<string, unknown>> {
    const opts = this.buildVisualQueryOptions(visual);
    if (!opts) {
      return [];
    }
    const localRows = this.raxQuery.evaluateDatasetRowsLocally(opts);
    if (localRows.length > 0) {
      return localRows;
    }
    const cachedBackendRows = this.visualQueryResults()[visual.id];
    if (cachedBackendRows && cachedBackendRows.length > 0) {
      return [...cachedBackendRows];
    }
    return [];
  }

  public getMatrixRows(visual: CanvasVisualItem): Array<{
    category: string;
    units: number;
    revenue: number;
    margin: number;
  }> {
    const slots = this.resolveWellsForVisual(visual);
    const rowField =
      slots["rows"]?.[0] ??
      slots["category"]?.[0] ??
      this.inferDefaultDimensionForVisual(visual)[0];
    const valueField = slots["values"]?.[0] ?? slots["measure"]?.[0];
    const rows = this.evaluateVisualRows(visual);
    if (rows.length === 0) {
      return [];
    }
    const bareDim = rowField
      ? rowField.includes(".")
        ? rowField.split(".")[1]
        : rowField
      : "category";
    const bareVal = valueField
      ? valueField.includes(".")
        ? valueField.split(".")[1]
        : valueField
      : "measure_value";

    return rows.map((r) => {
      const catVal =
        r[bareDim] ??
        r[rowField ?? ""] ??
        Object.values(r).find((v) => typeof v === "string") ??
        "Total";
      const revVal = Number(r["measure_value"] ?? r[bareVal] ?? 0);
      const unitsVal = Number(r["units"] ?? r["count"] ?? 1);
      const marginVal = Number(r["margin"] ?? 0);
      return {
        category: String(catVal),
        units: Number.isNaN(unitsVal) ? 1 : unitsVal,
        revenue: Number.isNaN(revVal) ? 0 : revVal,
        margin: Number.isNaN(marginVal) ? 0 : marginVal,
      };
    });
  }

  public getMatrixTotals(visual: CanvasVisualItem): {
    units: number;
    revenue: number;
    margin: number;
  } {
    const rows = this.getMatrixRows(visual);
    if (rows.length === 0) {
      return { units: 0, revenue: 0, margin: 0 };
    }
    const units = rows.reduce((sum, r) => sum + r.units, 0);
    const revenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const margin =
      rows.reduce((sum, r) => sum + r.margin, 0) / rows.length;
    return { units, revenue, margin };
  }

  public getMeasureCardDisplay(visual: CanvasVisualItem): VisualStatus {
    const slots = this.resolveWellsForVisual(visual);
    const measureRef = slots["measure"]?.[0] ?? slots["values"]?.[0];
    const rows = this.evaluateVisualRows(visual);
    if (rows.length > 0 && typeof rows[0]["measure_value"] === "number") {
      const num = rows[0]["measure_value"] as number;
      const resolved = this.resolveMeasureField(measureRef);
      return {
        label: resolved.label || visual.title,
        value: num.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        }),
        subtext: measureRef
          ? `Bound field: ${resolved.label}`
          : "Live dataset aggregation",
      };
    }
    return {
      label: visual.metricLabel || visual.title,
      value: visual.metricValue || "-",
      subtext:
        visual.metricSubtext ||
        "Bind a measure or column in Field Wells to evaluate",
    };
  }

  public hasVisualChartData(visual: CanvasVisualItem): boolean {
    const slots = this.resolveWellsForVisual(visual);
    const hasBoundSlots = Object.values(slots).some(
      (fields) => fields.length > 0,
    );
    const hasLiveRows = this.evaluateVisualRows(visual).length > 0;
    return hasBoundSlots || hasLiveRows || visual.metricValue !== "-";
  }

  public getVisualChartData(visual: CanvasVisualItem): ChartCanvasPayload {
    const base = this.resolveBaseVisualChartData(visual);
    const sorted = this.applySortToPayload(base, visual);
    return {
      ...sorted,
      showTitle: this.showVisualTitle(),
      showGridlines: this.showGridlines(),
      highlightCallouts: this.highlightCallouts(),
      legendPosition: this.legendPosition(),
    };
  }

  private resolveBaseVisualChartData(
    visual: CanvasVisualItem,
  ): ChartCanvasPayload {
    const archetype = visual.archetype;
    const isDark = this.state.theme() === "dark";
    const primaryColor = this.activePaletteColor();
    const primarySubtle = this.activePaletteSubtle();
    const isNeutral = this.selectedPalette() === "neutral";

    const slots = this.resolveWellsForVisual(visual);
    const valueField =
      slots["values"]?.[0] ??
      slots["measure"]?.[0];
    const resolvedMeasure = this.resolveMeasureField(valueField);
    const dimField =
      slots["category"]?.[0] ??
      slots["location"]?.[0] ??
      slots["rows"]?.[0] ??
      this.inferDefaultDimensionForVisual(visual, resolvedMeasure.table)[0];
    const bareDim = dimField
      ? dimField.includes(".")
        ? dimField.split(".")[1]
        : dimField
      : "";

    const evaluatedRows = this.evaluateVisualRows(visual);
    let labels: string[] = [];
    let data: number[] = [];

    if (evaluatedRows.length > 0) {
      for (const row of evaluatedRows) {
        const rawLabel =
          (bareDim ? row[bareDim] : undefined) ??
          (dimField ? row[dimField] : undefined) ??
          Object.entries(row).find(([k]) => k !== "measure_value")?.[1] ??
          resolvedMeasure.label;
        const rawVal = Number(row["measure_value"] ?? 0);
        labels.push(String(rawLabel));
        data.push(Number.isNaN(rawVal) ? 0 : rawVal);
      }
    } else if (visual.metricValue && visual.metricValue !== "-") {
      const parsedMetric = Number(
        visual.metricValue.replace(/[^0-9.-]+/g, ""),
      );
      labels = [visual.metricLabel || visual.title];
      data = [Number.isNaN(parsedMetric) ? 0 : parsedMetric];
    }

    const datasetLabel =
      valueField
        ? resolvedMeasure.label
        : visual.metricLabel && visual.metricLabel !== "No data connected"
          ? visual.metricLabel
          : visual.title;

    if (archetype === "Line") {
      return {
        title: visual.title,
        chartType: "line",
        labels,
        datasets: [
          {
            label: datasetLabel,
            data,
            borderColor: primaryColor,
            fill: false,
          },
        ],
      };
    }

    if (archetype === "Area") {
      return {
        title: visual.title,
        chartType: "line",
        labels,
        datasets: [
          {
            label: datasetLabel,
            data,
            borderColor: primaryColor,
            backgroundColor: primarySubtle,
            fill: true,
          },
        ],
      };
    }

    if (archetype === "Donut") {
      return {
        title: visual.title,
        chartType: "doughnut",
        labels,
        datasets: [
          {
            label: datasetLabel,
            data,
            backgroundColor: [primaryColor, ...SERIES_PALETTE_TAIL],
            borderColor: primaryColor,
          },
        ],
      };
    }

    if (archetype === "Gauge") {
      const currentVal = data[0] ?? 0;
      const targetField = slots["target"]?.[0];
      let targetVal = currentVal > 0 ? currentVal * 1.25 : 100;
      if (targetField) {
        const targetMeasure = this.resolveMeasureField(targetField);
        const targetRows = this.raxQuery.evaluateDatasetRowsLocally({
          visualId: `${visual.id}-target`,
          raxExpression: targetMeasure.expression,
          factTableName: targetMeasure.table,
        });
        if (
          targetRows.length > 0 &&
          typeof targetRows[0]["measure_value"] === "number"
        ) {
          targetVal = targetRows[0]["measure_value"] as number;
        }
      }
      const remaining = Math.max(0, targetVal - currentVal);
      return {
        title: visual.title,
        chartType: "doughnut",
        labels:
          data.length > 0
            ? [`Current (${currentVal.toLocaleString("en-US")})`, `Target Remaining (${remaining.toLocaleString("en-US")})`]
            : [],
        datasets: [
          {
            label: datasetLabel,
            data: data.length > 0 ? [currentVal, remaining] : [],
            backgroundColor: [
              primaryColor,
              isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)",
            ],
            borderColor: primaryColor,
          },
        ],
      };
    }

    return {
      title: visual.title,
      chartType: "bar",
      labels,
      datasets: [
        {
          label: datasetLabel,
          data,
          backgroundColor: isNeutral
            ? isDark
              ? "rgba(255, 255, 255, 0.85)"
              : "rgba(0, 0, 0, 0.75)"
            : primaryColor,
          borderColor: primaryColor,
        },
      ],
    };
  }

  private applySortToPayload(
    payload: ChartCanvasPayload,
    visual: CanvasVisualItem,
  ): ChartCanvasPayload {
    if (
      !visual.sortBy ||
      !visual.sortOrder ||
      payload.labels.length <= 1 ||
      payload.datasets.length === 0
    ) {
      return payload;
    }
    const order = visual.sortOrder;
    const by = visual.sortBy;
    const indices = payload.labels.map((_, i) => i);

    indices.sort((i, j) => {
      if (by === "value") {
        const valA = payload.datasets[0].data[i] ?? 0;
        const valB = payload.datasets[0].data[j] ?? 0;
        return order === "desc" ? valB - valA : valA - valB;
      } else {
        const lblA = String(payload.labels[i]);
        const lblB = String(payload.labels[j]);
        return order === "desc"
          ? lblB.localeCompare(lblA)
          : lblA.localeCompare(lblB);
      }
    });

    return {
      ...payload,
      labels: indices.map((i) => payload.labels[i]),
      datasets: payload.datasets.map((ds) => ({
        ...ds,
        data: indices.map((i) => ds.data[i]),
        backgroundColor: Array.isArray(ds.backgroundColor)
          ? indices.map(
              (i) =>
                (ds.backgroundColor as readonly string[])[
                  i % (ds.backgroundColor as readonly string[]).length
                ],
            )
          : ds.backgroundColor,
        borderColor: Array.isArray(ds.borderColor)
          ? indices.map(
              (i) =>
                (ds.borderColor as readonly string[])[
                  i % (ds.borderColor as readonly string[]).length
                ],
            )
          : ds.borderColor,
      })),
    };
  }

  public setVisualSort(
    visualId: string,
    sortBy: "value" | "axis",
    sortOrder: "asc" | "desc",
  ): void {
    this.state.updateVisualSort(visualId, sortBy, sortOrder);
    const orderLabel = sortOrder === "desc" ? "Descending" : "Ascending";
    const targetLabel = sortBy === "value" ? "value" : "category axis";
    this.state.announce(`Visual sorted by ${targetLabel} (${orderLabel}).`);
    this.closeVisualMenu();
  }

  public clearVisualSort(visualId: string): void {
    this.state.updateVisualSort(visualId, undefined, undefined);
    this.state.announce("Visual axis sorting reset to default.");
    this.closeVisualMenu();
  }

  public onDropFieldIntoSlot(
    slotId: string,
    event: CdkDragDrop<unknown>,
  ): void {
    if (event.previousContainer === event.container) {
      const reordered = [...this.getSlotFields(slotId)];
      if (reordered.length > 1 && event.previousIndex !== event.currentIndex) {
        moveItemInArray(reordered, event.previousIndex, event.currentIndex);
        this.commitWells({
          ...this.assignedSlotFields(),
          [slotId]: reordered,
        });
      }
      return;
    }

    const dropped: unknown = event.item.data;
    if (typeof dropped !== "string" || dropped.length === 0) {
      return;
    }
    const slot = this.activeArchetypeSlots().find((item) => item.id === slotId);
    if (slot?.role === "dimension" && this.isMeasureField(dropped)) {
      this.state.announce(`${slot.label} accepts dimension fields only.`);
      return;
    }
    this.assignFieldToSlot(slotId, dropped);
  }

  public onDropFieldWell(event: CdkDragDrop<string[]>): void {
    // Retained for backward compatibility
  }

  public switchStudioTab(tab: ToolsTab): void {
    this.switchToolsTab(tab);
  }

  public resetActiveFilters(): void {
    this.selectedFilterCategories.set([]);
    this.state.resetFilters();
  }

  public toggleFilterDropdown(): void {
    this.isFilterDropdownOpen.update((open) => !open);
  }

  public closeFilterDropdown(): void {
    this.isFilterDropdownOpen.set(false);
  }

  public onSelectDimension(dimension: string): void {
    this.selectedFilterDimension.set(dimension);
    this.filterValueInput.set("");
  }

  public applyQuickSlicer(dimension: string, value: string): void {
    this.state.applyFilter(dimension, "EQ", [value]);
    this.closeFilterDropdown();
  }

  public applyCustomFilter(): void {
    const dimension = this.resolveFilterDimension();
    if (!dimension) {
      return;
    }

    const rawValue = this.filterValueInput().trim();
    if (!rawValue) {
      return;
    }

    const operator = this.selectedFilterOperator();
    const values = this.parseFilterValues(rawValue, operator);
    if (values.length === 0) {
      return;
    }

    this.state.applyFilter(dimension, operator, values);
    this.filterValueInput.set("");
    this.customDimensionInput.set("");
    this.closeFilterDropdown();
  }

  private resolveFilterDimension(): string {
    const rawDimension = this.selectedFilterDimension();
    const isCustomOrNoPredefined =
      rawDimension === "Custom..." || this.availableDimensions().length === 0;
    return isCustomOrNoPredefined
      ? this.customDimensionInput().trim()
      : rawDimension.trim();
  }

  private parseFilterValues(
    rawValue: string,
    operator: FilterOp,
  ): FilterValue[] {
    if (operator === "IN" || operator === "BETWEEN") {
      const separator = rawValue.includes("..") ? ".." : ",";
      return rawValue
        .split(separator)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    }
    return [rawValue];
  }

  public removeActiveFilter(dimension: string): void {
    this.state.removeFilter(dimension);
  }

  public getVisualGridColumnClass(width: "half" | "full"): string {
    return width === "full" ? "col-12" : "col-12 col-xl-6";
  }

  public getVisualWidthToggleTitle(width: "half" | "full"): string {
    return width === "full" ? "Switch to half width" : "Switch to full width";
  }

  public getVisualWidthToggleLabel(width: "half" | "full"): string {
    return width === "full" ? "Half Width" : "Full Width";
  }

  public formatFilterValues(clause: FilterClause): string {
    return clause.values.join(", ");
  }

  private isValidArchetype(value: string): value is VisualArchetype {
    return (VISUAL_ARCHETYPES as readonly string[]).includes(value);
  }

  // ---------------------------------------------------------------------------
  // Bottom Report Page Tabs Management
  // ---------------------------------------------------------------------------

  public readonly editingPageIndex = signal<number | null>(null);
  public readonly editingPageValue = signal<string>("");
  public readonly pageMenuIndex = signal<number | null>(null);
  public readonly draggedPageIndex = signal<number | null>(null);
  public readonly dragOverIndex = signal<number | null>(null);
  public readonly dragOverPosition = signal<"left" | "right" | null>(null);

  public onSelectReportPage(page: string): void {
    this.pageMenuIndex.set(null);
    this.state.selectPage(page);
  }

  public startRenamePage(index: number, page: string): void {
    this.pageMenuIndex.set(null);
    this.editingPageIndex.set(index);
    this.editingPageValue.set(page);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        ".rc-bottom-page-tab-input",
      );
      if (input) {
        input.focus();
        input.select();
      }
    }, 10);
  }

  public commitRenamePage(oldName: string): void {
    const newName = this.editingPageValue().trim();
    this.editingPageIndex.set(null);
    if (newName && newName !== oldName) {
      this.state.renameReportPage(oldName, newName);
    }
  }

  public cancelRenamePage(): void {
    this.editingPageIndex.set(null);
  }

  public onRemoveReportPage(event: Event, page: string): void {
    event.stopPropagation();
    this.pageMenuIndex.set(null);
    this.state.removeReportPage(page);
  }

  public togglePageMenu(event: Event, index: number): void {
    event.stopPropagation();
    this.pageMenuIndex.update((curr) => (curr === index ? null : index));
  }

  public onPageContextMenu(event: MouseEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.pageMenuIndex.set(index);
  }

  public moveTab(page: string, direction: "left" | "right"): void {
    this.pageMenuIndex.set(null);
    this.state.moveReportPage(page, direction);
  }

  public onPageDragStart(event: DragEvent, index: number): void {
    if (this.editingPageIndex() !== null) {
      event.preventDefault();
      return;
    }
    this.draggedPageIndex.set(index);
    this.pageMenuIndex.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    }
  }

  public onPageDragEnter(event: DragEvent, _index: number): void {
    event.preventDefault();
  }

  public onPageDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const fromIndex = this.draggedPageIndex();
    if (fromIndex === null || fromIndex === index) {
      this.dragOverIndex.set(null);
      this.dragOverPosition.set(null);
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const pos = event.clientX < midX ? "left" : "right";
    this.dragOverIndex.set(index);
    this.dragOverPosition.set(pos);
  }

  public onPageDragLeave(event: DragEvent, index: number): void {
    const target = event.currentTarget as HTMLElement;
    if (!target.contains(event.relatedTarget as Node)) {
      if (this.dragOverIndex() === index) {
        this.dragOverIndex.set(null);
        this.dragOverPosition.set(null);
      }
    }
  }

  public onPageDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    const fromIndex = this.draggedPageIndex();
    if (fromIndex !== null && fromIndex !== dropIndex) {
      const pos = this.dragOverPosition();
      let targetIndex = dropIndex;
      if (fromIndex < dropIndex) {
        targetIndex = pos === "left" ? dropIndex - 1 : dropIndex;
      } else {
        targetIndex = pos === "right" ? dropIndex + 1 : dropIndex;
      }
      const total = this.state.reportPages().length;
      if (
        targetIndex >= 0 &&
        targetIndex < total &&
        targetIndex !== fromIndex
      ) {
        this.state.reorderReportPages(fromIndex, targetIndex);
      }
    }
    this.onPageDragEnd();
  }

  public onPageDragEnd(): void {
    this.draggedPageIndex.set(null);
    this.dragOverIndex.set(null);
    this.dragOverPosition.set(null);
  }

  public onTabKeyDown(event: KeyboardEvent, index: number, page: string): void {
    if (event.key === "F2") {
      event.preventDefault();
      this.startRenamePage(index, page);
    } else if (event.key === "Delete") {
      if (this.state.reportPages().length > 1) {
        event.preventDefault();
        this.state.removeReportPage(page);
      }
    } else if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      this.state.moveReportPage(page, "left");
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      this.state.moveReportPage(page, "right");
    }
  }

  @HostListener("document:keydown.escape")
  public onEscapeKey(): void {
    if (this.pageMenuIndex() !== null) {
      this.pageMenuIndex.set(null);
    }
    if (this.editingPageIndex() !== null) {
      this.cancelRenamePage();
    }
    if (this.activeVisualMenuId() !== null) {
      this.closeVisualMenu();
    }
  }

  @HostListener("document:click", ["$event"])
  public onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      this.pageMenuIndex() !== null &&
      !target.closest(".rc-bottom-page-tab-group")
    ) {
      this.pageMenuIndex.set(null);
    }
  }
}
