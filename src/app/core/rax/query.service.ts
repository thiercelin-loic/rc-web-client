import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, catchError, tap, throwError } from "rxjs";
import { DEFAULT_SEMANTIC_MODEL } from "../model/model.constants";
import { StateManagerService } from "../state/state.service";
import type {
  QueryExecutionResult,
  VisualQueryPayload,
  VisualQueryRequestOptions,
} from "./rax.interface";

export type {
  QueryExecutionResult,
  VisualQueryPayload,
  VisualQueryRequestOptions,
} from "./rax.interface";

@Injectable({ providedIn: "root" })
export class QueryService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);

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

  public executeMeasure(
    measureId: string,
    raxExpression?: string,
    visualId?: string,
  ): Observable<QueryExecutionResult> {
    const reportId = this.state.activeProject().filename || "default-report";
    const tenantId = undefined;
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
      tenantId,
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
    const tenantId = undefined;
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
      tenantId,
      factTableName: primaryTable,
      estimatedRows: 0,
      operationalLookup: false,
      groupByColumns: options.groupByColumns
        ? [...options.groupByColumns]
        : [],
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
        tap(() => this.state.setLoading(false)),
        catchError((error) => {
          this.state.setLoading(false);
          this.state.announceError(`Visual query ${options.visualId}`, error);
          return throwError(() => error);
        }),
      );
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
