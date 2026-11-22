import {
  ProjectDescriptor,
  RaxMeasureDescriptor,
} from "./state.interface";

export const THEME_STORAGE_KEY = "rc_theme_preference";
export const MEASURES_STORAGE_KEY = "rc_measures_state";
export const TABLES_STORAGE_KEY = "rc_tables_state";
export const TABLE_ROWS_STORAGE_KEY = "rc_table_rows_state";
export const WORKSPACE_STORAGE_KEY = "rc_workspace_state";
export const ANONYMOUS_STORAGE_SCOPE = "anonymous";

export const DEFAULT_PROJECT_FILENAME = "Untitled Project.rcp";
export const DEFAULT_PROJECT_BRANCH = "workspace/main";
export const DEFAULT_PROJECT_WATERMARK = "00:00";

export const DEFAULT_PROJECT_DESCRIPTOR: ProjectDescriptor = {
  filename: DEFAULT_PROJECT_FILENAME,
  statusPill: "draft [unsaved]",
  branch: DEFAULT_PROJECT_BRANCH,
  watermark: DEFAULT_PROJECT_WATERMARK,
};

export const EMPTY_MEASURE: RaxMeasureDescriptor = {
  id: "",
  label: "No measure selected",
  formula: "",
  table: "",
};
