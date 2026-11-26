import { DataPrepQuarantineRow } from "../../services/api.service";

export type BackendSourceFormat =
  | "CSV"
  | "TSV"
  | "JSON"
  | "XML"
  | "XLSX"
  | "PARQUET"
  | "AVRO";

export type BackendDataType =
  | "INT64"
  | "FLOAT64"
  | "DECIMAL"
  | "CURRENCY"
  | "BOOLEAN"
  | "ISO_DATE"
  | "ISO_DATETIME"
  | "UTF8_STRING";

export type AggregationFunction = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
export type JoinKind = "INNER" | "LEFT" | "RIGHT" | "FULL";

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterOrEqual"
  | "lessThan"
  | "lessOrEqual"
  | "between"
  | "notEmpty";

export interface FilterOperatorOption {
  readonly id: FilterOperator;
  readonly label: string;
}

export interface DataPrepColumn {
  readonly name: string;
  readonly type?: string;
  readonly displayType?: string;
  readonly icon?: string;
  readonly numeric?: boolean;
}

export interface DataPrepStep {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly detail?: string;
  readonly definition?: Readonly<Record<string, unknown>>;
}

export interface RQueryAggregateDefinition {
  readonly outputColumn: string;
  readonly sourceColumn: string;
  readonly function: AggregationFunction;
}

export interface RQueryStepDefinition {
  readonly step: string;
  readonly input?: string;
  readonly uri?: string;
  readonly format?: BackendSourceFormat;
  readonly column?: string;
  readonly type?: BackendDataType | string;
  readonly oldName?: string;
  readonly newName?: string;
  readonly predicate?: string;
  readonly operator?: FilterOperator;
  readonly value?: string;
  readonly valueTo?: string;
  readonly numeric?: boolean;
  readonly pivotColumns?: readonly string[];
  readonly nameCol?: string;
  readonly valCol?: string;
  readonly groupColumns?: readonly string[];
  readonly aggregations?: readonly RQueryAggregateDefinition[];
  readonly joinKeys?: readonly string[];
  readonly targetTable?: string;
  readonly joinType?: JoinKind;
  readonly expression?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly onError?: string;
  readonly item?: string;
  readonly kind?: string;
  readonly [key: string]: unknown;
}

export interface StepEvaluationResult {
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly quarantined: readonly DataPrepQuarantineRow[];
  readonly tableName?: string;
  readonly mQueryScript?: string;
  readonly activeStepFormula?: string;
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
  readonly columns?: readonly DataPrepColumn[];
  readonly tableName?: string;
  readonly mQueryScript?: string;
  readonly activeStepFormula?: string;
}

export interface BackendPreviewResponse {
  readonly columns?: readonly DataPrepColumn[];
  readonly schema?: Readonly<Record<string, string>>;
  readonly rows?: readonly Record<string, unknown>[];
  readonly quarantined?: readonly QuarantinedRecordDto[];
  readonly quarantinedRecords?: readonly QuarantinedRecordDto[];
  readonly tableName?: string;
  readonly mQueryScript?: string;
  readonly activeStepFormula?: string;
  readonly appliedSteps?: readonly DataPrepStep[];
}

export interface StepPreviewPayload {
  readonly tenantId: string;
  readonly datasetId: string;
  readonly fileName?: string;
  readonly format?: BackendSourceFormat;
  readonly rawPayload?: string;
  readonly rawPayloadBase64?: string;
  readonly sheetName?: string;
  readonly initialColumns?: readonly DataPrepColumn[];
  readonly initialRows?: readonly Record<string, unknown>[];
  readonly steps: readonly RQueryStepDefinition[];
  readonly lookupTables?: Readonly<
    Record<string, readonly Record<string, unknown>[]>
  >;
  readonly rangeStart?: string;
  readonly rangeEnd?: string;
}
