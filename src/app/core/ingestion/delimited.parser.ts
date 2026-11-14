import { DataPrepColumn } from "../../features/data-prep/data-prep.model";
import * as PARSER from "./ingestion.constants";
import { ParsedTextResult } from "./ingestion.interface";
import { stripBom } from "./sheet.builder";

export function detectSeparator(
  text: string,
  forcedSeparator?: string,
): string {
  if (forcedSeparator) return forcedSeparator;
  const firstLine = stripBom(text)
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!firstLine) return PARSER.COMMA_SEP;

  let inQuotes = false;
  let semicolonCount = 0;
  let tabCount = 0;
  let commaCount = 0;

  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      if (inQuotes && firstLine[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes) {
      if (ch === PARSER.SEMICOLON_SEP) semicolonCount++;
      else if (ch === PARSER.TAB_SEP) tabCount++;
      else if (ch === PARSER.COMMA_SEP) commaCount++;
    }
  }

  if (
    semicolonCount > 0 &&
    semicolonCount >= commaCount &&
    semicolonCount >= tabCount
  ) {
    return PARSER.SEMICOLON_SEP;
  }
  if (tabCount > 0 && tabCount >= commaCount) {
    return PARSER.TAB_SEP;
  }
  return PARSER.COMMA_SEP;
}

export function parseGrid(text: string, separator: string): string[][] {
  const cleaned = stripBom(text);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let wasQuoted = false;
  let hasContent = false;

  const pushCell = (): void => {
    currentRow.push(
      wasQuoted
        ? currentField
        : currentField.trim().replace(/^['"]|['"]$/g, ""),
    );
    currentField = "";
    wasQuoted = false;
  };

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"' && currentField.trim().length === 0) {
      inQuotes = true;
      wasQuoted = true;
      currentField = "";
      hasContent = true;
    } else if (ch === separator) {
      pushCell();
      hasContent = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && cleaned[i + 1] === "\n") {
        i++;
      }
      if (hasContent || currentField.trim().length > 0) {
        pushCell();
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
      }
      currentRow = [];
      currentField = "";
      wasQuoted = false;
      hasContent = false;
    } else {
      currentField += ch;
      if (ch.trim().length > 0) {
        hasContent = true;
      }
    }
  }

  if (hasContent || currentField.trim().length > 0) {
    pushCell();
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function extractDelimited(
  fileName: string,
  text: string,
  forcedSeparator?: string,
): ParsedTextResult {
  const separator = detectSeparator(text, forcedSeparator);
  const grid = parseGrid(text, separator);
  if (grid.length === 0) {
    return {
      sheets: [
        {
          id: "sheet_1",
          name: PARSER.DEFAULT_SHEET,
          kind: "Sheet",
          columns: [],
          rows: [],
        },
      ],
    };
  }

  const rawHeaders = grid[0];
  const columns: DataPrepColumn[] = rawHeaders.map((_, index) => ({
    name: `${PARSER.COLUMN_PREFIX}${index + 1}`,
    type: PARSER.STRING_TYPE,
    icon: PARSER.STRING_TYPE,
  }));

  const rows: Record<string, unknown>[] = grid.map((rowValues) => {
    const record: Record<string, unknown> = {};
    rawHeaders.forEach((_, index) => {
      const val = rowValues[index];
      record[`${PARSER.COLUMN_PREFIX}${index + 1}`] =
        val === undefined ? null : val;
    });
    return record;
  });

  const baseName = fileName.replace(PARSER.EXT_PATTERN, "");
  const isSpreadsheet = PARSER.XLS_PATTERN.test(fileName);
  return {
    sheets: [
      {
        id: isSpreadsheet ? "sheet_1" : "table_1",
        name: isSpreadsheet ? PARSER.DEFAULT_SHEET : baseName,
        kind: isSpreadsheet ? "Sheet" : "Table",
        columns,
        rows,
      },
    ],
  };
}
