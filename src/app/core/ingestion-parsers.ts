import { DataPrepColumn, WorkbookSheet } from '../features/data-prep/data-prep.model';

export interface ParsedTextResult {
  readonly sheets: WorkbookSheet[];
  readonly error?: string;
}

export interface TabularJsonResult {
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly error?: string;
}

export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toScalarCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every((item) => item === null || item === undefined || typeof item !== 'object')) {
      return value.filter((item) => item !== null && item !== undefined).join(', ');
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

export function inferColumnTypeFromRows(
  rows: readonly Record<string, unknown>[],
  columnName: string,
): string {
  const sample = rows.find(
    (r) => r[columnName] !== null && r[columnName] !== undefined && r[columnName] !== '',
  )?.[columnName];

  if (typeof sample === 'number') {
    return Number.isInteger(sample) ? 'Int64' : 'Float64';
  }
  if (typeof sample === 'boolean') {
    return 'Boolean';
  }
  if (typeof sample === 'string') {
    const trimmed = sample.trim();
    if (/^-?\d+$/.test(trimmed)) return 'Int64';
    if (/^-?\d+\.\d+$/.test(trimmed)) return 'Float64';
    if (/^(true|false|yes|no)$/i.test(trimmed)) return 'Boolean';
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return 'Date';
  }
  return 'String';
}

export function collectOrderedHeaders(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      seen.add(key);
    }
  }
  return Array.from(seen);
}

export function buildUnpromotedSheet(
  id: string,
  name: string,
  kind: 'Sheet' | 'Table',
  headers: readonly string[],
  records: readonly Record<string, unknown>[],
): WorkbookSheet {
  if (headers.length === 0) {
    return { id, name, kind, columns: [], rows: [] };
  }

  const columns: DataPrepColumn[] = headers.map((_, i) => ({
    name: `Column${i + 1}`,
    type: 'String',
    icon: 'String',
  }));

  const unpromotedRows: Record<string, unknown>[] = [];
  const headerRow: Record<string, unknown> = {};
  headers.forEach((header, i) => {
    headerRow[`Column${i + 1}`] = header;
  });
  unpromotedRows.push(headerRow);

  for (const rec of records) {
    const row: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      const raw = rec[header];
      row[`Column${i + 1}`] = raw === undefined ? null : toScalarCell(raw);
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

export function unpromotedSheetToJsonPayload(sheet: WorkbookSheet): string | null {
  if (sheet.columns.length === 0 || sheet.rows.length < 2) {
    return null;
  }
  if (sheet.columns[0]?.name !== 'Column1') {
    return JSON.stringify(sheet.rows);
  }

  const headerRow = sheet.rows[0];
  const keyMap = sheet.columns.map((col, idx) => ({
    colKey: col.name,
    fieldName: String(headerRow[col.name] ?? `Column_${idx + 1}`).trim() || col.name,
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

interface ArrayCandidate {
  readonly leafKey: string;
  readonly fullKey: string;
  readonly items: readonly unknown[];
}

function collectObjectFields(
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
      const hasComplexElement = val.some(
        (item) => isPlainObject(item) || Array.isArray(item),
      );
      if (hasComplexElement) {
        arrayCandidates.push({ leafKey: key, fullKey, items: val });
      } else {
        scalars[fullKey] = val
          .filter((item) => item !== null && item !== undefined)
          .join(', ');
      }
    } else if (isPlainObject(val)) {
      if (Object.keys(val).length === 0) {
        scalars[fullKey] = null;
      } else {
        collectObjectFields(val, fullKey, scalars, arrayCandidates);
      }
    } else {
      scalars[fullKey] = val;
    }
  }
}

export function flattenJsonValue(value: unknown): Record<string, unknown>[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    const rows: Record<string, unknown>[] = [];
    for (const item of value) {
      rows.push(...flattenJsonValue(item));
    }
    return rows;
  }
  if (!isPlainObject(value)) {
    return [{ Value: value }];
  }

  const scalars: Record<string, unknown> = {};
  const arrayCandidates: ArrayCandidate[] = [];
  collectObjectFields(value, '', scalars, arrayCandidates);

  if (arrayCandidates.length === 0) {
    return Object.keys(scalars).length > 0 ? [scalars] : [];
  }

  const primary = arrayCandidates[0];
  for (const extra of arrayCandidates.slice(1)) {
    scalars[extra.fullKey] = JSON.stringify(extra.items);
  }

  const expanded: Record<string, unknown>[] = [];
  for (const childItem of primary.items) {
    const childRows = flattenJsonValue(childItem);
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

export function parseJsonDocument(text: string): unknown {
  const cleaned = stripBom(text).trim();
  if (!cleaned) {
    return [];
  }
  try {
    return JSON.parse(cleaned);
  } catch (primaryError) {
    const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

export function extractSheetsFromJson(fileName: string, text: string): ParsedTextResult {
  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'Dataset';
  try {
    const parsed = parseJsonDocument(text);

    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (row) =>
          Array.isArray(row) &&
          row.every((cell) => cell === null || cell === undefined || typeof cell !== 'object'),
      )
    ) {
      const maxCols = parsed.reduce((max, row) => Math.max(max, row.length), 0);
      const columns: DataPrepColumn[] = Array.from({ length: maxCols }, (_, i) => ({
        name: `Column${i + 1}`,
        type: 'String',
        icon: 'String',
      }));
      const rows = (parsed as unknown[][]).map((row) => {
        const rec: Record<string, unknown> = {};
        for (let i = 0; i < maxCols; i++) {
          rec[`Column${i + 1}`] = row[i] ?? null;
        }
        return rec;
      });
      return {
        sheets: [{ id: 'table_1', name: baseName, kind: 'Table', columns, rows }],
      };
    }

    if (isPlainObject(parsed)) {
      const rootArrayTables = Object.entries(parsed).filter(
        ([, val]) => Array.isArray(val) && val.some((el) => isPlainObject(el)),
      );
      if (rootArrayTables.length > 1) {
        const sheets: WorkbookSheet[] = rootArrayTables.map(([tableKey, items], idx) => {
          const rows = flattenJsonValue(items);
          const headers = collectOrderedHeaders(rows);
          return buildUnpromotedSheet(
            `table_${idx + 1}`,
            tableKey,
            'Table',
            headers,
            rows,
          );
        });
        return { sheets };
      }
    }

    const flatRows = flattenJsonValue(parsed);
    const headers = collectOrderedHeaders(flatRows);
    return {
      sheets: [buildUnpromotedSheet('table_1', baseName, 'Table', headers, flatRows)],
    };
  } catch (err: unknown) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '.';
    return {
      sheets: [],
      error: `Failed to parse JSON structure in "${fileName}"${detail}`,
    };
  }
}

export function extractTabularRecordsFromJson(text: string): TabularJsonResult {
  try {
    const parsed = parseJsonDocument(text);
    const rows = flattenJsonValue(parsed).map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        normalized[k] = v === undefined ? null : toScalarCell(v);
      }
      return normalized;
    });
    const headers = collectOrderedHeaders(rows);
    const columns: DataPrepColumn[] = headers.map((name) => {
      const type = inferColumnTypeFromRows(rows, name);
      return { name, type, icon: type };
    });
    return { columns, rows };
  } catch (err: unknown) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '.';
    return {
      columns: [],
      rows: [],
      error: `Failed to parse JSON file structure${detail}`,
    };
  }
}

function collectXmlElementFields(
  element: Element,
  prefix: string,
  scalars: Record<string, unknown>,
  arrayGroups: Array<{ key: string; elements: Element[] }>,
): void {
  for (const attr of Array.from(element.attributes)) {
    const attrName = prefix ? `${prefix}.@${attr.name}` : `@${attr.name}`;
    scalars[attrName] = attr.value;
  }

  const children = Array.from(element.children);
  if (children.length === 0) {
    const textVal = element.textContent?.trim() ?? '';
    if (prefix) {
      scalars[prefix] = textVal === '' ? null : textVal;
    } else if (textVal !== '') {
      scalars['Value'] = textVal;
    }
    return;
  }

  const groupedByTag = new Map<string, Element[]>();
  for (const child of children) {
    const list = groupedByTag.get(child.tagName) ?? [];
    list.push(child);
    groupedByTag.set(child.tagName, list);
  }

  for (const [tag, group] of groupedByTag.entries()) {
    const childPrefix = prefix ? `${prefix}.${tag}` : tag;
    if (group.length > 1) {
      const allSimpleLeaves = group.every(
        (el) => el.children.length === 0 && el.attributes.length === 0,
      );
      if (allSimpleLeaves) {
        scalars[childPrefix] = group
          .map((el) => el.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(', ');
      } else {
        arrayGroups.push({ key: tag, elements: group });
      }
    } else {
      const single = group[0];
      const singleChildren = Array.from(single.children);
      const isWrapperOfRepeated =
        singleChildren.length > 1 &&
        singleChildren.every((c) => c.tagName === singleChildren[0].tagName) &&
        singleChildren.some((c) => c.children.length > 0 || c.attributes.length > 0);
      if (isWrapperOfRepeated && single.attributes.length === 0) {
        arrayGroups.push({ key: tag, elements: singleChildren });
      } else {
        collectXmlElementFields(single, childPrefix, scalars, arrayGroups);
      }
    }
  }
}

function flattenXmlRecordElement(element: Element): Record<string, unknown>[] {
  const scalars: Record<string, unknown> = {};
  const arrayGroups: Array<{ key: string; elements: Element[] }> = [];
  collectXmlElementFields(element, '', scalars, arrayGroups);

  if (arrayGroups.length === 0) {
    return Object.keys(scalars).length > 0 ? [scalars] : [];
  }

  const primary = arrayGroups[0];
  const expanded: Record<string, unknown>[] = [];
  for (const childEl of primary.elements) {
    const childRows = flattenXmlRecordElement(childEl);
    for (const childRow of childRows) {
      const merged: Record<string, unknown> = { ...scalars };
      for (const [ck, cv] of Object.entries(childRow)) {
        const targetKey = ck in merged ? `${primary.key}.${ck}` : ck;
        merged[targetKey] = cv;
      }
      expanded.push(merged);
    }
  }

  return expanded.length > 0 ? expanded : [scalars];
}

export function extractSheetsFromXml(fileName: string, text: string): ParsedTextResult {
  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'XmlData';
  const cleaned = stripBom(text).trim();
  if (!cleaned) {
    return { sheets: [buildUnpromotedSheet('table_1', baseName, 'Table', [], [])] };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    return {
      sheets: [],
      error: `Failed to parse XML structure in "${fileName}".`,
    };
  }

  const root = doc.documentElement;
  const rootChildren = Array.from(root.children);
  if (rootChildren.length === 0) {
    const rows = flattenXmlRecordElement(root);
    const headers = collectOrderedHeaders(rows);
    return {
      sheets: [buildUnpromotedSheet('table_1', baseName, 'Table', headers, rows)],
    };
  }

  const hasRepeatingRootChildren =
    rootChildren.length > 1 ||
    rootChildren[0].children.length > 0 ||
    rootChildren[0].attributes.length > 0;

  let recordElements: Element[] = hasRepeatingRootChildren ? rootChildren : [root];
  if (
    rootChildren.length === 1 &&
    rootChildren[0].children.length > 0 &&
    rootChildren[0].attributes.length === 0 &&
    Array.from(rootChildren[0].children).some(
      (c) => c.children.length > 0 || c.attributes.length > 0,
    )
  ) {
    recordElements = Array.from(rootChildren[0].children);
  }

  const flatRows: Record<string, unknown>[] = [];
  for (const el of recordElements) {
    flatRows.push(...flattenXmlRecordElement(el));
  }
  const headers = collectOrderedHeaders(flatRows);
  return {
    sheets: [buildUnpromotedSheet('table_1', baseName, 'Table', headers, flatRows)],
  };
}

export function detectDelimitedSeparator(text: string, forcedSeparator?: string): string {
  if (forcedSeparator) return forcedSeparator;
  const firstLine = stripBom(text)
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0);
  if (!firstLine) return ',';

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
      if (ch === ';') semicolonCount++;
      else if (ch === '\t') tabCount++;
      else if (ch === ',') commaCount++;
    }
  }

  if (semicolonCount > 0 && semicolonCount >= commaCount && semicolonCount >= tabCount) {
    return ';';
  }
  if (tabCount > 0 && tabCount >= commaCount) {
    return '\t';
  }
  return ',';
}

export function parseDelimitedGrid(text: string, separator: string): string[][] {
  const cleaned = stripBom(text);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let wasQuoted = false;
  let hasContentInRow = false;

  const pushCell = (): void => {
    currentRow.push(wasQuoted ? currentField : currentField.trim().replace(/^['"]|['"]$/g, ''));
    currentField = '';
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
      currentField = '';
      hasContentInRow = true;
    } else if (ch === separator) {
      pushCell();
      hasContentInRow = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && cleaned[i + 1] === '\n') {
        i++;
      }
      if (hasContentInRow || currentField.trim().length > 0) {
        pushCell();
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
      }
      currentRow = [];
      currentField = '';
      wasQuoted = false;
      hasContentInRow = false;
    } else {
      currentField += ch;
      if (ch.trim().length > 0) {
        hasContentInRow = true;
      }
    }
  }

  if (hasContentInRow || currentField.trim().length > 0) {
    pushCell();
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function extractSheetsFromDelimitedText(
  fileName: string,
  text: string,
  forcedSeparator?: string,
): ParsedTextResult {
  const separator = detectDelimitedSeparator(text, forcedSeparator);
  const grid = parseDelimitedGrid(text, separator);
  if (grid.length === 0) {
    return {
      sheets: [{ id: 'sheet_1', name: 'Sheet1', kind: 'Sheet', columns: [], rows: [] }],
    };
  }

  const rawHeaders = grid[0];
  const unpromotedCols: DataPrepColumn[] = rawHeaders.map((_, i) => ({
    name: `Column${i + 1}`,
    type: 'String',
    icon: 'String',
  }));

  const unpromotedRows: Record<string, unknown>[] = [];
  for (const rowValues of grid) {
    const record: Record<string, unknown> = {};
    rawHeaders.forEach((_, i) => {
      const val = rowValues[i];
      record[`Column${i + 1}`] = val === undefined ? null : val;
    });
    unpromotedRows.push(record);
  }

  const baseName = fileName.replace(/\.[^/.]+$/, '');
  const isSpreadsheet = /\.xlsx?$/i.test(fileName);
  return {
    sheets: [
      {
        id: isSpreadsheet ? 'sheet_1' : 'table_1',
        name: isSpreadsheet ? 'Sheet1' : baseName,
        kind: isSpreadsheet ? 'Sheet' : 'Table',
        columns: unpromotedCols,
        rows: unpromotedRows,
      },
    ],
  };
}
