import { BackendDataType, FilterOperatorOption } from "./prep.interface";

export const PREVIEW_ENDPOINT = "/api/ingestion/pipeline/preview";
export const DEFAULT_TENANT_ID = "default-tenant";
export const DEFAULT_DATASET_ID = "preview-dataset";
export const DEFAULT_EXPECTED_TYPE = "UTF8_STRING";
export const DEFAULT_ERROR_REASON = "Validation failure";

export const BACKEND_DATA_TYPES: ReadonlySet<string> = new Set<BackendDataType>([
  "INT64",
  "FLOAT64",
  "DECIMAL",
  "CURRENCY",
  "BOOLEAN",
  "ISO_DATE",
  "ISO_DATETIME",
  "UTF8_STRING",
]);

export const FILTER_OPERATORS: readonly FilterOperatorOption[] = [
  { id: "equals", label: "Equals" },
  { id: "notEquals", label: "Does not equal" },
  { id: "greaterThan", label: "Greater than" },
  { id: "greaterOrEqual", label: "Greater than or equal to" },
  { id: "lessThan", label: "Less than" },
  { id: "lessOrEqual", label: "Less than or equal to" },
  { id: "between", label: "Between (RangeStart <= x < RangeEnd)" },
  { id: "notEmpty", label: "Is not empty" },
];
