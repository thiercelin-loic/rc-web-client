import { SemanticModelApiPayload } from "./model.interface";

export const DEFAULT_MODEL_ID = "a98f12b4-539c-4b6e-8210-90c1f6d90124";
export const DEFAULT_MODEL_NAME = "Untitled Project";
export const LEGACY_MODEL_NAME = "Enterprise Operations Model";

export const MODELS_ENDPOINT = "/api/models";
export const MODELS_DEFAULT_ENDPOINT = "/api/models/default";
export const MODELS_VALIDATE_DAG_ENDPOINT = "/api/models/validate-dag";

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
  rlsRolePredicates: {},
  tables: [],
  relationships: [],
  measures: [],
};
