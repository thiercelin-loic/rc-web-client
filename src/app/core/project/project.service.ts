import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, firstValueFrom, map } from "rxjs";
import { SemanticModelService } from "../model/model.service";
import {
  CanvasVisualItem,
  ProjectDescriptor,
  StateManagerService,
} from "../state/state.service";
import {
  DEFAULT_BRANCH,
  DEFAULT_WATERMARK,
  PROJECT_EXPORT_ENDPOINT,
  PROJECT_EXTENSION,
  PROJECT_IMPORT_ENDPOINT,
} from "./project.constants";
import {
  ParsedProjectState,
  ProjectArchiveReceipt,
  ProjectExportPayload,
  ProjectImportPayload,
} from "./project.interface";

@Injectable({ providedIn: "root" })
export class ProjectService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);
  private readonly model = inject(SemanticModelService);

  public exportArchive(customFilename?: string): Observable<Uint8Array> {
    const payload = this.buildPayload(customFilename);
    return this.http
      .post<ProjectArchiveReceipt>(PROJECT_EXPORT_ENDPOINT, payload)
      .pipe(map((receipt) => this.decodeBase64(receipt.archiveBase64)));
  }

  public saveProject(customFilename?: string): void {
    const filename = this.normalizeName(
      customFilename || this.state.activeProject().filename,
    );

    this.exportArchive(filename).subscribe({
      next: (zipBytes) => {
        this.triggerDownload(zipBytes, filename);
        const now = new Date();
        const watermark = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
        this.state.updateStatus("saved [synchronized]", watermark);
        this.state.announce(`Project ${filename} saved successfully.`);
      },
      error: (err: unknown) => {
        this.state.announceError(`Saving ${filename}`, err);
      },
    });
  }

  public async openFile(file: File): Promise<boolean> {
    try {
      const bytes = await this.readBytes(file);
      const filename = this.normalizeName(file.name);
      const payload: ProjectImportPayload = {
        filename,
        archiveBase64: this.encodeBase64(bytes),
      };

      const parsed = await firstValueFrom(
        this.http.post<ParsedProjectState>(PROJECT_IMPORT_ENDPOINT, payload),
      );

      if (parsed.tables) {
        this.state.syncTables(parsed.tables);
      }
      if (parsed.rows) {
        for (const [tableName, tableRows] of Object.entries(parsed.rows)) {
          this.state.setRows(tableName, tableRows);
        }
      }
      await this.syncBackend(parsed.rows);

      const descriptor: ProjectDescriptor = {
        filename: parsed.filename || filename,
        statusPill: "loaded [saved]",
        branch: DEFAULT_BRANCH,
        watermark: DEFAULT_WATERMARK,
      };
      this.state.setProject(
        descriptor,
        parsed.pages,
        parsed.visualsMap,
        parsed.measures ? [...parsed.measures] : undefined,
      );
      this.state.announce(`Opened project ${descriptor.filename}.`);
      return true;
    } catch (error: unknown) {
      this.state.announceError(`Opening project ${file.name}`, error);
      return false;
    }
  }

  public createProject(projectName?: string): void {
    this.state.createProject(projectName);
  }

  public renameProject(newFilename: string): boolean {
    return this.state.renameProject(newFilename);
  }

  private async syncBackend(
    rows?: Record<string, readonly Record<string, unknown>[]>,
  ): Promise<void> {
    await firstValueFrom(this.model.pushState(this.state));
    if (!rows) {
      return;
    }
    const uploads = Object.entries(rows)
      .filter(([, tableRows]) => tableRows.length > 0)
      .map(([tableName, tableRows]) =>
        firstValueFrom(this.model.ingestRows(tableName, tableRows)),
      );
    await Promise.all(uploads);
  }

  private buildPayload(customFilename?: string): ProjectExportPayload {
    const filename = this.normalizeName(
      customFilename || this.state.activeProject().filename,
    );
    const pages = this.state.reportPages();
    const visualsMap: Record<string, readonly CanvasVisualItem[]> = {};
    for (const page of pages) {
      visualsMap[page] = this.state.pageVisuals(page);
    }

    return {
      filename,
      theme: this.state.theme(),
      pages,
      visualsMap,
      tables: this.state.sharedTables,
      rows: this.state.tableRowsMap(),
      measures: this.state.measures,
    };
  }

  private normalizeName(raw: string): string {
    const trimmed = raw.trim();
    return trimmed.toLowerCase().endsWith(PROJECT_EXTENSION)
      ? trimmed
      : `${trimmed}${PROJECT_EXTENSION}`;
  }

  private async readBytes(file: File): Promise<Uint8Array> {
    if (typeof file.arrayBuffer === "function") {
      return new Uint8Array(await file.arrayBuffer());
    }
    return await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          reject(new Error("Failed to read project binary buffer"));
        }
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error("File read error"));
      reader.readAsArrayBuffer(file);
    });
  }

  private encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private triggerDownload(data: Uint8Array, filename: string): void {
    if (typeof document === "undefined") {
      return;
    }
    const blob = new Blob([data as unknown as BlobPart], {
      type: "application/octet-stream",
    });
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
}
