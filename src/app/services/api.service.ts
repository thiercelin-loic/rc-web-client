import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
import { AuthService } from "../core/auth.service";

export interface DataPrepQuarantineRow {
  sourceLineNumber: number;
  columnName: string | null;
  expectedType: string | null;
  errorReason: string;
  rawPayload: string;
}

export interface DataPrepPreview {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  quarantined: DataPrepQuarantineRow[];
  appliedSteps?: Array<{ name: string; type: string; detail?: string }>;
}

/** Request body of POST /api/ingestion/preview (backend record RQueryPreviewRequest). */
export interface DataPrepPreviewRequest {
  datasetId: string;
  format: string;
  rawPayload?: string;
  rawPayloadBase64?: string;
  sheetName?: string;
  steps: ReadonlyArray<unknown>;
  lookupTables?: Record<string, ReadonlyArray<Record<string, unknown>>>;
}

export interface IncrementalRefreshResult {
  recordsUpserted: number;
}

interface RecordBatchResponse {
  schema?: Record<string, string>;
  rows?: Array<Record<string, unknown>>;
  quarantinedRecords?: Array<Partial<DataPrepQuarantineRow>>;
}

@Injectable({
  providedIn: "root",
})
export class ApiService {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly auth = inject(AuthService, { optional: true });

  public getTenantId(): string {
    return this.auth?.currentUser()?.tenantId || "ws-90124-enterprise";
  }

  /**
   * Executes the R-Query pipeline server-side and returns the typed result of the last step.
   * Supports both structured `DataPrepPreviewRequest` and legacy positional arguments.
   */
  public getDataPrepPreview(
    requestOrSourceId?: DataPrepPreviewRequest | string,
    format?: string,
    rawPayload = "",
  ): Observable<DataPrepPreview> {
    if (!this.http) {
      return of({ columns: [], rows: [], quarantined: [] });
    }
    const request: DataPrepPreviewRequest =
      typeof requestOrSourceId === "object" && requestOrSourceId !== null
        ? requestOrSourceId
        : {
            datasetId: requestOrSourceId || "ds_source_01",
            format: format || "CSV",
            rawPayload,
            steps: [],
          };

    return this.http
      .post<RecordBatchResponse[] | DataPrepPreview>("/api/ingestion/preview", {
        tenantId: this.getTenantId(),
        datasetId: request.datasetId,
        format: request.format,
        rawPayload: request.rawPayload ?? "",
        rawPayloadBase64: request.rawPayloadBase64,
        sheetName: request.sheetName,
        steps: request.steps,
        lookupTables: request.lookupTables,
      })
      .pipe(
        map((response) => {
          if (Array.isArray(response)) {
            const schema =
              response.find((b) => b.schema && Object.keys(b.schema).length > 0)?.schema ?? {};
            return {
              columns: Object.entries(schema).map(([name, type]) => ({
                name,
                type: String(type || "UTF8_STRING"),
              })),
              rows: response.flatMap((b) => b.rows ?? []),
              quarantined: response.flatMap((b) =>
                (b.quarantinedRecords ?? []).map((q) => ({
                  sourceLineNumber: Number(q.sourceLineNumber ?? 0),
                  columnName: q.columnName ?? null,
                  expectedType: q.expectedType ?? null,
                  errorReason: q.errorReason ?? "",
                  rawPayload: q.rawPayload ?? "",
                })),
              ),
            };
          }
          return {
            columns: response?.columns ?? [],
            rows: response?.rows ?? [],
            quarantined: response?.quarantined ?? [],
            appliedSteps: response?.appliedSteps,
          };
        }),
      );
  }

  public runIncrementalRefresh(tableId = "fact_sales"): Observable<IncrementalRefreshResult> {
    if (!this.http) {
      return of({ recordsUpserted: 0 });
    }
    const tenantId = this.getTenantId();
    return this.http
      .post<IncrementalRefreshResult>("/api/ingestion/incremental-refresh", {
        tenantId,
        tableId,
        deltaRecords: [],
      })
      .pipe(catchError(() => of({ recordsUpserted: 0 })));
  }
}
