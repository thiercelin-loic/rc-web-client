import {
  DataPrepColumn,
  WorkbookSheet,
} from "../../features/data-prep/data-prep.model";
import * as PARSER from "./ingestion.constants";

export function stripBom(text: string): string {
  return text.replace(PARSER.BOM_PREFIX, "");
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toScalar(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (
      value.every(
        (item) =>
          item === null || item === undefined || typeof item !== "object",
      )
    ) {
      return value
        .filter((item) => item !== null && item !== undefined)
        .join(", ");
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

export function inferType(
  rows: readonly Record<string, unknown>[],
  columnName: string,
): string {
  const sample = rows.find(
    (row) =>
      row[columnName] !== null &&
      row[columnName] !== undefined &&
      row[columnName] !== "",
  )?.[columnName];

  if (typeof sample === "number") {
    return Number.isInteger(sample) ? PARSER.INT_TYPE : PARSER.FLOAT_TYPE;
  }
  if (typeof sample === "boolean") {
    return PARSER.BOOL_TYPE;
  }
  if (typeof sample === "string") {
    const trimmed = sample.trim();
    if (PARSER.INT_PATTERN.test(trimmed)) return PARSER.INT_TYPE;
    if (PARSER.FLOAT_PATTERN.test(trimmed)) return PARSER.FLOAT_TYPE;
    if (PARSER.BOOL_PATTERN.test(trimmed)) return PARSER.BOOL_TYPE;
    if (PARSER.DATE_PATTERN.test(trimmed)) return PARSER.DATE_TYPE;
  }
  return PARSER.STRING_TYPE;
}

export function collectHeaders(
  rows: readonly Record<string, unknown>[],
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      seen.add(key);
    }
  }
  return Array.from(seen);
}

export function buildSheet(
  id: string,
  name: string,
  kind: "Sheet" | "Table",
  headers: readonly string[],
  records: readonly Record<string, unknown>[],
): WorkbookSheet {
  if (headers.length === 0) {
    return { id, name, kind, columns: [], rows: [] };
  }

  const columns: DataPrepColumn[] = headers.map((_, index) => ({
    name: `${PARSER.COLUMN_PREFIX}${index + 1}`,
    type: PARSER.STRING_TYPE,
    icon: PARSER.STRING_TYPE,
  }));

  const unpromotedRows: Record<string, unknown>[] = [];
  const headerRow: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    headerRow[`${PARSER.COLUMN_PREFIX}${index + 1}`] = header;
  });
  unpromotedRows.push(headerRow);

  for (const record of records) {
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const raw = record[header];
      row[`${PARSER.COLUMN_PREFIX}${index + 1}`] =
        raw === undefined ? null : toScalar(raw);
    });
    unpromotedRows.push(row);
  }

  return {
    id,
    name,
    kind,
    columns,
    rows: unpromotedRows,
  };
}

export function toPayload(sheet: WorkbookSheet): string | null {
  if (sheet.columns.length === 0 || sheet.rows.length < 2) {
    return null;
  }
  if (sheet.columns[0]?.name !== `${PARSER.COLUMN_PREFIX}1`) {
    return JSON.stringify(sheet.rows);
  }

  const headerRow = sheet.rows[0];
  const keyMap = sheet.columns.map((col, index) => ({
    colKey: col.name,
    fieldName:
      String(
        headerRow[col.name] ?? `${PARSER.COLUMN_PREFIX}_${index + 1}`,
      ).trim() || col.name,
  }));

  const records = sheet.rows.slice(1).map((row) => {
    const out: Record<string, unknown> = {};
    for (const { colKey, fieldName } of keyMap) {
      out[fieldName] = row[colKey] ?? null;
    }
    return out;
  });

  return JSON.stringify(records);
}
