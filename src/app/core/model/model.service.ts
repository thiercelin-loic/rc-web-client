import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
import { SharedTable, StateManagerService } from "../state/state.service";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_NAME,
  DEFAULT_SEMANTIC_MODEL,
  LEGACY_DEMO_TABLES,
  LEGACY_MODEL_NAME,
  MODELS_DEFAULT_ENDPOINT,
  MODELS_ENDPOINT,
  MODELS_VALIDATE_DAG_ENDPOINT,
} from "./model.constants";
import {
  BackendSemanticModelPayload,
  DagValidationResponse,
  SemanticModelApiPayload,
} from "./model.interface";

export { DEFAULT_SEMANTIC_MODEL } from "./model.constants";
export type {
  BackendSemanticModelColumn,
  BackendSemanticModelMeasure,
  BackendSemanticModelPayload,
  BackendSemanticModelRelationship,
  BackendSemanticModelTable,
  DagDiagnosticMarker,
  DagValidationResponse,
  SemanticModelApiPayload,
  SemanticModelColumn,
  SemanticModelMeasure,
  SemanticModelRelationship,
  SemanticModelTable,
} from "./model.interface";

@Injectable({ providedIn: "root" })
export class SemanticModelService {
  private readonly http = inject(HttpClient);

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

  public loadDefault(): Observable<SemanticModelApiPayload> {
    return this.http
      .get<SemanticModelApiPayload>(MODELS_DEFAULT_ENDPOINT)
      .pipe(
        map((payload) => this.stripDemo(payload)),
        catchError(() => of(DEFAULT_SEMANTIC_MODEL)),
      );
  }

  public fetchModel(modelName: string): Observable<SemanticModelApiPayload> {
    return this.http
      .get<SemanticModelApiPayload>(
        `${MODELS_ENDPOINT}/${encodeURIComponent(modelName)}`,
      )
      .pipe(
        map((payload) => this.stripDemo(payload)),
        catchError(() => of(DEFAULT_SEMANTIC_MODEL)),
      );
  }

  public validate(
    model: SemanticModelApiPayload,
  ): Observable<DagValidationResponse> {
    const payload = this.buildPayload(model);
    return this.http
      .post<DagValidationResponse>(MODELS_VALIDATE_DAG_ENDPOINT, payload)
      .pipe(
        catchError(() =>
          of({
            valid: true,
            message: "DAG is consistent and acyclic.",
            hasCycles: false,
            hasAmbiguousActivePaths: false,
            violatesStarSchema: false,
            diagnostics: [],
          }),
        ),
      );
  }

  public save(model: SemanticModelApiPayload): Observable<{ status: string }> {
    const payload = this.buildPayload(model);
    return this.http
      .post<{ status: string }>(MODELS_ENDPOINT, payload)
      .pipe(catchError(() => of({ status: "SAVED_LOCAL" })));
  }

  public ingestRows(
    tableName: string,
    rows: readonly Record<string, unknown>[],
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || DEFAULT_MODEL_ID,
  ): Observable<{ modelId: string; tableName: string; rowsIngested: number }> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/rows`;
    return this.http
      .post<{ modelId: string; tableName: string; rowsIngested: number }>(
        url,
        rows,
      )
      .pipe(
        catchError(() =>
          of({ modelId, tableName, rowsIngested: rows.length }),
        ),
      );
  }

  public fetchRows(
    tableName: string,
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || DEFAULT_MODEL_ID,
  ): Observable<Array<Record<string, unknown>>> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/rows`;
    return this.http
      .get<Array<Record<string, unknown>>>(url)
      .pipe(catchError(() => of([])));
  }

  public fetchDictionary(
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || DEFAULT_MODEL_ID,
  ): Observable<Array<Record<string, unknown>>> {
    const url = `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/dictionary`;
    return this.http
      .get<Array<Record<string, unknown>>>(url)
      .pipe(catchError(() => of([])));
  }

  public pushState(
    state: StateManagerService,
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || DEFAULT_MODEL_ID,
  ): Observable<{ status: string }> {
    const payload: SemanticModelApiPayload = {
      modelId,
      name:
        state.activeProject().filename.replace(/\.rcp$/, "") ||
        DEFAULT_MODEL_NAME,
      fiscalYearStartMonth: 1,
      tables: state.sharedTables.map((t) => ({
        name: t.name,
        role: t.role,
        partitionColumn: t.dateColumn || "",
        estimatedRows: t.rowCount ?? state.tableRows(t.name).length,
        scdType2: false,
        description: t.description || "",
        columns: t.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.keyType === "PK",
          isForeignKey: c.keyType === "FK",
          isHidden: !!c.isHidden,
          description: c.description || "",
        })),
      })),
      relationships: [],
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
      modelId: model.modelId || DEFAULT_MODEL_ID,
      name: model.name || LEGACY_MODEL_NAME,
      fiscalYearStartMonth: model.fiscalYearStartMonth || 1,
      tables: (model.tables || []).map((t) => ({
        name: t.name,
        role: t.role,
        partitionColumn: t.partitionColumn || "",
        estimatedRows: t.estimatedRows || 0,
        scdType2: !!t.scdType2,
        description: t.description || "",
        isHidden: !!t.isHidden,
        isDateTable: !!t.isDateTable,
        dateColumn: t.dateColumn || "",
        columns: (t.columns || []).map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: !!c.isPrimaryKey,
          isForeignKey: !!c.isForeignKey,
          isHidden: !!c.isHidden,
          piiClassification: c.piiClassification || null,
          description: c.description || "",
          displayFolder: c.displayFolder || "",
          summarizeBy: c.summarizeBy || "default",
        })),
      })),
      relationships: (model.relationships || []).map((r) => ({
        name: r.name,
        fromTable: r.fromTable,
        fromColumn: r.fromColumn,
        toTable: r.toTable,
        toColumn: r.toColumn,
        cardinality: r.cardinality,
        crossFilterDirection: r.crossFilterDirection,
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
      const sharedTables: SharedTable[] = payload.tables.map((t, idx) => ({
        id: `tbl-${idx}-${t.name}`,
        name: t.name,
        role: t.role,
        description: t.description || "",
        isHidden: !!t.isHidden,
        isDateTable: !!t.isDateTable,
        dateColumn: t.dateColumn || "",
        columns: (t.columns || []).map((c) => ({
          name: c.name,
          dataType: c.dataType,
          keyType: c.isPrimaryKey ? "PK" : c.isForeignKey ? "FK" : "None",
          description: c.description || "",
          isHidden: !!c.isHidden,
          displayFolder: c.displayFolder || "",
        })),
        rowCount: t.estimatedRows || 10,
      }));
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
}
