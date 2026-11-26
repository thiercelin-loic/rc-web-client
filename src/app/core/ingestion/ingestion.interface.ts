import {
  BackendSourceFormat,
  DataPrepColumn,
  DataPrepStep,
  StepEvaluationResult,
} from "../prep/prep.interface";

export type SourceFormat = "CSV" | "PARQUET" | "XLSX" | "REST";
export type NavigatorMode = "load" | "transform";

export interface IngestionSource {
  readonly id: string;
  readonly name: string;
  readonly format: SourceFormat;
  readonly path: string;
  readonly enableLoad?: boolean;
  readonly backendFormat?: BackendSourceFormat;
  readonly tableName?: string;
}

export interface SourceSnapshot {
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly rawText?: string;
  readonly rawBase64?: string;
  readonly tableName?: string;
}

export interface WorkbookSheet {
  readonly id: string;
  readonly name: string;
  readonly kind: "Sheet" | "Table";
  readonly sheetName?: string;
  readonly tableName?: string;
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly initialSteps?: readonly DataPrepStep[];
  readonly mQueryScript?: string;
  readonly activeStepFormula?: string;
}

export interface DataConnector {
  readonly id: string;
  readonly name: string;
  readonly category: "file";
  readonly description: string;
  readonly fileExtensions: string;
}

export interface PipelineSyncEvent {
  readonly sourceId: string;
  readonly stepIndex: number;
  readonly seq: number;
}

export interface DirectDataset {
  readonly source: IngestionSource;
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly initialStep: DataPrepStep;
  readonly tableName?: string;
  readonly mQueryScript?: string;
  readonly activeStepFormula?: string;
}

export type EvalResult = StepEvaluationResult;

export interface SheetExtractionRequest {
  readonly fileName: string;
  readonly format: BackendSourceFormat;
  readonly rawPayload: string;
  readonly rawPayloadBase64: string;
}

export interface SheetExtractionResponse {
  readonly sheets: readonly WorkbookSheet[];
  readonly tableName?: string;
  readonly initialSteps?: readonly DataPrepStep[];
  readonly mQueryScript?: string;
  readonly activeStepFormula?: string;
  readonly error?: string | null;
}
