import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DataPrepQuarantineRow } from '../services/api.service';
import { StateManagerService } from './state-manager.service';
import { unpackZipArchive } from './zip-archive';
import { DataPrepEngineService } from './data-prep-engine.service';
import {
  BackendSourceFormat,
  DATA_CONNECTORS,
  DataPrepColumn,
  DataPrepStep,
  IngestionSource,
  SourceSnapshot,
  WorkbookSheet,
  formatFromFileName,
  isBinaryFormat,
  tableNameFromSource,
  toBase64,
} from '../features/data-prep/data-prep.model';
import {
  detectDelimitedSeparator,
  extractSheetsFromDelimitedText,
  extractSheetsFromJson,
  extractSheetsFromXml,
  extractTabularRecordsFromJson,
  inferColumnTypeFromRows,
  parseDelimitedGrid,
  unpromotedSheetToJsonPayload,
} from './ingestion-parsers';

export interface PipelineSyncEvent {
  readonly sourceId: string;
  readonly stepIndex: number;
  readonly seq: number;
}

@Injectable({
  providedIn: 'root',
})
export class IngestionWorkflowService {
  private readonly state = inject(StateManagerService);
  private readonly router = inject(Router, { optional: true });
  private readonly engine = inject(DataPrepEngineService);

  // Shared R-Query dataset registry across Data Prep and global ingestion modals
  public readonly sources = signal<readonly IngestionSource[]>([]);
  public readonly selectedSourceId = signal<string>('');
  public readonly stepsBySource = signal<Record<string, readonly DataPrepStep[]>>({});
  public readonly rawSnapshotsBySource = signal<Record<string, SourceSnapshot>>({});
  public readonly pipelineSync = signal<PipelineSyncEvent | null>(null);

  // Global Import roll-list menu state
  public readonly importMenuOpen = signal<boolean>(false);
  public readonly selectedConnectorId = signal<string>('excel');

  // Global Pre-Ingestion Navigator modal state
  public readonly isNavigatorModalOpen = signal<boolean>(false);
  public readonly pendingFileName = signal<string>('');
  public readonly pendingFileFormat = signal<'CSV' | 'PARQUET' | 'XLSX' | 'REST'>('XLSX');
  public readonly pendingBackendFormat = signal<BackendSourceFormat>('XLSX');
  public readonly pendingRawText = signal<string>('');
  public readonly pendingRawBase64 = signal<string>('');
  public readonly navigatorSheets = signal<readonly WorkbookSheet[]>([]);
  public readonly selectedNavigatorSheetId = signal<string>('');
  public readonly navigatorError = signal<string>('');

  public readonly selectedNavigatorSheet = computed(() => {
    const list = this.navigatorSheets();
    const id = this.selectedNavigatorSheetId();
    return list.find((s) => s.id === id) ?? list[0] ?? null;
  });

  public readonly fileConnectors = DATA_CONNECTORS;

  public toggleImportMenu(): void {
    this.importMenuOpen.update((open) => !open);
  }

  public closeImportMenu(): void {
    this.importMenuOpen.set(false);
  }

  public triggerFileConnector(connectorId: string, fileInput?: HTMLInputElement): void {
    const connector = DATA_CONNECTORS.find((c) => c.id === connectorId);
    if (!connector) return;

    this.selectedConnectorId.set(connectorId);
    this.importMenuOpen.set(false);
    if (fileInput) {
      fileInput.accept =
        connector.fileExtensions || '.csv,.tsv,.json,.txt,.xml,.xlsx,.parquet,.avro';
      fileInput.click();
    }
  }

  public handleFileSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const fileName = file.name;
    const backendFmt = formatFromFileName(fileName) ?? 'CSV';
    const format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST' =
      backendFmt === 'JSON' || backendFmt === 'XML'
        ? 'REST'
        : backendFmt === 'XLSX'
          ? 'XLSX'
          : backendFmt === 'PARQUET' || backendFmt === 'AVRO'
            ? 'PARQUET'
            : 'CSV';

    const reader = new FileReader();
    if (isBinaryFormat(backendFmt)) {
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) return;
        const base64 = toBase64(buffer);
        this.openNavigatorForBinary(fileName, format, backendFmt, buffer, base64);
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;
        this.openNavigatorForText(fileName, format, backendFmt, text);
      };
      reader.readAsText(file);
    }
    input.value = '';
  }

  public openNavigatorForBinary(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    backendFormat: BackendSourceFormat,
    buffer: ArrayBuffer,
    base64: string,
  ): void {
    const sheets = this.extractSheetsFromBinary(buffer, name);
    this.pendingFileName.set(name);
    this.pendingFileFormat.set(format);
    this.pendingBackendFormat.set(backendFormat);
    this.pendingRawBase64.set(base64);
    this.pendingRawText.set('');
    this.navigatorSheets.set(sheets);
    this.selectedNavigatorSheetId.set(sheets[0]?.id ?? '');
    if (sheets.length === 0) {
      const msg =
        backendFormat === 'PARQUET' || backendFormat === 'AVRO'
          ? `${backendFormat} binary preview requires backend ingestion support or JSON/CSV/XLSX export.`
          : `Failed to extract readable sheets from "${name}": file may be corrupt or not a valid OpenXML .xlsx workbook.`;
      this.navigatorError.set(msg);
      this.state.announceError(msg);
    } else {
      this.navigatorError.set('');
      this.state.announce(`Navigator: select sheet to preview from ${name}.`);
    }
    this.isNavigatorModalOpen.set(true);
  }

  public openNavigatorForText(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    backendFormat: BackendSourceFormat,
    text: string,
  ): void {
    const { sheets, error } = this.extractSheetsWithStatus(name, text, backendFormat);
    this.pendingFileName.set(name);
    this.pendingFileFormat.set(format);
    this.pendingBackendFormat.set(backendFormat);
    this.pendingRawBase64.set('');
    this.pendingRawText.set(text);
    this.navigatorSheets.set(sheets);
    this.selectedNavigatorSheetId.set(sheets[0]?.id ?? '');
    if (error) {
      this.navigatorError.set(error);
      this.state.announceError(error);
    } else {
      this.navigatorError.set('');
      this.state.announce(`Navigator: select sheet to preview from ${name}.`);
    }
    this.isNavigatorModalOpen.set(true);
  }

  public cancelNavigator(): void {
    this.isNavigatorModalOpen.set(false);
    this.pendingFileName.set('');
    this.pendingRawText.set('');
    this.pendingRawBase64.set('');
    this.navigatorError.set('');
    this.navigatorSheets.set([]);
  }

  /**
   * Commits the selected Navigator item with the canonical 4-step pipeline
   * (`Source Ingestion -> Navigation -> Promoted Headers -> Changed Type`).
   *
   * - `'load'`: Evaluates the pipeline and publishes the resulting table directly into
   *   `StateManagerService` without navigating away from the current view.
   * - `'transform'`: Registers the pipeline and navigates to `/data-prep` for editing.
   */
  public confirmNavigatorAndLoad(mode: 'load' | 'transform' = 'transform'): void {
    const sheet = this.selectedNavigatorSheet();
    if (!sheet) {
      this.isNavigatorModalOpen.set(false);
      return;
    }

    const fileName = this.pendingFileName();
    const format = this.pendingFileFormat();
    const backendFormat = this.pendingBackendFormat();
    const rawText = this.pendingRawText();
    const rawBase64 = this.pendingRawBase64();
    const normalizedRawText =
      backendFormat === 'JSON' ? (unpromotedSheetToJsonPayload(sheet) ?? rawText) : rawText;

    const datasetId = `ds_${Date.now()}`;
    const newSource: IngestionSource = {
      id: datasetId,
      name: fileName,
      format,
      path: fileName,
      enableLoad: true,
      backendFormat,
    };

    const snapCols = sheet.columns.map((c) => ({ ...c }));
    const snapRows = sheet.rows.map((r) => ({ ...r }));

    this.rawSnapshotsBySource.update((m) => ({
      ...m,
      [datasetId]: {
        columns: snapCols,
        rows: snapRows,
        rawText: normalizedRawText,
        rawBase64,
      },
    }));

    const now = Date.now();
    const initialSteps: DataPrepStep[] = [
      {
        id: `step_${now}_source`,
        name: 'Source Ingestion',
        type: 'FileSource',
        detail: `${backendFormat.toLowerCase()}("${fileName}")`,
        definition: {
          step: 'FileSource',
          source: fileName,
          format: backendFormat,
        },
      },
      {
        id: `step_${now}_nav`,
        name: 'Navigation',
        type: 'Navigation',
        detail: `Item="${sheet.name}", Kind="${sheet.kind}"`,
        definition: {
          step: 'Navigation',
          item: sheet.name,
          kind: sheet.kind,
          sheetName: sheet.sheetName ?? sheet.name,
        },
      },
      {
        id: `step_${now}_headers`,
        name: 'Promoted Headers',
        type: 'PromoteHeaders',
        detail: 'PromoteAllScalars=true',
        definition: {
          step: 'PromoteHeaders',
        },
      },
      {
        id: `step_${now}_types`,
        name: 'Changed Type',
        type: 'DetectDataType',
        detail: 'Auto-detected schema across all columns',
        definition: {
          step: 'DetectDataType',
        },
      },
    ];

    this.sources.update((srcs) => [...srcs, newSource]);
    this.selectedSourceId.set(datasetId);
    this.stepsBySource.update((m) => ({ ...m, [datasetId]: initialSteps }));
    this.isNavigatorModalOpen.set(false);

    const evaluated = this.evaluateStepsLocally(snapCols, snapRows, initialSteps);
    if (mode === 'load' && evaluated.columns.length > 0) {
      const multiTable = this.navigatorSheets().length > 1 && !/^sheet\d*$/i.test(sheet.name);
      const tableName = multiTable
        ? `${tableNameFromSource(fileName)}_${tableNameFromSource(sheet.name)}`
        : tableNameFromSource(fileName);
      this.state.addTable({
        id: `tbl_${datasetId}`,
        name: tableName,
        role: 'FACT',
        columns: evaluated.columns.map((c) => ({
          name: c.name,
          dataType: (c.type || 'VARCHAR').toUpperCase(),
          keyType: 'None' as const,
        })),
        rowCount: evaluated.rows.length,
      });
      this.state.setTableRows(tableName, [...evaluated.rows]);
    }

    this.pipelineSync.update((prev) => ({
      sourceId: datasetId,
      stepIndex: initialSteps.length - 1,
      seq: (prev?.seq ?? 0) + 1,
    }));

    this.state.announce(
      mode === 'load'
        ? `Loaded sheet "${sheet.name}" from "${fileName}" (${evaluated.rows.length} rows) into semantic model.`
        : `Loaded sheet "${sheet.name}" from "${fileName}" with standard 4-step ingestion pipeline.`,
    );

    if (
      mode === 'transform' &&
      this.router &&
      this.router.url !== '/data-prep' &&
      this.router.config.some((r) => r.path === 'data-prep')
    ) {
      void this.router.navigate(['/data-prep']).catch(() => false);
    }
  }

  /**
   * Direct single-step ingestion helper used by REST streams and automated unit tests.
   */
  public loadDirectDataset(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    content: string,
  ): {
    source: IngestionSource;
    columns: DataPrepColumn[];
    rows: Record<string, unknown>[];
    initialStep: DataPrepStep;
  } | null {
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let parsedColumns: DataPrepColumn[] = [];
    let parsedRows: Record<string, unknown>[] = [];
    const backendFormat = formatFromFileName(name) ?? (format === 'REST' ? 'JSON' : format);
    let snapshotRawText = content;

    if (format === 'REST' || name.toLowerCase().endsWith('.json')) {
      const jsonResult = extractTabularRecordsFromJson(content);
      if (jsonResult.error) {
        this.state.announceError(jsonResult.error);
        return null;
      }
      parsedColumns = jsonResult.columns;
      parsedRows = jsonResult.rows;
      if (parsedRows.length > 0) {
        snapshotRawText = JSON.stringify(parsedRows);
      }
    } else {
      const separator = detectDelimitedSeparator(
        content,
        backendFormat === 'TSV' ? '\t' : undefined,
      );
      const grid = parseDelimitedGrid(content, separator);
      if (grid.length > 0) {
        const headers = grid[0];
        const dataLines = grid.slice(1);

        parsedRows = dataLines.map((parts) => {
          const record: Record<string, unknown> = {};
          headers.forEach((col, idx) => {
            const raw = parts[idx] ?? '';
            if (raw === '') {
              record[col] = null;
            } else if (!isNaN(Number(raw))) {
              record[col] = Number(raw);
            } else if (raw.toLowerCase() === 'true' || raw.toLowerCase() === 'false') {
              record[col] = raw.toLowerCase() === 'true';
            } else {
              record[col] = raw;
            }
          });
          return record;
        });

        parsedColumns = headers.map((col) => {
          const type = inferColumnTypeFromRows(parsedRows, col);
          return { name: col, type, icon: type };
        });
      }
    }

    const newSource: IngestionSource = {
      id: datasetId,
      name,
      format,
      path: name,
      enableLoad: true,
      backendFormat,
    };

    const initialStep: DataPrepStep = {
      id: `step_${Date.now()}`,
      name: 'Source Ingestion',
      type: 'FileSource',
      detail: `${format.toLowerCase()}("${name}")`,
      definition: {
        step: 'FileSource',
        source: name,
        format,
        rowCount: parsedRows.length,
      },
    };

    this.rawSnapshotsBySource.update((map) => ({
      ...map,
      [datasetId]: {
        columns: parsedColumns,
        rows: parsedRows,
        rawText: snapshotRawText,
      },
    }));
    this.sources.update((srcs) => [...srcs, newSource]);
    this.selectedSourceId.set(datasetId);
    this.stepsBySource.update((map) => ({
      ...map,
      [datasetId]: [initialStep],
    }));

    if (parsedColumns.length > 0) {
      const tableName = tableNameFromSource(name) || 'user_dataset';
      const sharedCols = parsedColumns.map((c) => ({
        name: c.name,
        dataType: (c.type || 'VARCHAR').toUpperCase(),
        keyType: 'None' as const,
      }));
      this.state.addTable({
        id: `user_tbl_${tableName}`,
        name: tableName,
        role: 'FACT',
        columns: sharedCols,
        rowCount: parsedRows.length,
      });
      this.state.setTableRows(tableName, [...parsedRows]);
    }

    this.pipelineSync.update((prev) => ({
      sourceId: datasetId,
      stepIndex: 0,
      seq: (prev?.seq ?? 0) + 1,
    }));

    this.state.announce(
      `Successfully loaded user dataset "${name}" (${parsedRows.length} rows, ${parsedColumns.length} columns).`,
    );

    return { source: newSource, columns: parsedColumns, rows: parsedRows, initialStep };
  }

  public evaluateStepsLocally(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
  ): {
    columns: DataPrepColumn[];
    rows: Record<string, unknown>[];
    quarantined: DataPrepQuarantineRow[];
  } {
    return this.engine.evaluateStepsLocally(
      initialCols,
      initialRows,
      steps,
      (targetIdOrName) => {
        const targetSrc =
          this.sources().find((s) => s.id === targetIdOrName) ??
          this.sources().find((s) => tableNameFromSource(s.name) === targetIdOrName);
        const targetSnap = targetSrc ? this.rawSnapshotsBySource()[targetSrc.id] : undefined;
        return targetSnap ? { columns: targetSnap.columns, rows: targetSnap.rows } : undefined;
      },
    );
  }

  private extractSheetsFromBinary(buffer: ArrayBuffer, _fileName: string): WorkbookSheet[] {
    try {
      const entries = unpackZipArchive(buffer);
      if (!entries['xl/workbook.xml']) {
        return [];
      }

      const decoder = new TextDecoder();
      const parser = new DOMParser();

      // 1. Parse Shared Strings Table (xl/sharedStrings.xml) if present
      const sharedStrings: string[] = [];
      if (entries['xl/sharedStrings.xml']) {
        const sstXml = decoder.decode(entries['xl/sharedStrings.xml']);
        const sstDoc = parser.parseFromString(sstXml, 'application/xml');
        const siNodes = Array.from(sstDoc.getElementsByTagName('si'));
        const items =
          siNodes.length > 0 ? siNodes : Array.from(sstDoc.getElementsByTagNameNS('*', 'si'));
        for (const si of items) {
          const tNodes = Array.from(si.getElementsByTagName('t'));
          const texts =
            tNodes.length > 0 ? tNodes : Array.from(si.getElementsByTagNameNS('*', 't'));
          sharedStrings.push(texts.map((t) => t.textContent ?? '').join(''));
        }
      }

      // 2. Parse Workbook Relationships (xl/_rels/workbook.xml.rels)
      const relsTargetById = new Map<string, string>();
      if (entries['xl/_rels/workbook.xml.rels']) {
        const relsXml = decoder.decode(entries['xl/_rels/workbook.xml.rels']);
        const relsDoc = parser.parseFromString(relsXml, 'application/xml');
        const relNodes = Array.from(relsDoc.getElementsByTagName('Relationship'));
        const rels =
          relNodes.length > 0
            ? relNodes
            : Array.from(relsDoc.getElementsByTagNameNS('*', 'Relationship'));
        for (const rel of rels) {
          const id = rel.getAttribute('Id') ?? '';
          const rawTarget = rel.getAttribute('Target') ?? '';
          if (id && rawTarget) {
            const normalized = rawTarget.startsWith('/xl/')
              ? rawTarget.slice(1)
              : rawTarget.startsWith('xl/')
                ? rawTarget
                : `xl/${rawTarget.replace(/^\/+/, '')}`;
            relsTargetById.set(id, normalized);
          }
        }
      }

      // 3. Parse Workbook Sheet metadata (xl/workbook.xml)
      const wbXml = decoder.decode(entries['xl/workbook.xml']);
      const wbDoc = parser.parseFromString(wbXml, 'application/xml');
      const sheetNodes = Array.from(wbDoc.getElementsByTagName('sheet'));
      const sheetsMeta =
        sheetNodes.length > 0
          ? sheetNodes
          : Array.from(wbDoc.getElementsByTagNameNS('*', 'sheet'));

      const extractedSheets: WorkbookSheet[] = [];

      sheetsMeta.forEach((sheetEl, idx) => {
        const sheetName = sheetEl.getAttribute('name') || `Sheet${idx + 1}`;
        const rId =
          sheetEl.getAttribute('r:id') ||
          sheetEl.getAttributeNS(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
            'id',
          ) ||
          '';
        const targetPath =
          (rId && relsTargetById.get(rId)) || `xl/worksheets/sheet${idx + 1}.xml`;
        const sheetBytes =
          entries[targetPath] ?? entries[`xl/worksheets/sheet${idx + 1}.xml`];
        if (!sheetBytes) {
          return;
        }

        const sheetXml = decoder.decode(sheetBytes);
        const parsedGrid = this.parseWorksheetXml(sheetXml, sharedStrings, parser);
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

  private parseWorksheetXml(
    sheetXml: string,
    sharedStrings: readonly string[],
    parser: DOMParser,
  ): { columns: DataPrepColumn[]; rows: Record<string, unknown>[] } {
    const doc = parser.parseFromString(sheetXml, 'application/xml');
    const rowNodes = Array.from(doc.getElementsByTagName('row'));
    const rowsList =
      rowNodes.length > 0 ? rowNodes : Array.from(doc.getElementsByTagNameNS('*', 'row'));

    let maxCols = 0;
    const rawMatrix: Array<Record<number, unknown>> = [];

    for (const rowEl of rowsList) {
      const cellNodes = Array.from(rowEl.getElementsByTagName('c'));
      const cells =
        cellNodes.length > 0 ? cellNodes : Array.from(rowEl.getElementsByTagNameNS('*', 'c'));
      let nextColIdx = 0;
      const rowValues: Record<number, unknown> = {};
      let hasNonEmpty = false;

      for (const cellEl of cells) {
        const ref = cellEl.getAttribute('r') ?? '';
        const colIdx = ref ? this.columnIndexFromCellRef(ref, nextColIdx) : nextColIdx;
        nextColIdx = colIdx + 1;
        if (colIdx + 1 > maxCols) {
          maxCols = colIdx + 1;
        }

        const cellType = cellEl.getAttribute('t') ?? '';
        let val: unknown = null;

        if (cellType === 'inlineStr') {
          const tNodes = Array.from(cellEl.getElementsByTagName('t'));
          const texts =
            tNodes.length > 0 ? tNodes : Array.from(cellEl.getElementsByTagNameNS('*', 't'));
          val = texts.map((t) => t.textContent ?? '').join('');
        } else {
          const vNode =
            cellEl.getElementsByTagName('v')[0] ??
            cellEl.getElementsByTagNameNS('*', 'v')[0];
          const rawV = vNode?.textContent ?? '';
          if (rawV !== '') {
            if (cellType === 's') {
              const sstIdx = Number.parseInt(rawV, 10);
              val = sharedStrings[sstIdx] ?? rawV;
            } else if (cellType === 'b') {
              val = rawV === '1' || rawV.toLowerCase() === 'true';
            } else if (cellType === 'str' || cellType === 'e') {
              val = rawV;
            } else {
              const num = Number(rawV);
              val = Number.isNaN(num) ? rawV : Number.isInteger(num) ? num : Number(num.toFixed(6));
            }
          }
        }

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
      name: `Column${i + 1}`,
      type: 'String',
      icon: 'String',
    }));

    const rows: Record<string, unknown>[] = rawMatrix.map((rowValues) => {
      const record: Record<string, unknown> = {};
      for (let i = 0; i < maxCols; i++) {
        record[`Column${i + 1}`] = rowValues[i] ?? null;
      }
      return record;
    });

    return { columns, rows };
  }

  private columnIndexFromCellRef(cellRef: string, fallback: number): number {
    const match = cellRef.match(/^[A-Za-z]+/);
    if (!match) return fallback;
    const letters = match[0].toUpperCase();
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return Math.max(0, idx - 1);
  }

  private extractSheetsWithStatus(
    fileName: string,
    text: string,
    backendFormat?: BackendSourceFormat,
  ): { sheets: WorkbookSheet[]; error?: string } {
    if (backendFormat === 'JSON' || /\.json$/i.test(fileName)) {
      return extractSheetsFromJson(fileName, text);
    }
    if (backendFormat === 'XML' || /\.xml$/i.test(fileName)) {
      return extractSheetsFromXml(fileName, text);
    }
    return extractSheetsFromDelimitedText(
      fileName,
      text,
      backendFormat === 'TSV' ? '\t' : undefined,
    );
  }
}
