import { HttpClient } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { Observable, catchError, map, of, tap, throwError } from "rxjs";
import { DEFAULT_SEMANTIC_MODEL } from "../model/model.constants";
import {
  CanvasVisualItem,
  FilterValue,
  RaxMeasureDescriptor,
  StateManagerService,
} from "../state/state.service";
import {
  RAX_CATALOG_ENDPOINT,
  RAX_EXECUTE_ENDPOINT,
  RAX_FORMAT_ENDPOINT,
  RAX_MEASURES_APPLY_ENDPOINT,
  RAX_MEASURES_DEFINE_ENDPOINT,
  RAX_TMDL_ENDPOINT,
  RAX_VALIDATE_ENDPOINT,
  VISUAL_BATCH_QUERY_ENDPOINT,
} from "./rax.constants";
import type {
  ApplyMeasuresRequest,
  ApplyMeasuresResponse,
  BackendMeasureDefinitionDto,
  BackendRaxValidationResponse,
  ExecuteRaxScriptRequest,
  FilterInputSpec,
  FormatQueryRequest,
  FormatQueryResponse,
  MatrixRollupPayloadDto,
  MatrixRowRollupDto,
  MatrixTotalsRollupDto,
  MeasureCardPayloadDto,
  QueryExecutionResult,
  RaxFunctionCatalogEntry,
  RaxValidationResult,
  ResolvedFilterClause,
  SqlDialect,
  TmdlGenerateRequest,
  TmdlGenerateResponse,
  VisualBatchOptions,
  VisualBatchQueryItemDto,
  VisualBatchQueryRequest,
  VisualBatchQueryResponse,
  VisualChartPayloadDto,
  VisualChartSeriesDto,
  VisualEvaluationDto,
  VisualQueryPayload,
  VisualQueryRequestOptions,
} from "./rax.interface";

export {
  RAX_CATALOG_ENDPOINT,
  RAX_EXECUTE_ENDPOINT,
  RAX_FORMAT_ENDPOINT,
  RAX_MEASURES_APPLY_ENDPOINT,
  RAX_MEASURES_DEFINE_ENDPOINT,
  RAX_TMDL_ENDPOINT,
  RAX_VALIDATE_ENDPOINT,
  VISUAL_BATCH_QUERY_ENDPOINT,
} from "./rax.constants";
export type {
  ApplyMeasuresRequest,
  ApplyMeasuresResponse,
  BackendMeasureDefinitionDto,
  ExecuteRaxScriptRequest,
  FilterInputSpec,
  FormatQueryRequest,
  FormatQueryResponse,
  MatrixRollupPayloadDto,
  MatrixRowRollupDto,
  MatrixTotalsRollupDto,
  MeasureCardPayloadDto,
  QueryExecutionResult,
  RaxFunctionCatalogEntry,
  RaxValidationResult,
  ResolvedFilterClause,
  SqlDialect,
  TmdlGenerateRequest,
  TmdlGenerateResponse,
  VisualBatchOptions,
  VisualBatchQueryItemDto,
  VisualBatchQueryRequest,
  VisualBatchQueryResponse,
  VisualChartPayloadDto,
  VisualChartSeriesDto,
  VisualEvaluationDto,
  VisualQueryPayload,
  VisualQueryRequestOptions,
} from "./rax.interface";

const EMPTY_MATRIX_TOTALS: MatrixTotalsRollupDto = {
  units: 0,
  revenue: 0,
  margin: 0,
};

@Injectable({ providedIn: "root" })
export class QueryService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);

  private readonly visualResultsSignal = signal<
    Readonly<Record<string, VisualEvaluationDto>>
  >({});
  private readonly visualRowsSignal = signal<
    Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>
  >({});
  private readonly catalogSignal = signal<readonly RaxFunctionCatalogEntry[]>(
    [],
  );
  private readonly isExecutingSignal = signal<boolean>(false);

  public readonly visualResults = this.visualResultsSignal.asReadonly();
  public readonly visualRows = this.visualRowsSignal.asReadonly();
  public readonly catalog = this.catalogSignal.asReadonly();
  public readonly isExecuting = this.isExecutingSignal.asReadonly();

  public formatScript(script: string): Observable<FormatQueryResponse> {
    const request: FormatQueryRequest = { script };
    return this.http.post<FormatQueryResponse>(RAX_FORMAT_ENDPOINT, request);
  }

  public generateTmdl(
    modelId?: string | null,
  ): Observable<TmdlGenerateResponse> {
    const request: TmdlGenerateRequest = {
      modelId: modelId ?? DEFAULT_SEMANTIC_MODEL.modelId ?? null,
    };
    return this.http.post<TmdlGenerateResponse>(RAX_TMDL_ENDPOINT, request);
  }

  public executeScript(
    script: string,
    modelId?: string | null,
    dialect: SqlDialect = "DUCKDB",
  ): Observable<QueryExecutionResult> {
    const request: ExecuteRaxScriptRequest = {
      modelId: modelId ?? DEFAULT_SEMANTIC_MODEL.modelId ?? null,
      script,
      dialect,
    };
    this.isExecutingSignal.set(true);
    return this.http
      .post<QueryExecutionResult>(RAX_EXECUTE_ENDPOINT, request)
      .pipe(
        tap(() => this.isExecutingSignal.set(false)),
        catchError((error) => {
          this.isExecutingSignal.set(false);
          return throwError(() => error);
        }),
      );
  }

  public applyMeasures(
    script: string,
    modelId?: string | null,
  ): Observable<ApplyMeasuresResponse> {
    const request: ApplyMeasuresRequest = {
      modelId: modelId ?? DEFAULT_SEMANTIC_MODEL.modelId ?? null,
      script,
    };
    return this.http
      .post<ApplyMeasuresResponse>(RAX_MEASURES_APPLY_ENDPOINT, request)
      .pipe(
        tap((response) => {
          for (const dto of response?.measures ?? []) {
            this.state.saveMeasure(this.mapMeasure(dto));
          }
        }),
      );
  }

  public validateScript(
    script: string,
    defaultMeasureName = "New Measure",
  ): Observable<RaxValidationResult | null> {
    if (!script.trim()) {
      return of(null);
    }
    return this.http
      .post<BackendRaxValidationResponse>(RAX_VALIDATE_ENDPOINT, {
        workspaceId: "default",
        formula: script,
        defaultMeasureName,
      })
      .pipe(
        map((res) => ({
          isValid: res.isValid,
          statusLabel: res.statusLabel,
          measureName: res.measureName,
          formulaExpression: res.formulaExpression,
          diagnostics: (res.diagnostics ?? []).map((d) => ({
            ...d,
            startColumn: d.startColumn ?? d.column ?? 1,
            errorCode: d.errorCode ?? d.code ?? "ERR_RAX_SYNTAX",
            severity: (d.severity?.toLowerCase() ?? "error") as
              | "error"
              | "warning"
              | "info",
          })),
          tokens: (res.tokens ?? []).map((t) => ({
            type:
              (t.type as RaxValidationResult["tokens"][number]["type"]) ||
              "plain",
            value: t.text,
          })),
        })),
      );
  }

  public loadCatalog(): Observable<readonly RaxFunctionCatalogEntry[]> {
    return this.http
      .get<readonly RaxFunctionCatalogEntry[]>(RAX_CATALOG_ENDPOINT)
      .pipe(
        tap((entries) => {
          if (entries?.length) {
            this.catalogSignal.set(entries);
          }
        }),
        catchError(() => of(this.catalogSignal())),
      );
  }

  public serializeFilters(): Record<string, unknown[]> {
    const serialized: Record<string, unknown[]> = {};
    for (const [, clause] of this.state.activeFilters().clauses.entries()) {
      if (clause.values.length > 0) {
        serialized[`${clause.dimension}:${clause.operator}`] = [
          ...clause.values,
        ];
      }
    }
    return serialized;
  }

  public buildFilter(spec: FilterInputSpec): ResolvedFilterClause | null {
    const isCustom =
      spec.selectedDimension === "Custom..." ||
      spec.availableDimensions.length === 0;
    const dimension = (
      isCustom ? spec.customDimension : spec.selectedDimension
    ).trim();
    const trimmedValue = spec.rawValue.trim();
    if (!dimension || !trimmedValue) {
      return null;
    }

    const values: FilterValue[] =
      spec.operator === "IN" || spec.operator === "BETWEEN"
        ? trimmedValue
            .split(trimmedValue.includes("..") ? ".." : ",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
        : [trimmedValue];

    if (values.length === 0) {
      return null;
    }

    return {
      dimension,
      operator: spec.operator,
      values,
    };
  }

  public clearVisual(visualId: string): void {
    this.visualResultsSignal.update((curr) => {
      const next = { ...curr };
      delete next[visualId];
      return next;
    });
    this.visualRowsSignal.update((curr) => {
      const next = { ...curr };
      delete next[visualId];
      return next;
    });
  }

  public queryVisuals(
    options: VisualBatchOptions,
  ): Observable<Readonly<Record<string, VisualEvaluationDto>>> {
    const boundItems = this.buildItems(options);
    if (boundItems.length === 0) {
      return of(this.visualResultsSignal());
    }

    const reportId = this.state.activeProject().filename || "default-report";
    const externalFilters: Record<string, readonly unknown[]> = {};
    if (
      options.slicerDimension &&
      options.slicerCategories &&
      options.slicerCategories.length > 0
    ) {
      externalFilters[options.slicerDimension] = [...options.slicerCategories];
    }

    const request: VisualBatchQueryRequest = {
      modelId: DEFAULT_SEMANTIC_MODEL.modelId ?? "",
      reportId,
      visuals: boundItems,
      activeFilters: this.serializeFilters(),
      externalSlicerFilters: externalFilters,
      measures: this.state.measures,
      evaluationDate: new Date().toISOString().split("T")[0],
      acceptLanguage:
        typeof navigator !== "undefined"
          ? navigator.language || "en-US"
          : "en-US",
    };

    this.state.setLoading(true, "Querying report visuals...");
    return this.http
      .post<VisualBatchQueryResponse>(VISUAL_BATCH_QUERY_ENDPOINT, request)
      .pipe(
        map((response) => this.applyBatch(boundItems, response)),
        tap(() => this.state.setLoading(false)),
        catchError((error) => {
          this.state.setLoading(false);
          this.state.announceError("Visual batch query", error);
          return throwError(() => error);
        }),
      );
  }

  public executeMeasure(
    measureId: string,
    raxExpression?: string,
    visualId?: string,
  ): Observable<QueryExecutionResult> {
    const reportId = this.state.activeProject().filename || "default-report";
    const primaryTable =
      this.resolveTable(undefined, raxExpression) ||
      this.state.sharedTables.find((t) => t.role === "FACT")?.name ||
      this.state.sharedTables[0]?.name ||
      undefined;
    const payload: VisualQueryPayload = {
      modelId: DEFAULT_SEMANTIC_MODEL.modelId,
      reportId,
      visualId,
      measureId,
      raxExpression: raxExpression ?? "",
      tenantId: undefined,
      factTableName: primaryTable,
      estimatedRows: 0,
      operationalLookup: false,
      groupByColumns: [],
      activeFilters: this.serializeFilters(),
      externalSlicerFilters: {},
      evaluationDate: new Date().toISOString().split("T")[0],
      acceptLanguage:
        typeof navigator !== "undefined"
          ? navigator.language || "en-US"
          : "en-US",
    };

    const startTime = performance.now();
    this.state.setLoading(true, `Evaluating RAX measure ${measureId}...`);

    return this.http
      .post<QueryExecutionResult>(
        `/api/reports/${encodeURIComponent(reportId)}/query`,
        payload,
      )
      .pipe(
        tap((result) => {
          const duration = Math.round(performance.now() - startTime);
          this.state.setLoading(false);
          this.state.announce(
            `Query completed via ${result.routedEngine} in ${duration}ms.`,
          );
        }),
        catchError((error) => {
          this.state.setLoading(false);
          this.state.announceError(`RAX query ${measureId}`, error);
          return throwError(() => error);
        }),
      );
  }

  public executeVisual(
    options: VisualQueryRequestOptions,
  ): Observable<QueryExecutionResult> {
    const reportId = this.state.activeProject().filename || "default-report";
    const primaryTable =
      this.resolveTable(options.factTableName, options.raxExpression) ||
      this.state.sharedTables.find((t) => t.role === "FACT")?.name ||
      this.state.sharedTables[0]?.name ||
      undefined;

    const externalFilters: Record<string, unknown[]> = {};
    if (options.externalSlicerFilters) {
      for (const [k, v] of Object.entries(options.externalSlicerFilters)) {
        externalFilters[k] = [...v];
      }
    }

    const payload: VisualQueryPayload = {
      modelId: DEFAULT_SEMANTIC_MODEL.modelId,
      reportId,
      visualId: options.visualId,
      measureId: options.measureId,
      raxExpression: options.raxExpression ?? "",
      tenantId: undefined,
      factTableName: primaryTable,
      estimatedRows: 0,
      operationalLookup: false,
      groupByColumns: options.groupByColumns ? [...options.groupByColumns] : [],
      activeFilters: this.serializeFilters(),
      externalSlicerFilters: externalFilters,
      evaluationDate: new Date().toISOString().split("T")[0],
      acceptLanguage:
        typeof navigator !== "undefined"
          ? navigator.language || "en-US"
          : "en-US",
    };

    this.state.setLoading(true, `Querying visual ${options.visualId}...`);
    return this.http
      .post<QueryExecutionResult>(
        `/api/reports/${encodeURIComponent(reportId)}/query`,
        payload,
      )
      .pipe(
        tap((res) => {
          this.state.setLoading(false);
          if (res?.rows) {
            this.visualRowsSignal.update((curr) => ({
              ...curr,
              [options.visualId]: res.rows,
            }));
          }
        }),
        catchError((error) => {
          this.state.setLoading(false);
          this.state.announceError(`Visual query ${options.visualId}`, error);
          return throwError(() => error);
        }),
      );
  }

  public matrixRows(visual: CanvasVisualItem): readonly MatrixRowRollupDto[] {
    return this.visualResultsSignal()[visual.id]?.matrix?.rows ?? [];
  }

  public matrixTotals(visual: CanvasVisualItem): MatrixTotalsRollupDto {
    return (
      this.visualResultsSignal()[visual.id]?.matrix?.totals ??
      EMPTY_MATRIX_TOTALS
    );
  }

  public cardDisplay(visual: CanvasVisualItem): MeasureCardPayloadDto {
    const evaluated = this.visualResultsSignal()[visual.id]?.measureCard;
    if (evaluated) {
      return evaluated;
    }
    return {
      label: visual.metricLabel || visual.title,
      value: visual.metricValue || "-",
      subtext:
        visual.metricSubtext ||
        "Bind a measure or column in Field Wells to evaluate",
    };
  }

  private mapMeasure(dto: BackendMeasureDefinitionDto): RaxMeasureDescriptor {
    const label = dto.name ?? dto.label ?? dto.id;
    const table =
      dto.tableName ?? dto.table ?? this.state.sharedTables[0]?.name ?? "";
    const formula = dto.raxExpression ?? dto.formula ?? "";
    return {
      id: dto.id || `m-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label,
      formula,
      table,
      description: dto.description ?? "",
      formatString: dto.formatString ?? "",
    };
  }

  private buildItems(
    options: VisualBatchOptions,
  ): readonly VisualBatchQueryItemDto[] {
    const items: VisualBatchQueryItemDto[] = [];
    for (const visual of options.visuals) {
      const wells = this.extractWells(visual, options);
      const hasBoundFields = Object.values(wells).some(
        (fields) => fields.length > 0,
      );
      if (!hasBoundFields) {
        continue;
      }
      items.push({
        visualId: visual.id,
        title: visual.title,
        archetype: visual.archetype,
        fieldWells: wells,
        sortBy: visual.sortBy,
        sortOrder: visual.sortOrder,
        metricLabel: visual.metricLabel,
        metricValue: visual.metricValue,
        metricSubtext: visual.metricSubtext,
      });
    }
    return items;
  }

  private extractWells(
    visual: CanvasVisualItem,
    options: VisualBatchOptions,
  ): Readonly<Record<string, readonly string[]>> {
    if (visual.fieldWells && Object.keys(visual.fieldWells).length > 0) {
      return visual.fieldWells;
    }
    if (
      options.assignedWells &&
      (options.selectedVisualId === visual.id || !options.selectedVisualId)
    ) {
      return options.assignedWells;
    }
    return {};
  }

  private applyBatch(
    items: readonly VisualBatchQueryItemDto[],
    response: VisualBatchQueryResponse | null,
  ): Readonly<Record<string, VisualEvaluationDto>> {
    const incoming: Record<string, VisualEvaluationDto> = {};
    if (response?.visuals) {
      for (const [id, dto] of Object.entries(response.visuals)) {
        incoming[id] = this.normalizeEvaluation(id, dto, items);
      }
    }
    if (response?.results) {
      for (const dto of response.results) {
        if (dto?.visualId) {
          incoming[dto.visualId] = this.normalizeEvaluation(
            dto.visualId,
            dto,
            items,
          );
        }
      }
    }

    this.visualResultsSignal.update((curr) => ({
      ...curr,
      ...incoming,
    }));

    this.visualRowsSignal.update((curr) => {
      const next = { ...curr };
      for (const [id, dto] of Object.entries(incoming)) {
        if (dto.rows) {
          next[id] = dto.rows;
        }
      }
      return next;
    });

    return this.visualResultsSignal();
  }

  private normalizeEvaluation(
    visualId: string,
    dto: VisualEvaluationDto,
    items: readonly VisualBatchQueryItemDto[],
  ): VisualEvaluationDto {
    if (dto.chart || !dto.rows || dto.rows.length === 0) {
      return { ...dto, visualId };
    }
    const item = items.find((i) => i.visualId === visualId);
    const valueField =
      item?.fieldWells["values"]?.[0] ?? item?.fieldWells["measure"]?.[0];
    const dimField =
      item?.fieldWells["category"]?.[0] ??
      item?.fieldWells["location"]?.[0] ??
      item?.fieldWells["rows"]?.[0];
    const bareDim = dimField?.includes(".") ? dimField.split(".")[1] : dimField;
    const bareVal = valueField?.includes(".")
      ? valueField.split(".")[1]
      : valueField;

    const labels: string[] = [];
    const data: number[] = [];
    for (const row of dto.rows) {
      const lbl =
        (bareDim ? row[bareDim] : undefined) ??
        (dimField ? row[dimField] : undefined) ??
        Object.entries(row).find(
          ([k]) => k !== "measure_value" && k !== bareVal,
        )?.[1] ??
        item?.title ??
        "Total";
      const val = Number(
        row["measure_value"] ??
          (bareVal ? row[bareVal] : undefined) ??
          (valueField ? row[valueField] : undefined) ??
          0,
      );
      labels.push(String(lbl));
      data.push(Number.isNaN(val) ? 0 : val);
    }

    const chartType =
      item?.archetype === "Line" || item?.archetype === "Area"
        ? "line"
        : item?.archetype === "Donut" || item?.archetype === "Gauge"
          ? "doughnut"
          : "bar";

    return {
      ...dto,
      visualId,
      hasChartData: true,
      chart: {
        title: item?.title ?? "",
        chartType,
        labels,
        datasets: [
          {
            label: bareVal || item?.title || "Value",
            data,
          },
        ],
      },
    };
  }

  private resolveTable(
    explicit?: string,
    raxExpression?: string,
  ): string | undefined {
    if (explicit) {
      return explicit;
    }
    if (!raxExpression) {
      return undefined;
    }
    const match = raxExpression.match(/'([^']+)'\s*\[/);
    return match ? match[1] : undefined;
  }
}
