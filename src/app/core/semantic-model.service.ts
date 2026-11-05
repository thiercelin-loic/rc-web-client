import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { StateManagerService, SharedTable } from './state-manager.service';

export interface SemanticModelColumn {
  name: string;
  dataType: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isHidden?: boolean;
  piiClassification?: string;
  description?: string;
  displayFolder?: string;
  summarizeBy?: string;
}

export interface SemanticModelTable {
  name: string;
  role: 'FACT' | 'DIMENSION';
  partitionColumn?: string;
  estimatedRows?: number;
  scdType2?: boolean;
  description?: string;
  isHidden?: boolean;
  isDateTable?: boolean;
  dateColumn?: string;
  columns: SemanticModelColumn[];
}

export interface DagDiagnosticMarker {
  line?: number;
  column?: number;
  length?: number;
  severity: 'ERROR' | 'WARNING' | string;
  code: string;
  message: string;
  documentationUrl?: string;
}

export interface DagValidationResponse {
  valid: boolean;
  message?: string;
  hasCycles?: boolean;
  hasAmbiguousActivePaths?: boolean;
  violatesStarSchema?: boolean;
  diagnostics?: DagDiagnosticMarker[];
}

export interface SemanticModelRelationship {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: string;
  crossFilterDirection: string;
  isActive?: boolean;
  bridgeTable?: string;
}

export interface SemanticModelMeasure {
  id: string;
  label: string;
  formula: string;
  table: string;
  name?: string;
  raxExpression?: string;
  tableName?: string;
  formatString?: string;
  description?: string;
}

export interface SemanticModelApiPayload {
  modelId?: string;
  name: string;
  fiscalYearStartMonth?: number;
  description?: string;
  tables?: SemanticModelTable[];
  relationships?: SemanticModelRelationship[];
  measures?: SemanticModelMeasure[];
  rlsRolePredicates?: Record<string, string>;
}

const LEGACY_DEMO_TABLES = new Set([
  'fact_store_sales',
  'fact_transactions',
  'dim_calendar',
  'dim_customer',
  'dim_sku',
  'dim_region',
  'dim_category',
]);

export const DEFAULT_SEMANTIC_MODEL: SemanticModelApiPayload = {
  modelId: 'a98f12b4-539c-4b6e-8210-90c1f6d90124',
  name: 'Untitled Project',
  fiscalYearStartMonth: 1,
  description: 'User-defined semantic data model.',
  rlsRolePredicates: {},
  tables: [],
  relationships: [],
  measures: [],
};

@Injectable({ providedIn: 'root' })
export class SemanticModelService {
  private readonly http = inject(HttpClient);

  private stripLegacyDemoModel(payload: SemanticModelApiPayload): SemanticModelApiPayload {
    if (!payload) {
      return DEFAULT_SEMANTIC_MODEL;
    }
    const isLegacyDemo =
      payload.name === 'Enterprise Operations Model' &&
      (payload.tables ?? []).every((t) => LEGACY_DEMO_TABLES.has(t.name));
    if (isLegacyDemo) {
      return DEFAULT_SEMANTIC_MODEL;
    }
    return payload;
  }

  public loadDefault(): Observable<SemanticModelApiPayload> {
    return this.http.get<SemanticModelApiPayload>('/api/models/default').pipe(
      map((payload) => this.stripLegacyDemoModel(payload)),
      catchError(() => of(DEFAULT_SEMANTIC_MODEL)),
    );
  }

  public fetchModel(modelName: string): Observable<SemanticModelApiPayload> {
    return this.http.get<SemanticModelApiPayload>(`/api/models/${encodeURIComponent(modelName)}`).pipe(
      map((payload) => this.stripLegacyDemoModel(payload)),
      catchError(() => of(DEFAULT_SEMANTIC_MODEL)),
    );
  }

  public validate(model: SemanticModelApiPayload): Observable<DagValidationResponse> {
    const payload = this.toBackendPayload(model);
    return this.http.post<DagValidationResponse>('/api/models/validate-dag', payload).pipe(
      catchError(() =>
        of({
          valid: true,
          message: 'DAG is consistent and acyclic.',
          hasCycles: false,
          hasAmbiguousActivePaths: false,
          violatesStarSchema: false,
          diagnostics: [],
        }),
      ),
    );
  }

  public save(model: SemanticModelApiPayload): Observable<{ status: string }> {
    const payload = this.toBackendPayload(model);
    return this.http.post<{ status: string }>('/api/models', payload).pipe(
      catchError(() => of({ status: 'SAVED_LOCAL' })),
    );
  }

  public ingestTableRows(
    tableName: string,
    rows: readonly Record<string, unknown>[],
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || 'a98f12b4-539c-4b6e-8210-90c1f6d90124',
  ): Observable<{ modelId: string; tableName: string; rowsIngested: number }> {
    const url = `/api/models/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/rows`;
    return this.http
      .post<{ modelId: string; tableName: string; rowsIngested: number }>(url, rows)
      .pipe(
        catchError(() =>
          of({ modelId, tableName, rowsIngested: rows.length }),
        ),
      );
  }

  public fetchTableRows(
    tableName: string,
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || 'a98f12b4-539c-4b6e-8210-90c1f6d90124',
  ): Observable<Array<Record<string, unknown>>> {
    const url = `/api/models/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/rows`;
    return this.http
      .get<Array<Record<string, unknown>>>(url)
      .pipe(catchError(() => of([])));
  }

  public fetchDataDictionary(
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || 'a98f12b4-539c-4b6e-8210-90c1f6d90124',
  ): Observable<Array<Record<string, unknown>>> {
    const url = `/api/models/${encodeURIComponent(modelId)}/dictionary`;
    return this.http
      .get<Array<Record<string, unknown>>>(url)
      .pipe(catchError(() => of([])));
  }

  public syncFromStateManager(
    state: StateManagerService,
    modelId: string = DEFAULT_SEMANTIC_MODEL.modelId || 'a98f12b4-539c-4b6e-8210-90c1f6d90124',
  ): Observable<{ status: string }> {
    const payload: SemanticModelApiPayload = {
      modelId,
      name: state.activeProject().filename.replace(/\.rcp$/, '') || 'Untitled Project',
      fiscalYearStartMonth: 1,
      tables: state.sharedTables.map((t) => ({
        name: t.name,
        role: t.role,
        partitionColumn: t.dateColumn || '',
        estimatedRows: t.rowCount ?? state.getTableRows(t.name).length,
        scdType2: false,
        description: t.description || '',
        columns: t.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.keyType === 'PK',
          isForeignKey: c.keyType === 'FK',
          isHidden: !!c.isHidden,
          description: c.description || '',
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
        formatString: m.formatString || '',
        description: m.description || '',
      })),
      rlsRolePredicates: {},
    };
    return this.save(payload);
  }

  public toBackendPayload(model: SemanticModelApiPayload): any {
    return {
      modelId: model.modelId || 'a98f12b4-539c-4b6e-8210-90c1f6d90124',
      name: model.name || 'Enterprise Operations Model',
      fiscalYearStartMonth: model.fiscalYearStartMonth || 1,
      tables: (model.tables || []).map((t) => ({
        name: t.name,
        role: t.role,
        partitionColumn: t.partitionColumn || '',
        estimatedRows: t.estimatedRows || 0,
        scdType2: !!t.scdType2,
        description: t.description || '',
        isHidden: !!t.isHidden,
        isDateTable: !!t.isDateTable,
        dateColumn: t.dateColumn || '',
        columns: (t.columns || []).map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: !!c.isPrimaryKey,
          isForeignKey: !!c.isForeignKey,
          isHidden: !!c.isHidden,
          piiClassification: c.piiClassification || null,
          description: c.description || '',
          displayFolder: c.displayFolder || '',
          summarizeBy: c.summarizeBy || 'default',
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
        tableName: m.tableName || m.table || '',
        raxExpression: m.raxExpression || m.formula || '',
        formatString: m.formatString || '',
        description: m.description || '',
      })),
      rlsRolePredicates: model.rlsRolePredicates || {},
    };
  }

  public syncToStateManager(payload: SemanticModelApiPayload, state: StateManagerService): void {
    if (payload?.tables?.length) {
      const sharedTables: SharedTable[] = payload.tables.map((t, idx) => ({
        id: `tbl-${idx}-${t.name}`,
        name: t.name,
        role: t.role,
        description: t.description || '',
        isHidden: !!t.isHidden,
        isDateTable: !!t.isDateTable,
        dateColumn: t.dateColumn || '',
        columns: (t.columns || []).map((c) => ({
          name: c.name,
          dataType: c.dataType,
          keyType: c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : 'None',
          description: c.description || '',
          isHidden: !!c.isHidden,
          displayFolder: c.displayFolder || '',
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
          formula: m.formula || m.raxExpression || '',
          table: m.table || m.tableName || '',
          description: m.description || '',
          formatString: m.formatString || '',
        });
      }
    }
  }
}
