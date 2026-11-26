import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, map } from "rxjs";
import { DataPrepQuarantineRow } from "../../services/api.service";
import {
  BACKEND_DATA_TYPES,
  DEFAULT_DATASET_ID,
  DEFAULT_ERROR_REASON,
  DEFAULT_EXPECTED_TYPE,
  DEFAULT_TENANT_ID,
  PREVIEW_ENDPOINT,
} from "./prep.constants";
import {
  BackendPreviewResponse,
  BackendRecordBatch,
  BackendSourceFormat,
  DataPrepColumn,
  DataPrepStep,
  QuarantinedRecordDto,
  RQueryStepDefinition,
  StepEvaluationResult,
  StepPreviewPayload,
} from "./prep.interface";

export type {
  BackendPreviewResponse,
  BackendRecordBatch,
  QuarantinedRecordDto,
  StepEvaluationResult,
  StepPreviewPayload,
} from "./prep.interface";

export interface PreviewOptions {
  readonly tenantId?: string;
  readonly datasetId?: string;
  readonly fileName?: string;
  readonly format?: BackendSourceFormat;
  readonly rawPayload?: string;
  readonly rawPayloadBase64?: string;
  readonly sheetName?: string;
  readonly initialColumns?: readonly DataPrepColumn[];
  readonly initialRows?: readonly Record<string, unknown>[];
  readonly steps?: readonly DataPrepStep[];
  readonly lookupTables?: Readonly<
    Record<string, readonly Record<string, unknown>[]>
  >;
  readonly rangeStart?: string;
  readonly rangeEnd?: string;
}

@Injectable({ providedIn: "root" })
export class DataPrepEngineService {
  private readonly http = inject(HttpClient);

  public evaluateSteps(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
    lookupTables?: Readonly<Record<string, readonly Record<string, unknown>[]>>,
    options?: Omit<
      PreviewOptions,
      "initialColumns" | "initialRows" | "steps" | "lookupTables"
    >,
  ): Observable<StepEvaluationResult> {
    return this.previewPipeline({
      ...options,
      initialColumns: initialCols,
      initialRows,
      steps,
      lookupTables,
    });
  }

  public previewPipeline(
    options: PreviewOptions,
  ): Observable<StepEvaluationResult> {
    const payload = this.buildPayload(options);
    return this.http
      .post<
        readonly BackendRecordBatch[] | BackendPreviewResponse
      >(PREVIEW_ENDPOINT, payload)
      .pipe(map((response) => this.mapResponse(response)));
  }

  public buildSteps(steps: readonly DataPrepStep[]): RQueryStepDefinition[] {
    return steps.map((step) => this.mapStep(step));
  }

  public mapStep(step: DataPrepStep): RQueryStepDefinition {
    const def = step.definition ?? {};
    const stepName = String(def["step"] ?? step.type);
    const rawType = def["type"] ?? def["targetType"];
    const typeStr = rawType !== undefined ? String(rawType) : undefined;
    const isEnumType = typeStr !== undefined && BACKEND_DATA_TYPES.has(typeStr);
    const baseParams = (def["parameters"] as Record<string, unknown> | undefined) ?? undefined;
    // Pass non-enum labels via parameters so backend DataType.fromLabel resolves them safely.
    const parameters =
      typeStr && !isEnumType
        ? { ...(baseParams ?? {}), type: typeStr }
        : baseParams;
    const oldName = def["oldName"] ?? def["original"];
    const newName = def["newName"] ?? def["renamed"];
    return {
      ...(def as RQueryStepDefinition),
      step: stepName,
      type: isEnumType ? (typeStr as RQueryStepDefinition["type"]) : undefined,
      ...(oldName !== undefined ? { oldName: String(oldName) } : {}),
      ...(newName !== undefined ? { newName: String(newName) } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
      onError: String(def["onError"] ?? "quarantine"),
    };
  }

  private buildPayload(options: PreviewOptions): StepPreviewPayload {
    return {
      tenantId: options.tenantId ?? DEFAULT_TENANT_ID,
      datasetId: options.datasetId ?? DEFAULT_DATASET_ID,
      ...(options.fileName ? { fileName: options.fileName } : {}),
      ...(options.format ? { format: options.format } : {}),
      ...(options.rawPayload !== undefined
        ? { rawPayload: options.rawPayload }
        : {}),
      ...(options.rawPayloadBase64
        ? { rawPayloadBase64: options.rawPayloadBase64 }
        : {}),
      ...(options.sheetName ? { sheetName: options.sheetName } : {}),
      ...(options.initialColumns
        ? { initialColumns: options.initialColumns }
        : {}),
      ...(options.initialRows ? { initialRows: options.initialRows } : {}),
      steps: this.buildSteps(options.steps ?? []),
      lookupTables: options.lookupTables ?? {},
      ...(options.rangeStart ? { rangeStart: options.rangeStart } : {}),
      ...(options.rangeEnd ? { rangeEnd: options.rangeEnd } : {}),
    };
  }

  private mapResponse(
    response: readonly BackendRecordBatch[] | BackendPreviewResponse,
  ): StepEvaluationResult {
    if (Array.isArray(response)) {
      return this.mapBatches(response);
    }
    const obj = response as BackendPreviewResponse | null;
    if (!obj) {
      return { columns: [], rows: [], quarantined: [] };
    }
    const rawQuarantined = obj.quarantined ?? obj.quarantinedRecords ?? [];
    return {
      columns: this.extractColumns(obj.columns, obj.schema),
      rows: [...(obj.rows ?? [])],
      quarantined: this.mapQuarantined(rawQuarantined),
      tableName: obj.tableName,
      mQueryScript: obj.mQueryScript,
      activeStepFormula: obj.activeStepFormula,
    };
  }

  private mapBatches(
    batches: readonly BackendRecordBatch[],
  ): StepEvaluationResult {
    if (!batches || batches.length === 0) {
      return { columns: [], rows: [], quarantined: [] };
    }
    const first = batches[0];
    return {
      columns: this.extractColumns(first.columns, first.schema),
      rows: batches.flatMap((b) => b.rows ?? []),
      quarantined: this.mapQuarantined(
        batches.flatMap((b) => b.quarantinedRecords ?? []),
      ),
      tableName: first.tableName,
      mQueryScript: first.mQueryScript,
      activeStepFormula: first.activeStepFormula,
    };
  }

  private extractColumns(
    explicitCols?: readonly DataPrepColumn[],
    schema?: Readonly<Record<string, string>>,
  ): DataPrepColumn[] {
    if (explicitCols && explicitCols.length > 0) {
      return explicitCols.map((col) => {
        const display = col.displayType ?? col.type ?? "String";
        return {
          name: col.name,
          type: display,
          displayType: display,
          icon: col.icon ?? display,
          numeric: col.numeric,
        };
      });
    }
    if (!schema) {
      return [];
    }
    return Object.entries(schema).map(([name, rawType]) => ({
      name,
      type: rawType,
      displayType: rawType,
      icon: rawType,
    }));
  }

  private mapQuarantined(
    records: readonly QuarantinedRecordDto[],
  ): DataPrepQuarantineRow[] {
    return records.map((q) => ({
      sourceLineNumber: q.sourceLineNumber ?? 0,
      columnName: q.columnName ?? "",
      expectedType: q.expectedType ?? DEFAULT_EXPECTED_TYPE,
      rawPayload: q.rawPayload ?? "",
      errorReason: q.errorReason ?? DEFAULT_ERROR_REASON,
    }));
  }
}
