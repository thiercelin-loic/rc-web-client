import { ApplicationRef, Injectable, inject, signal } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { EMPTY, Observable, catchError, map, of, throwError } from "rxjs";
import {
  ExportChartData,
  ExportFormatMeta,
  ExportFormatType,
  ExportJobReceipt,
  ExportPayload,
  ExportVisualSummary,
  TabularExportData,
} from "./export.interface";
import { buildSheets, shapeDataset } from "./dataset.builder";
import { encodeParquet } from "./parquet.encoder";
import { encodeXlsx } from "./xlsx.encoder";
import { StateManagerService } from "../state-manager.service";

@Injectable({ providedIn: "root" })
export class ExportService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);
  private readonly appRef = inject(ApplicationRef);

  private readonly receiptSignal = signal<ExportJobReceipt | null>(null);

  public readonly lastReceipt = this.receiptSignal.asReadonly();

  private chartSource:
    | ((visual: { readonly id: string }) => ExportChartData | null)
    | null = null;

  public bindCharts(
    source: (visual: { readonly id: string }) => ExportChartData | null,
  ): () => void {
    this.chartSource = source;
    return () => {
      if (this.chartSource === source) {
        this.chartSource = null;
      }
    };
  }

  public triggerExport(
    reportId: string,
    visualId: string,
    format: ExportFormatType,
    canvasDimensions?: { width: number; height: number; preset?: string },
  ): Observable<ExportJobReceipt> {
    const meta = this.formatMeta(format);
    const activeVisuals = this.state.activePageVisuals();

    if (activeVisuals.length === 0) {
      this.receiptSignal.set(null);
      this.state.setLoading(false);
      this.state.announceError(
        `Export of ${meta.filename}`,
        `page "${this.state.activePage()}" has no visuals to export — add at least one visual on the canvas first`,
      );
      return EMPTY;
    }

    this.state.setLoading(true, `Exporting ${format}...`);

    if (format !== ".pdf") {
      const localReceipt = this.createFallback(format, meta);
      this.finalizeDownload(localReceipt);
      return of(localReceipt);
    }

    const endpoint = this.resolveEndpoint(reportId, visualId, format);
    const payload = this.buildPayload(
      reportId,
      visualId,
      format,
      activeVisuals,
      canvasDimensions,
    );

    return this.http.post<ExportJobReceipt>(endpoint, payload).pipe(
      map((serverReceipt) => {
        const consolidated = this.mergeReceipt(serverReceipt, format, meta);
        this.finalizeDownload(consolidated);
        return consolidated;
      }),
      catchError((error: HttpErrorResponse) =>
        this.handleError(error, format, meta),
      ),
    );
  }

  public downloadReceipt(receipt: ExportJobReceipt): void {
    if (
      receipt.format === ".pdf" &&
      typeof window !== "undefined" &&
      typeof window.print === "function"
    ) {
      this.printLight();
      return;
    }

    const content = this.generateContent(receipt);
    this.triggerDownload(content, receipt.filename, receipt.mimeType);
  }

  public buildDataset(_receipt: ExportJobReceipt): TabularExportData {
    return shapeDataset(this.state.activePageVisuals(), this.chartSource);
  }

  public buildDelimited(receipt: ExportJobReceipt, delimiter: string): string {
    const dataset = this.buildDataset(receipt);
    const header = dataset.columns
      .map((col) => this.escapeCell(col, delimiter))
      .join(delimiter);
    const rows = dataset.rows.map((row) =>
      row.map((cell) => this.escapeCell(cell, delimiter)).join(delimiter),
    );
    return "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";
  }

  public buildXlsx(_receipt: ExportJobReceipt): Uint8Array {
    const sheets = buildSheets(
      this.state.activePageVisuals(),
      this.chartSource,
    );
    return encodeXlsx(sheets);
  }

  public buildParquet(receipt: ExportJobReceipt): Uint8Array {
    return encodeParquet(this.buildDataset(receipt));
  }

  private mergeReceipt(
    serverReceipt: ExportJobReceipt,
    format: ExportFormatType,
    meta: ExportFormatMeta,
  ): ExportJobReceipt {
    return {
      ...serverReceipt,
      format,
      filename: serverReceipt.filename || meta.filename,
      mimeType: serverReceipt.mimeType || meta.mimeType,
    };
  }

  private handleError(
    error: HttpErrorResponse,
    format: ExportFormatType,
    meta: ExportFormatMeta,
  ): Observable<ExportJobReceipt> {
    if (error && error.status === 400) {
      this.receiptSignal.set(null);
      this.state.setLoading(false);
      this.state.announceError(`Export of ${meta.filename}`, error);
      return throwError(() => error);
    }

    const fallbackReceipt = this.createFallback(format, meta);
    this.finalizeDownload(fallbackReceipt);
    return of(fallbackReceipt);
  }

  private finalizeDownload(receipt: ExportJobReceipt): void {
    this.receiptSignal.set(receipt);
    this.downloadReceipt(receipt);
    this.state.setLoading(false);
    this.state.announce(`Exported ${receipt.filename} (${receipt.mimeType}).`);
  }

  private generateContent(receipt: ExportJobReceipt): BlobPart {
    if (receipt.fileContentBase64) {
      return this.decodeBase64(
        receipt.fileContentBase64,
      ) as unknown as BlobPart;
    }
    if (receipt.format === ".csv" || receipt.format === ".tsv") {
      const delimiter = receipt.format === ".tsv" ? "\t" : ";";
      return this.buildDelimited(receipt, delimiter);
    }
    if (receipt.format === ".xlsx") {
      return this.buildXlsx(receipt) as unknown as BlobPart;
    }
    if (receipt.format === ".parquet") {
      return this.buildParquet(receipt) as unknown as BlobPart;
    }
    return (
      `%PDF-1.4\n` +
      `% Export Document\n` +
      `% Project: ${this.state.activeProject().filename}\n` +
      `% Page: ${this.state.activePage()}\n` +
      `% Generated: ${receipt.timestamp}\n` +
      `%%EOF`
    );
  }

  private triggerDownload(
    content: BlobPart,
    filename: string,
    mimeType: string,
  ): void {
    if (typeof document === "undefined") {
      return;
    }
    const blob = new Blob([content], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  private printLight(): void {
    this.state.setPrintingLightMode(true);
    const savedThemes = this.applyLight();
    const printStyle = this.injectOrientation();
    const previousTitle = typeof document !== "undefined" ? document.title : "";

    if (typeof document !== "undefined") {
      document.title = this.projectName();
    }

    try {
      this.appRef.tick();
      window.print();
    } finally {
      if (typeof document !== "undefined") {
        document.title = previousTitle;
      }
      printStyle?.remove();
      this.state.setPrintingLightMode(false);
      this.restoreThemes(savedThemes);
      this.appRef.tick();
    }
  }

  private applyLight(): { element: HTMLElement; originalTheme: string | null }[] {
    if (typeof document === "undefined") {
      return [];
    }
    const saved: { element: HTMLElement; originalTheme: string | null }[] = [];
    const root = document.documentElement;
    saved.push({
      element: root,
      originalTheme: root.getAttribute("data-bs-theme"),
    });
    root.setAttribute("data-bs-theme", "light");

    document.querySelectorAll<HTMLElement>("[data-bs-theme]").forEach((el) => {
      if (el !== root) {
        saved.push({
          element: el,
          originalTheme: el.getAttribute("data-bs-theme"),
        });
        el.setAttribute("data-bs-theme", "light");
      }
    });
    return saved;
  }

  private injectOrientation(): HTMLStyleElement | null {
    if (typeof document === "undefined") {
      return null;
    }
    const sheet = document.querySelector<HTMLElement>(".rc-report-page-sheet");
    if (!sheet) {
      return null;
    }
    const width = sheet.offsetWidth || 1280;
    const height = sheet.offsetHeight || 720;
    const isPortrait = height > width;
    const style = document.createElement("style");
    style.id = "rc-print-dynamic-orientation";
    style.textContent = `@page { size: ${isPortrait ? "portrait" : "landscape"}; margin: 6mm; }`;
    document.head.appendChild(style);
    return style;
  }

  private restoreThemes(
    saved: readonly { element: HTMLElement; originalTheme: string | null }[],
  ): void {
    for (const { element, originalTheme } of saved) {
      if (originalTheme !== null) {
        element.setAttribute("data-bs-theme", originalTheme);
      } else {
        element.removeAttribute("data-bs-theme");
      }
    }
  }

  private resolveEndpoint(
    reportId: string,
    visualId: string,
    format: ExportFormatType,
  ): string {
    return format === ".pdf"
      ? "/api/reports/export/pdf"
      : `/api/reports/${encodeURIComponent(reportId)}/visuals/${encodeURIComponent(visualId)}/export`;
  }

  private buildPayload(
    reportId: string,
    visualId: string,
    format: ExportFormatType,
    visuals: readonly ExportVisualSummary[],
    canvasDimensions?: { width: number; height: number; preset?: string },
  ): ExportPayload {
    return {
      reportId,
      visualId,
      format,
      dpi: 300,
      includeBom: true,
      delimiter: format === ".tsv" ? "\t" : ";",
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
        chartData: this.chartSource?.(visual) ?? null,
      })),
      measures: this.state.measures.map((measure) => ({
        id: measure.id,
        label: measure.label,
        formula: measure.formula,
        table: measure.table,
      })),
    };
  }

  private createFallback(
    format: ExportFormatType,
    meta: ExportFormatMeta,
  ): ExportJobReceipt {
    return {
      jobId: `exp-local-${Date.now()}`,
      format,
      mimeType: meta.mimeType,
      filename: meta.filename,
      status: "COMPLETED",
      timestamp: new Date().toISOString(),
    };
  }

  private formatMeta(format: ExportFormatType): ExportFormatMeta {
    const filename = `${this.projectName()}${format}`;
    switch (format) {
      case ".pdf":
        return { mimeType: "application/pdf", filename };
      case ".xlsx":
        return {
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          filename,
        };
      case ".parquet":
        return { mimeType: "application/vnd.apache.parquet", filename };
      case ".tsv":
        return {
          mimeType: "text/tab-separated-values; charset=utf-8",
          filename,
        };
      case ".csv":
      default:
        return { mimeType: "text/csv; charset=utf-8", filename };
    }
  }

  private projectName(): string {
    const raw = (this.state.activeProject()?.filename ?? "").trim();
    const stripped = raw.replace(/\.rcp$/i, "").trim();
    return stripped || "Untitled Project";
  }

  private escapeCell(value: string, _delimiter?: string): string {
    const safeValue = value ?? "";
    const escapedValue = safeValue.replace(/"/g, '""');
    return `"${escapedValue}"`;
  }

  private decodeBase64(base64: string): Uint8Array {
    if (typeof atob === "function") {
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
