export interface DiagnosticMarker {
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn?: number;
  readonly length?: number;
  readonly message: string;
  readonly errorCode: string;
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

export interface RaxParsedFormula {
  readonly measureName: string | null;
  readonly formulaExpression: string;
}

export interface RaxDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly line: number;
  readonly startColumn: number;
  readonly errorCode: string;
  readonly message: string;
}

export interface RaxQueryResult {
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly routedEngine: "DUCKDB" | "MYSQL";
  readonly executionTimeMs: number;
  readonly executedSql: string;
  readonly rows: Record<string, unknown>[];
}

export interface VisualQueryPayload {
  modelId?: string;
  tenantId?: string;
  reportId?: string;
  visualId?: string;
  measureId?: string;
  raxExpression?: string;
  factTableName?: string;
  estimatedRows?: number;
  operationalLookup?: boolean;
  groupByColumns?: string[];
  activeFilters?: Record<string, unknown[]>;
  externalSlicerFilters?: Record<string, unknown[]>;
  evaluationDate?: string;
  acceptLanguage?: string;
}

export interface VisualQueryRequestOptions {
  readonly visualId: string;
  readonly measureId?: string;
  readonly raxExpression?: string;
  readonly factTableName?: string;
  readonly groupByColumns?: readonly string[];
  readonly externalSlicerFilters?: Record<string, readonly unknown[]>;
}

export interface QueryExecutionResult {
  cacheKey: string;
  cacheHit: boolean;
  routedEngine: "DUCKDB" | "MYSQL";
  executionTimeMs: number;
  executedSql: string;
  rows: Array<Record<string, unknown>>;
}
