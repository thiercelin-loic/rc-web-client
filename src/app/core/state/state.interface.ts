export type FilterOp = "EQ" | "IN" | "NEQ" | "BETWEEN";
export type FilterValue = string | number | boolean;

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";

export interface FilterClause {
  readonly dimension: string;
  readonly operator: FilterOp;
  readonly values: readonly FilterValue[];
}

export interface ProjectDescriptor {
  readonly filename: string;
  readonly statusPill: string;
  readonly branch: string;
  readonly watermark: string;
}

export interface RaxMeasureDescriptor {
  readonly id: string;
  readonly label: string;
  readonly formula: string;
  readonly table: string;
  readonly description?: string;
  readonly formatString?: string;
  readonly isHidden?: boolean;
}

export interface RaxStudioDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly line: number;
  readonly startColumn: number;
  readonly errorCode: string;
  readonly message: string;
}

export interface RaxStudioQueryResult {
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly routedEngine: "DUCKDB" | "MYSQL";
  readonly executionTimeMs: number;
  readonly executedSql: string;
  readonly rows: Array<Record<string, unknown>>;
}

export type ExchangeLogLevel = "request" | "success" | "error";

export interface ExchangeLogEntry {
  readonly id: number;
  readonly level: ExchangeLogLevel;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly durationMs: number;
  readonly timestamp: string;
}

export type ColumnSummarization =
  | "None"
  | "Sum"
  | "Average"
  | "Min"
  | "Max"
  | "Count"
  | "DistinctCount";

export type ColumnDisplayFormat =
  | "General"
  | "Currency"
  | "Percentage"
  | "Date"
  | "WholeNumber"
  | "Decimal";

export interface SharedColumn {
  readonly name: string;
  readonly dataType: string;
  readonly keyType?: "PK" | "FK" | "None";
  readonly description?: string;
  readonly isHidden?: boolean;
  readonly displayFolder?: string;
  readonly expression?: string;
  readonly summarizeBy?: ColumnSummarization;
  readonly sortByColumn?: string;
  readonly format?: ColumnDisplayFormat;
}

export interface SharedTable {
  readonly id: string;
  readonly name: string;
  readonly role: "FACT" | "DIMENSION";
  readonly columns: readonly SharedColumn[];
  readonly rowCount?: number;
  readonly description?: string;
  readonly isHidden?: boolean;
  readonly expression?: string;
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
}

export interface CanvasVisualItem {
  readonly id: string;
  title: string;
  archetype: string;
  width: "half" | "full";
  metricLabel: string;
  metricValue: string;
  metricSubtext: string;
  sortBy?: "value" | "axis";
  sortOrder?: "asc" | "desc";
  fieldWells?: Record<string, string[]>;
}

export interface StoredWorkspaceState {
  readonly project: ProjectDescriptor;
  readonly pages: string[];
  readonly activePage: string;
  readonly visuals: Record<string, CanvasVisualItem[]>;
}

export interface LegacyMediaQueryList {
  addListener?: (
    listener: (event: MediaQueryListEvent | MediaQueryList) => void,
  ) => void;
  removeListener?: (
    listener: (event: MediaQueryListEvent | MediaQueryList) => void,
  ) => void;
}
