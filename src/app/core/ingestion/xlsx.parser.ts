import {
  DataPrepColumn,
  WorkbookSheet,
} from '../../features/data-prep/data-prep.model';
import { unpackZipArchive } from '../zip-archive';
import * as PARSER from './ingestion.constants';

function queryNodes(root: Document | Element, tag: string): Element[] {
  const direct = Array.from(root.getElementsByTagName(tag));
  return direct.length > 0 ? direct : Array.from(root.getElementsByTagNameNS('*', tag));
}

function readStrings(
  entries: Record<string, Uint8Array>,
  decoder: TextDecoder,
  parser: DOMParser,
): string[] {
  const bytes = entries['xl/sharedStrings.xml'];
  if (!bytes) return [];
  const doc = parser.parseFromString(decoder.decode(bytes), 'application/xml');
  return queryNodes(doc, 'si').map((si) =>
    queryNodes(si, 't')
      .map((node) => node.textContent ?? '')
      .join(''),
  );
}

function readRels(
  entries: Record<string, Uint8Array>,
  decoder: TextDecoder,
  parser: DOMParser,
): Map<string, string> {
  const targetById = new Map<string, string>();
  const bytes = entries['xl/_rels/workbook.xml.rels'];
  if (!bytes) return targetById;

  const doc = parser.parseFromString(decoder.decode(bytes), 'application/xml');
  for (const rel of queryNodes(doc, 'Relationship')) {
    const id = rel.getAttribute('Id') ?? '';
    const rawTarget = rel.getAttribute('Target') ?? '';
    if (!id || !rawTarget) continue;

    const normalized = rawTarget.startsWith('/xl/')
      ? rawTarget.slice(1)
      : rawTarget.startsWith('xl/')
        ? rawTarget
        : `xl/${rawTarget.replace(/^\/+/, '')}`;
    targetById.set(id, normalized);
  }
  return targetById;
}

function cellColumn(cellRef: string, fallback: number): number {
  const match = cellRef.match(/^[A-Za-z]+/);
  if (!match) return fallback;
  const letters = match[0].toUpperCase();
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function readCell(
  cellEl: Element,
  sharedStrings: readonly string[],
): unknown {
  const cellType = cellEl.getAttribute('t') ?? '';
  if (cellType === 'inlineStr') {
    return queryNodes(cellEl, 't')
      .map((node) => node.textContent ?? '')
      .join('');
  }

  const vNode = queryNodes(cellEl, 'v')[0];
  const rawV = vNode?.textContent ?? '';
  if (rawV === '') return null;

  if (cellType === 's') {
    const sstIdx = Number.parseInt(rawV, 10);
    return sharedStrings[sstIdx] ?? rawV;
  }
  if (cellType === 'b') {
    return rawV === '1' || rawV.toLowerCase() === 'true';
  }
  if (cellType === 'str' || cellType === 'e') {
    return rawV;
  }

  const num = Number(rawV);
  return Number.isNaN(num)
    ? rawV
    : Number.isInteger(num)
      ? num
      : Number(num.toFixed(6));
}

function parseWorksheet(
  sheetXml: string,
  sharedStrings: readonly string[],
  parser: DOMParser,
): { columns: DataPrepColumn[]; rows: Record<string, unknown>[] } {
  const doc = parser.parseFromString(sheetXml, 'application/xml');
  let maxCols = 0;
  const rawMatrix: Array<Record<number, unknown>> = [];

  for (const rowEl of queryNodes(doc, 'row')) {
    let nextColIdx = 0;
    const rowValues: Record<number, unknown> = {};
    let hasNonEmpty = false;

    for (const cellEl of queryNodes(rowEl, 'c')) {
      const ref = cellEl.getAttribute('r') ?? '';
      const colIdx = ref ? cellColumn(ref, nextColIdx) : nextColIdx;
      nextColIdx = colIdx + 1;
      if (colIdx + 1 > maxCols) {
        maxCols = colIdx + 1;
      }

      const val = readCell(cellEl, sharedStrings);
      if (val !== null && val !== undefined && val !== '') {
        hasNonEmpty = true;
      }
      rowValues[colIdx] = val;
    }

    if (hasNonEmpty) {
      rawMatrix.push(rowValues);
    }
  }

  const columns: DataPrepColumn[] = Array.from({ length: maxCols }, (_, i) => ({
    name: `${PARSER.COLUMN_PREFIX}${i + 1}`,
    type: PARSER.STRING_TYPE,
    icon: PARSER.STRING_TYPE,
  }));

  const rows: Record<string, unknown>[] = rawMatrix.map((rowValues) => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < maxCols; i++) {
      record[`${PARSER.COLUMN_PREFIX}${i + 1}`] = rowValues[i] ?? null;
    }
    return record;
  });

  return { columns, rows };
}

/** Extracts unpromoted workbook sheets from an OpenXML `.xlsx` binary buffer. */
export function extractXlsx(buffer: ArrayBuffer): WorkbookSheet[] {
  try {
    const entries = unpackZipArchive(buffer);
    if (!entries['xl/workbook.xml']) {
      return [];
    }

    const decoder = new TextDecoder();
    const parser = new DOMParser();
    const sharedStrings = readStrings(entries, decoder, parser);
    const relsTargetById = readRels(entries, decoder, parser);

    const wbDoc = parser.parseFromString(
      decoder.decode(entries['xl/workbook.xml']),
      'application/xml',
    );
    const extractedSheets: WorkbookSheet[] = [];

    queryNodes(wbDoc, 'sheet').forEach((sheetEl, idx) => {
      const sheetName = sheetEl.getAttribute('name') || `Sheet${idx + 1}`;
      const rId =
        sheetEl.getAttribute('r:id') ||
        sheetEl.getAttributeNS(PARSER.OPENXML_RELS_NS, 'id') ||
        '';
      const targetPath =
        (rId && relsTargetById.get(rId)) || `xl/worksheets/sheet${idx + 1}.xml`;
      const sheetBytes =
        entries[targetPath] ?? entries[`xl/worksheets/sheet${idx + 1}.xml`];
      if (!sheetBytes) return;

      const parsedGrid = parseWorksheet(
        decoder.decode(sheetBytes),
        sharedStrings,
        parser,
      );
      extractedSheets.push({
        id: `sheet_${idx + 1}`,
        name: sheetName,
        kind: 'Sheet',
        sheetName,
        columns: parsedGrid.columns,
        rows: parsedGrid.rows,
      });
    });

    return extractedSheets;
  } catch {
    return [];
  }
}
