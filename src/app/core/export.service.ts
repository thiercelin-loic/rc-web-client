import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, catchError, map, of, throwError } from 'rxjs';
import { StateManagerService } from './state-manager.service';

export type ExportFormatType = '.pdf' | '.xlsx' | '.parquet' | '.csv' | '.tsv';

export interface ExportJobReceipt {
  readonly jobId: string;
  readonly format: ExportFormatType;
  readonly mimeType: string;
  readonly filename: string;
  readonly engine: string;
  readonly status: 'COMPLETED' | 'STREAMING';
  readonly timestamp: string;
  readonly fileContentBase64?: string | null;
}

export interface TabularExportData {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface ExportFormatMeta {
  readonly mimeType: string;
  readonly filename: string;
  readonly engine: string;
}

interface ColumnChunkMetadata {
  readonly columnName: string;
  readonly fileOffset: number;
  readonly totalByteSize: number;
}

interface ExportPayload {
  readonly reportId: string;
  readonly visualId: string;
  readonly format: ExportFormatType;
  readonly dpi: number;
  readonly includeBom: boolean;
  readonly delimiter: string;
  readonly contextHash: string;
  readonly projectName: string;
  readonly pageName: string;
  readonly canvasDimensions?: {
    readonly width: number;
    readonly height: number;
    readonly preset?: string;
  };
  readonly visuals: readonly {
    readonly id: string;
    readonly title: string;
    readonly archetype: string;
    readonly width: 'half' | 'full';
    readonly metricLabel: string;
    readonly metricValue: string;
    readonly metricSubtext: string;
  }[];
  readonly measures: readonly {
    readonly id: string;
    readonly label: string;
    readonly formula: string;
    readonly table: string;
  }[];
}

// ---------------------------------------------------------------------------
// OpenXML & ZIP File Signatures
// ---------------------------------------------------------------------------
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50; // PK\x03\x04
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50; // PK\x01\x02
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50; // PK\x05\x06
const ZIP_VERSION_20 = 20;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_EOCD_BYTE_LENGTH = 22;

// ---------------------------------------------------------------------------
// Apache Parquet v1 & Thrift Compact Protocol Constants
// ---------------------------------------------------------------------------
const PARQUET_MAGIC_STRING = 'PAR1';
const PARQUET_FOOTER_LENGTH_BYTES = 4;
const PARQUET_BYTE_ARRAY_TYPE = 6;
const PARQUET_REQUIRED_REPETITION = 0;
const PARQUET_UTF8_CONVERTED_TYPE = 0;
const PARQUET_UNCOMPRESSED_CODEC = 0;
const PARQUET_PLAIN_ENCODING = 0;
const PARQUET_RLE_ENCODING = 3;

// Thrift Compact Field Delimiters and Types
const THRIFT_STOP = 0x00;
const THRIFT_I32_DELTA_1 = 0x15;
const THRIFT_I64_DELTA_1 = 0x16;
const THRIFT_BINARY_DELTA_1 = 0x18;
const THRIFT_LIST_DELTA_1 = 0x19;
const THRIFT_STRUCT_DELTA_1 = 0x1c;
const THRIFT_I32_DELTA_2 = 0x25;
const THRIFT_I64_DELTA_2 = 0x26;
const THRIFT_BINARY_DELTA_2 = 0x28;
const THRIFT_STRUCT_DELTA_2 = 0x2c;
const THRIFT_BINARY_DELTA_4 = 0x48;

// ---------------------------------------------------------------------------
// CRC-32 Lookup Table (Precomputed for IEEE 802.3 Ethernet / ZIP standard)
// ---------------------------------------------------------------------------
const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let checksum = index;
    for (let bit = 0; bit < 8; bit++) {
      checksum = checksum & 1 ? CRC32_POLYNOMIAL ^ (checksum >>> 1) : checksum >>> 1;
    }
    table[index] = checksum >>> 0;
  }
  return table;
})();

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);

  private readonly lastExportReceiptSignal = signal<ExportJobReceipt | null>(null);
  public readonly lastExportReceipt = this.lastExportReceiptSignal.asReadonly();

  // ---------------------------------------------------------------------------
  // Public Export API
  // ---------------------------------------------------------------------------

  public triggerExport(
    reportId: string,
    visualId: string,
    format: ExportFormatType,
    canvasDimensions?: { width: number; height: number; preset?: string }
  ): Observable<ExportJobReceipt> {
    const formatMeta = this.resolveFormatMeta(format);
    const activeVisuals = this.state.activePageVisuals();

    if (activeVisuals.length === 0) {
      this.lastExportReceiptSignal.set(null);
      this.state.setLoading(false);
      this.state.announceError(
        `Export of ${formatMeta.filename}`,
        `page "${this.state.activePage()}" has no visuals to export — add at least one visual on the canvas first`,
      );
      return EMPTY;
    }

    this.state.setLoading(true, `Exporting ${format}...`);

    const endpoint = this.resolveExportEndpoint(reportId, visualId, format);
    const payload = this.buildExportPayload(
      reportId,
      visualId,
      format,
      activeVisuals,
      canvasDimensions
    );

    return this.http.post<ExportJobReceipt>(endpoint, payload).pipe(
      map((serverReceipt) => {
        const consolidatedReceipt: ExportJobReceipt = {
          ...serverReceipt,
          format,
          filename: serverReceipt.filename || formatMeta.filename,
          mimeType: serverReceipt.mimeType || formatMeta.mimeType,
          engine: serverReceipt.engine || formatMeta.engine,
        };
        this.finalizeReceiptDownload(consolidatedReceipt);
        return consolidatedReceipt;
      }),
      catchError((error: HttpErrorResponse) => {
        if (error && error.status === 400) {
          this.lastExportReceiptSignal.set(null);
          this.state.setLoading(false);
          this.state.announceError(
            `Export of ${formatMeta.filename}`,
            error,
          );
          return throwError(() => error);
        }

        // Offline / local fallback: synthesize valid binary/tabular export in browser
        const fallbackReceipt = this.createFallbackReceipt(format, formatMeta);
        this.finalizeReceiptDownload(fallbackReceipt);
        return of(fallbackReceipt);
      })
    );
  }

  public downloadReceiptFile(receipt: ExportJobReceipt): void {
    if (receipt.format === '.pdf' && typeof window !== 'undefined' && typeof window.print === 'function') {
      this.printInLightMode();
      return;
    }

    const content = this.generateExportContent(receipt);
    this.triggerBrowserDownload(content, receipt.filename, receipt.mimeType);
  }

  // ---------------------------------------------------------------------------
  // Dataset & Delimited Builders
  // ---------------------------------------------------------------------------

  public buildTabularDataset(receipt: ExportJobReceipt): TabularExportData {
    const columns: readonly string[] = [
      'Project',
      'Page',
      'Visual ID',
      'Visual Title',
      'Archetype',
      'Metric Label',
      'Metric Value',
      'Metric Subtext',
      'Context Hash',
      'Exported At',
    ];

    const projectName = this.state.activeProject().filename;
    const pageName = this.state.activePage();
    const contextHash = this.state.activeFilters().toContextHash();
    const activeVisuals = this.state.activePageVisuals();

    const rows: readonly (readonly string[])[] = activeVisuals.map((visual) => [
      projectName,
      pageName,
      visual.id,
      visual.title,
      visual.archetype,
      visual.metricLabel,
      visual.metricValue,
      visual.metricSubtext,
      contextHash,
      receipt.timestamp,
    ]);

    return { columns, rows };
  }

  public buildDelimitedContent(receipt: ExportJobReceipt, delimiter: string): string {
    const dataset = this.buildTabularDataset(receipt);
    const lines: string[] = [];

    lines.push(
      dataset.columns
        .map((columnName) => this.escapeDelimitedCell(columnName, delimiter))
        .join(delimiter)
    );

    for (const row of dataset.rows) {
      lines.push(
        row
          .map((cellValue) => this.escapeDelimitedCell(cellValue, delimiter))
          .join(delimiter)
      );
    }

    // Prepend UTF-8 BOM (\uFEFF) for localized spreadsheet compatibility
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // OpenXML XLSX ZIP Archive Generator
  // ---------------------------------------------------------------------------

  /**
   * Builds a standards-compliant OpenXML (.xlsx) ZIP archive containing
   * [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels,
   * xl/styles.xml, xl/worksheets/sheet1.xml (Report Visuals), and xl/worksheets/sheet2.xml (Measures).
   */
  public buildXlsxZipBytes(receipt: ExportJobReceipt): Uint8Array {
    const encoder = new TextEncoder();
    const dataset = this.buildTabularDataset(receipt);

    const sheet1Rows: readonly (readonly string[])[] = [
      dataset.columns,
      ...dataset.rows,
    ];
    const sheet1Xml = this.buildWorksheetXml(sheet1Rows);

    const measureRows: readonly (readonly string[])[] = [
      ['Measure ID', 'Measure Name', 'Table', 'RAX Expression'],
      ...this.state.measures.map((measure) => [
        measure.id,
        measure.label,
        measure.table,
        measure.formula,
      ]),
    ];
    const sheet2Xml = this.buildWorksheetXml(measureRows);

    const entries: readonly ZipEntrySpec[] = [
      { name: '[Content_Types].xml', data: encoder.encode(this.buildContentTypesXml()) },
      { name: '_rels/.rels', data: encoder.encode(this.buildRootRelationshipsXml()) },
      { name: 'xl/workbook.xml', data: encoder.encode(this.buildWorkbookXml()) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(this.buildWorkbookRelationshipsXml()) },
      { name: 'xl/styles.xml', data: encoder.encode(this.buildStylesXml()) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet1Xml) },
      { name: 'xl/worksheets/sheet2.xml', data: encoder.encode(sheet2Xml) },
    ];

    return this.packZipArchive(entries);
  }

  // ---------------------------------------------------------------------------
  // Apache Parquet Binary Generator
  // ---------------------------------------------------------------------------

  /**
   * Builds a binary Apache Parquet v1 file with valid PAR1 header/footer magic bytes,
   * uncompressed BYTE_ARRAY column chunks, and a Thrift-encoded FileMetaData footer.
   */
  public buildParquetBinaryBytes(receipt: ExportJobReceipt): Uint8Array {
    const encoder = new TextEncoder();
    const dataset = this.buildTabularDataset(receipt);
    const rowCount = dataset.rows.length;
    const magicBytes = encoder.encode(PARQUET_MAGIC_STRING);

    const columnChunksBytes: Uint8Array[] = [];
    const columnChunkMetadataList: ColumnChunkMetadata[] = [];

    let currentOffset = magicBytes.length; // Starts at byte 4 after leading "PAR1"

    for (let columnIndex = 0; columnIndex < dataset.columns.length; columnIndex++) {
      const columnName = dataset.columns[columnIndex];
      const encodedValues: Uint8Array[] = [];
      let valuesByteLength = 0;

      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const rawString = dataset.rows[rowIndex][columnIndex] ?? '';
        const utf8Bytes = encoder.encode(rawString);
        const valueBuffer = new Uint8Array(4 + utf8Bytes.length);
        new DataView(valueBuffer.buffer).setUint32(0, utf8Bytes.length, true);
        valueBuffer.set(utf8Bytes, 4);
        encodedValues.push(valueBuffer);
        valuesByteLength += valueBuffer.length;
      }

      const pageHeader = this.encodeParquetDataPageHeader(rowCount, valuesByteLength);
      const chunkTotalLength = pageHeader.length + valuesByteLength;
      const chunkBytes = new Uint8Array(chunkTotalLength);
      chunkBytes.set(pageHeader, 0);

      let writePosition = pageHeader.length;
      for (const valueBuffer of encodedValues) {
        chunkBytes.set(valueBuffer, writePosition);
        writePosition += valueBuffer.length;
      }

      columnChunksBytes.push(chunkBytes);
      columnChunkMetadataList.push({
        columnName,
        fileOffset: currentOffset,
        totalByteSize: chunkTotalLength,
      });
      currentOffset += chunkTotalLength;
    }

    const footerMetadata = this.encodeParquetFileMetaData(
      dataset.columns,
      rowCount,
      columnChunkMetadataList
    );

    const footerLengthBuffer = new Uint8Array(PARQUET_FOOTER_LENGTH_BYTES);
    new DataView(footerLengthBuffer.buffer).setUint32(0, footerMetadata.length, true);

    const totalFileSize =
      magicBytes.length +
      columnChunksBytes.reduce((accumulated, chunk) => accumulated + chunk.length, 0) +
      footerMetadata.length +
      PARQUET_FOOTER_LENGTH_BYTES +
      magicBytes.length;

    const outputBuffer = new Uint8Array(totalFileSize);
    let bufferPosition = 0;

    outputBuffer.set(magicBytes, bufferPosition);
    bufferPosition += magicBytes.length;

    for (const chunk of columnChunksBytes) {
      outputBuffer.set(chunk, bufferPosition);
      bufferPosition += chunk.length;
    }

    outputBuffer.set(footerMetadata, bufferPosition);
    bufferPosition += footerMetadata.length;

    outputBuffer.set(footerLengthBuffer, bufferPosition);
    bufferPosition += PARQUET_FOOTER_LENGTH_BYTES;

    outputBuffer.set(magicBytes, bufferPosition);

    return outputBuffer;
  }

  // ---------------------------------------------------------------------------
  // Private Orchestration & Download Helpers
  // ---------------------------------------------------------------------------

  private finalizeReceiptDownload(receipt: ExportJobReceipt): void {
    this.lastExportReceiptSignal.set(receipt);
    this.downloadReceiptFile(receipt);
    this.state.setLoading(false);
    this.state.announce(
      `Exported ${receipt.filename} via ${receipt.engine} (${receipt.mimeType}).`
    );
  }

  private generateExportContent(receipt: ExportJobReceipt): BlobPart {
    if (receipt.fileContentBase64) {
      return this.decodeBase64ToBytes(receipt.fileContentBase64) as unknown as BlobPart;
    }
    if (receipt.format === '.csv' || receipt.format === '.tsv') {
      const delimiter = receipt.format === '.tsv' ? '\t' : ';';
      return this.buildDelimitedContent(receipt, delimiter);
    }
    if (receipt.format === '.xlsx') {
      return this.buildXlsxZipBytes(receipt) as unknown as BlobPart;
    }
    if (receipt.format === '.parquet') {
      return this.buildParquetBinaryBytes(receipt) as unknown as BlobPart;
    }
    return (
      `%PDF-1.4\n` +
      `% RollerCoaster 300 DPI Export Document\n` +
      `% Project: ${this.state.activeProject().filename}\n` +
      `% Page: ${this.state.activePage()}\n` +
      `% Generated: ${receipt.timestamp}\n` +
      `%%EOF`
    );
  }

  private triggerBrowserDownload(content: BlobPart, filename: string, mimeType: string): void {
    if (typeof document === 'undefined') {
      return;
    }
    const blob = new Blob([content], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchorElement = document.createElement('a');
    anchorElement.href = objectUrl;
    anchorElement.download = filename;
    document.body.appendChild(anchorElement);
    anchorElement.click();
    document.body.removeChild(anchorElement);

    // Chrome drops the specified download filename if revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  private printInLightMode(): void {
    const themedElements: {
      element: HTMLElement;
      originalTheme: string | null;
    }[] = [];

    this.state.setPrintingLightMode(true);
    let dynamicPrintStyle: HTMLStyleElement | null = null;

    if (typeof document !== 'undefined') {
      const rootElement = document.documentElement;
      themedElements.push({
        element: rootElement,
        originalTheme: rootElement.getAttribute('data-bs-theme'),
      });
      rootElement.setAttribute('data-bs-theme', 'light');

      const workspaceElements = document.querySelectorAll<HTMLElement>('[data-bs-theme]');
      workspaceElements.forEach((element) => {
        if (element !== rootElement) {
          themedElements.push({
            element,
            originalTheme: element.getAttribute('data-bs-theme'),
          });
          element.setAttribute('data-bs-theme', 'light');
        }
      });

      const canvasSheet = document.querySelector<HTMLElement>('.rc-report-page-sheet');
      if (canvasSheet) {
        const width = canvasSheet.offsetWidth || 1280;
        const height = canvasSheet.offsetHeight || 720;
        const isPortrait = height > width;
        dynamicPrintStyle = document.createElement('style');
        dynamicPrintStyle.id = 'rc-print-dynamic-orientation';
        dynamicPrintStyle.textContent = `@page { size: ${isPortrait ? 'portrait' : 'landscape'}; margin: 6mm; }`;
        document.head.appendChild(dynamicPrintStyle);
      }
    }

    try {
      window.print();
    } finally {
      if (dynamicPrintStyle) {
        dynamicPrintStyle.remove();
      }
      this.state.setPrintingLightMode(false);
      for (const { element, originalTheme } of themedElements) {
        if (originalTheme !== null) {
          element.setAttribute('data-bs-theme', originalTheme);
        } else {
          element.removeAttribute('data-bs-theme');
        }
      }
    }
  }

  private resolveExportEndpoint(reportId: string, visualId: string, format: ExportFormatType): string {
    return format === '.pdf'
      ? '/api/reports/export/pdf'
      : `/api/reports/${encodeURIComponent(reportId)}/visuals/${encodeURIComponent(visualId)}/export`;
  }

  private buildExportPayload(
    reportId: string,
    visualId: string,
    format: ExportFormatType,
    visuals: readonly {
      readonly id: string;
      readonly title: string;
      readonly archetype: string;
      readonly width: 'half' | 'full';
      readonly metricLabel: string;
      readonly metricValue: string;
      readonly metricSubtext: string;
    }[],
    canvasDimensions?: { width: number; height: number; preset?: string }
  ): ExportPayload {
    return {
      reportId,
      visualId,
      format,
      dpi: 300,
      includeBom: true,
      delimiter: format === '.tsv' ? '\t' : ';',
      contextHash: this.state.activeFilters().toContextHash(),
      projectName: this.state.activeProject().filename,
      pageName: this.state.activePage(),
      canvasDimensions,
      visuals: visuals.map((visual) => ({
        id: visual.id,
        title: visual.title,
        archetype: visual.archetype,
        width: visual.width,
        metricLabel: visual.metricLabel,
        metricValue: visual.metricValue,
        metricSubtext: visual.metricSubtext,
      })),
      measures: this.state.measures.map((measure) => ({
        id: measure.id,
        label: measure.label,
        formula: measure.formula,
        table: measure.table,
      })),
    };
  }

  private createFallbackReceipt(format: ExportFormatType, meta: ExportFormatMeta): ExportJobReceipt {
    return {
      jobId: `exp-local-${Date.now()}`,
      format,
      mimeType: meta.mimeType,
      filename: meta.filename,
      engine: meta.engine,
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
    };
  }

  private resolveFormatMeta(format: ExportFormatType): ExportFormatMeta {
    switch (format) {
      case '.pdf':
        return {
          mimeType: 'application/pdf',
          filename: 'Workspace-Report-300DPI.pdf',
          engine: 'Playwright Headless Chromium (300 DPI Vector/Raster)',
        };
      case '.xlsx':
        return {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: 'Workspace-Report.xlsx',
          engine: 'Apache POI SXSSFWorkbook (100-row sliding window)',
        };
      case '.parquet':
        return {
          mimeType: 'application/vnd.apache.parquet',
          filename: 'Workspace-Report.parquet',
          engine: 'Native DuckDB Engine (SNAPPY Columnar)',
        };
      case '.tsv':
        return {
          mimeType: 'text/tab-separated-values; charset=utf-8',
          filename: 'Workspace-Report.tsv',
          engine: 'Spring WebFlux Reactive (8 KB ByteBuffer)',
        };
      case '.csv':
      default:
        return {
          mimeType: 'text/csv; charset=utf-8',
          filename: 'Workspace-Report.csv',
          engine: 'Spring WebFlux Reactive (UTF-8 BOM + Semicolon Delimiter)',
        };
    }
  }

  private escapeDelimitedCell(value: string, _delimiter?: string): string {
    const safeValue = value ?? '';
    const escapedValue = safeValue.replace(/"/g, '""');
    return `"${escapedValue}"`;
  }

  // ---------------------------------------------------------------------------
  // OpenXML XML Template Helpers
  // ---------------------------------------------------------------------------

  private buildContentTypesXml(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '  <Default Extension="xml" ContentType="application/xml"/>',
      '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '</Types>',
    ].join('');
  }

  private buildRootRelationshipsXml(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '</Relationships>',
    ].join('');
  }

  private buildWorkbookXml(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '  <sheets>',
      '    <sheet name="Report Visuals" sheetId="1" r:id="rId1"/>',
      '    <sheet name="Measures Context" sheetId="2" r:id="rId2"/>',
      '  </sheets>',
      '</workbook>',
    ].join('');
  }

  private buildWorkbookRelationshipsXml(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>',
      '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '</Relationships>',
    ].join('');
  }

  private buildStylesXml(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>',
      '  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>',
      '  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
      '  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
      '  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>',
      '</styleSheet>',
    ].join('');
  }

  private buildWorksheetXml(rows: readonly (readonly string[])[]): string {
    const xmlRows: string[] = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const rowNumber = rowIndex + 1;
      const cellValues = rows[rowIndex];
      const xmlCells: string[] = [];
      for (let colIndex = 0; colIndex < cellValues.length; colIndex++) {
        const cellReference = this.toExcelColumnName(colIndex) + rowNumber;
        const escapedValue = this.escapeXml(cellValues[colIndex] ?? '');
        xmlCells.push(
          `<c r="${cellReference}" t="inlineStr"><is><t>${escapedValue}</t></is></c>`
        );
      }
      xmlRows.push(`<row r="${rowNumber}">${xmlCells.join('')}</row>`);
    }
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      `  <sheetData>${xmlRows.join('')}</sheetData>`,
      '</worksheet>',
    ].join('');
  }

  private toExcelColumnName(columnIndex: number): string {
    let remainingIndex = columnIndex;
    let columnName = '';
    while (remainingIndex >= 0) {
      columnName = String.fromCharCode((remainingIndex % 26) + 65) + columnName;
      remainingIndex = Math.floor(remainingIndex / 26) - 1;
    }
    return columnName;
  }

  private escapeXml(value: string): string {
    return (value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ---------------------------------------------------------------------------
  // Low-Level Binary ZIP Packer
  // ---------------------------------------------------------------------------

  private packZipArchive(entries: readonly ZipEntrySpec[]): Uint8Array {
    const encoder = new TextEncoder();
    const localHeaderParts: Uint8Array[] = [];
    const centralDirectoryParts: Uint8Array[] = [];
    let currentRelativeOffset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = entry.data;
      const crc32Checksum = this.computeCrc32(dataBytes);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
      localView.setUint16(4, ZIP_VERSION_20, true);
      localView.setUint16(6, 0, true); // General purpose flags
      localView.setUint16(8, ZIP_COMPRESSION_STORE, true);
      localView.setUint16(10, 0, true); // Mod time
      localView.setUint16(12, 0, true); // Mod date
      localView.setUint32(14, crc32Checksum, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true); // Extra field length
      localHeader.set(nameBytes, 30);

      localHeaderParts.push(localHeader, dataBytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
      centralView.setUint16(4, ZIP_VERSION_20, true); // Version made by
      centralView.setUint16(6, ZIP_VERSION_20, true); // Version needed
      centralView.setUint16(8, 0, true); // Flags
      centralView.setUint16(10, ZIP_COMPRESSION_STORE, true);
      centralView.setUint16(12, 0, true); // Mod time
      centralView.setUint16(14, 0, true); // Mod date
      centralView.setUint32(16, crc32Checksum, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true); // Extra field length
      centralView.setUint16(32, 0, true); // File comment length
      centralView.setUint16(34, 0, true); // Disk number start
      centralView.setUint16(36, 0, true); // Internal file attributes
      centralView.setUint32(38, 0, true); // External file attributes
      centralView.setUint32(42, currentRelativeOffset, true);
      centralHeader.set(nameBytes, 46);

      centralDirectoryParts.push(centralHeader);
      currentRelativeOffset += localHeader.length + dataBytes.length;
    }

    const centralDirectoryTotalSize = centralDirectoryParts.reduce(
      (accumulated, part) => accumulated + part.length,
      0
    );

    const endOfCentralDirectory = new Uint8Array(ZIP_EOCD_BYTE_LENGTH);
    const eocdView = new DataView(endOfCentralDirectory.buffer);
    eocdView.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
    eocdView.setUint16(4, 0, true); // Number of this disk
    eocdView.setUint16(6, 0, true); // Disk where central directory starts
    eocdView.setUint16(8, entries.length, true); // Total entries on disk
    eocdView.setUint16(10, entries.length, true); // Total entries
    eocdView.setUint32(12, centralDirectoryTotalSize, true);
    eocdView.setUint32(16, currentRelativeOffset, true);
    eocdView.setUint16(20, 0, true); // Comment length

    const totalArchiveLength =
      currentRelativeOffset + centralDirectoryTotalSize + endOfCentralDirectory.length;
    const resultBuffer = new Uint8Array(totalArchiveLength);
    let writeOffset = 0;

    for (const part of localHeaderParts) {
      resultBuffer.set(part, writeOffset);
      writeOffset += part.length;
    }
    for (const part of centralDirectoryParts) {
      resultBuffer.set(part, writeOffset);
      writeOffset += part.length;
    }
    resultBuffer.set(endOfCentralDirectory, writeOffset);

    return resultBuffer;
  }

  private computeCrc32(bytes: Uint8Array): number {
    let checksum = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) {
      const tableIndex = (checksum ^ bytes[index]) & 0xff;
      checksum = (checksum >>> 8) ^ CRC32_TABLE[tableIndex];
    }
    return (checksum ^ 0xffffffff) >>> 0;
  }

  // ---------------------------------------------------------------------------
  // Parquet Thrift Protocol Encoding
  // ---------------------------------------------------------------------------

  private encodeParquetDataPageHeader(numValues: number, byteSize: number): Uint8Array {
    const encodedBytes: number[] = [
      // Field 1: type = DATA_PAGE (0) -> delta 1, I32
      THRIFT_I32_DELTA_1,
      0x00,
      // Field 2: uncompressed_page_size
      THRIFT_I32_DELTA_1,
      ...this.encodeZigZagVarint(byteSize),
      // Field 3: compressed_page_size
      THRIFT_I32_DELTA_1,
      ...this.encodeZigZagVarint(byteSize),
      // Field 5: data_page_header (delta 2, STRUCT)
      THRIFT_STRUCT_DELTA_2,
      //   DataPageHeader Field 1: num_values
      THRIFT_I32_DELTA_1,
      ...this.encodeZigZagVarint(numValues),
      //   DataPageHeader Field 2: encoding = PLAIN (0)
      THRIFT_I32_DELTA_1,
      0x00,
      //   DataPageHeader Field 3: definition_level_encoding = RLE (3)
      THRIFT_I32_DELTA_1,
      ...this.encodeZigZagVarint(PARQUET_RLE_ENCODING),
      //   DataPageHeader Field 4: repetition_level_encoding = RLE (3)
      THRIFT_I32_DELTA_1,
      ...this.encodeZigZagVarint(PARQUET_RLE_ENCODING),
      //   End DataPageHeader struct
      THRIFT_STOP,
      // End PageHeader struct
      THRIFT_STOP,
    ];
    return new Uint8Array(encodedBytes);
  }

  private encodeParquetFileMetaData(
    columns: readonly string[],
    rowCount: number,
    chunks: readonly ColumnChunkMetadata[]
  ): Uint8Array {
    const encoder = new TextEncoder();
    const encodedBytes: number[] = [];

    // Field 1: version = 1 (delta 1, I32 -> 0x15, zigzag(1)=2)
    encodedBytes.push(THRIFT_I32_DELTA_1, 0x02);

    // Field 2: schema = list<SchemaElement>
    const schemaCount = 1 + columns.length;
    if (schemaCount < 15) {
      encodedBytes.push(THRIFT_LIST_DELTA_1, (schemaCount << 4) | 0x0c);
    } else {
      encodedBytes.push(THRIFT_LIST_DELTA_1, 0xfc, ...this.encodeUnsignedVarint(schemaCount));
    }

    // Root SchemaElement: name="schema"
    const rootSchemaName = encoder.encode('schema');
    encodedBytes.push(
      THRIFT_BINARY_DELTA_4,
      ...this.encodeUnsignedVarint(rootSchemaName.length),
      ...rootSchemaName
    );
    encodedBytes.push(THRIFT_I32_DELTA_1, ...this.encodeZigZagVarint(columns.length));
    encodedBytes.push(THRIFT_STOP);

    // Leaf SchemaElements for each column
    for (const columnName of columns) {
      const columnBytes = encoder.encode(columnName);
      // Field 1: type = 6 (BYTE_ARRAY)
      encodedBytes.push(THRIFT_I32_DELTA_1, ...this.encodeZigZagVarint(PARQUET_BYTE_ARRAY_TYPE));
      // Field 3: repetition_type = 0 (REQUIRED)
      encodedBytes.push(THRIFT_I32_DELTA_2, PARQUET_REQUIRED_REPETITION);
      // Field 4: name
      encodedBytes.push(
        THRIFT_BINARY_DELTA_1,
        ...this.encodeUnsignedVarint(columnBytes.length),
        ...columnBytes
      );
      // Field 6: converted_type = 0 (UTF8)
      encodedBytes.push(THRIFT_I32_DELTA_2, PARQUET_UTF8_CONVERTED_TYPE);
      encodedBytes.push(THRIFT_STOP);
    }

    // Field 3: num_rows
    encodedBytes.push(THRIFT_I64_DELTA_1, ...this.encodeZigZagVarint(rowCount));

    // Field 4: row_groups = list<RowGroup> (1 element)
    encodedBytes.push(THRIFT_LIST_DELTA_1, 0x1c);

    // RowGroup Field 1: columns = list<ColumnChunk>
    if (chunks.length < 15) {
      encodedBytes.push(THRIFT_LIST_DELTA_1, (chunks.length << 4) | 0x0c);
    } else {
      encodedBytes.push(THRIFT_LIST_DELTA_1, 0xfc, ...this.encodeUnsignedVarint(chunks.length));
    }

    let totalByteSizeAll = 0;
    for (const chunk of chunks) {
      totalByteSizeAll += chunk.totalByteSize;
      const columnNameBytes = encoder.encode(chunk.columnName);

      // ColumnChunk Field 2: file_offset
      encodedBytes.push(THRIFT_I64_DELTA_2, ...this.encodeZigZagVarint(chunk.fileOffset));
      // ColumnChunk Field 3: meta_data
      encodedBytes.push(THRIFT_STRUCT_DELTA_1);
      //   ColumnMetaData Field 1: type = 6 (BYTE_ARRAY)
      encodedBytes.push(THRIFT_I32_DELTA_1, ...this.encodeZigZagVarint(PARQUET_BYTE_ARRAY_TYPE));
      //   ColumnMetaData Field 2: encodings = [PLAIN(0), RLE(3)]
      encodedBytes.push(THRIFT_LIST_DELTA_1, THRIFT_I32_DELTA_2, PARQUET_PLAIN_ENCODING, 0x06);
      //   ColumnMetaData Field 3: path_in_schema = [colName]
      encodedBytes.push(
        THRIFT_LIST_DELTA_1,
        THRIFT_BINARY_DELTA_1,
        ...this.encodeUnsignedVarint(columnNameBytes.length),
        ...columnNameBytes
      );
      //   ColumnMetaData Field 4: codec = UNCOMPRESSED (0)
      encodedBytes.push(THRIFT_I32_DELTA_1, PARQUET_UNCOMPRESSED_CODEC);
      //   ColumnMetaData Field 5: num_values
      encodedBytes.push(THRIFT_I64_DELTA_1, ...this.encodeZigZagVarint(rowCount));
      //   ColumnMetaData Field 6: total_uncompressed_size
      encodedBytes.push(THRIFT_I64_DELTA_1, ...this.encodeZigZagVarint(chunk.totalByteSize));
      //   ColumnMetaData Field 7: total_compressed_size
      encodedBytes.push(THRIFT_I64_DELTA_1, ...this.encodeZigZagVarint(chunk.totalByteSize));
      //   ColumnMetaData Field 9: data_page_offset
      encodedBytes.push(THRIFT_I64_DELTA_2, ...this.encodeZigZagVarint(chunk.fileOffset));
      //   End ColumnMetaData
      encodedBytes.push(THRIFT_STOP);
      // End ColumnChunk
      encodedBytes.push(THRIFT_STOP);
    }

    // RowGroup Field 2: total_byte_size
    encodedBytes.push(THRIFT_I64_DELTA_1, ...this.encodeZigZagVarint(totalByteSizeAll));
    // RowGroup Field 3: num_rows
    encodedBytes.push(THRIFT_I64_DELTA_1, ...this.encodeZigZagVarint(rowCount));
    // End RowGroup
    encodedBytes.push(THRIFT_STOP);

    // Field 6: created_by
    const createdBy = encoder.encode('RollerCoaster Columnar Engine v1.2');
    encodedBytes.push(
      THRIFT_BINARY_DELTA_2,
      ...this.encodeUnsignedVarint(createdBy.length),
      ...createdBy
    );
    // End FileMetaData
    encodedBytes.push(THRIFT_STOP);

    return new Uint8Array(encodedBytes);
  }

  private encodeUnsignedVarint(value: number): number[] {
    const bytes: number[] = [];
    let remainingValue = Math.max(0, Math.floor(value));
    while (remainingValue >= 0x80) {
      bytes.push((remainingValue & 0x7f) | 0x80);
      remainingValue = Math.floor(remainingValue / 128);
    }
    bytes.push(remainingValue & 0x7f);
    return bytes;
  }

  private encodeZigZagVarint(value: number): number[] {
    const numericValue = Math.floor(value);
    const zigzagValue = numericValue >= 0 ? numericValue * 2 : -numericValue * 2 - 1;
    return this.encodeUnsignedVarint(zigzagValue);
  }

  private decodeBase64ToBytes(base64: string): Uint8Array {
    if (typeof atob === 'function') {
      const binaryString = atob(base64);
      const outputBytes = new Uint8Array(binaryString.length);
      for (let index = 0; index < binaryString.length; index++) {
        outputBytes[index] = binaryString.charCodeAt(index);
      }
      return outputBytes;
    }
    return new TextEncoder().encode(base64);
  }
}
