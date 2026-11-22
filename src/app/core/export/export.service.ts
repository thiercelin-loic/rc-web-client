import { ApplicationRef, Injectable, inject, signal } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { EMPTY, Observable, catchError, map, throwError } from "rxjs";
import {
  DEFAULT_PROJECT_NAME,
  EXPORT_API_BASE,
  EXPORT_MIME_TYPES,
} from "./export.constants";
import {
  ExportChartData,
  ExportFormatMeta,
  ExportFormatType,
  ExportJobReceipt,
  ExportPayload,
  ExportVisualSummary,
} from "./export.interface";
import { StateManagerService } from "../state/state.service";

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

    const endpoint = this.resolveEndpoint(reportId);
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
      catchError((error: HttpErrorResponse) => this.handleError(error, meta)),
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

    const content = this.extractContent(receipt);
    if (content !== null) {
      this.triggerDownload(content, receipt.filename, receipt.mimeType);
    }
  }

  private finalizeDownload(receipt: ExportJobReceipt): void {
    this.receiptSignal.set(receipt);
    this.state.setLoading(false);
    this.downloadReceipt(receipt);
    this.state.announce(
      `Exported ${receipt.filename} (${receipt.format.toUpperCase()}).`,
    );
  }

  private handleError(
    error: HttpErrorResponse,
    meta: ExportFormatMeta,
  ): Observable<ExportJobReceipt> {
    this.receiptSignal.set(null);
    this.state.setLoading(false);
    this.state.announceError(`Export of ${meta.filename}`, error);
    return throwError(() => error);
  }

  private mergeReceipt(
    receipt: ExportJobReceipt,
    format: ExportFormatType,
    meta: ExportFormatMeta,
  ): ExportJobReceipt {
    return {
      ...receipt,
      format: receipt.format || format,
      mimeType: receipt.mimeType || meta.mimeType,
      filename: receipt.filename || meta.filename,
    };
  }

  private extractContent(receipt: ExportJobReceipt): BlobPart | null {
    if (!receipt.fileContentBase64) {
      return null;
    }
    return this.decodeBase64(receipt.fileContentBase64) as unknown as BlobPart;
  }

  private decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
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
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  private printLight(): void {
    this.state.setPrinting(true);
    this.appRef.tick();

    const restored = this.applyLight();
    const cleanup = () => {
      this.state.setPrinting(false);
      this.appRef.tick();
      for (const entry of restored) {
        if (entry.originalTheme !== null) {
          entry.element.setAttribute("data-theme", entry.originalTheme);
        } else {
          entry.element.removeAttribute("data-theme");
        }
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("afterprint", cleanup);
      }
    };

    window.addEventListener("afterprint", cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1000);
    }, 60);
  }

  private applyLight(): {
    element: HTMLElement;
    originalTheme: string | null;
  }[] {
    if (typeof document === "undefined") {
      return [];
    }
    const targets: HTMLElement[] = [document.documentElement, document.body];
    document.querySelectorAll<HTMLElement>("[data-theme]").forEach((el) => {
      if (!targets.includes(el)) {
        targets.push(el);
      }
    });

    const snapshots: { element: HTMLElement; originalTheme: string | null }[] =
      [];
    for (const el of targets) {
      if (el) {
        snapshots.push({
          element: el,
          originalTheme: el.getAttribute("data-theme"),
        });
        el.setAttribute("data-theme", "light");
      }
    }
    return snapshots;
  }

  private buildPayload(
    reportId: string,
    visualId: string,
    format: ExportFormatType,
    activeVisuals: readonly {
      readonly id: string;
      readonly title: string;
      readonly archetype: string;
      readonly width: "half" | "full";
      readonly metricLabel: string;
      readonly metricValue: string;
      readonly metricSubtext: string;
    }[],
    canvasDimensions?: { width: number; height: number; preset?: string },
  ): ExportPayload {
    const visuals: ExportVisualSummary[] = activeVisuals.map((v) => ({
      id: v.id,
      title: v.title,
      archetype: v.archetype,
      width: v.width,
      metricLabel: v.metricLabel,
      metricValue: v.metricValue,
      metricSubtext: v.metricSubtext,
      chartData: this.chartSource ? this.chartSource(v) : null,
    }));

    return {
      reportId,
      visualId,
      format,
      includeBom: true,
      delimiter: format === ".tsv" ? "\t" : ";",
      contextHash: this.state.activeFilters().contextHash(),
      projectName: this.projectName(),
      pageName: this.state.activePage(),
      canvasDimensions,
      visuals,
      measures: this.state.measures.map((m) => ({
        id: m.id,
        label: m.label,
        formula: m.formula,
        table: m.table,
      })),
    };
  }

  private resolveEndpoint(reportId: string): string {
    return `${EXPORT_API_BASE}/${encodeURIComponent(reportId)}/export`;
  }

  private formatMeta(format: ExportFormatType): ExportFormatMeta {
    const filename = `${this.projectName()}${format}`;
    return {
      mimeType: EXPORT_MIME_TYPES[format] ?? EXPORT_MIME_TYPES[".csv"],
      filename,
    };
  }

  private projectName(): string {
    const raw = (this.state.activeProject()?.filename ?? "").trim();
    const stripped = raw.replace(/\.rcp$/i, "").trim();
    return stripped || DEFAULT_PROJECT_NAME;
  }
}
