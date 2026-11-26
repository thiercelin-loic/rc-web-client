import { HttpClient } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { Observable, catchError, map, of, switchMap } from "rxjs";
import {
  ApiService,
  IncrementalRefreshResult,
} from "../../services/api.service";
import { SemanticModelService } from "../model/model.service";
import {
  BackendSourceFormat,
  DataPrepColumn,
  DataPrepStep,
  StepEvaluationResult,
} from "../prep/prep.interface";
import { DataPrepEngineService } from "../prep/prep.service";
import { StateManagerService } from "../state/state.service";
import {
  DATA_CONNECTORS,
  DEFAULT_EXTENSIONS,
  INGESTION_SHEETS_ENDPOINT,
  MULTI_SHEET_PATTERN,
} from "./ingestion.constants";
import {
  DirectDataset,
  EvalResult,
  IngestionSource,
  NavigatorMode,
  PipelineSyncEvent,
  SheetExtractionRequest,
  SheetExtractionResponse,
  SourceFormat,
  SourceSnapshot,
  WorkbookSheet,
} from "./ingestion.interface";
import { toBase64 } from "./ingestion.utils";

@Injectable({
  providedIn: "root",
})
export class IngestionService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly state = inject(StateManagerService);
  private readonly router = inject(Router, { optional: true });
  private readonly engine = inject(DataPrepEngineService);
  private readonly model = inject(SemanticModelService);

  public readonly sources = signal<readonly IngestionSource[]>([]);
  public readonly selectedSourceId = signal<string>("");
  public readonly stepsBySource = signal<
    Record<string, readonly DataPrepStep[]>
  >({});
  public readonly rawSnapshotsBySource = signal<Record<string, SourceSnapshot>>(
    {},
  );
  public readonly pipelineSync = signal<PipelineSyncEvent | null>(null);

  public readonly importMenuOpen = signal<boolean>(false);
  public readonly selectedConnectorId = signal<string>("excel");

  public readonly isNavigatorModalOpen = signal<boolean>(false);
  public readonly pendingFileName = signal<string>("");
  public readonly pendingFileFormat = signal<SourceFormat>("XLSX");
  public readonly pendingBackendFormat = signal<BackendSourceFormat>("XLSX");
  public readonly pendingRawText = signal<string>("");
  public readonly pendingRawBase64 = signal<string>("");
  public readonly pendingTableName = signal<string>("");
  public readonly pendingInitialSteps = signal<readonly DataPrepStep[]>([]);
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
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const backendFmt = this.detectFormat(file.name);
    const format = this.toUiFormat(backendFmt);
    this.readFile(file, format, backendFmt);
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
    this.pendingTableName.set("");
    this.pendingInitialSteps.set([]);
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
    const backendFormat = this.pendingBackendFormat();
    const tableName = this.resolveTable(fileName, sheet);
    const datasetId = `ds_${Date.now()}`;
    const newSource = this.createSource(
      datasetId,
      fileName,
      this.pendingFileFormat(),
      backendFormat,
      tableName,
    );
    const initialSteps = this.resolveSteps(fileName, backendFormat, sheet);

    this.registerDataset(
      newSource,
      {
        columns: [...sheet.columns],
        rows: [...sheet.rows],
        rawText: this.pendingRawText(),
        rawBase64: this.pendingRawBase64(),
        tableName,
      },
      initialSteps,
    );
    this.isNavigatorModalOpen.set(false);

    this.evaluateNavigator(
      newSource,
      sheet,
      initialSteps,
      mode,
      fileName,
      tableName,
    );
    this.navigateToPrep(mode);
  }

  public loadDirect(
    name: string,
    format: SourceFormat,
    content: string,
  ): Observable<DirectDataset | null> {
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const backendFormat = this.resolveFormat(name, format);

    return this.engine
      .previewPipeline({
        datasetId,
        fileName: name,
        format: backendFormat,
        rawPayload: content,
        steps: [],
      })
      .pipe(
        map((evaluated) =>
          this.commitDirect(
            datasetId,
            name,
            format,
            backendFormat,
            content,
            evaluated,
          ),
        ),
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
    source?: IngestionSource | null,
    rangeStart?: string,
    rangeEnd?: string,
  ): Observable<EvalResult> {
    return this.engine.evaluateSteps(
      initialCols,
      initialRows,
      steps,
      this.buildLookups(),
      {
        datasetId: source?.id,
        fileName: source?.name,
        format: source?.backendFormat,
        rangeStart,
        rangeEnd,
      },
    );
  }

  public upsertStep(
    sourceId: string,
    step: DataPrepStep,
    replaceSameColumnType = false,
  ): number {
    if (!sourceId) {
      return -1;
    }
    let updatedLength = 0;
    this.stepsBySource.update((mapBySource) => {
      const current = [...(mapBySource[sourceId] ?? [])];
      const existingIdx = replaceSameColumnType
        ? this.findTypeStep(current, step)
        : -1;
      if (existingIdx >= 0) {
        current[existingIdx] = step;
      } else {
        current.push(step);
      }
      updatedLength = current.length;
      return { ...mapBySource, [sourceId]: current };
    });
    return updatedLength - 1;
  }

  public removeStep(
    sourceId: string,
    index: number,
  ): { readonly removed: DataPrepStep | null; readonly nextIndex: number } {
    const current = this.stepsBySource()[sourceId] ?? [];
    if (index <= 0 || index >= current.length) {
      return { removed: null, nextIndex: current.length - 1 };
    }
    const removed = current[index];
    const updated = current.filter((_, i) => i !== index);
    this.stepsBySource.update((m) => ({ ...m, [sourceId]: updated }));
    return { removed, nextIndex: updated.length - 1 };
  }

  public moveStep(
    sourceId: string,
    index: number,
    direction: -1 | 1,
  ): { readonly moved: DataPrepStep | null; readonly targetIndex: number } {
    const current = [...(this.stepsBySource()[sourceId] ?? [])];
    const targetIdx = index + direction;
    if (index <= 0 || targetIdx <= 0 || targetIdx >= current.length) {
      return { moved: null, targetIndex: index };
    }
    const temp = current[index];
    current[index] = current[targetIdx];
    current[targetIdx] = temp;
    this.stepsBySource.update((m) => ({ ...m, [sourceId]: current }));
    return { moved: temp, targetIndex: targetIdx };
  }

  public toggleLoad(sourceId: string): IngestionSource | null {
    let updatedSource: IngestionSource | null = null;
    this.sources.update((list) =>
      list.map((src) => {
        if (src.id === sourceId) {
          updatedSource = { ...src, enableLoad: src.enableLoad === false };
          return updatedSource;
        }
        return src;
      }),
    );
    if (updatedSource) {
      const target: IngestionSource = updatedSource;
      if (target.enableLoad === false) {
        this.state.removeTable(target.tableName || target.name);
      }
    }
    return updatedSource;
  }

  public duplicateDataset(source: IngestionSource): IngestionSource {
    const snap = this.rawSnapshotsBySource()[source.id];
    const steps = this.stepsBySource()[source.id] ?? [];
    const copyId = `ds_${Date.now()}`;
    const copyName = source.name.replace(/(\.[^/.]+)?$/, "_copy$1");
    const copyTableName = source.tableName
      ? `${source.tableName}_copy`
      : copyName;
    const copySource: IngestionSource = {
      ...source,
      id: copyId,
      name: copyName,
      path: copyName,
      enableLoad: true,
      tableName: copyTableName,
    };
    if (snap) {
      this.rawSnapshotsBySource.update((m) => ({
        ...m,
        [copyId]: {
          columns: snap.columns.map((c) => ({ ...c })),
          rows: snap.rows.map((r) => ({ ...r })),
          rawText: snap.rawText,
          rawBase64: snap.rawBase64,
          tableName: copyTableName,
        },
      }));
    }
    this.stepsBySource.update((m) => ({
      ...m,
      [copyId]: steps.map((s, idx) => ({ ...s, id: `step_${copyId}_${idx}` })),
    }));
    this.sources.update((list) => [...list, copySource]);
    return copySource;
  }

  public applyLoad(
    source: IngestionSource | null,
    columns: readonly DataPrepColumn[],
    rows: readonly Record<string, unknown>[],
  ): {
    readonly status: "disabled" | "loaded" | "empty";
    readonly tableName: string;
  } {
    if (source && columns.length > 0) {
      const tableName = source.tableName || source.name;
      if (source.enableLoad === false) {
        return { status: "disabled", tableName };
      }
      this.publishTable(`tbl_${source.id}`, tableName, columns, rows);
      return { status: "loaded", tableName };
    }
    return { status: "empty", tableName: "" };
  }

  public runRefresh(
    source: IngestionSource | null,
    dateCol: string,
    rangeStart: string,
    rangeEnd: string,
  ): Observable<IncrementalRefreshResult> {
    if (source && dateCol) {
      const pred = `[${dateCol}] >= '${rangeStart}' and [${dateCol}] < '${rangeEnd}'`;
      this.upsertStep(source.id, {
        id: `step_${Date.now()}`,
        name: `Incremental Partition: ${dateCol}`,
        type: "FilterRows",
        detail: `[${dateCol}] >= RangeStart and < RangeEnd`,
        definition: {
          step: "FilterRows",
          column: dateCol,
          predicate: pred,
          parameters: {
            RangeStart: rangeStart,
            RangeEnd: rangeEnd,
          },
        },
      });
    }
    const tableId = source ? source.tableName || source.name : "";
    return this.api.runIncrementalRefresh(tableId);
  }

  public restoreTables(): boolean {
    if (this.sources().length > 0 || this.state.sharedTables.length === 0) {
      return false;
    }
    const restoredSources: IngestionSource[] = [];
    const snapshots: Record<string, SourceSnapshot> = {};
    const initialStepsMap: Record<string, readonly DataPrepStep[]> = {};

    for (const tbl of this.state.sharedTables) {
      const src = this.createSource(
        tbl.id || `ds_${tbl.name}`,
        `${tbl.name}.csv`,
        "CSV",
        "CSV",
        tbl.name,
      );
      const cols: DataPrepColumn[] = tbl.columns.map((c) => ({
        name: c.name,
        type: c.dataType,
        displayType: c.dataType,
        icon: c.dataType,
      }));
      const tblRows = [...this.state.tableRows(tbl.name)];
      restoredSources.push(src);
      snapshots[src.id] = {
        columns: cols,
        rows: tblRows,
        tableName: tbl.name,
      };
      initialStepsMap[src.id] = [
        this.buildSourceStep(src.id, src.name, "CSV", tblRows.length),
      ];
    }

    this.rawSnapshotsBySource.set(snapshots);
    this.stepsBySource.set(initialStepsMap);
    this.sources.set(restoredSources);
    this.selectedSourceId.set(restoredSources[0].id);
    return true;
  }

  private readFile(
    file: File,
    format: SourceFormat,
    backendFmt: BackendSourceFormat,
  ): void {
    const reader = new FileReader();
    const isBinary =
      backendFmt === "XLSX" ||
      backendFmt === "PARQUET" ||
      backendFmt === "AVRO";
    if (isBinary) {
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;
        if (buffer) {
          this.openBinary(
            file.name,
            format,
            backendFmt,
            buffer,
            toBase64(buffer),
          );
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        this.openText(file.name, format, backendFmt, text);
      }
    };
    reader.readAsText(file);
  }

  private toUiFormat(backendFmt: BackendSourceFormat): SourceFormat {
    if (backendFmt === "JSON" || backendFmt === "XML") {
      return "REST";
    }
    if (backendFmt === "XLSX") {
      return "XLSX";
    }
    if (backendFmt === "PARQUET" || backendFmt === "AVRO") {
      return "PARQUET";
    }
    return "CSV";
  }

  private resolveFormat(
    name: string,
    format: SourceFormat,
  ): BackendSourceFormat {
    if (format === "REST") return "JSON";
    if (format === "XLSX") return "XLSX";
    if (format === "PARQUET") return "PARQUET";
    return this.detectFormat(name);
  }

  private createSource(
    id: string,
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    tableName: string,
  ): IngestionSource {
    return {
      id,
      name,
      format,
      path: name,
      enableLoad: true,
      backendFormat,
      tableName,
    };
  }

  private registerDataset(
    source: IngestionSource,
    snapshot: SourceSnapshot,
    steps: readonly DataPrepStep[],
  ): void {
    this.rawSnapshotsBySource.update((current) => ({
      ...current,
      [source.id]: snapshot,
    }));
    this.sources.update((srcs) => [...srcs, source]);
    this.selectedSourceId.set(source.id);
    this.stepsBySource.update((current) => ({
      ...current,
      [source.id]: steps,
    }));
  }

  private resolveTable(fileName: string, sheet: WorkbookSheet): string {
    const multiTable =
      this.navigatorSheets().length > 1 &&
      !MULTI_SHEET_PATTERN.test(sheet.name);
    const baseName = this.formatTable(fileName);
    const sheetPart = this.formatTable(sheet.name);
    return (
      sheet.tableName ||
      this.pendingTableName() ||
      (multiTable ? `${baseName}_${sheetPart}` : baseName)
    );
  }

  private formatTable(sourceName: string): string {
    return (
      sourceName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_") ||
      "dataset"
    );
  }

  private resolveSteps(
    fileName: string,
    backendFormat: BackendSourceFormat,
    sheet: WorkbookSheet,
  ): DataPrepStep[] {
    if (sheet.initialSteps && sheet.initialSteps.length > 0) {
      return [...sheet.initialSteps];
    }
    if (this.pendingInitialSteps().length > 0) {
      return [...this.pendingInitialSteps()];
    }
    return this.buildPipeline(fileName, backendFormat, sheet);
  }

  private evaluateNavigator(
    source: IngestionSource,
    sheet: WorkbookSheet,
    initialSteps: readonly DataPrepStep[],
    mode: NavigatorMode,
    fileName: string,
    resolvedTableName: string,
  ): void {
    this.evaluateSteps(
      sheet.columns,
      sheet.rows,
      initialSteps,
      source,
    ).subscribe({
      next: (evaluated) => {
        const finalTableName = evaluated.tableName || resolvedTableName;
        if (mode === "load" && evaluated.columns.length > 0) {
          this.publishTable(
            `tbl_${source.id}`,
            finalTableName,
            evaluated.columns,
            evaluated.rows,
          );
        }
        this.emitSync(source.id, initialSteps.length - 1);
        this.state.announce(
          mode === "load"
            ? `Loaded sheet "${sheet.name}" from "${fileName}" (${evaluated.rows.length} rows) into semantic model.`
            : `Loaded sheet "${sheet.name}" from "${fileName}" with standard 4-step ingestion pipeline.`,
        );
      },
      error: (err) => {
        this.state.announceError(`Evaluating "${fileName}"`, err);
      },
    });
  }

  private navigateToPrep(mode: NavigatorMode): void {
    if (
      mode === "transform" &&
      this.router &&
      this.router.url !== "/data-prep" &&
      this.router.config.some((route) => route.path === "data-prep")
    ) {
      void this.router.navigate(["/data-prep"]).catch(() => false);
    }
  }

  private commitDirect(
    datasetId: string,
    name: string,
    format: SourceFormat,
    backendFormat: BackendSourceFormat,
    content: string,
    evaluated: StepEvaluationResult,
  ): DirectDataset {
    const parsedColumns = [...evaluated.columns];
    const parsedRows = [...evaluated.rows];
    const tableName = evaluated.tableName || this.formatTable(name);
    const newSource = this.createSource(
      datasetId,
      name,
      format,
      backendFormat,
      tableName,
    );
    const initialStep = this.buildSourceStep(
      `${Date.now()}`,
      name,
      format,
      parsedRows.length,
    );

    this.registerDataset(
      newSource,
      {
        columns: parsedColumns,
        rows: parsedRows,
        rawText: content,
        tableName,
      },
      [initialStep],
    );

    if (parsedColumns.length > 0) {
      this.publishTable(
        `user_tbl_${tableName}`,
        tableName,
        parsedColumns,
        parsedRows,
      );
    }
    this.emitSync(datasetId, 0);
    this.state.announce(
      `Successfully loaded user dataset "${name}" (${parsedRows.length} rows, ${parsedColumns.length} columns).`,
    );

    return {
      source: newSource,
      columns: parsedColumns,
      rows: parsedRows,
      initialStep,
      tableName,
      mQueryScript: evaluated.mQueryScript,
      activeStepFormula: evaluated.activeStepFormula,
    };
  }

  private buildSourceStep(
    suffix: string,
    name: string,
    format: string,
    rowCount: number,
  ): DataPrepStep {
    return {
      id: `step_${suffix}`,
      name: "Source Ingestion",
      type: "FileSource",
      detail: `${format.toLowerCase()}("${name}")`,
      definition: {
        step: "FileSource",
        uri: name,
        source: name,
        format,
        rowCount,
      },
    };
  }

  private emitSync(sourceId: string, stepIndex: number): void {
    this.pipelineSync.update((prev) => ({
      sourceId,
      stepIndex,
      seq: (prev?.seq ?? 0) + 1,
    }));
  }

  private buildLookups(): Record<string, readonly Record<string, unknown>[]> {
    const lookupTables: Record<string, readonly Record<string, unknown>[]> = {};
    const snapshots = this.rawSnapshotsBySource();
    for (const src of this.sources()) {
      const snap = snapshots[src.id];
      if (snap) {
        lookupTables[src.id] = snap.rows;
        lookupTables[src.name] = snap.rows;
        if (src.tableName) {
          lookupTables[src.tableName] = snap.rows;
        }
      }
    }
    return lookupTables;
  }

  private findTypeStep(
    steps: readonly DataPrepStep[],
    candidate: DataPrepStep,
  ): number {
    if (
      candidate.type !== "ChangeType" &&
      candidate.type !== "ChangeTypeStep"
    ) {
      return -1;
    }
    const targetCol = candidate.definition?.["column"];
    return steps.findIndex(
      (s) =>
        (s.type === "ChangeType" || s.type === "ChangeTypeStep") &&
        s.definition?.["column"] === targetCol,
    );
  }

  private detectFormat(fileName: string): BackendSourceFormat {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
      case "tsv":
        return "TSV";
      case "json":
        return "JSON";
      case "xml":
        return "XML";
      case "xlsx":
      case "xls":
      case "xlsm":
        return "XLSX";
      case "parquet":
        return "PARQUET";
      case "avro":
        return "AVRO";
      default:
        return "CSV";
    }
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
        next: (response) => this.handleSheetsResponse(name, response),
        error: (err) => this.handleSheetsError(name, err),
      });
  }

  private handleSheetsResponse(
    name: string,
    response: SheetExtractionResponse,
  ): void {
    const sheets = [...(response.sheets ?? [])];
    this.navigatorSheets.set(sheets);
    this.selectedNavigatorSheetId.set(sheets[0]?.id ?? "");
    this.pendingTableName.set(response.tableName ?? "");
    this.pendingInitialSteps.set(response.initialSteps ?? []);

    if (response.error) {
      this.navigatorError.set(response.error);
      this.state.announceError(response.error);
    } else if (sheets.length === 0) {
      const msg = `Failed to extract readable sheets from "${name}".`;
      this.navigatorError.set(msg);
      this.state.announceError(msg);
    } else {
      this.navigatorError.set("");
      this.state.announce(`Navigator: select sheet to preview from ${name}.`);
    }
    this.isNavigatorModalOpen.set(true);
  }

  private handleSheetsError(name: string, err: unknown): void {
    const baseMsg = `Failed to extract sheets from "${name}"`;
    this.state.announceError(baseMsg, err);
    this.navigatorSheets.set([]);
    this.navigatorError.set(this.state.statusMessage() || `${baseMsg}.`);
    this.isNavigatorModalOpen.set(true);
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
          uri: fileName,
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
          targetTable: sheet.sheetName ?? sheet.name,
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
        dataType: (col.displayType || col.type || "VARCHAR").toUpperCase(),
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
