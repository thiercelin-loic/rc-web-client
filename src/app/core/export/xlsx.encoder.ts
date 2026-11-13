import { ExportSheetSpec, ZipEntrySpec } from "./export.interface";
import { packZip } from "./zip.encoder";

export function encodeXlsx(sheets: readonly ExportSheetSpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const sheetNames = sheets.map((sheet) => sheet.name);

  const entries: ZipEntrySpec[] = [
    {
      name: "[Content_Types].xml",
      data: encoder.encode(buildTypes(sheets.length)),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(buildRels()),
    },
    {
      name: "xl/workbook.xml",
      data: encoder.encode(buildWorkbook(sheetNames)),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(workbookRels(sheets.length)),
    },
    {
      name: "xl/styles.xml",
      data: encoder.encode(buildStyles()),
    },
  ];

  sheets.forEach((sheet, idx) => {
    entries.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: encoder.encode(buildWorksheet(sheet.rows)),
    });
  });

  return packZip(entries);
}

function buildTypes(sheetCount: number): string {
  const overrides: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(
      `  <Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...overrides,
    '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    "</Types>",
  ].join("");
}

function buildRels(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    "</Relationships>",
  ].join("");
}

function buildWorkbook(sheetNames: readonly string[]): string {
  const sheetsXml = sheetNames.map((name, idx) => {
    const sheetId = idx + 1;
    const escapedName = escapeXml(name);
    return `    <sheet name="${escapedName}" sheetId="${sheetId}" r:id="rId${sheetId}"/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "  <sheets>",
    ...sheetsXml,
    "  </sheets>",
    "</workbook>",
  ].join("");
}

function workbookRels(sheetCount: number): string {
  const relsXml: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    relsXml.push(
      `  <Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`,
    );
  }
  relsXml.push(
    `  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...relsXml,
    "</Relationships>",
  ].join("");
}

function buildStyles(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '  <fonts count="2">',
    '    <font><sz val="11"/><name val="Calibri"/></font>',
    '    <font><b/><sz val="11"/><name val="Calibri"/></font>',
    "  </fonts>",
    '  <fills count="2">',
    '    <fill><patternFill patternType="none"/></fill>',
    '    <fill><patternFill patternType="gray125"/></fill>',
    "  </fills>",
    '  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
    '  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '  <cellXfs count="2">',
    '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    "  </cellXfs>",
    '  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    "</styleSheet>",
  ].join("");
}

function buildWorksheet(rows: readonly (readonly (string | number)[])[]): string {
  const colsBlock = buildColumns(rows);
  const xmlRows = rows.map((row, idx) => buildRow(row, idx));
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    colsBlock,
    `  <sheetData>${xmlRows.join("")}</sheetData>`,
    "</worksheet>",
  ].join("");
}

function buildColumns(rows: readonly (readonly (string | number)[])[]): string {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (colCount === 0) {
    return "";
  }
  const colXml: string[] = [];
  for (let colIdx = 0; colIdx < colCount; colIdx++) {
    let maxLen = 8;
    for (const row of rows) {
      const text = String(row[colIdx] ?? "");
      if (text.length > maxLen) {
        maxLen = text.length;
      }
    }
    const width = Math.min(50, maxLen + 4);
    const colNum = colIdx + 1;
    colXml.push(
      `<col min="${colNum}" max="${colNum}" width="${width}" customWidth="1"/>`,
    );
  }
  return `  <cols>${colXml.join("")}</cols>`;
}

function buildRow(
  cells: readonly (string | number)[],
  rowIndex: number,
): string {
  const rowNumber = rowIndex + 1;
  const styleAttr = rowIndex === 0 ? ' s="1"' : "";
  const xmlCells = cells.map((cell, colIndex) => {
    const ref = columnName(colIndex) + rowNumber;
    if (rowIndex > 0 && typeof cell === "number" && Number.isFinite(cell)) {
      return `<c r="${ref}" t="n"><v>${cell}</v></c>`;
    }
    const escaped = escapeXml(String(cell ?? ""));
    return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t>${escaped}</t></is></c>`;
  });
  return `<row r="${rowNumber}">${xmlCells.join("")}</row>`;
}

function columnName(columnIndex: number): string {
  let remaining = columnIndex;
  let name = "";
  while (remaining >= 0) {
    name = String.fromCharCode((remaining % 26) + 65) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return name;
}

function escapeXml(value: string): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

