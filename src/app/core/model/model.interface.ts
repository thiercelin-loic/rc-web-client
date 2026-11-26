import {
  ColumnDisplayFormat,
  ColumnSummarization,
} from "../state/state.interface";

export type ModelSection =
  | "Inspector"
  | "Properties"
  | "Entities"
  | "Definition";
export type ModelLayoutMode = "kimball" | "collie";
export type BackendCardinality = "MANY_TO_ONE" | "ONE_TO_ONE" | "MANY_TO_MANY";
export type BackendCrossFilter = "SINGLE" | "BOTH";

export interface ProblemDetail {
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly errorCode?: string;
  readonly timestamp?: string;
}

export interface ColumnMetadataPatchRequest {
  readonly modelId?: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly dataType?: string;
  readonly summarizeBy?: ColumnSummarization | "default" | string;
  readonly sortByColumn?: string | null;
  readonly isHidden?: boolean;
  readonly format?: ColumnDisplayFormat | string;
  readonly keyType?: "PK" | "FK" | "None";
}

export interface RelationshipRoutingRequest {
  readonly cardinality: BackendCardinality;
  readonly crossFilterDirection: BackendCrossFilter;
}

export interface ColumnTargetRequest {
  readonly tableName: string;
  readonly columnName: string;
}

export interface DateTableRequest {
  readonly tableName: string;
  readonly dateTable?: boolean;
  readonly dateColumn?: string;
}

export interface ModelColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey?: boolean;
  readonly isForeignKey?: boolean;
  readonly isHidden?: boolean;
  readonly description?: string;
  readonly displayFolder?: string;
  readonly summarizeBy?: string;
  readonly expression?: string;
  readonly sortByColumn?: string;
  readonly format?: string;
}

export interface ModelTable {
  readonly name: string;
  readonly role: "FACT" | "DIMENSION";
  readonly position: { readonly x: number; readonly y: number };
  readonly columns: readonly ModelColumn[];
  readonly isHidden?: boolean;
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
  readonly description?: string;
}

export interface ModelRelationship {
  readonly name: string;
  readonly fromTable: string;
  readonly fromCol: string;
  readonly toTable: string;
  readonly toCol: string;
  readonly cardinality: string;
  readonly crossFilter: string;
  readonly isActive?: boolean;
  readonly bridgeTable?: string;
  readonly description?: string;
}

export interface RenderedRelationship {
  readonly rel: ModelRelationship;
  readonly pathD: string;
  readonly labelText: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly isBiDirectional: boolean;
}

export interface SemanticModelColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey?: boolean;
  readonly isForeignKey?: boolean;
  readonly isHidden?: boolean;
  readonly piiClassification?: string;
  readonly description?: string;
  readonly displayFolder?: string;
  readonly summarizeBy?: string;
  readonly expression?: string;
  readonly sortByColumn?: string;
  readonly format?: string;
}

export interface SemanticModelTable {
  readonly name: string;
  readonly role: "FACT" | "DIMENSION";
  readonly partitionColumn?: string;
  readonly estimatedRows?: number;
  readonly scdType2?: boolean;
  readonly description?: string;
  readonly isHidden?: boolean;
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
  readonly columns: readonly SemanticModelColumn[];
}

export interface DagDiagnosticMarker {
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
  readonly severity: "ERROR" | "WARNING" | string;
  readonly code: string;
  readonly message: string;
  readonly documentationUrl?: string;
}

export interface DagValidationResponse {
  readonly valid: boolean;
  readonly message?: string;
  readonly hasCycles?: boolean;
  readonly hasAmbiguousActivePaths?: boolean;
  readonly violatesStarSchema?: boolean;
  readonly diagnostics?: readonly DagDiagnosticMarker[];
}

export interface SemanticModelRelationship {
  readonly name: string;
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality: string;
  readonly crossFilterDirection: string;
  readonly isActive?: boolean;
  readonly bridgeTable?: string | null;
  readonly description?: string;
}

export interface RelationshipInferenceRequest {
  readonly tables: readonly BackendSemanticModelTable[];
}

export interface RelationshipInferenceResponse {
  readonly relationships: readonly SemanticModelRelationship[];
  readonly dateColumnsByTable?: Readonly<Record<string, string>>;
  readonly suggestedDateColumns?: Readonly<Record<string, string>>;
}

export interface ModelMutationResult {
  readonly schema: SemanticModelApiPayload;
  readonly dagValidation: DagValidationResponse;
  readonly rsdl: string;
}

export interface SemanticModelMeasure {
  readonly id: string;
  readonly label: string;
  readonly formula: string;
  readonly table: string;
  readonly name?: string;
  readonly raxExpression?: string;
  readonly tableName?: string;
  readonly formatString?: string;
  readonly description?: string;
}

export interface SemanticModelApiPayload {
  readonly modelId?: string;
  readonly name: string;
  readonly fiscalYearStartMonth?: number;
  readonly description?: string;
  readonly discourageImplicitMeasures?: boolean;
  readonly tables?: readonly SemanticModelTable[];
  readonly relationships?: readonly SemanticModelRelationship[];
  readonly measures?: readonly SemanticModelMeasure[];
  readonly rlsRolePredicates?: Readonly<Record<string, string>>;
  readonly rsdl?: string;
  readonly dagValidation?: DagValidationResponse;
}

export interface BackendSemanticModelColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey: boolean;
  readonly isForeignKey: boolean;
  readonly isHidden: boolean;
  readonly piiClassification: string | null;
  readonly description: string;
  readonly displayFolder: string;
  readonly summarizeBy: string;
  readonly expression: string;
  readonly sortByColumn: string;
  readonly format: string;
}

export interface BackendSemanticModelTable {
  readonly name: string;
  readonly role: "FACT" | "DIMENSION";
  readonly partitionColumn: string;
  readonly estimatedRows: number;
  readonly scdType2: boolean;
  readonly description: string;
  readonly isHidden: boolean;
  readonly isDateTable: boolean;
  readonly dateColumn: string;
  readonly columns: readonly BackendSemanticModelColumn[];
}

export interface BackendSemanticModelRelationship {
  readonly name: string;
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality: BackendCardinality;
  readonly crossFilterDirection: BackendCrossFilter;
  readonly isActive: boolean;
  readonly bridgeTable: string | null;
}

export interface BackendSemanticModelMeasure {
  readonly id: string;
  readonly name: string;
  readonly tableName: string;
  readonly raxExpression: string;
  readonly formatString: string;
  readonly description: string;
}

export interface BackendSemanticModelPayload {
  readonly modelId: string;
  readonly name: string;
  readonly fiscalYearStartMonth: number;
  readonly tables: readonly BackendSemanticModelTable[];
  readonly relationships: readonly BackendSemanticModelRelationship[];
  readonly measures: readonly BackendSemanticModelMeasure[];
  readonly rlsRolePredicates: Readonly<Record<string, string>>;
  readonly discourageImplicitMeasures: boolean;
}
