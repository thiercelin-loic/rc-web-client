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
  readonly columns: SemanticModelColumn[];
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
  readonly diagnostics?: DagDiagnosticMarker[];
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
  readonly bridgeTable?: string;
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
  readonly tables?: SemanticModelTable[];
  readonly relationships?: SemanticModelRelationship[];
  readonly measures?: SemanticModelMeasure[];
  readonly rlsRolePredicates?: Record<string, string>;
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
  readonly columns: BackendSemanticModelColumn[];
}

export interface BackendSemanticModelRelationship {
  readonly name: string;
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality: string;
  readonly crossFilterDirection: string;
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
  readonly tables: BackendSemanticModelTable[];
  readonly relationships: BackendSemanticModelRelationship[];
  readonly measures: BackendSemanticModelMeasure[];
  readonly rlsRolePredicates: Record<string, string>;
}
