import { ExportFormatType } from "./export.interface";

export const EXPORT_API_BASE = "/api/reports";
export const DEFAULT_PROJECT_NAME = "Untitled Project";

export const EXPORT_MIME_TYPES: Readonly<Record<ExportFormatType, string>> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};
