import {
  DataPrepColumn,
  RQueryStepDefinition,
} from "../../features/data-prep/data-prep.model";
import { DataPrepQuarantineRow } from "../../services/api.service";

export interface StepEvaluationResult {
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly quarantined: DataPrepQuarantineRow[];
}

export interface QuarantinedRecordDto {
  readonly id?: string;
  readonly sourceLineNumber?: number;
  readonly columnName?: string;
  readonly expectedType?: string;
  readonly rawPayload?: string;
  readonly errorReason?: string;
}

export interface BackendRecordBatch {
  readonly batchIndex: number;
  readonly schema: Readonly<Record<string, string>>;
  readonly rows: readonly Record<string, unknown>[];
  readonly quarantinedRecords: readonly QuarantinedRecordDto[];
}

export interface StepPreviewPayload {
  readonly tenantId: string;
  readonly datasetId: string;
  readonly initialColumns: readonly DataPrepColumn[];
  readonly initialRows: readonly Record<string, unknown>[];
  readonly steps: readonly RQueryStepDefinition[];
  readonly lookupTables?: Readonly<
    Record<string, readonly Record<string, unknown>[]>
  >;
}
