import { HttpClient } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { Observable, catchError, map, of, switchMap } from "rxjs";
import { SemanticModelService } from "../model/model.service";
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
  toDisplayType,
} from "../../features/data-prep/data-prep.model";
import { BackendRecordBatch } from "../prep/prep.interface";
import { DataPrepEngineService } from "../prep/prep.service";
import { StateManagerService } from "../state/state.service";
import {
  DEFAULT_EXTENSIONS,
  INGESTION_PREVIEW_ENDPOINT,
  INGESTION_SHEETS_ENDPOINT,
  MULTI_SHEET_PATTERN,
} from "./ingestion.constants";
import {
  DirectDataset,
  EvalResult,
  NavigatorMode,
  PipelineSyncEvent,
  SheetExtractionRequest,
  SheetExtractionResponse,
  SourceFormat,
} from "./ingestion.interface";

@Injectable({
  providedIn: "root",
})
export class IngestionService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);
  private readonly router = inject(Router, { optional: true });
  private readonly engine = inject(DataPrepEngineService);
  private readonly model = inject(SemanticModelService);

  public readonly sources = signal<readonly IngestionSource[]>([]);
  public readonly selectedSourceId = signal<string>("");
  public readonly stepsBySource = signal<Record<string, readonly DataPrepStep[]>>({});
  public readonly rawSnapshotsBySource = signal<Record<string, SourceSnapshot>>({});
  public readonly pipelineSync = signal<PipelineSyncEvent | null>(null);

  public readonly importMenuOpen = signal<boolean>(false);
  public readonly selectedConnectorId = signal<string>("excel");

  public readonly isNavigatorModalOpen = signal<boolean>(false);
  public readonly pendingFileName = signal<string>("");
  public readonly pendingFileFormat = signal<SourceFormat>("XLSX");
  public readonly pendingBackendFormat = signal<BackendSourceFormat>("XLSX");
  public readonly pendingRawText = signal<string>("");
  public readonly pendingRawBase64 = signal<string>("");
  public readonly navigatorSheets = signal<readonly WorkbookSheet[]>([]);
  public readonly selectedNavigatorSheetId = signal<string>("");
  public readonly navigatorError = signal<string>("");

  public readonly selectedNavigatorSheet = computed(() => {
    const list = this.navigatorSheets();
    const id = this.selectedNavigatorSheetId();
    return list.find((sheet) => sheet.id === id) ?? list[0] ?? null;
  });

  public readonly fileConnectors = DATA_CONNECTORS;

  public toggleMenu(): void {
    this.importMenuOpen.update((open) => !open);
  }

  public closeMenu(): void {
    this.importMenuOpen.set(false);
  }

  public triggerConnector(
    connectorId: string,
    fileInput?: HTMLInputElement,
  ): void {
    const connector = DATA_CONNECTORS.find((c) => c.id === connectorId);
    if (!connector) {
      return;
    }

    this.selectedConnectorId.set(connectorId);
    this.importMenuOpen.set(false);
    if (fileInput) {
      fileInput.accept = connector.fileExtensions || DEFAULT_EXTENSIONS;
      fileInput.click();
    }
  }

  public selectFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const file = input.files[0];
    const fileName = file.name;
    const backendFmt = formatFromFileName(fileName) ?? "CSV";
    const format: SourceFormat =
      backendFmt === "JSON" || backendFmt === "XML"
        ? "REST"
        : backendFmt === "XLSX"
          ? "XLSX"
          : backendFmt === "PARQUET" || backendFmt === "AVRO"
            ? "PARQUET"
            : "CSV";

    const reader = new FileReader();
    if (isBinaryFormat(backendFmt)) {
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) {
          return;
        }
        this.openBinary(fileName, format, backendFmt, buffer, toBase64(buffer));
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) {
          return;
        }
        this.openText(fileName, format, backendFmt, text);
      };
      reader.readAsText(file);
    }
    input.value = "";
  }

  public openBinary(
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    _buffer: ArrayBuffer,
    base64: string,
  ): void {
    this.extractSheets(name, format, backendFormat, "", base64);
  }

  public openText(
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    text: string,
  ): void {
    this.extractSheets(name, format, backendFormat, text, "");
  }

  public cancelNavigator(): void {
    this.isNavigatorModalOpen.set(false);
    this.pendingFileName.set("");
    this.pendingRawText.set("");
    this.pendingRawBase64.set("");
    this.navigatorError.set("");
    this.navigatorSheets.set([]);
  }

  public confirmNavigator(mode: NavigatorMode = "transform"): void {
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

    const snapCols = [...sheet.columns];
    const snapRows = [...sheet.rows];
    this.rawSnapshotsBySource.update((current) => ({
      ...current,
      [datasetId]: {
        columns: snapCols,
        rows: snapRows,
        rawText,
        rawBase64,
      },
    }));

    const initialSteps = this.buildPipeline(fileName, backendFormat, sheet);
    this.sources.update((srcs) => [...srcs, newSource]);
    this.selectedSourceId.set(datasetId);
    this.stepsBySource.update((current) => ({
      ...current,
      [datasetId]: initialSteps,
    }));
    this.isNavigatorModalOpen.set(false);

    this.evaluateSteps(snapCols, snapRows, initialSteps).subscribe(
      (evaluated) => {
        if (mode === "load" && evaluated.columns.length > 0) {
          const multiTable =
            this.navigatorSheets().length > 1 &&
            !MULTI_SHEET_PATTERN.test(sheet.name);
          const tableName = multiTable
            ? `${tableNameFromSource(fileName)}_${tableNameFromSource(sheet.name)}`
            : tableNameFromSource(fileName);
          this.publishTable(
            `tbl_${datasetId}`,
            tableName,
            evaluated.columns,
            evaluated.rows,
          );
        }

        this.pipelineSync.update((prev) => ({
          sourceId: datasetId,
          stepIndex: initialSteps.length - 1,
          seq: (prev?.seq ?? 0) + 1,
        }));

        this.state.announce(
          mode === "load"
            ? `Loaded sheet "${sheet.name}" from "${fileName}" (${evaluated.rows.length} rows) into semantic model.`
            : `Loaded sheet "${sheet.name}" from "${fileName}" with standard 4-step ingestion pipeline.`,
        );
      },
    );

    if (
      mode === "transform" &&
      this.router &&
      this.router.url !== "/data-prep" &&
      this.router.config.some((route) => route.path === "data-prep")
    ) {
      void this.router.navigate(["/data-prep"]).catch(() => false);
    }
  }

  public loadDirect(
    name: string,
    format: SourceFormat,
    content: string,
  ): Observable<DirectDataset | null> {
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const backendFormat =
      formatFromFileName(name) ?? (format === "REST" ? "JSON" : format);

    const payload = {
      tenantId: "default-tenant",
      datasetId,
      format: backendFormat,
      rawPayload: content,
      steps: [],
    };

    return this.http
      .post<readonly BackendRecordBatch[]>(INGESTION_PREVIEW_ENDPOINT, payload)
      .pipe(
        map((batches) => {
          const schema = batches[0]?.schema ?? {};
          const parsedColumns: DataPrepColumn[] = Object.entries(schema).map(
            ([colName, rawType]) => {
              const displayType = toDisplayType(rawType);
              return { name: colName, type: displayType, icon: displayType };
            },
          );
          const parsedRows: Record<string, unknown>[] = batches.flatMap(
            (b) => b.rows ?? [],
          );

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
            name: "Source Ingestion",
            type: "FileSource",
            detail: `${format.toLowerCase()}("${name}")`,
            definition: {
              step: "FileSource",
              source: name,
              format,
              rowCount: parsedRows.length,
            },
          };

          this.rawSnapshotsBySource.update((current) => ({
            ...current,
            [datasetId]: {
              columns: parsedColumns,
              rows: parsedRows,
              rawText: content,
            },
          }));
          this.sources.update((srcs) => [...srcs, newSource]);
          this.selectedSourceId.set(datasetId);
          this.stepsBySource.update((current) => ({
            ...current,
            [datasetId]: [initialStep],
          }));

          if (parsedColumns.length > 0) {
            const tableName = tableNameFromSource(name) || "user_dataset";
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

          return {
            source: newSource,
            columns: parsedColumns,
            rows: parsedRows,
            initialStep,
          };
        }),
        catchError((error) => {
          this.state.announceError(`Loading ${name}`, error);
          return of(null);
        }),
      );
  }

  public evaluateSteps(
    initialCols: readonly DataPrepColumn[],
    initialRows: readonly Record<string, unknown>[],
    steps: readonly DataPrepStep[],
  ): Observable<EvalResult> {
    const lookupTables: Record<string, readonly Record<string, unknown>[]> = {};
    const snapshots = this.rawSnapshotsBySource();
    for (const src of this.sources()) {
      const snap = snapshots[src.id];
      if (snap) {
        lookupTables[src.id] = snap.rows;
        lookupTables[tableNameFromSource(src.name)] = snap.rows;
      }
    }
    return this.engine.evaluateSteps(
      initialCols,
      initialRows,
      steps,
      lookupTables,
    );
  }

  private extractSheets(
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    rawPayload: string,
    rawPayloadBase64: string,
  ): void {
    this.pendingFileName.set(name);
    this.pendingFileFormat.set(format);
    this.pendingBackendFormat.set(backendFormat);
    this.pendingRawText.set(rawPayload);
    this.pendingRawBase64.set(rawPayloadBase64);

    const request: SheetExtractionRequest = {
      fileName: name,
      format: backendFormat,
      rawPayload,
      rawPayloadBase64,
    };

    this.http
      .post<SheetExtractionResponse>(INGESTION_SHEETS_ENDPOINT, request)
      .subscribe({
        next: (response) => {
          const sheets = [...(response.sheets ?? [])];
          this.navigatorSheets.set(sheets);
          this.selectedNavigatorSheetId.set(sheets[0]?.id ?? "");

          if (response.error) {
            this.navigatorError.set(response.error);
            this.state.announceError(response.error);
          } else if (sheets.length === 0) {
            const msg = `Failed to extract readable sheets from "${name}".`;
            this.navigatorError.set(msg);
            this.state.announceError(msg);
          } else {
            this.navigatorError.set("");
            this.state.announce(
              `Navigator: select sheet to preview from ${name}.`,
            );
          }
          this.isNavigatorModalOpen.set(true);
        },
        error: (err) => {
          const msg = `Failed to extract sheets from "${name}".`;
          this.navigatorSheets.set([]);
          this.navigatorError.set(msg);
          this.state.announceError(msg, err);
          this.isNavigatorModalOpen.set(true);
        },
      });
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
        name: "Source Ingestion",
        type: "FileSource",
        detail: `${backendFormat.toLowerCase()}("${fileName}")`,
        definition: {
          step: "FileSource",
          source: fileName,
          format: backendFormat,
        },
      },
      {
        id: `step_${now}_nav`,
        name: "Navigation",
        type: "Navigation",
        detail: `Item="${sheet.name}", Kind="${sheet.kind}"`,
        definition: {
          step: "Navigation",
          item: sheet.name,
          kind: sheet.kind,
          sheetName: sheet.sheetName ?? sheet.name,
        },
      },
      {
        id: `step_${now}_headers`,
        name: "Promoted Headers",
        type: "PromoteHeaders",
        detail: "PromoteAllScalars=true",
        definition: { step: "PromoteHeaders" },
      },
      {
        id: `step_${now}_types`,
        name: "Changed Type",
        type: "DetectDataType",
        detail: "Auto-detected schema across all columns",
        definition: { step: "DetectDataType" },
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
      role: "FACT",
      columns: columns.map((col) => ({
        name: col.name,
        dataType: (col.type || "VARCHAR").toUpperCase(),
        keyType: "None" as const,
      })),
      rowCount: rows.length,
    });
    this.state.setRows(tableName, [...rows]);
    this.syncTable(tableName, rows);
  }

  private syncTable(
    tableName: string,
    rows: readonly Record<string, unknown>[],
  ): void {
    this.model
      .pushState(this.state)
      .pipe(switchMap(() => this.model.ingestRows(tableName, rows)))
      .subscribe();
  }
}
