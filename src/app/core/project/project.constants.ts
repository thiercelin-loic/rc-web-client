export const PROJECT_EXTENSION = ".rcp";
export const PROJECT_FORMAT_VERSION = "1.0.0";
export const PROJECT_ENGINE_VERSION = "1.0.0";
export const PROJECT_GRID_COLUMNS = 12;

export const MANIFEST_SCHEMA_URL = "urn:rollercoaster:schemas:v1:manifest";
export const DEFINITION_SCHEMA_URL = "urn:rollercoaster:schemas:v1:definition";
export const THEME_SCHEMA_URL = "urn:rollercoaster:schemas:v1:theme";

export const DEFAULT_PAGE_TITLE = "Page 1";
export const DEFAULT_BRANCH = "workspace/main";
export const DEFAULT_WATERMARK = "00:00";
export const FALLBACK_UUID = "a98f12b4-539c-4b6e-8210-90c1f6d90124";

export const ZIP_MAGIC_BYTES: readonly number[] = [0x50, 0x4b, 0x03, 0x04];

export const PROJECT_THEME_NAME = "RollerCoaster Corporate Theme";
export const PROJECT_THEME_TOKENS: Readonly<Record<string, string>> = {
  "--rc-primary": "#FF981A",
  "--rc-primary-dark": "#E65100",
  "--rc-surface-light": "#F2F2F2",
  "--rc-surface-dark": "#333333",
  "--rc-text-pure": "#FFFFFF",
  "--rc-text-dark": "#333333",
  "--rc-neutral-soft": "#B9C1C6",
};
