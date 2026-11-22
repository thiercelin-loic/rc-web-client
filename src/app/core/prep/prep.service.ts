import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, map } from "rxjs";
import {
  DataPrepColumn,
  DataPrepStep,
  RQueryStepDefinition,
  toBackendType,
  toDisplayType,
} from "../../features/data-prep/data-prep.model";
import { DataPrepQuarantineRow } from "../../services/api.service";
import {
  DEFAULT_DATASET_ID,
  DEFAULT_ERROR_REASON,
  DEFAULT_EXPECTED_TYPE,
  DEFAULT_TENANT_ID,
  PREVIEW_ENDPOINT,
} from "./prep.constants";
import {
  BackendRecordBatch,
  StepEvaluationResult,
  StepPreviewPayload,
} from "./prep.interface";

export type {
  BackendRecordBatch,
  QuarantinedRecordDto,
  StepEvaluationResult,
  StepPreviewPayload,
} from "./prep.interface";

@Injectable({ providedIn: "root" })
export class DataPrepEngineService {
  private readonly http = inject(HttpClient);

  public evaluateSteps(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
    lookupTables?: Readonly<Record<string, readonly Record<string, unknown>[]>>,
  ): Observable<StepEvaluationResult> {
    const payload: StepPreviewPayload = {
      tenantId: DEFAULT_TENANT_ID,
      datasetId: DEFAULT_DATASET_ID,
      initialColumns: initialCols,
      initialRows,
      steps: this.buildSteps(steps),
      lookupTables: lookupTables ?? {},
    };

    return this.http
      .post<readonly BackendRecordBatch[]>(PREVIEW_ENDPOINT, payload)
      .pipe(map((batches) => this.mapBatches(batches)));
  }

  public buildSteps(steps: readonly DataPrepStep[]): RQueryStepDefinition[] {
    return steps
      .filter(
        (step) =>
          step.type !== "FileSource" &&
          step.type !== "FileSourceStep" &&
          step.type !== "Navigation" &&
          step.type !== "NavigationStep",
      )
      .map((step) => this.mapStep(step));
  }

  public mapStep(step: DataPrepStep): RQueryStepDefinition {
    const def = step.definition ?? {};
    const rawStep = String(def["step"] ?? step.type);
    const normalizedStep = rawStep.endsWith("Step")
      ? rawStep
      : `${rawStep}Step`;
    return {
      ...(def as RQueryStepDefinition),
      step: normalizedStep,
      type: def["targetType"]
        ? toBackendType(String(def["targetType"]))
        : (def["type"] as RQueryStepDefinition["type"]),
      oldName: String(def["oldName"] ?? def["original"] ?? ""),
      newName: String(def["newName"] ?? def["renamed"] ?? ""),
      onError: String(def["onError"] ?? "quarantine"),
    };
  }

  private mapBatches(
    batches: readonly BackendRecordBatch[],
  ): StepEvaluationResult {
    if (!batches || batches.length === 0) {
      return { columns: [], rows: [], quarantined: [] };
    }
    const firstSchema = batches[0].schema ?? {};
    const columns: DataPrepColumn[] = Object.entries(firstSchema).map(
      ([name, rawType]) => {
        const displayType = toDisplayType(rawType);
        return { name, type: displayType, icon: displayType };
      },
    );
    const rows: Record<string, unknown>[] = batches.flatMap(
      (b) => b.rows ?? [],
    );
    const quarantined: DataPrepQuarantineRow[] = batches.flatMap((b) =>
      (b.quarantinedRecords ?? []).map((q) => ({
        id: q.id,
        sourceLineNumber: q.sourceLineNumber ?? 0,
        columnName: q.columnName ?? "",
        expectedType: q.expectedType ?? DEFAULT_EXPECTED_TYPE,
        rawPayload: q.rawPayload ?? "",
        errorReason: q.errorReason ?? DEFAULT_ERROR_REASON,
      })),
    );
    return { columns, rows, quarantined };
  }
}
