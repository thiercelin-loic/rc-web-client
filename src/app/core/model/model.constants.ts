import {
  ModelRelationship,
  SemanticModelApiPayload,
} from "./model.interface";

export const DEFAULT_MODEL_ID = "a98f12b4-539c-4b6e-8210-90c1f6d90124";
export const DEFAULT_MODEL_NAME = "Untitled Project";
export const LEGACY_MODEL_NAME = "Enterprise Operations Model";

export const MODELS_ENDPOINT = "/api/models";
export const MODELS_DEFAULT_ENDPOINT = "/api/models/default";
export const MODELS_VALIDATE_DAG_ENDPOINT = "/api/models/validate-dag";
export const MODELS_INFER_ENDPOINT = "/api/models/infer-relationships";
export const MODELS_RSDL_ENDPOINT = "/api/models/rsdl";
export const MODEL_DATE_TABLE_SEGMENT = "date-table";

export function columnUrl(
  modelId: string,
  tableName: string,
  columnName: string,
): string {
  return `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/tables/${encodeURIComponent(tableName)}/columns/${encodeURIComponent(columnName)}`;
}

export function dateUrl(modelId: string): string {
  return `${MODELS_ENDPOINT}/${encodeURIComponent(modelId)}/${MODEL_DATE_TABLE_SEGMENT}`;
}
export const MODEL_TABLES_SEGMENT = "tables";
export const MODEL_COLUMNS_SEGMENT = "columns";

export const TABLE_CARD_WIDTH = 244;
export const TABLE_HEADER_HEIGHT = 38;
export const TABLE_ROW_HEIGHT = 22;

export const EMPTY_MODEL_RELATIONSHIP: ModelRelationship = {
  name: "",
  fromTable: "",
  fromCol: "",
  toTable: "",
  toCol: "",
  cardinality: "ManyToOne",
  crossFilter: "Single",
  isActive: true,
  description: "",
};

export const LEGACY_DEMO_TABLES: ReadonlySet<string> = new Set([
  "fact_store_sales",
  "fact_transactions",
  "dim_calendar",
  "dim_customer",
  "dim_sku",
  "dim_region",
  "dim_category",
]);

export const DEFAULT_SEMANTIC_MODEL: SemanticModelApiPayload = {
  modelId: DEFAULT_MODEL_ID,
  name: DEFAULT_MODEL_NAME,
  fiscalYearStartMonth: 1,
  description: "User-defined semantic data model.",
  discourageImplicitMeasures: false,
  rlsRolePredicates: {},
  tables: [],
  relationships: [],
  measures: [],
};
