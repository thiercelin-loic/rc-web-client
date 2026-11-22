import {
  BackendSourceFormat,
  DataPrepColumn,
  DataPrepStep,
  IngestionSource,
  WorkbookSheet,
} from "../../features/data-prep/data-prep.model";
import { DataPrepQuarantineRow } from "../../services/api.service";

export type SourceFormat = "CSV" | "PARQUET" | "XLSX" | "REST";
export type NavigatorMode = "load" | "transform";

export interface PipelineSyncEvent {
  readonly sourceId: string;
  readonly stepIndex: number;
  readonly seq: number;
}

export interface DirectDataset {
  readonly source: IngestionSource;
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly initialStep: DataPrepStep;
}

export interface EvalResult {
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly quarantined: DataPrepQuarantineRow[];
}

export interface SheetExtractionRequest {
  readonly fileName: string;
  readonly format: BackendSourceFormat;
  readonly rawPayload: string;
  readonly rawPayloadBase64: string;
}

export interface SheetExtractionResponse {
  readonly sheets: readonly WorkbookSheet[];
  readonly error?: string | null;
}
