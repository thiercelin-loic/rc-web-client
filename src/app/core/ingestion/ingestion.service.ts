import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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
} from '../../features/data-prep/data-prep.model';
import { DataPrepEngineService } from '../data-prep-engine.service';
import { StateManagerService } from '../state-manager.service';
import {
  detectSeparator,
  extractDelimited,
  parseGrid,
} from './delimited.parser';
import {
  DEFAULT_EXTENSIONS,
  MULTI_SHEET_PATTERN,
} from './ingestion.constants';
import {
  DirectDataset,
  EvalResult,
  NavigatorMode,
  ParsedTextResult,
  PipelineSyncEvent,
  SourceFormat,
} from './ingestion.interface';
import { extractJson, extractRecords } from './json.parser';
import { inferType, toPayload } from './sheet.builder';
import { extractXlsx } from './xlsx.parser';
import { extractXml } from './xml.parser';

@Injectable({
  providedIn: 'root',
})
export class IngestionService {
  private readonly state = inject(StateManagerService);
  private readonly router = inject(Router, { optional: true });
  private readonly engine = inject(DataPrepEngineService);

  public readonly sources = signal<readonly IngestionSource[]>([]);
  public readonly selectedSourceId = signal<string>('');
  public readonly stepsBySource = signal<Record<string, readonly DataPrepStep[]>>({});
  public readonly rawSnapshotsBySource = signal<Record<string, SourceSnapshot>>({});
  public readonly pipelineSync = signal<PipelineSyncEvent | null>(null);

  public readonly importMenuOpen = signal<boolean>(false);
  public readonly selectedConnectorId = signal<string>('excel');

  public readonly isNavigatorModalOpen = signal<boolean>(false);
  public readonly pendingFileName = signal<string>('');
  public readonly pendingFileFormat = signal<SourceFormat>('XLSX');
  public readonly pendingBackendFormat = signal<BackendSourceFormat>('XLSX');
  public readonly pendingRawText = signal<string>('');
  public readonly pendingRawBase64 = signal<string>('');
  public readonly navigatorSheets = signal<readonly WorkbookSheet[]>([]);
  public readonly selectedNavigatorSheetId = signal<string>('');
  public readonly navigatorError = signal<string>('');

  public readonly selectedNavigatorSheet = computed(() => {
    const list = this.navigatorSheets();
    const id = this.selectedNavigatorSheetId();
    return list.find((sheet) => sheet.id === id) ?? list[0] ?? null;
  });

  public readonly fileConnectors = DATA_CONNECTORS;

  /** Toggles the global import connector dropdown. */
  public toggleMenu(): void {
    this.importMenuOpen.update((open) => !open);
  }

  /** Closes the global import connector dropdown. */
  public closeMenu(): void {
    this.importMenuOpen.set(false);
  }

  /** Selects a connector and opens the native file picker when an input is provided. */
  public triggerConnector(
    connectorId: string,
    fileInput?: HTMLInputElement,
  ): void {
    const connector = DATA_CONNECTORS.find((c) => c.id === connectorId);
    if (!connector) return;

    this.selectedConnectorId.set(connectorId);
    this.importMenuOpen.set(false);
    if (fileInput) {
      fileInput.accept = connector.fileExtensions || DEFAULT_EXTENSIONS;
      fileInput.click();
    }
  }

  /** Reads the selected file from an `<input type="file">` change event. */
  public selectFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const fileName = file.name;
    const backendFmt = formatFromFileName(fileName) ?? 'CSV';
    const format: SourceFormat =
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
        this.openBinary(fileName, format, backendFmt, buffer, toBase64(buffer));
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;
        this.openText(fileName, format, backendFmt, text);
      };
      reader.readAsText(file);
    }
    input.value = '';
  }

  /** Opens the Navigator modal for a binary file (XLSX, Parquet, Avro). */
  public openBinary(
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    buffer: ArrayBuffer,
    base64: string,
  ): void {
    const sheets = extractXlsx(buffer);
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

  /** Opens the Navigator modal for a text file (CSV, TSV, JSON, XML). */
  public openText(
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    text: string,
  ): void {
    const { sheets, error } = this.extractText(name, text, backendFormat);
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

  /** Closes the Navigator modal and clears pending file buffers. */
  public cancelNavigator(): void {
    this.isNavigatorModalOpen.set(false);
    this.pendingFileName.set('');
    this.pendingRawText.set('');
    this.pendingRawBase64.set('');
    this.navigatorError.set('');
    this.navigatorSheets.set([]);
  }

  /** Commits the selected Navigator item with the 4-step ingestion pipeline. */
  public confirmNavigator(mode: NavigatorMode = 'transform'): void {
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
      backendFormat === 'JSON' ? (toPayload(sheet) ?? rawText) : rawText;

    const datasetId = `ds_${Date.now()}`;
    const newSource: IngestionSource = {
      id: datasetId,
      name: fileName,
      format,
      path: fileName,
      enableLoad: true,
      backendFormat,
    };

    const snapCols = [...sheet.columns];
    const snapRows = [...sheet.rows];
    this.rawSnapshotsBySource.update((map) => ({
      ...map,
      [datasetId]: {
        columns: snapCols,
        rows: snapRows,
        rawText: normalizedRawText,
        rawBase64,
      },
    }));

    const initialSteps = this.buildPipeline(fileName, backendFormat, sheet);
    this.sources.update((srcs) => [...srcs, newSource]);
    this.selectedSourceId.set(datasetId);
    this.stepsBySource.update((map) => ({ ...map, [datasetId]: initialSteps }));
    this.isNavigatorModalOpen.set(false);

    const evaluated = this.evaluateSteps(snapCols, snapRows, initialSteps);
    if (mode === 'load' && evaluated.columns.length > 0) {
      const multiTable =
        this.navigatorSheets().length > 1 &&
        !MULTI_SHEET_PATTERN.test(sheet.name);
      const tableName = multiTable
        ? `${tableNameFromSource(fileName)}_${tableNameFromSource(sheet.name)}`
        : tableNameFromSource(fileName);
      this.publishTable(`tbl_${datasetId}`, tableName, evaluated.columns, evaluated.rows);
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
      this.router.config.some((route) => route.path === 'data-prep')
    ) {
      void this.router.navigate(['/data-prep']).catch(() => false);
    }
  }

  /** Direct single-step ingestion helper used by REST streams and tests. */
  public loadDirect(
    name: string,
    format: SourceFormat,
    content: string,
  ): DirectDataset | null {
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const backendFormat =
      formatFromFileName(name) ?? (format === 'REST' ? 'JSON' : format);
    let parsedColumns: DataPrepColumn[] = [];
    let parsedRows: Record<string, unknown>[] = [];
    let snapshotRawText = content;

    if (format === 'REST' || name.toLowerCase().endsWith('.json')) {
      const jsonResult = extractRecords(content);
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
      const delimited = this.parseDelimited(content, backendFormat);
      parsedColumns = delimited.columns;
      parsedRows = delimited.rows;
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
      this.publishTable(
        `user_tbl_${tableName}`,
        tableName,
        parsedColumns,
        parsedRows,
      );
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

  /** Evaluates Data Prep transformation steps locally against the snapshot cache. */
  public evaluateSteps(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
  ): EvalResult {
    return this.engine.evaluateStepsLocally(
      initialCols,
      initialRows,
      steps,
      (targetIdOrName) => {
        const targetSrc =
          this.sources().find((s) => s.id === targetIdOrName) ??
          this.sources().find((s) => tableNameFromSource(s.name) === targetIdOrName);
        const targetSnap = targetSrc
          ? this.rawSnapshotsBySource()[targetSrc.id]
          : undefined;
        return targetSnap
          ? { columns: targetSnap.columns, rows: targetSnap.rows }
          : undefined;
      },
    );
  }

  private buildPipeline(
    fileName: string,
    backendFormat: BackendSourceFormat,
    sheet: WorkbookSheet,
  ): DataPrepStep[] {
    const now = Date.now();
    return [
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
        definition: { step: 'PromoteHeaders' },
      },
      {
        id: `step_${now}_types`,
        name: 'Changed Type',
        type: 'DetectDataType',
        detail: 'Auto-detected schema across all columns',
        definition: { step: 'DetectDataType' },
      },
    ];
  }

  private publishTable(
    tableId: string,
    tableName: string,
    columns: readonly DataPrepColumn[],
    rows: readonly Record<string, unknown>[],
  ): void {
    this.state.addTable({
      id: tableId,
      name: tableName,
      role: 'FACT',
      columns: columns.map((col) => ({
        name: col.name,
        dataType: (col.type || 'VARCHAR').toUpperCase(),
        keyType: 'None' as const,
      })),
      rowCount: rows.length,
    });
    this.state.setTableRows(tableName, [...rows]);
  }

  private parseDelimited(
    content: string,
    backendFormat: BackendSourceFormat,
  ): { columns: DataPrepColumn[]; rows: Record<string, unknown>[] } {
    const separator = detectSeparator(
      content,
      backendFormat === 'TSV' ? '\t' : undefined,
    );
    const grid = parseGrid(content, separator);
    if (grid.length === 0) {
      return { columns: [], rows: [] };
    }

    const headers = grid[0];
    const rows = grid.slice(1).map((parts) => {
      const record: Record<string, unknown> = {};
      headers.forEach((col, idx) => {
        const raw = parts[idx] ?? '';
        if (raw === '') {
          record[col] = null;
        } else if (!Number.isNaN(Number(raw))) {
          record[col] = Number(raw);
        } else if (raw.toLowerCase() === 'true' || raw.toLowerCase() === 'false') {
          record[col] = raw.toLowerCase() === 'true';
        } else {
          record[col] = raw;
        }
      });
      return record;
    });

    const columns: DataPrepColumn[] = headers.map((col) => {
      const type = inferType(rows, col);
      return { name: col, type, icon: type };
    });

    return { columns, rows };
  }

  private extractText(
    fileName: string,
    text: string,
    backendFormat?: BackendSourceFormat,
  ): ParsedTextResult {
    if (backendFormat === 'JSON' || /\.json$/i.test(fileName)) {
      return extractJson(fileName, text);
    }
    if (backendFormat === 'XML' || /\.xml$/i.test(fileName)) {
      return extractXml(fileName, text);
    }
    return extractDelimited(
      fileName,
      text,
      backendFormat === 'TSV' ? '\t' : undefined,
    );
  }
}
