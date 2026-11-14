import {
  DataPrepColumn,
  WorkbookSheet,
} from "../../features/data-prep/data-prep.model";
import * as PARSER from "./ingestion.constants";
import {
  ArrayCandidate,
  ParsedTextResult,
  TabularJsonResult,
} from "./ingestion.interface";
import {
  buildSheet,
  collectHeaders,
  inferType,
  isObject,
  stripBom,
  toScalar,
} from "./sheet.builder";

function collectFields(
  obj: Record<string, unknown>,
  prefix: string,
  scalars: Record<string, unknown>,
  arrayCandidates: ArrayCandidate[],
): void {
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined) {
      scalars[fullKey] = null;
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        continue;
      }
      const hasComplex = val.some(
        (item) => isObject(item) || Array.isArray(item),
      );
      if (hasComplex) {
        arrayCandidates.push({ leafKey: key, fullKey, items: val });
      } else {
        scalars[fullKey] = val
          .filter((item) => item !== null && item !== undefined)
          .join(", ");
      }
    } else if (isObject(val)) {
      if (Object.keys(val).length === 0) {
        scalars[fullKey] = null;
      } else {
        collectFields(val, fullKey, scalars, arrayCandidates);
      }
    } else {
      scalars[fullKey] = val;
    }
  }
}

export function flattenJson(value: unknown): Record<string, unknown>[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    const rows: Record<string, unknown>[] = [];
    for (const item of value) {
      rows.push(...flattenJson(item));
    }
    return rows;
  }
  if (!isObject(value)) {
    return [{ [PARSER.DEFAULT_VALUE_KEY]: value }];
  }

  const scalars: Record<string, unknown> = {};
  const arrayCandidates: ArrayCandidate[] = [];
  collectFields(value, "", scalars, arrayCandidates);

  if (arrayCandidates.length === 0) {
    return Object.keys(scalars).length > 0 ? [scalars] : [];
  }

  const primary = arrayCandidates[0];
  for (const extra of arrayCandidates.slice(1)) {
    scalars[extra.fullKey] = JSON.stringify(extra.items);
  }

  const expanded: Record<string, unknown>[] = [];
  for (const childItem of primary.items) {
    const childRows = flattenJson(childItem);
    for (const childRow of childRows) {
      const merged: Record<string, unknown> = { ...scalars };
      for (const [ck, cv] of Object.entries(childRow)) {
        const targetKey = ck in merged ? `${primary.fullKey}.${ck}` : ck;
        merged[targetKey] = cv;
      }
      expanded.push(merged);
    }
  }

  return expanded.length > 0 ? expanded : [scalars];
}

export function parseJson(text: string): unknown {
  const cleaned = stripBom(text).trim();
  if (!cleaned) {
    return [];
  }
  try {
    return JSON.parse(cleaned);
  } catch (primaryError) {
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      try {
        return lines.map((line) => JSON.parse(line));
      } catch {
        throw primaryError;
      }
    }
    throw primaryError;
  }
}

function isMatrix(value: unknown): value is readonly (readonly unknown[])[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.every(
          (cell) =>
            cell === null || cell === undefined || typeof cell !== "object",
        ),
    )
  );
}

function buildMatrix(
  baseName: string,
  parsed: readonly (readonly unknown[])[],
): ParsedTextResult {
  const maxCols = parsed.reduce((max, row) => Math.max(max, row.length), 0);
  const columns: DataPrepColumn[] = Array.from(
    { length: maxCols },
    (_, index) => ({
      name: `${PARSER.COLUMN_PREFIX}${index + 1}`,
      type: PARSER.STRING_TYPE,
      icon: PARSER.STRING_TYPE,
    }),
  );
  const rows = parsed.map((row) => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < maxCols; i++) {
      record[`${PARSER.COLUMN_PREFIX}${i + 1}`] = row[i] ?? null;
    }
    return record;
  });
  return {
    sheets: [{ id: "table_1", name: baseName, kind: "Table", columns, rows }],
  };
}

export function extractJson(fileName: string, text: string): ParsedTextResult {
  const baseName =
    fileName.replace(PARSER.EXT_PATTERN, "") || PARSER.DEFAULT_DATASET;
  try {
    const parsed = parseJson(text);
    if (isMatrix(parsed)) {
      return buildMatrix(baseName, parsed);
    }

    if (isObject(parsed)) {
      const rootTables = Object.entries(parsed).filter(
        ([, val]) => Array.isArray(val) && val.some((el) => isObject(el)),
      );
      if (rootTables.length > 1) {
        const sheets: WorkbookSheet[] = rootTables.map(
          ([tableKey, items], index) => {
            const rows = flattenJson(items);
            const headers = collectHeaders(rows);
            return buildSheet(
              `table_${index + 1}`,
              tableKey,
              "Table",
              headers,
              rows,
            );
          },
        );
        return { sheets };
      }
    }

    const flatRows = flattenJson(parsed);
    const headers = collectHeaders(flatRows);
    return {
      sheets: [buildSheet("table_1", baseName, "Table", headers, flatRows)],
    };
  } catch (err: unknown) {
    const detail =
      err instanceof Error && err.message ? `: ${err.message}` : ".";
    return {
      sheets: [],
      error: `Failed to parse JSON structure in "${fileName}"${detail}`,
    };
  }
}

export function extractRecords(text: string): TabularJsonResult {
  try {
    const parsed = parseJson(text);
    const rows = flattenJson(parsed).map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        normalized[key] = val === undefined ? null : toScalar(val);
      }
      return normalized;
    });
    const headers = collectHeaders(rows);
    const columns: DataPrepColumn[] = headers.map((name) => {
      const type = inferType(rows, name);
      return { name, type, icon: type };
    });
    return { columns, rows };
  } catch (err: unknown) {
    const detail =
      err instanceof Error && err.message ? `: ${err.message}` : ".";
    return {
      columns: [],
      rows: [],
      error: `Failed to parse JSON file structure${detail}`,
    };
  }
}
