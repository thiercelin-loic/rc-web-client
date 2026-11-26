import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Observable, of } from "rxjs";
import { catchError, map, switchMap, tap } from "rxjs/operators";
import {
  ColumnDisplayFormat,
  SharedColumn,
  SharedTable,
  StateManagerService,
} from "../state/state.service";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_SEMANTIC_MODEL,
  EMPTY_MODEL_RELATIONSHIP,
  LEGACY_DEMO_TABLES,
  LEGACY_MODEL_NAME,
  MODELS_DEFAULT_ENDPOINT,
  MODELS_ENDPOINT,
  MODELS_INFER_ENDPOINT,
  MODELS_RSDL_ENDPOINT,
  MODELS_VALIDATE_DAG_ENDPOINT,
  columnUrl,
  dateUrl,
  TABLE_CARD_WIDTH,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
} from "./model.constants";
import {
  BackendCardinality,
  BackendCrossFilter,
  BackendSemanticModelPayload,
  ColumnMetadataPatchRequest,
  ColumnTargetRequest,
  DagDiagnosticMarker,
  DagValidationResponse,
  DateTableRequest,
  ModelColumn,
  ModelLayoutMode,
  ModelMutationResult,
  ModelRelationship,
  ModelTable,
  ProblemDetail,
  RelationshipInferenceRequest,
  RelationshipInferenceResponse,
  RelationshipRoutingRequest,
  SemanticModelApiPayload,
  SemanticModelRelationship,
  SemanticModelTable,
} from "./model.interface";

export {
  DEFAULT_MODEL_ID,
  DEFAULT_SEMANTIC_MODEL,
  EMPTY_MODEL_RELATIONSHIP,
  MODELS_DEFAULT_ENDPOINT,
  MODELS_ENDPOINT,
  MODELS_INFER_ENDPOINT,
  MODELS_RSDL_ENDPOINT,
  MODELS_VALIDATE_DAG_ENDPOINT,
  TABLE_CARD_WIDTH,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
} from "./model.constants";
export type {
  BackendCardinality,
  BackendCrossFilter,
  BackendSemanticModelColumn,
  BackendSemanticModelMeasure,
  BackendSemanticModelPayload,
  BackendSemanticModelRelationship,
  BackendSemanticModelTable,
  ColumnMetadataPatchRequest,
  ColumnTargetRequest,
  DagDiagnosticMarker,
  DagValidationResponse,
  DateTableRequest,
  ModelColumn,
  ModelLayoutMode,
  ModelMutationResult,
  ModelRelationship,
  ModelSection,
  ModelTable,
  ProblemDetail,
  RelationshipInferenceRequest,
  RelationshipInferenceResponse,
  RelationshipRoutingRequest,
  RenderedRelationship,
  SemanticModelApiPayload,
  SemanticModelColumn,
  SemanticModelMeasure,
  SemanticModelRelationship,
  SemanticModelTable,
} from "./model.interface";

export function isPrimaryKey(colName: string, tableName = ""): boolean {
  const normCol = colName.toLowerCase().replace(/[\s_-]+/g, "");
  const normTbl = tableName.toLowerCase().replace(/[\s_-]+/g, "");
  return (
    normCol === "id" ||
    normCol === `id${normTbl}` ||
    normCol === `${normTbl}id` ||
    normCol.startsWith("id") ||
    normCol.endsWith("id") ||
    normCol === "code" ||
    normCol === "key"
  );
}

export function cardHeight(columnCount: number): number {
  return TABLE_HEADER_HEIGHT + Math.max(columnCount, 1) * TABLE_ROW_HEIGHT + 16;
}

export function layoutTables(
  rawTables: ReadonlyArray<{
    readonly name: string;
    readonly role: "FACT" | "DIMENSION";
    readonly columns: readonly ModelColumn[];
    readonly isHidden?: boolean;
    readonly isDateTable?: boolean;
    readonly dateColumn?: string;
    readonly description?: string;
  }>,
  mode: ModelLayoutMode = "kimball",
  preservedPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): ModelTable[] {
  if (rawTables.length === 0) {
    return [];
  }

  const factTables = rawTables.filter((tbl) => tbl.role === "FACT");
  const centerHubTables = factTables.length > 0 ? factTables : [rawTables[0]];
  const centerNames = new Set(centerHubTables.map((tbl) => tbl.name));
  const peripheralTables = rawTables.filter(
    (tbl) => !centerNames.has(tbl.name),
  );
  const positionMap = new Map<string, { x: number; y: number }>();

  if (mode === "collie") {
    let topX = 48;
    let maxTopBottom = 36;
    const topTables =
      peripheralTables.length > 0 ? peripheralTables : centerHubTables;
    for (const tbl of topTables) {
      positionMap.set(tbl.name, { x: topX, y: 36 });
      const cardBottom = 36 + cardHeight(tbl.columns.length);
      if (cardBottom > maxTopBottom) {
        maxTopBottom = cardBottom;
      }
      topX += TABLE_CARD_WIDTH + 36;
    }

    if (peripheralTables.length > 0) {
      const totalFactWidth =
        centerHubTables.length * TABLE_CARD_WIDTH +
        Math.max(0, centerHubTables.length - 1) * 48;
      const totalDimSpan = Math.max(topX - 36, TABLE_CARD_WIDTH + 96);
      let factX = Math.max(
        48,
        Math.round((totalDimSpan - totalFactWidth) / 2),
      );
      const factY = maxTopBottom + 72;
      for (const tbl of centerHubTables) {
        positionMap.set(tbl.name, { x: factX, y: factY });
        factX += TABLE_CARD_WIDTH + 48;
      }
    }
  } else {
    const leftWing = peripheralTables.filter((_, idx) => idx % 2 === 0);
    const rightWing = peripheralTables.filter((_, idx) => idx % 2 === 1);

    let leftY = 36;
    for (const tbl of leftWing) {
      positionMap.set(tbl.name, { x: 56, y: leftY });
      leftY += cardHeight(tbl.columns.length) + 28;
    }

    let rightY = 36;
    for (const tbl of rightWing) {
      const singleRightOffset =
        rightWing.length === 1 && leftWing.length > 1 ? 100 : rightY;
      positionMap.set(tbl.name, { x: 704, y: singleRightOffset });
      rightY = singleRightOffset + cardHeight(tbl.columns.length) + 28;
    }

    const maxWingBottom = Math.max(leftY, rightY, 320);
    const totalCenterHeight = centerHubTables.reduce(
      (sum, tbl) => sum + cardHeight(tbl.columns.length) + 28,
      -28,
    );
    let centerY = Math.max(
      44,
      Math.round((maxWingBottom - totalCenterHeight) / 2),
    );

    for (const tbl of centerHubTables) {
      positionMap.set(tbl.name, { x: 380, y: centerY });
      centerY += cardHeight(tbl.columns.length) + 28;
    }
  }

  return rawTables.map((tbl) => ({
    name: tbl.name,
    role: tbl.role,
    position:
      preservedPositions?.get(tbl.name) ??
      positionMap.get(tbl.name) ?? { x: 380, y: 80 },
    columns: tbl.columns,
    isHidden: tbl.isHidden,
    isDateTable: tbl.isDateTable,
    dateColumn: tbl.dateColumn,
    description: tbl.description,
  }));
}

@Injectable({ providedIn: "root" })
export class SemanticModelService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);

  private readonly modelIdSignal = signal<string>(DEFAULT_MODEL_ID);
  private readonly tablesSignal = signal<readonly ModelTable[]>([]);
  private readonly relationshipsSignal = signal<readonly ModelRelationship[]>(
    [],
  );
  private readonly selectedRelSignal = signal<ModelRelationship>(
    EMPTY_MODEL_RELATIONSHIP,
  );
  private readonly dagValidationSignal = signal<DagValidationResponse | null>(
    null,
  );
  private readonly dagDiagnosticsSignal = signal<
    readonly DagDiagnosticMarker[]
  >([]);
  private readonly backendRsdlSignal = signal<string>("");
  private readonly discourageImplicitSignal = signal<boolean>(false);
  private readonly layoutModeSignal = signal<ModelLayoutMode>("kimball");
  private readonly suggestedDatesSignal = signal<
    Readonly<Record<string, string>>
  >({});
  private readonly lastErrorSignal = signal<ProblemDetail | null>(null);
  private backendSynced = false;
  private readonly syncedTables = new Set<string>();

  public readonly modelId = this.modelIdSignal.asReadonly();
  public readonly tables = this.tablesSignal.asReadonly();
  public readonly relationships = this.relationshipsSignal.asReadonly();
  public readonly selectedRel = this.selectedRelSignal.asReadonly();
  public readonly dagValidation = this.dagValidationSignal.asReadonly();
  public readonly dagDiagnostics = this.dagDiagnosticsSignal.asReadonly();
  public readonly backendRsdl = this.backendRsdlSignal.asReadonly();
  public readonly discourageImplicitMeasures =
    this.discourageImplicitSignal.asReadonly();
  public readonly layoutMode = this.layoutModeSignal.asReadonly();
  public readonly suggestedDates = this.suggestedDatesSignal.asReadonly();
  public readonly lastError = this.lastErrorSignal.asReadonly();

  // Strictly reflects the canonical RSDL returned by the backend.
  public readonly activeRsdl = computed<string>(() => this.backendRsdlSignal());

  public clearError(): void {
    this.lastErrorSignal.set(null);
  }

  public markSynced(tableNames: readonly string[]): void {
    this.backendSynced = true;
    for (const name of tableNames) {
      if (name.trim()) {
        this.syncedTables.add(name.trim().toLowerCase());
      }
    }
  }

  public markTable(tableName: string): void {
    if (tableName.trim()) {
      this.backendSynced = true;
      this.syncedTables.add(tableName.trim().toLowerCase());
    }
  }

  public ensureTable(
    tableName: string | undefined,
    modelId: string = this.modelIdSignal(),
  ): Observable<boolean> {
    if (!tableName) {
      return of(false);
    }
    if (!this.needsSync(tableName)) {
      return of(true);
    }
    return this.pushState(this.state, modelId).pipe(
      map((res) => res !== null),
    );
  }

  public setTables(tables: readonly ModelTable[]): void {
    this.tablesSignal.set(tables);
  }

  public setRelationships(relationships: readonly ModelRelationship[]): void {
    this.relationshipsSignal.set(relationships);
    if (relationships.length > 0 && !this.selectedRelSignal().name) {
      this.selectedRelSignal.set(relationships[0]);
    }
  }

  public selectRelationship(rel: ModelRelationship): void {
    this.selectedRelSignal.set(rel);
  }

  public setLayout(mode: ModelLayoutMode): void {
    this.layoutModeSignal.set(mode);
    const current = this.tablesSignal();
    if (current.length > 0) {
      this.tablesSignal.set(layoutTables(current, mode));
    }
  }

  public nudgeTable(tableName: string, dx: number, dy: number): void {
    this.tablesSignal.update((list) =>
      list.map((tbl) =>
        tbl.name === tableName
          ? {
              ...tbl,
              position: {
                x: Math.max(16, tbl.position.x + dx),
                y: Math.max(16, tbl.position.y + dy),
              },
            }
          : tbl,
      ),
    );
  }

  public syncShared(sharedTables: readonly SharedTable[]): void {
    const mappedTables = layoutTables(
      sharedTables.map((tbl) => ({
        name: tbl.name,
        role: tbl.role,
        isHidden: Boolean(tbl.isHidden),
        isDateTable: Boolean(tbl.isDateTable),
        dateColumn: tbl.dateColumn || "",
        description: tbl.description || "",
        columns: tbl.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.keyType === "PK",
          isForeignKey: c.keyType === "FK",
          isHidden: Boolean(c.isHidden),
          description: c.description || "",
          displayFolder: c.displayFolder || "",
          summarizeBy: c.summarizeBy || "default",
          expression: c.expression || "",
          sortByColumn: c.sortByColumn || "",
          format: c.format || "",
        })),
      })),
      this.layoutModeSignal(),
    );
    this.tablesSignal.set(mappedTables);

    if (mappedTables.length > 1 && this.relationshipsSignal().length === 0) {
      this.inferRelationships().subscribe();
    } else if (mappedTables.length > 0) {
      this.persistModel();
    }
  }

  public applyPayload(
    payload: SemanticModelApiPayload,
    preferredRelName?: string,
    autoInfer = false,
  ): void {
    if (!payload) {
      return;
    }
    if (payload.modelId) {
      this.modelIdSignal.set(payload.modelId);
    }
    if (typeof payload.discourageImplicitMeasures === "boolean") {
      this.discourageImplicitSignal.set(payload.discourageImplicitMeasures);
    }
    if (payload.rsdl !== undefined) {
      this.backendRsdlSignal.set(payload.rsdl);
    }
    if (payload.dagValidation) {
      this.dagValidationSignal.set(payload.dagValidation);
      this.dagDiagnosticsSignal.set(payload.dagValidation.diagnostics ?? []);
    }
    this.recordSync(payload);
    if (!payload.tables?.length) {
      return;
    }

    this.pullState(payload, this.state);

    const existingPositions = new Map(
      this.tablesSignal().map((t) => [t.name, t.position]),
    );
    const mappedTables = this.mapTables(payload.tables, existingPositions);
    this.tablesSignal.set(mappedTables);

    const mappedRels = this.mapRelationships(payload.relationships ?? []);
    this.relationshipsSignal.set(mappedRels);

    const targetRelName = preferredRelName ?? this.selectedRelSignal().name;
    const selected =
      mappedRels.find((r) => r.name === targetRelName) ??
      mappedRels[0] ??
      EMPTY_MODEL_RELATIONSHIP;
    this.selectedRelSignal.set(selected);

    if (autoInfer && mappedRels.length === 0 && mappedTables.length > 1) {
      this.inferRelationships().subscribe();
    } else if (payload.rsdl === undefined) {
      this.evaluateModel().subscribe();
    }
  }

  public applyMutation(
    result: ModelMutationResult,
    preferredRelName?: string,
  ): void {
    if (!result?.schema) {
      return;
    }
    this.recordSync(result.schema);
    this.lastErrorSignal.set(null);
    this.backendRsdlSignal.set(result.rsdl ?? "");
    this.dagValidationSignal.set(result.dagValidation ?? null);
    this.dagDiagnosticsSignal.set(result.dagValidation?.diagnostics ?? []);
    this.applyPayload(
      {
        ...result.schema,
        rsdl: result.rsdl,
        dagValidation: result.dagValidation,
      },
      preferredRelName,
    );
  }

  public inferRelationships(): Observable<RelationshipInferenceResponse | null> {
    const request: RelationshipInferenceRequest = {
      tables: this.buildPayload(this.toPayload()).tables,
    };
    return this.http
      .post<RelationshipInferenceResponse>(MODELS_INFER_ENDPOINT, request)
      .pipe(
        switchMap((res) => {
          this.lastErrorSignal.set(null);
          const suggestions =
            res?.suggestedDateColumns ?? res?.dateColumnsByTable ?? {};
          this.suggestedDatesSignal.set(suggestions);

          const mappedRels = this.mapRelationships(res?.relationships ?? []);
          this.relationshipsSignal.set(mappedRels);
          this.selectedRelSignal.set(mappedRels[0] ?? EMPTY_MODEL_RELATIONSHIP);

          if (Object.keys(suggestions).length > 0) {
            this.tablesSignal.update((list) =>
              list.map((tbl) =>
                !tbl.dateColumn && suggestions[tbl.name]
                  ? { ...tbl, dateColumn: suggestions[tbl.name] }
                  : tbl,
              ),
            );
          }

          return this.save(this.toPayload()).pipe(map(() => res));
        }),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public fetchRsdl(
    modelId: string = this.modelIdSignal(),
  ): Observable<string> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/rsdl`;
    return this.http.get(url, { responseType: "text" }).pipe(
      tap((rsdl) => {
        this.backendRsdlSignal.set(rsdl ?? "");
      }),
      catchError(() =>
        this.evaluateModel().pipe(map((res) => res?.rsdl ?? "")),
      ),
    );
  }

  public evaluateModel(): Observable<ModelMutationResult | null> {
    if (this.tablesSignal().length === 0) {
      return of(null);
    }
    const payload = this.buildPayload(this.toPayload());
    return this.http
      .post<ModelMutationResult>(MODELS_RSDL_ENDPOINT, payload)
      .pipe(
        tap((res) => {
          this.lastErrorSignal.set(null);
          if (res?.rsdl !== undefined) {
            this.backendRsdlSignal.set(res.rsdl);
          }
          if (res?.dagValidation) {
            this.dagValidationSignal.set(res.dagValidation);
            this.dagDiagnosticsSignal.set(res.dagValidation.diagnostics ?? []);
          }
        }),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public validateDag(): Observable<readonly DagDiagnosticMarker[]> {
    if (this.tablesSignal().length === 0) {
      this.dagDiagnosticsSignal.set([]);
      return of([]);
    }
    return this.evaluateModel().pipe(
      map((res) => res?.dagValidation?.diagnostics ?? this.dagDiagnosticsSignal()),
    );
  }

  public createRelationship(
    fromTable: string,
    fromCol: string,
    toTable: string,
    toCol: string,
    cardinality = "ManyToOne",
    crossFilter = "Single",
    isActive?: boolean,
  ): Observable<ModelMutationResult | null> {
    const relName = `${fromTable}_${fromCol}_to_${toTable}_${toCol}`;
    const pairHasActive = this.relationshipsSignal().some(
      (r) =>
        r.isActive !== false &&
        ((r.fromTable.toLowerCase() === fromTable.toLowerCase() &&
          r.toTable.toLowerCase() === toTable.toLowerCase()) ||
          (r.fromTable.toLowerCase() === toTable.toLowerCase() &&
            r.toTable.toLowerCase() === fromTable.toLowerCase())),
    );
    const body: SemanticModelRelationship = {
      name: relName,
      fromTable,
      fromColumn: fromCol,
      toTable,
      toColumn: toCol,
      cardinality: this.toCardinality(cardinality),
      crossFilterDirection: this.toCrossFilter(crossFilter),
      isActive: isActive ?? !pairHasActive,
      bridgeTable: null,
    };
    return this.http
      .post<ModelMutationResult>(`${this.modelUrl()}/relationships`, body)
      .pipe(
        tap((res) => this.applyMutation(res, relName)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public updateRelationship(
    existingName: string,
    rel: ModelRelationship,
  ): Observable<ModelMutationResult | null> {
    const body: SemanticModelRelationship = {
      name: rel.name,
      fromTable: rel.fromTable,
      fromColumn: rel.fromCol,
      toTable: rel.toTable,
      toColumn: rel.toCol,
      cardinality: this.toCardinality(rel.cardinality),
      crossFilterDirection: this.toCrossFilter(rel.crossFilter),
      isActive: rel.isActive !== false,
      bridgeTable: rel.bridgeTable ?? null,
    };
    return this.http
      .put<ModelMutationResult>(
        `${this.modelUrl()}/relationships/${encodeURIComponent(existingName)}`,
        body,
      )
      .pipe(
        tap((res) => this.applyMutation(res, rel.name)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public deleteRelationship(
    relName = this.selectedRelSignal().name,
  ): Observable<ModelMutationResult | null> {
    if (!relName) {
      return of(null);
    }
    return this.http
      .delete<ModelMutationResult>(
        `${this.modelUrl()}/relationships/${encodeURIComponent(relName)}`,
      )
      .pipe(
        tap((res) => this.applyMutation(res)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public toggleActive(
    relName = this.selectedRelSignal().name,
  ): Observable<ModelMutationResult | null> {
    if (!relName) {
      return of(null);
    }
    return this.http
      .patch<ModelMutationResult>(
        `${this.modelUrl()}/relationships/${encodeURIComponent(relName)}/active`,
        {},
      )
      .pipe(
        tap((res) => this.applyMutation(res, relName)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public updateRouting(
    cardinality: string,
    crossFilter: string,
    relName = this.selectedRelSignal().name,
  ): Observable<ModelMutationResult | null> {
    if (!relName) {
      return of(null);
    }
    const body: RelationshipRoutingRequest = {
      cardinality: this.toCardinality(cardinality),
      crossFilterDirection: this.toCrossFilter(crossFilter),
    };
    return this.http
      .patch<ModelMutationResult>(
        `${this.modelUrl()}/relationships/${encodeURIComponent(relName)}/routing`,
        body,
      )
      .pipe(
        tap((res) => this.applyMutation(res, relName)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public updateCardinality(
    cardinality: string,
  ): Observable<ModelMutationResult | null> {
    const current = this.selectedRelSignal();
    return this.updateRouting(cardinality, current.crossFilter, current.name);
  }

  public updateFilter(
    crossFilter: string,
  ): Observable<ModelMutationResult | null> {
    const current = this.selectedRelSignal();
    return this.updateRouting(current.cardinality, crossFilter, current.name);
  }

  public toggleKey(
    tableName: string | undefined,
    colName: string | undefined,
  ): Observable<ModelMutationResult | null> {
    if (!tableName || !colName) {
      return of(null);
    }
    const body: ColumnTargetRequest = { tableName, columnName: colName };
    return this.http
      .post<ModelMutationResult>(`${this.modelUrl()}/primary-key`, body)
      .pipe(
        tap((res) => this.applyMutation(res)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public hideKeys(): Observable<ModelMutationResult | null> {
    return this.http
      .post<ModelMutationResult>(`${this.modelUrl()}/hide-foreign-keys`, {})
      .pipe(
        tap((res) => this.applyMutation(res)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public markDate(
    tableName: string | undefined,
    isDateTable: boolean,
    explicitDateColumn?: string,
  ): Observable<ModelMutationResult | null> {
    if (!tableName) {
      return of(null);
    }
    const body: DateTableRequest = {
      tableName,
      dateTable: isDateTable,
      ...(explicitDateColumn ? { dateColumn: explicitDateColumn } : {}),
    };
    return this.ensureTable(tableName).pipe(
      switchMap(() =>
        this.http.post<ModelMutationResult>(dateUrl(this.modelIdSignal()), body),
      ),
      tap((res) => this.applyMutation(res)),
      catchError((err: unknown) => {
        this.handleProblem(err);
        return of(null);
      }),
    );
  }

  public setDateCol(
    tableName: string | undefined,
    dateColumn: string,
  ): Observable<ModelMutationResult | null> {
    return this.markDate(tableName, true, dateColumn);
  }

  public toggleImplicit(): Observable<ModelMutationResult | null> {
    return this.http
      .post<ModelMutationResult>(
        `${this.modelUrl()}/discourage-implicit-measures`,
        {},
      )
      .pipe(
        tap((res) => this.applyMutation(res)),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of(null);
        }),
      );
  }

  public patchColumn(
    patch: ColumnMetadataPatchRequest,
  ): Observable<ModelMutationResult | null> {
    const targetModelId = patch.modelId ?? this.modelIdSignal();
    const url = columnUrl(targetModelId, patch.tableName, patch.columnName);
    const body = {
      dataType: patch.dataType,
      summarizeBy: patch.summarizeBy,
      /** Empty string clears custom sort on backend; omitted/null leaves it unchanged. */
      sortByColumn:
        patch.sortByColumn === null ? "" : patch.sortByColumn,
      isHidden: patch.isHidden,
      format: patch.format,
    };
    return this.ensureTable(patch.tableName, targetModelId).pipe(
      switchMap(() => this.http.patch<ModelMutationResult>(url, body)),
      tap((res) => this.applyMutation(res)),
      catchError((err: unknown) => {
        this.handleProblem(err);
        return of(null);
      }),
    );
  }

  public toggleColumn(
    tableName: string | undefined,
    colName: string | undefined,
  ): Observable<ModelMutationResult | null> {
    if (!tableName || !colName) {
      return of(null);
    }
    const tbl = this.tablesSignal().find((t) => t.name === tableName);
    const col = tbl?.columns.find((c) => c.name === colName);
    if (!col) {
      return of(null);
    }
    return this.patchColumn({
      tableName,
      columnName: colName,
      isHidden: !col.isHidden,
    });
  }

  public setSummary(
    tableName: string | undefined,
    colName: string | undefined,
    summarizeBy: string,
  ): Observable<ModelMutationResult | null> {
    if (!tableName || !colName) {
      return of(null);
    }
    return this.patchColumn({
      tableName,
      columnName: colName,
      summarizeBy,
    });
  }

  public setSortBy(
    tableName: string | undefined,
    colName: string | undefined,
    sortByColumn: string,
  ): Observable<ModelMutationResult | null> {
    if (!tableName || !colName) {
      return of(null);
    }
    return this.patchColumn({
      tableName,
      columnName: colName,
      sortByColumn,
    });
  }

  public setRole(
    tableName: string | undefined,
    role: "FACT" | "DIMENSION",
  ): Observable<ModelMutationResult | null> {
    if (!tableName) {
      return of(null);
    }
    const nextPayload: SemanticModelApiPayload = {
      ...this.toPayload(),
      tables: (this.toPayload().tables ?? []).map((tbl) =>
        tbl.name === tableName ? { ...tbl, role } : tbl,
      ),
    };
    return this.save(nextPayload);
  }

  public toggleTable(
    tableName: string | undefined,
  ): Observable<ModelMutationResult | null> {
    if (!tableName) {
      return of(null);
    }
    const nextPayload: SemanticModelApiPayload = {
      ...this.toPayload(),
      tables: (this.toPayload().tables ?? []).map((tbl) =>
        tbl.name === tableName ? { ...tbl, isHidden: !tbl.isHidden } : tbl,
      ),
    };
    return this.save(nextPayload);
  }

  public setTableDesc(
    tableName: string | undefined,
    description: string,
  ): Observable<ModelMutationResult | null> {
    if (!tableName) {
      return of(null);
    }
    const nextPayload: SemanticModelApiPayload = {
      ...this.toPayload(),
      tables: (this.toPayload().tables ?? []).map((tbl) =>
        tbl.name === tableName ? { ...tbl, description } : tbl,
      ),
    };
    return this.save(nextPayload);
  }

  public setFolder(
    tableName: string | undefined,
    colName: string | undefined,
    displayFolder: string,
  ): Observable<ModelMutationResult | null> {
    if (!tableName || !colName) {
      return of(null);
    }
    const nextPayload: SemanticModelApiPayload = {
      ...this.toPayload(),
      tables: (this.toPayload().tables ?? []).map((tbl) =>
        tbl.name === tableName
          ? {
              ...tbl,
              columns: tbl.columns.map((c) =>
                c.name === colName ? { ...c, displayFolder } : c,
              ),
            }
          : tbl,
      ),
    };
    return this.save(nextPayload);
  }

  public setColDesc(
    tableName: string | undefined,
    colName: string | undefined,
    description: string,
  ): Observable<ModelMutationResult | null> {
    if (!tableName || !colName) {
      return of(null);
    }
    const nextPayload: SemanticModelApiPayload = {
      ...this.toPayload(),
      tables: (this.toPayload().tables ?? []).map((tbl) =>
        tbl.name === tableName
          ? {
              ...tbl,
              columns: tbl.columns.map((c) =>
                c.name === colName ? { ...c, description } : c,
              ),
            }
          : tbl,
      ),
    };
    return this.save(nextPayload);
  }

  public toPayload(): SemanticModelApiPayload {
    return {
      modelId: this.modelIdSignal(),
      name:
        this.state.activeProject().filename.replace(/\.rcp$/, "") ||
        DEFAULT_MODEL_NAME,
      fiscalYearStartMonth: 1,
      discourageImplicitMeasures: this.discourageImplicitSignal(),
      tables: this.tablesSignal().map((tbl): SemanticModelTable => ({
        name: tbl.name,
        role: tbl.role,
        partitionColumn: tbl.dateColumn || "",
        estimatedRows: 100,
        scdType2: false,
        description: tbl.description || "",
        isHidden: Boolean(tbl.isHidden),
        isDateTable: Boolean(tbl.isDateTable),
        dateColumn: tbl.dateColumn || "",
        columns: tbl.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: Boolean(c.isPrimaryKey),
          isForeignKey: Boolean(c.isForeignKey),
          isHidden: Boolean(c.isHidden),
          description: c.description || "",
          displayFolder: c.displayFolder || "",
          summarizeBy: c.summarizeBy || "default",
          expression: c.expression || "",
          sortByColumn: c.sortByColumn || "",
          format: c.format || "",
        })),
      })),
      relationships: this.relationshipsSignal().map(
        (r): SemanticModelRelationship => ({
          name: r.name,
          fromTable: r.fromTable,
          fromColumn: r.fromCol,
          toTable: r.toTable,
          toColumn: r.toCol,
          cardinality: this.toCardinality(r.cardinality),
          crossFilterDirection: this.toCrossFilter(r.crossFilter),
          isActive: r.isActive !== false,
          bridgeTable: r.bridgeTable ?? null,
          description: r.description,
        }),
      ),
      measures: this.state.measures.map((m) => ({
        id: m.id,
        label: m.label,
        name: m.label,
        table: m.table,
        tableName: m.table,
        formula: m.formula,
        raxExpression: m.formula,
      })),
      rlsRolePredicates: {},
    };
  }

  public persistModel(): void {
    if (this.tablesSignal().length === 0) {
      return;
    }
    this.save(this.toPayload()).subscribe();
  }

  public loadDefault(): Observable<SemanticModelApiPayload> {
    return this.http
      .get<SemanticModelApiPayload>(MODELS_DEFAULT_ENDPOINT)
      .pipe(
        tap((payload) => this.recordSync(payload)),
        map((payload) => this.stripDemo(payload)),
        catchError((err: unknown) => {
          console.warn("[SemanticModelService] Failed to load default model:", err);
          return of(DEFAULT_SEMANTIC_MODEL);
        }),
      );
  }

  public fetchModel(modelName: string): Observable<SemanticModelApiPayload> {
    return this.http
      .get<SemanticModelApiPayload>(
        `${MODELS_ENDPOINT}/${encodeURIComponent(modelName)}`,
      )
      .pipe(
        tap((payload) => this.recordSync(payload)),
        map((payload) => this.stripDemo(payload)),
        catchError((err: unknown) => {
          console.warn("[SemanticModelService] Failed to fetch model:", err);
          return of(DEFAULT_SEMANTIC_MODEL);
        }),
      );
  }

  public validate(
    model: SemanticModelApiPayload,
  ): Observable<DagValidationResponse> {
    const payload = this.buildPayload(model);
    return this.http
      .post<DagValidationResponse>(MODELS_VALIDATE_DAG_ENDPOINT, payload)
      .pipe(
        tap((report) => {
          this.dagValidationSignal.set(report);
          this.dagDiagnosticsSignal.set(report.diagnostics ?? []);
        }),
        catchError((err: unknown) => {
          this.handleProblem(err);
          return of({
            valid: false,
            diagnostics: [],
          });
        }),
      );
  }

  public save(
    model: SemanticModelApiPayload,
  ): Observable<ModelMutationResult | null> {
    const payload = this.buildPayload(model);
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(payload.modelId)}`;
    return this.http.put<ModelMutationResult>(url, payload).pipe(
      tap((res) => {
        if (res?.schema) {
          this.applyMutation(res);
        }
      }),
      catchError((err: unknown) => {
        this.handleProblem(err);
        return of(null);
      }),
    );
  }

  public ingestRows(
    tableName: string,
    rows: readonly Record<string, unknown>[],
    modelId: string = this.modelIdSignal(),
  ): Observable<{ modelId: string; tableName: string; rowsIngested: number }> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/rows`;
    return this.http
      .post<{ modelId: string; tableName: string; rowsIngested: number }>(
        url,
        rows,
      )
      .pipe(
        catchError((err: unknown) => {
          console.warn(
            `[SemanticModelService] Failed to ingest rows for ${tableName}:`,
            err,
          );
          return of({ modelId, tableName, rowsIngested: rows.length });
        }),
      );
  }

  public fetchRows(
    tableName: string,
    modelId: string = this.modelIdSignal(),
  ): Observable<Array<Record<string, unknown>>> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/rows`;
    return this.http.get<Array<Record<string, unknown>>>(url).pipe(
      catchError((err: unknown) => {
        console.warn(
          `[SemanticModelService] Failed to fetch rows for ${tableName}:`,
          err,
        );
        return of([]);
      }),
    );
  }

  public fetchDictionary(
    modelId: string = this.modelIdSignal(),
  ): Observable<Array<Record<string, unknown>>> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/dictionary`;
    return this.http.get<Array<Record<string, unknown>>>(url).pipe(
      catchError((err: unknown) => {
        console.warn("[SemanticModelService] Failed to fetch dictionary:", err);
        return of([]);
      }),
    );
  }

  public pushState(
    state: StateManagerService,
    modelId: string = this.modelIdSignal(),
  ): Observable<ModelMutationResult | null> {
    const payload: SemanticModelApiPayload = {
      modelId,
      name:
        state.activeProject().filename.replace(/\.rcp$/, "") ||
        DEFAULT_MODEL_NAME,
      fiscalYearStartMonth: 1,
      discourageImplicitMeasures: this.discourageImplicitSignal(),
      tables: state.sharedTables.map((t) => ({
        name: t.name,
        role: t.role,
        partitionColumn: t.dateColumn || "",
        estimatedRows: t.rowCount ?? state.tableRows(t.name).length,
        scdType2: false,
        description: t.description || "",
        isHidden: Boolean(t.isHidden),
        isDateTable: Boolean(t.isDateTable),
        dateColumn: t.dateColumn || "",
        columns: t.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.keyType === "PK",
          isForeignKey: c.keyType === "FK",
          isHidden: Boolean(c.isHidden),
          description: c.description || "",
          displayFolder: c.displayFolder || "",
          summarizeBy: c.summarizeBy || "default",
          expression: c.expression || "",
          sortByColumn: c.sortByColumn || "",
          format: c.format || "",
        })),
      })),
      relationships: this.toPayload().relationships ?? [],
      measures: state.measures.map((m) => ({
        id: m.id,
        label: m.label,
        name: m.label,
        table: m.table,
        tableName: m.table,
        formula: m.formula,
        raxExpression: m.formula,
        formatString: m.formatString || "",
        description: m.description || "",
      })),
      rlsRolePredicates: {},
    };
    return this.save(payload);
  }

  public buildPayload(
    model: SemanticModelApiPayload,
  ): BackendSemanticModelPayload {
    return {
      modelId: model.modelId || this.modelIdSignal() || DEFAULT_MODEL_ID,
      name: model.name || LEGACY_MODEL_NAME,
      fiscalYearStartMonth: model.fiscalYearStartMonth || 1,
      discourageImplicitMeasures: Boolean(model.discourageImplicitMeasures),
      tables: (model.tables || []).map((t) => ({
        name: t.name,
        role: t.role,
        partitionColumn: t.partitionColumn || "",
        estimatedRows: t.estimatedRows || 0,
        scdType2: Boolean(t.scdType2),
        description: t.description || "",
        isHidden: Boolean(t.isHidden),
        isDateTable: Boolean(t.isDateTable),
        dateColumn: t.dateColumn || "",
        columns: (t.columns || []).map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: Boolean(c.isPrimaryKey),
          isForeignKey: Boolean(c.isForeignKey),
          isHidden: Boolean(c.isHidden),
          piiClassification: c.piiClassification || null,
          description: c.description || "",
          displayFolder: c.displayFolder || "",
          summarizeBy: c.summarizeBy || "default",
          expression: c.expression || "",
          sortByColumn: c.sortByColumn || "",
          format: c.format || "",
        })),
      })),
      relationships: (model.relationships || []).map((r) => ({
        name: r.name,
        fromTable: r.fromTable,
        fromColumn: r.fromColumn,
        toTable: r.toTable,
        toColumn: r.toColumn,
        cardinality: this.toCardinality(r.cardinality),
        crossFilterDirection: this.toCrossFilter(r.crossFilterDirection),
        isActive: r.isActive !== false,
        bridgeTable: r.bridgeTable || null,
      })),
      measures: (model.measures || []).map((m) => ({
        id: m.id,
        name: m.name || m.label || m.id,
        tableName: m.tableName || m.table || "",
        raxExpression: m.raxExpression || m.formula || "",
        formatString: m.formatString || "",
        description: m.description || "",
      })),
      rlsRolePredicates: model.rlsRolePredicates || {},
    };
  }

  public pullState(
    payload: SemanticModelApiPayload,
    state: StateManagerService,
  ): void {
    if (payload?.tables?.length) {
      const existingByName = new Map(
        state.sharedTables.map((tbl) => [tbl.name.toLowerCase(), tbl]),
      );
      const sharedTables: SharedTable[] = payload.tables.map((t, idx) => {
        const existingTbl = existingByName.get(t.name.toLowerCase());
        const existingCols = new Map<string, SharedColumn>(
          (existingTbl?.columns ?? []).map((col) => [
            col.name.toLowerCase(),
            col,
          ]),
        );
        return {
          id: existingTbl?.id ?? `tbl-${idx}-${t.name}`,
          name: t.name,
          role: t.role,
          description: t.description || "",
          isHidden: Boolean(t.isHidden),
          isDateTable: Boolean(t.isDateTable),
          dateColumn: t.dateColumn || "",
          ...(existingTbl?.expression
            ? { expression: existingTbl.expression }
            : {}),
          columns: (t.columns || []).map((c) => {
            const prevCol = existingCols.get(c.name.toLowerCase());
            const expr = c.expression || prevCol?.expression;
            const fmt = this.parseFormat(c.format);
            return {
              name: c.name,
              dataType: c.dataType,
              keyType: c.isPrimaryKey ? "PK" : c.isForeignKey ? "FK" : "None",
              description: c.description || "",
              isHidden: Boolean(c.isHidden),
              displayFolder: c.displayFolder || "",
              summarizeBy: this.toSharedSummary(c.summarizeBy),
              ...(expr ? { expression: expr } : {}),
              sortByColumn: c.sortByColumn || undefined,
              ...(fmt ? { format: fmt } : {}),
            };
          }),
          rowCount: t.estimatedRows ?? existingTbl?.rowCount ?? 10,
        };
      });
      state.syncTables(sharedTables);
    }
    if (payload?.measures?.length) {
      for (const m of payload.measures) {
        state.saveMeasure({
          id: m.id,
          label: m.label || m.name || m.id,
          formula: m.formula || m.raxExpression || "",
          table: m.table || m.tableName || "",
          description: m.description || "",
          formatString: m.formatString || "",
        });
      }
    }
  }

  private modelUrl(): string {
    return `${MODELS_ENDPOINT}/${encodeURIComponent(this.modelIdSignal())}`;
  }

  private mapTables(
    tables: readonly SemanticModelTable[],
    preservedPositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  ): ModelTable[] {
    return layoutTables(
      tables.map((tbl) => ({
        name: tbl.name,
        role: tbl.role,
        isHidden: Boolean(tbl.isHidden),
        isDateTable: Boolean(tbl.isDateTable),
        dateColumn: tbl.dateColumn || "",
        description: tbl.description || "",
        columns: tbl.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: Boolean(c.isPrimaryKey),
          isForeignKey: Boolean(c.isForeignKey),
          isHidden: Boolean(c.isHidden),
          description: c.description || "",
          displayFolder: c.displayFolder || "",
          summarizeBy: c.summarizeBy || "default",
          expression: c.expression || "",
          sortByColumn: c.sortByColumn || "",
          format: c.format || "",
        })),
      })),
      this.layoutModeSignal(),
      preservedPositions,
    );
  }

  private mapRelationships(
    rels: readonly SemanticModelRelationship[],
  ): ModelRelationship[] {
    return rels.map((r) => ({
      name: r.name,
      fromTable: r.fromTable,
      fromCol: r.fromColumn,
      toTable: r.toTable,
      toCol: r.toColumn,
      cardinality:
        r.cardinality === "ONE_TO_ONE" || r.cardinality === "OneToOne"
          ? "OneToOne"
          : r.cardinality === "MANY_TO_MANY" || r.cardinality === "ManyToMany"
            ? "ManyToMany"
            : "ManyToOne",
      crossFilter:
        r.crossFilterDirection === "BOTH" || r.crossFilterDirection === "Both"
          ? "Both"
          : "Single",
      isActive: r.isActive !== false,
      bridgeTable: r.bridgeTable ?? undefined,
      description: r.description,
    }));
  }

  private toCardinality(value: string): BackendCardinality {
    if (value === "OneToOne" || value === "ONE_TO_ONE") {
      return "ONE_TO_ONE";
    }
    if (value === "ManyToMany" || value === "MANY_TO_MANY") {
      return "MANY_TO_MANY";
    }
    return "MANY_TO_ONE";
  }

  private toCrossFilter(value: string): BackendCrossFilter {
    return value === "Both" || value === "BOTH" ? "BOTH" : "SINGLE";
  }

  private toSharedSummary(
    value: string | undefined,
  ):
    | "None"
    | "Sum"
    | "Average"
    | "Min"
    | "Max"
    | "Count"
    | "DistinctCount"
    | undefined {
    switch ((value || "").toLowerCase()) {
      case "none":
        return "None";
      case "sum":
        return "Sum";
      case "average":
        return "Average";
      case "min":
        return "Min";
      case "max":
        return "Max";
      case "count":
        return "Count";
      case "distinctcount":
        return "DistinctCount";
      default:
        return undefined;
    }
  }

  private recordSync(payload: SemanticModelApiPayload | null | undefined): void {
    if (!payload) {
      return;
    }
    this.backendSynced = true;
    if (payload.modelId) {
      this.modelIdSignal.set(payload.modelId);
    }
    this.syncedTables.clear();
    for (const tbl of payload.tables ?? []) {
      if (tbl.name) {
        this.syncedTables.add(tbl.name.toLowerCase());
      }
    }
  }

  private needsSync(tableName: string): boolean {
    const key = tableName.trim().toLowerCase();
    if (!key || this.syncedTables.has(key)) {
      return false;
    }
    const inShared = this.state.sharedTables.some(
      (tbl) => tbl.name.toLowerCase() === key,
    );
    return inShared && (this.backendSynced || this.tablesSignal().length > 0);
  }

  private parseFormat(
    value: string | undefined,
  ): ColumnDisplayFormat | undefined {
    switch ((value ?? "").trim()) {
      case "General":
      case "Currency":
      case "Percentage":
      case "Date":
      case "WholeNumber":
      case "Decimal":
        return value!.trim() as ColumnDisplayFormat;
      default:
        return undefined;
    }
  }

  private handleProblem(err: unknown): void {
    const problem = this.extractProblem(err);
    console.warn("[SemanticModelService] Backend request failed:", problem, err);
    this.lastErrorSignal.set(problem);
    if (problem.detail) {
      const prefix = problem.errorCode ? `[${problem.errorCode}] ` : "";
      this.state.announce(`${prefix}${problem.detail}`, {
        error: true,
        safe: true,
      });
    }
  }

  private extractProblem(err: unknown): ProblemDetail {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        return {
          title:
            typeof record["title"] === "string"
              ? record["title"]
              : err.statusText || "Request Error",
          status:
            typeof record["status"] === "number"
              ? record["status"]
              : err.status,
          detail:
            typeof record["detail"] === "string"
              ? record["detail"]
              : err.message || "Semantic model operation failed.",
          errorCode:
            typeof record["errorCode"] === "string"
              ? record["errorCode"]
              : undefined,
          timestamp:
            typeof record["timestamp"] === "string"
              ? record["timestamp"]
              : undefined,
        };
      }
      if (typeof body === "string" && body.trim()) {
        return {
          title: err.statusText || "Request Error",
          status: err.status,
          detail: body.trim(),
        };
      }
      return {
        title: err.statusText || "Request Error",
        status: err.status,
        detail: err.message || "Semantic model operation failed.",
      };
    }
    if (err instanceof Error) {
      return { title: "Error", detail: err.message };
    }
    return { title: "Error", detail: "Semantic model operation failed." };
  }

  private stripDemo(payload: SemanticModelApiPayload): SemanticModelApiPayload {
    if (!payload) {
      return DEFAULT_SEMANTIC_MODEL;
    }
    const isLegacyDemo =
      payload.name === LEGACY_MODEL_NAME &&
      (payload.tables ?? []).every((t) => LEGACY_DEMO_TABLES.has(t.name));
    if (isLegacyDemo) {
      return DEFAULT_SEMANTIC_MODEL;
    }
    return payload;
  }
}
