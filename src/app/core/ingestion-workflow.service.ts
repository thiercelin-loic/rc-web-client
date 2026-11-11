import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DataPrepQuarantineRow } from '../services/api.service';
import { StateManagerService } from './state-manager.service';
import { unpackZipArchive } from './zip-archive';
import {
  AggregationFunction,
  BackendSourceFormat,
  DATA_CONNECTORS,
  DataPrepColumn,
  DataPrepStep,
  IngestionSource,
  RQueryAggregateDefinition,
  SourceSnapshot,
  WorkbookSheet,
  formatFromFileName,
  isBinaryFormat,
  tableNameFromSource,
  toBackendType,
  toBase64,
} from '../features/data-prep/data-prep.model';

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
    this.isNavigatorModalOpen.set(true);
    this.state.announce(`Navigator: select sheet to preview from ${name}.`);
  }

  public openNavigatorForText(
    name: string,
    format: 'CSV' | 'PARQUET' | 'XLSX' | 'REST',
    backendFormat: BackendSourceFormat,
    text: string,
  ): void {
    const sheets = this.extractSheetsFromText(name, text);
    this.pendingFileName.set(name);
    this.pendingFileFormat.set(format);
    this.pendingBackendFormat.set(backendFormat);
    this.pendingRawBase64.set('');
    this.pendingRawText.set(text);
    this.navigatorSheets.set(sheets);
    this.selectedNavigatorSheetId.set(sheets[0]?.id ?? '');
    this.isNavigatorModalOpen.set(true);
    this.state.announce(`Navigator: select sheet to preview from ${name}.`);
  }

  public cancelNavigator(): void {
    this.isNavigatorModalOpen.set(false);
    this.pendingFileName.set('');
    this.pendingRawText.set('');
    this.pendingRawBase64.set('');
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
        rawText,
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
      const tableName = tableNameFromSource(fileName);
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

    if (format === 'REST' || name.toLowerCase().endsWith('.json')) {
      try {
        const json = JSON.parse(content);
        if (Array.isArray(json) && json.length > 0) {
          parsedRows = json;
          const colKeys = Object.keys(json[0]);
          parsedColumns = colKeys.map((key) => {
            const sampleVal = json[0][key];
            const type =
              typeof sampleVal === 'number'
                ? Number.isInteger(sampleVal)
                  ? 'Int64'
                  : 'Float64'
                : typeof sampleVal === 'boolean'
                  ? 'Boolean'
                  : 'String';
            return { name: key, type, icon: type };
          });
        }
      } catch {
        this.state.announceError('Failed to parse JSON file structure.');
        return null;
      }
    } else {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const separator = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
        const headers = lines[0]
          .split(separator)
          .map((h) => h.trim().replace(/^["']|["']$/g, ''));
        const dataLines = lines.slice(1);

        parsedRows = dataLines.map((line) => {
          const parts = line
            .split(separator)
            .map((p) => p.trim().replace(/^["']|["']$/g, ''));
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
          let type = 'String';
          if (parsedRows.length > 0) {
            const firstNonEmpty = parsedRows.find(
              (r) => r[col] !== null && r[col] !== undefined,
            );
            if (firstNonEmpty) {
              const val = firstNonEmpty[col];
              if (typeof val === 'number') {
                type = Number.isInteger(val) ? 'Int64' : 'Float64';
              } else if (typeof val === 'boolean') {
                type = 'Boolean';
              } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
                type = 'Date';
              }
            }
          }
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
        rawText: content,
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
    let cols: DataPrepColumn[] = initialCols.map((c) => ({ ...c }));
    let currentRows: Record<string, unknown>[] = initialRows.map((r) => ({ ...r }));
    const quarantined: DataPrepQuarantineRow[] = [];

    for (const step of steps) {
      const def = step.definition ?? {};
      const stepKind = String(def['step'] ?? step.type).replace(/Step$/, '');

      switch (stepKind) {
        case 'FileSource':
        case 'Navigation':
          break;

        case 'ChangeType': {
          const colName = String(def['column'] ?? '');
          const targetType = String(def['targetType'] ?? def['type'] ?? 'String');
          cols = cols.map((c) =>
            c.name === colName ? { ...c, type: targetType, icon: targetType } : c,
          );
          const validRows: Record<string, unknown>[] = [];
          currentRows.forEach((row, rIdx) => {
            const rawVal = row[colName];
            if (rawVal === null || rawVal === undefined || rawVal === '') {
              validRows.push({ ...row, [colName]: null });
              return;
            }
            const coerced = this.coerceValue(rawVal, targetType);
            if (coerced.valid) {
              validRows.push({ ...row, [colName]: coerced.value });
            } else {
              quarantined.push({
                sourceLineNumber: rIdx + 1,
                columnName: colName,
                expectedType: toBackendType(targetType),
                errorReason: `Cannot coerce "${String(rawVal)}" to ${targetType}`,
                rawPayload: JSON.stringify(row),
              });
            }
          });
          currentRows = validRows;
          break;
        }

        case 'DetectDataType': {
          cols = cols.map((col) => {
            const sample = currentRows.find(
              (r) => r[col.name] !== null && r[col.name] !== undefined && r[col.name] !== '',
            )?.[col.name];
            let inferred = 'String';
            if (typeof sample === 'number') {
              inferred = Number.isInteger(sample) ? 'Int64' : 'Float64';
            } else if (typeof sample === 'boolean') {
              inferred = 'Boolean';
            } else if (typeof sample === 'string') {
              const trimmed = sample.trim();
              if (/^-?\d+$/.test(trimmed)) inferred = 'Int64';
              else if (/^-?\d+\.\d+$/.test(trimmed)) inferred = 'Float64';
              else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) inferred = 'Date';
            }
            return { ...col, type: inferred, icon: inferred };
          });
          currentRows = currentRows.map((r) => {
            const nextRow = { ...r };
            cols.forEach((c) => {
              const val = nextRow[c.name];
              if (typeof val === 'string' && val !== '') {
                if (c.type === 'Int64') {
                  const n = Number(val);
                  if (!Number.isNaN(n)) nextRow[c.name] = Math.trunc(n);
                } else if (c.type === 'Float64') {
                  const n = Number(val);
                  if (!Number.isNaN(n)) nextRow[c.name] = n;
                } else if (c.type === 'Boolean') {
                  const lower = val.toLowerCase();
                  if (lower === 'true' || lower === 'yes') nextRow[c.name] = true;
                  else if (lower === 'false' || lower === 'no') nextRow[c.name] = false;
                }
              }
            });
            return nextRow;
          });
          break;
        }

        case 'RenameColumn': {
          const oldName = String(def['oldName'] ?? def['original'] ?? '');
          const newName = String(def['newName'] ?? def['renamed'] ?? '');
          if (oldName && newName && oldName !== newName) {
            cols = cols.map((c) => (c.name === oldName ? { ...c, name: newName } : c));
            currentRows = currentRows.map((r) => {
              const copy = { ...r };
              if (oldName in copy) {
                copy[newName] = copy[oldName];
                delete copy[oldName];
              }
              return copy;
            });
          }
          break;
        }

        case 'TransformColumnNames': {
          const op = String(
            (def['parameters'] as Record<string, unknown>)?.['operation'] ?? 'UPPERCASE',
          );
          const transformName = (n: string): string => {
            if (op === 'LOWERCASE') return n.toLowerCase();
            if (op === 'TRIM') return n.trim();
            if (op === 'CLEAN') return n.replace(/[^a-zA-Z0-9_]/g, '_');
            return n.toUpperCase();
          };
          const mapping = new Map<string, string>();
          cols = cols.map((c) => {
            const nextName = transformName(c.name);
            mapping.set(c.name, nextName);
            return { ...c, name: nextName };
          });
          currentRows = currentRows.map((r) => {
            const nextRow: Record<string, unknown> = {};
            Object.entries(r).forEach(([k, v]) => {
              nextRow[mapping.get(k) ?? transformName(k)] = v;
            });
            return nextRow;
          });
          break;
        }

        case 'RemoveColumn': {
          const colName = String(def['column'] ?? '');
          cols = cols.filter((c) => c.name !== colName);
          currentRows = currentRows.map((r) => {
            const copy = { ...r };
            delete copy[colName];
            return copy;
          });
          break;
        }

        case 'RemoveOtherColumns': {
          const keep =
            ((def['parameters'] as Record<string, unknown>)?.['keepColumns'] as string[]) ?? [];
          const keepSet = new Set(keep);
          cols = cols.filter((c) => keepSet.has(c.name));
          currentRows = currentRows.map((r) => {
            const nextRow: Record<string, unknown> = {};
            keep.forEach((k) => {
              if (k in r) nextRow[k] = r[k];
            });
            return nextRow;
          });
          break;
        }

        case 'FilterNulls': {
          const colName = String(def['column'] ?? '');
          currentRows = currentRows.filter(
            (r) => r[colName] !== null && r[colName] !== undefined && r[colName] !== '',
          );
          break;
        }

        case 'FilterRows': {
          const predicate = String(def['predicate'] ?? '');
          currentRows = currentRows.filter((r) => this.evaluatePredicate(r, predicate));
          break;
        }

        case 'UnpivotColumns': {
          const pivotCols = (def['pivotColumns'] as string[]) ?? [];
          const nameCol = String(def['nameCol'] ?? 'Attribute');
          const valCol = String(def['valCol'] ?? 'Value');
          const pivotSet = new Set(pivotCols);
          const anchorCols = cols.filter((c) => !pivotSet.has(c.name));
          cols = [
            ...anchorCols,
            { name: nameCol, type: 'String', icon: 'String' },
            { name: valCol, type: 'Float64', icon: 'Float64' },
          ];
          const unpivoted: Record<string, unknown>[] = [];
          for (const r of currentRows) {
            for (const pCol of pivotCols) {
              const val = r[pCol];
              if (val !== null && val !== undefined && val !== '') {
                const base: Record<string, unknown> = {};
                anchorCols.forEach((ac) => (base[ac.name] = r[ac.name]));
                base[nameCol] = pCol;
                base[valCol] = val;
                unpivoted.push(base);
              }
            }
          }
          currentRows = unpivoted;
          break;
        }

        case 'UnpivotOtherColumns': {
          const anchorNames = (def['groupColumns'] as string[]) ?? [];
          const nameCol = String(def['nameCol'] ?? 'Attribute');
          const valCol = String(def['valCol'] ?? 'Value');
          const anchorSet = new Set(anchorNames);
          const pivotCols = cols.filter((c) => !anchorSet.has(c.name)).map((c) => c.name);
          const anchorCols = cols.filter((c) => anchorSet.has(c.name));
          cols = [
            ...anchorCols,
            { name: nameCol, type: 'String', icon: 'String' },
            { name: valCol, type: 'Float64', icon: 'Float64' },
          ];
          const unpivoted: Record<string, unknown>[] = [];
          for (const r of currentRows) {
            for (const pCol of pivotCols) {
              const val = r[pCol];
              if (val !== null && val !== undefined && val !== '') {
                const base: Record<string, unknown> = {};
                anchorCols.forEach((ac) => (base[ac.name] = r[ac.name]));
                base[nameCol] = pCol;
                base[valCol] = val;
                unpivoted.push(base);
              }
            }
          }
          currentRows = unpivoted;
          break;
        }

        case 'GroupRows': {
          const gCols = (def['groupColumns'] as string[]) ?? [];
          const aggs = (def['aggregations'] as RQueryAggregateDefinition[]) ?? [];
          const groups = new Map<string, Record<string, unknown>[]>();
          for (const r of currentRows) {
            const key = gCols.map((c) => String(r[c] ?? 'NULL')).join('||');
            const bucket = groups.get(key) ?? [];
            bucket.push(r);
            groups.set(key, bucket);
          }
          const nextRows: Record<string, unknown>[] = [];
          groups.forEach((bucket) => {
            const exemplar = bucket[0] ?? {};
            const outRow: Record<string, unknown> = {};
            gCols.forEach((c) => (outRow[c] = exemplar[c]));
            for (const agg of aggs) {
              const nums = bucket
                .map((b) => Number(b[agg.sourceColumn]))
                .filter((n) => !Number.isNaN(n));
              if (agg.function === 'COUNT') {
                outRow[agg.outputColumn] = bucket.length;
              } else if (nums.length === 0) {
                outRow[agg.outputColumn] = 0;
              } else if (agg.function === 'SUM') {
                outRow[agg.outputColumn] = nums.reduce((a, b) => a + b, 0);
              } else if (agg.function === 'AVG') {
                outRow[agg.outputColumn] = nums.reduce((a, b) => a + b, 0) / nums.length;
              } else if (agg.function === 'MIN') {
                outRow[agg.outputColumn] = Math.min(...nums);
              } else if (agg.function === 'MAX') {
                outRow[agg.outputColumn] = Math.max(...nums);
              }
            }
            nextRows.push(outRow);
          });
          cols = [
            ...cols.filter((c) => gCols.includes(c.name)),
            ...aggs.map((a) => ({
              name: a.outputColumn,
              type: a.function === 'COUNT' ? 'Int64' : 'Float64',
              icon: a.function === 'COUNT' ? 'Int64' : 'Float64',
            })),
          ];
          currentRows = nextRows;
          break;
        }

        case 'AddCustomColumn': {
          const newCol = String(def['newName'] ?? 'Custom');
          const expr = String(def['expression'] ?? '');
          const validRows: Record<string, unknown>[] = [];
          currentRows.forEach((r, idx) => {
            const res = this.evaluateCustomExpression(r, expr);
            if (res.error) {
              quarantined.push({
                sourceLineNumber: idx + 1,
                columnName: newCol,
                expectedType: 'FLOAT64',
                errorReason: res.error,
                rawPayload: JSON.stringify(r),
              });
            } else {
              validRows.push({ ...r, [newCol]: res.value });
            }
          });
          currentRows = validRows;
          const sampleVal = currentRows[0]?.[newCol];
          const colType = typeof sampleVal === 'number' ? 'Float64' : 'String';
          if (!cols.some((c) => c.name === newCol)) {
            cols = [...cols, { name: newCol, type: colType, icon: colType }];
          }
          break;
        }

        case 'AddIndexColumn': {
          const newCol = String(def['newName'] ?? 'Index');
          const params = (def['parameters'] as Record<string, unknown>) ?? {};
          const initial = Number(params['initialValue'] ?? 1);
          const increment = Number(params['increment'] ?? 1);
          currentRows = currentRows.map((r, idx) => ({
            ...r,
            [newCol]: initial + idx * increment,
          }));
          if (!cols.some((c) => c.name === newCol)) {
            cols = [...cols, { name: newCol, type: 'Int64', icon: 'Int64' }];
          }
          break;
        }

        case 'MergeQueries': {
          const targetSourceId = String(
            (def['parameters'] as Record<string, unknown>)?.['targetSourceId'] ?? '',
          );
          const targetTableName = String(def['targetTable'] ?? '');
          const joinKeys = (def['joinKeys'] as string[]) ?? [];
          const joinKey = joinKeys[0] ?? '';
          const joinType = String(def['joinType'] ?? 'LEFT');
          const params = (def['parameters'] as Record<string, unknown>) ?? {};
          const mode = String(params['mode'] ?? 'expand');

          const targetSrc =
            this.sources().find((s) => s.id === targetSourceId) ??
            this.sources().find((s) => tableNameFromSource(s.name) === targetTableName);
          const targetSnap = targetSrc ? this.rawSnapshotsBySource()[targetSrc.id] : undefined;
          const lookupRows = targetSnap ? targetSnap.rows : [];

          if (joinKey && lookupRows.length > 0) {
            if (mode === 'aggregate') {
              const aggCol = String(params['aggregateColumn'] ?? '');
              const aggFn = String(params['aggregateFunction'] ?? 'SUM') as AggregationFunction;
              const outName = String(params['outputColumn'] ?? `${targetTableName}_${aggFn}`);
              currentRows = currentRows
                .map((leftRow) => {
                  const keyVal = leftRow[joinKey];
                  const matches = lookupRows.filter(
                    (lr) => String(lr[joinKey]) === String(keyVal),
                  );
                  if (matches.length === 0 && joinType === 'INNER') return null;
                  const nums = matches
                    .map((m) => Number(m[aggCol]))
                    .filter((n) => !Number.isNaN(n));
                  let aggVal = 0;
                  if (aggFn === 'COUNT') aggVal = matches.length;
                  else if (aggFn === 'SUM') aggVal = nums.reduce((a, b) => a + b, 0);
                  else if (aggFn === 'AVG')
                    aggVal = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
                  else if (aggFn === 'MIN') aggVal = nums.length ? Math.min(...nums) : 0;
                  else if (aggFn === 'MAX') aggVal = nums.length ? Math.max(...nums) : 0;
                  return { ...leftRow, [outName]: aggVal };
                })
                .filter((r): r is Record<string, unknown> => r !== null);
              if (!cols.some((c) => c.name === outName)) {
                cols = [...cols, { name: outName, type: 'Float64', icon: 'Float64' }];
              }
            } else {
              const extraCols = (targetSnap?.columns ?? []).filter(
                (tc) => tc.name !== joinKey && !cols.some((c) => c.name === tc.name),
              );
              currentRows = currentRows
                .map((leftRow) => {
                  const keyVal = leftRow[joinKey];
                  const match = lookupRows.find((lr) => String(lr[joinKey]) === String(keyVal));
                  if (!match && joinType === 'INNER') return null;
                  const merged: Record<string, unknown> = { ...leftRow };
                  extraCols.forEach((ec) => {
                    merged[ec.name] = match ? (match[ec.name] ?? null) : null;
                  });
                  return merged;
                })
                .filter((r): r is Record<string, unknown> => r !== null);
              cols = [...cols, ...extraCols];
            }
          }
          break;
        }

        case 'FillDown': {
          const colName = String(def['column'] ?? '');
          let lastNonNull: unknown = null;
          currentRows = currentRows.map((r) => {
            const val = r[colName];
            if (val !== null && val !== undefined && val !== '') {
              lastNonNull = val;
              return r;
            }
            return lastNonNull !== null ? { ...r, [colName]: lastNonNull } : r;
          });
          break;
        }

        case 'PromoteHeaders': {
          if (currentRows.length > 0) {
            const firstRow = currentRows[0];
            const mapping = new Map<string, string>();
            cols = cols.map((c, idx) => {
              const promoted = String(firstRow[c.name] ?? `Column_${idx + 1}`).trim() || c.name;
              mapping.set(c.name, promoted);
              return { ...c, name: promoted };
            });
            currentRows = currentRows.slice(1).map((r) => {
              const next: Record<string, unknown> = {};
              Object.entries(r).forEach(([k, v]) => {
                next[mapping.get(k) ?? k] = v;
              });
              return next;
            });
          }
          break;
        }

        case 'Transpose': {
          if (cols.length > 0 && currentRows.length > 0) {
            const newCols: DataPrepColumn[] = currentRows.map((_, rIdx) => ({
              name: `Column_${rIdx + 1}`,
              type: 'String',
              icon: 'String',
            }));
            const transposedRows: Record<string, unknown>[] = cols.map((col) => {
              const rowObj: Record<string, unknown> = {};
              currentRows.forEach((r, rIdx) => {
                rowObj[`Column_${rIdx + 1}`] = r[col.name];
              });
              return rowObj;
            });
            cols = newCols;
            currentRows = transposedRows;
          }
          break;
        }

        case 'RemoveTopRows': {
          const count = Math.max(
            0,
            Number((def['parameters'] as Record<string, unknown>)?.['count'] ?? 1),
          );
          currentRows = currentRows.slice(count);
          break;
        }

        case 'RemoveBottomRows': {
          const count = Math.max(
            0,
            Number((def['parameters'] as Record<string, unknown>)?.['count'] ?? 1),
          );
          currentRows =
            count > 0 ? currentRows.slice(0, Math.max(0, currentRows.length - count)) : currentRows;
          break;
        }

        case 'RemoveDuplicates': {
          const keyCols = (def['groupColumns'] as string[]) ?? cols.map((c) => c.name);
          const seen = new Set<string>();
          currentRows = currentRows.filter((r) => {
            const sig = keyCols.map((k) => String(r[k] ?? 'NULL')).join('||');
            if (seen.has(sig)) return false;
            seen.add(sig);
            return true;
          });
          break;
        }

        case 'SplitColumn': {
          const colName = String(def['column'] ?? '');
          const delimiter = String(
            (def['parameters'] as Record<string, unknown>)?.['delimiter'] ?? ',',
          );
          const col1 = `${colName}_1`;
          const col2 = `${colName}_2`;
          currentRows = currentRows.map((r) => {
            const raw = String(r[colName] ?? '');
            const idx = raw.indexOf(delimiter);
            const p1 = idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
            const p2 = idx >= 0 ? raw.slice(idx + delimiter.length).trim() : null;
            const copy = { ...r, [col1]: p1, [col2]: p2 };
            delete copy[colName];
            return copy;
          });
          const targetIdx = cols.findIndex((c) => c.name === colName);
          if (targetIdx >= 0) {
            cols = [
              ...cols.slice(0, targetIdx),
              { name: col1, type: 'String', icon: 'String' },
              { name: col2, type: 'String', icon: 'String' },
              ...cols.slice(targetIdx + 1),
            ];
          }
          break;
        }

        case 'MergeColumns': {
          const sourceCols = (def['groupColumns'] as string[]) ?? [];
          const newCol = String(def['newName'] ?? 'Merged');
          const sep = String((def['parameters'] as Record<string, unknown>)?.['separator'] ?? ' ');
          if (sourceCols.length >= 2) {
            currentRows = currentRows.map((r) => ({
              ...r,
              [newCol]: sourceCols
                .map((sc) => r[sc])
                .filter((v) => v !== null && v !== undefined && v !== '')
                .join(sep),
            }));
            if (!cols.some((c) => c.name === newCol)) {
              cols = [...cols, { name: newCol, type: 'String', icon: 'String' }];
            }
          }
          break;
        }

        case 'SortRows': {
          const colName = String(def['column'] ?? '');
          const asc = (def['parameters'] as Record<string, unknown>)?.['ascending'] !== false;
          currentRows = [...currentRows].sort((a, b) => {
            const va = a[colName];
            const vb = b[colName];
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            const cmp =
              typeof va === 'number' && typeof vb === 'number'
                ? va - vb
                : String(va).localeCompare(String(vb));
            return asc ? cmp : -cmp;
          });
          break;
        }

        case 'InlineCleansing': {
          const colName = String(def['column'] ?? '');
          const params = (def['parameters'] as Record<string, unknown>) ?? {};
          const op = String(params['operation'] ?? 'TRIM');
          currentRows = currentRows.map((r) => {
            const raw = r[colName];
            if (raw === null || raw === undefined) return r;
            const str = String(raw);
            let nextVal: unknown = str;
            if (op === 'TRIM') nextVal = str.trim();
            else if (op === 'UPPERCASE') nextVal = str.toUpperCase();
            else if (op === 'LOWERCASE') nextVal = str.toLowerCase();
            else if (op === 'REPLACE') {
              const target = String(params['target'] ?? '');
              const replacement = String(params['replacement'] ?? '');
              nextVal = target ? str.split(target).join(replacement) : str;
            }
            return { ...r, [colName]: nextVal };
          });
          break;
        }
      }
    }

    return { columns: cols, rows: currentRows, quarantined };
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

  private extractSheetsFromText(fileName: string, text: string): WorkbookSheet[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return [{ id: 'sheet_1', name: 'Sheet1', kind: 'Sheet', columns: [], rows: [] }];
    }
    const separator = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    const rawHeaders = lines[0].split(separator).map((h) => h.trim().replace(/^["']|["']$/g, ''));
    const unpromotedCols: DataPrepColumn[] = rawHeaders.map((_, i) => ({
      name: `Column${i + 1}`,
      type: 'String',
      icon: 'String',
    }));

    const unpromotedRows: Record<string, unknown>[] = [];
    const headerRow: Record<string, unknown> = {};
    rawHeaders.forEach((h, i) => {
      headerRow[`Column${i + 1}`] = h;
    });
    unpromotedRows.push(headerRow);

    lines.slice(1).forEach((line) => {
      const parts = line.split(separator).map((p) => p.trim().replace(/^["']|["']$/g, ''));
      const r: Record<string, unknown> = {};
      rawHeaders.forEach((_, i) => {
        r[`Column${i + 1}`] = parts[i] ?? null;
      });
      unpromotedRows.push(r);
    });

    const baseName = fileName.replace(/\.[^/.]+$/, '');
    return [
      {
        id: 'sheet_1',
        name: 'Sheet1',
        kind: 'Sheet',
        columns: unpromotedCols,
        rows: unpromotedRows,
      },
      {
        id: 'sheet_2',
        name: baseName,
        kind: 'Table',
        columns: unpromotedCols,
        rows: unpromotedRows,
      },
    ];
  }

  private coerceValue(rawVal: unknown, targetType: string): { valid: boolean; value: unknown } {
    const upper = targetType.toUpperCase();
    if (upper === 'STRING' || upper === 'TEXT' || upper === 'UTF8_STRING') {
      return { valid: true, value: String(rawVal) };
    }
    if (upper === 'INT64') {
      const cleaned = String(rawVal).replace(/[€$,\s]/g, '');
      const num = Number(cleaned);
      if (Number.isNaN(num) || !Number.isFinite(num)) return { valid: false, value: null };
      return { valid: true, value: Math.trunc(num) };
    }
    if (upper === 'FLOAT64' || upper === 'DECIMAL' || upper === 'CURRENCY') {
      const cleaned = String(rawVal).replace(/[€$,\s]/g, '');
      const num = Number(cleaned);
      if (Number.isNaN(num) || !Number.isFinite(num)) return { valid: false, value: null };
      return { valid: true, value: num };
    }
    if (upper === 'BOOLEAN') {
      const s = String(rawVal).trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return { valid: true, value: true };
      if (s === 'false' || s === '0' || s === 'no') return { valid: true, value: false };
      return { valid: false, value: null };
    }
    if (
      upper === 'DATE' ||
      upper === 'DATETIME' ||
      upper === 'ISO_DATE' ||
      upper === 'ISO_DATETIME'
    ) {
      const str = String(rawVal).trim();
      const parsed = Date.parse(str);
      if (Number.isNaN(parsed)) return { valid: false, value: null };
      return { valid: true, value: str };
    }
    return { valid: true, value: rawVal };
  }

  private evaluatePredicate(row: Record<string, unknown>, predicate: string): boolean {
    if (!predicate.trim()) return true;
    const clauses = predicate.split(/\s+and\s+/i);
    return clauses.every((clause) => {
      const match = clause
        .trim()
        .match(/^\[([^\]]+)\]\s*(==|!=|<>|>=|<=|>|<)\s*(.+)$/);
      if (!match) return true;
      const [, col, op, rawLit] = match;
      const cellVal = row[col];
      const lit = rawLit.trim().replace(/^['"]|['"]$/g, '');
      if (cellVal === null || cellVal === undefined) {
        return op === '!=' || op === '<>';
      }
      const numCell = Number(cellVal);
      const numLit = Number(lit);
      const bothNumeric =
        !Number.isNaN(numCell) && !Number.isNaN(numLit) && !rawLit.trim().startsWith("'");
      const cmp = bothNumeric ? numCell - numLit : String(cellVal).localeCompare(lit);

      switch (op) {
        case '==':
          return bothNumeric ? numCell === numLit : String(cellVal) === lit;
        case '!=':
        case '<>':
          return bothNumeric ? numCell !== numLit : String(cellVal) !== lit;
        case '>':
          return cmp > 0;
        case '>=':
          return cmp >= 0;
        case '<':
          return cmp < 0;
        case '<=':
          return cmp <= 0;
        default:
          return true;
      }
    });
  }

  private evaluateCustomExpression(
    row: Record<string, unknown>,
    expression: string,
  ): { value: unknown; error?: string } {
    const trimmed = expression.trim();
    if (!trimmed) return { value: null };

    const textSelectMatch = trimmed.match(/Text\.Select\(\s*\[([^\]]+)\]/i);
    if (textSelectMatch) {
      const col = textSelectMatch[1];
      const raw = String(row[col] ?? '');
      return { value: raw.replace(/\D+/g, '') };
    }

    const condMatch = trimmed.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+)$/i);
    if (condMatch) {
      const [, condExpr, thenExpr, elseExpr] = condMatch;
      const condTrue = this.evaluatePredicate(row, condExpr.trim());
      const branch = (condTrue ? thenExpr : elseExpr).trim().replace(/^['"]|['"]$/g, '');
      const numBranch = Number(branch);
      return { value: !Number.isNaN(numBranch) && branch !== '' ? numBranch : branch };
    }

    if (trimmed.includes('&')) {
      const parts = trimmed.split('&').map((part) => {
        const p = part.trim();
        const colRef = p.match(/^\[([^\]]+)\]$/);
        if (colRef) return String(row[colRef[1]] ?? '');
        return p.replace(/^['"]|['"]$/g, '');
      });
      return { value: parts.join('') };
    }

    const binMatch = trimmed.match(
      /^\[([^\]]+)\]\s*([+\-*/])\s*(?:\[([^\]]+)\]|(-?\d+(?:\.\d+)?))$/,
    );
    if (binMatch) {
      const [, leftCol, op, rightCol, rightLit] = binMatch;
      const leftNum = Number(row[leftCol]);
      const rightNum = rightCol !== undefined ? Number(row[rightCol]) : Number(rightLit);
      if (Number.isNaN(leftNum) || Number.isNaN(rightNum)) {
        return { value: null, error: `Non-numeric operand in ${trimmed}` };
      }
      if (op === '/' && rightNum === 0) {
        return { value: null, error: 'Division by zero' };
      }
      const val =
        op === '+'
          ? leftNum + rightNum
          : op === '-'
            ? leftNum - rightNum
            : op === '*'
              ? leftNum * rightNum
              : leftNum / rightNum;
      return { value: Number(val.toFixed(4)) };
    }

    const singleCol = trimmed.match(/^\[([^\]]+)\]$/);
    if (singleCol) {
      return { value: row[singleCol[1]] ?? null };
    }
    return { value: trimmed.replace(/^['"]|['"]$/g, '') };
  }
}

