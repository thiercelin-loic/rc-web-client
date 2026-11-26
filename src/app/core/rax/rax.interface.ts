import {
  CanvasVisualItem,
  FilterOp,
  FilterValue,
  RaxMeasureDescriptor,
  SharedColumn,
  SharedTable,
} from "../state/state.interface";
import { SupportedChartType } from "../../shared/chart-canvas.component";

export type SqlDialect = "DUCKDB" | "MYSQL";

export interface DiagnosticMarker {
  readonly line: number;
  readonly startColumn: number;
  readonly column?: number;
  readonly endColumn?: number;
  readonly length?: number;
  readonly message: string;
  readonly errorCode: string;
  readonly code?: string;
  readonly severity:
    | "error"
    | "warning"
    | "info"
    | "ERROR"
    | "WARNING"
    | "INFO";
}

export interface RaxToken {
  readonly type:
    | "keyword"
    | "function"
    | "table"
    | "column"
    | "number"
    | "string"
    | "operator"
    | "identifier"
    | "comment"
    | "plain"
    | "text";
  readonly value: string;
}

export interface BackendRaxTokenDto {
  readonly text: string;
  readonly type: string;
}

export interface BackendRaxValidationResponse {
  readonly isValid: boolean;
  readonly statusLabel: string;
  readonly measureName: string | null;
  readonly formulaExpression: string;
  readonly diagnostics: readonly DiagnosticMarker[];
  readonly tokens: readonly BackendRaxTokenDto[];
}

export interface RaxValidationResult {
  readonly isValid: boolean;
  readonly statusLabel: string;
  readonly measureName?: string | null;
  readonly formulaExpression?: string;
  readonly diagnostics: readonly DiagnosticMarker[];
  readonly tokens: readonly RaxToken[];
}

export interface RaxFunctionSnippet {
  readonly label: string;
  readonly signature: string;
  readonly doc: string;
}

export type RaxFunctionCatalogEntry = RaxFunctionSnippet;

export interface RaxParsedFormula {
  readonly measureName: string | null;
  readonly formulaExpression: string;
}

export interface RaxDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly line: number;
  readonly startColumn: number;
  readonly length?: number;
  readonly errorCode: string;
  readonly message: string;
}

export interface RaxMonacoMarkerData {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
  readonly severity: "ERROR" | "WARNING" | "INFO";
  readonly code: string;
  readonly message: string;
}

export interface RaxProblemDetail {
  readonly title?: string;
  readonly status?: number;
  readonly detail: string;
  readonly errorCode?: string;
}

export interface DefineMeasuresRequest {
  readonly modelId?: string | null;
}

export interface DefineMeasuresResponse {
  readonly script: string;
}

export interface FormatQueryRequest {
  readonly script: string;
}

export interface FormatQueryResponse {
  readonly formattedScript: string;
}

export interface TmdlGenerateRequest {
  readonly modelId?: string | null;
}

export interface TmdlGenerateResponse {
  readonly tmdlScript: string;
}

export interface ExecuteRaxScriptRequest {
  readonly modelId?: string | null;
  readonly script: string;
  readonly dialect?: SqlDialect;
}

export interface BackendMeasureDefinitionDto {
  readonly id: string;
  readonly name?: string;
  readonly label?: string;
  readonly tableName?: string;
  readonly table?: string;
  readonly raxExpression?: string;
  readonly formula?: string;
  readonly formatString?: string;
  readonly description?: string;
}

export interface ApplyMeasuresRequest {
  readonly modelId?: string | null;
  readonly script: string;
}

export interface ApplyMeasuresResponse {
  readonly appliedCount: number;
  readonly measures: readonly BackendMeasureDefinitionDto[];
}

export interface BackendColumnDefinitionDto {
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey?: boolean;
  readonly isForeignKey?: boolean;
  readonly isHidden?: boolean;
  readonly piiClassification?: string | null;
  readonly description?: string;
  readonly displayFolder?: string;
  readonly summarizeBy?: string;
  readonly expression?: string;
  readonly sortByColumn?: string;
  readonly format?: string;
  readonly keyType?: "PK" | "FK" | "None";
}

export interface CalculatedColumnRequest {
  readonly modelId?: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly formula: string;
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
}

export interface BackendCalculatedColumnResponse {
  readonly tableName?: string;
  readonly columnName?: string;
  readonly dataType?: string;
  readonly inferredDataType?: string;
  readonly expression?: string;
  readonly column?: BackendColumnDefinitionDto;
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly diagnostics?: readonly DiagnosticMarker[];
}

export interface CalculatedColumnResponse {
  readonly tableName: string;
  readonly columnName: string;
  readonly dataType: string;
  readonly inferredDataType?: string;
  readonly expression: string;
  readonly column?: SharedColumn;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly diagnostics?: readonly DiagnosticMarker[];
}

export interface CalculatedTableRequest {
  readonly modelId?: string;
  readonly tableName: string;
  readonly formula: string;
  readonly sourceRows?: readonly Readonly<Record<string, unknown>>[];
}

export interface BackendCalculatedTableResponse {
  readonly table?: SharedTable;
  readonly tableName?: string;
  readonly columns?: readonly BackendColumnDefinitionDto[];
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
}

export interface CalculatedTableResponse {
  readonly table: SharedTable;
  readonly tableName?: string;
  readonly columns?: readonly BackendColumnDefinitionDto[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
}

export interface RaxQueryResult {
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly routedEngine: SqlDialect;
  readonly executionTimeMs: number;
  readonly executedSql: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface VisualQueryPayload {
  readonly modelId?: string;
  readonly tenantId?: string;
  readonly reportId?: string;
  readonly visualId?: string;
  readonly measureId?: string;
  readonly raxExpression?: string;
  readonly factTableName?: string;
  readonly estimatedRows?: number;
  readonly operationalLookup?: boolean;
  readonly groupByColumns?: readonly string[];
  readonly activeFilters?: Readonly<Record<string, readonly unknown[]>>;
  readonly externalSlicerFilters?: Readonly<Record<string, readonly unknown[]>>;
  readonly evaluationDate?: string;
  readonly acceptLanguage?: string;
}

export interface VisualQueryRequestOptions {
  readonly visualId: string;
  readonly measureId?: string;
  readonly raxExpression?: string;
  readonly factTableName?: string;
  readonly groupByColumns?: readonly string[];
  readonly externalSlicerFilters?: Readonly<Record<string, readonly unknown[]>>;
}

export interface QueryExecutionResult {
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly routedEngine: SqlDialect;
  readonly executionTimeMs: number;
  readonly executedSql: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface VisualChartSeriesDto {
  readonly label: string;
  readonly data: readonly number[];
  readonly backgroundColor?: string | readonly string[];
  readonly borderColor?: string | readonly string[];
  readonly fill?: boolean;
}

export interface VisualChartPayloadDto {
  readonly title: string;
  readonly chartType: SupportedChartType;
  readonly labels: readonly string[];
  readonly datasets: readonly VisualChartSeriesDto[];
}

export interface MatrixRowRollupDto {
  readonly category: string;
  readonly units: number;
  readonly revenue: number;
  readonly margin: number;
}

export interface MatrixTotalsRollupDto {
  readonly units: number;
  readonly revenue: number;
  readonly margin: number;
}

export interface MatrixRollupPayloadDto {
  readonly rows: readonly MatrixRowRollupDto[];
  readonly totals: MatrixTotalsRollupDto;
}

export interface MeasureCardPayloadDto {
  readonly label: string;
  readonly value: string;
  readonly subtext: string;
}

export interface VisualEvaluationDto {
  readonly visualId: string;
  readonly hasChartData?: boolean;
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly chart?: VisualChartPayloadDto;
  readonly matrix?: MatrixRollupPayloadDto;
  readonly measureCard?: MeasureCardPayloadDto;
}

export interface VisualBatchQueryItemDto {
  readonly visualId: string;
  readonly title: string;
  readonly archetype: string;
  readonly fieldWells: Readonly<Record<string, readonly string[]>>;
  readonly sortBy?: "value" | "axis";
  readonly sortOrder?: "asc" | "desc";
  readonly metricLabel?: string;
  readonly metricValue?: string;
  readonly metricSubtext?: string;
}

export interface VisualBatchQueryRequest {
  readonly modelId: string;
  readonly reportId: string;
  readonly visuals: readonly VisualBatchQueryItemDto[];
  readonly activeFilters: Readonly<Record<string, readonly unknown[]>>;
  readonly externalSlicerFilters?: Readonly<Record<string, readonly unknown[]>>;
  readonly measures?: readonly RaxMeasureDescriptor[];
  readonly evaluationDate?: string;
  readonly acceptLanguage?: string;
}

export interface VisualBatchQueryResponse {
  readonly reportId?: string;
  readonly visuals?: Readonly<Record<string, VisualEvaluationDto>>;
  readonly results?: readonly VisualEvaluationDto[];
}

export interface VisualBatchOptions {
  readonly visuals: readonly CanvasVisualItem[];
  readonly assignedWells?: Readonly<Record<string, readonly string[]>>;
  readonly selectedVisualId?: string | null;
  readonly slicerCategories?: readonly string[];
  readonly slicerDimension?: string;
}

export interface FilterInputSpec {
  readonly selectedDimension: string;
  readonly customDimension: string;
  readonly availableDimensions: readonly string[];
  readonly operator: FilterOp;
  readonly rawValue: string;
}

export interface ResolvedFilterClause {
  readonly dimension: string;
  readonly operator: FilterOp;
  readonly values: readonly FilterValue[];
}
