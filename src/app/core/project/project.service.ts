import { Injectable, inject } from "@angular/core";
import {
  ProjectDescriptor,
  StateManagerService,
} from "../state-manager.service";
import { packZip, ZipEntrySpec } from "../zip-archive";
import {
  buildDefinition,
  buildManifest,
  buildRsdl,
  buildTheme,
  isZip,
  normalizeName,
  parseArchive,
  parseJson,
  readBytes,
} from "./project.codec";
import { DEFAULT_BRANCH, DEFAULT_WATERMARK } from "./project.constants";
import { ProjectDataBundle } from "./project.interface";

@Injectable({ providedIn: "root" })
export class ProjectService {
  private readonly state = inject(StateManagerService);

  public exportArchive(): Uint8Array {
    const encoder = new TextEncoder();
    const activeProject = this.state.activeProject();
    const projectTitle = activeProject.filename.replace(/\.rcp$/i, "");

    const tables = this.state.sharedTables;
    const rows = this.state.tableRowsMap();
    const measures = this.state.measures;
    const hasEmbeddedData =
      tables.length > 0 || Object.keys(rows).length > 0 || measures.length > 0;

    const manifest = buildManifest(projectTitle, hasEmbeddedData);
    const definition = buildDefinition(this.state.reportPages(), (pageTitle) =>
      this.state.getVisualsForPage(pageTitle),
    );
    const rsdlContent = buildRsdl({
      filename: activeProject.filename,
      tables,
      measures,
    });
    const themeContent = JSON.stringify(
      buildTheme(this.state.theme()),
      null,
      2,
    );
    const dataBundle: ProjectDataBundle = { tables, rows, measures };

    const entries: ZipEntrySpec[] = [
      {
        name: "Version/manifest.json",
        data: encoder.encode(JSON.stringify(manifest, null, 2)),
        compressed: true,
      },
      {
        name: "Report/Layout.json",
        data: encoder.encode(JSON.stringify(definition, null, 2)),
        compressed: true,
      },
      {
        name: "DataModel/model.rsdl",
        data: encoder.encode(rsdlContent),
        compressed: true,
      },
      {
        name: "Settings/queries.rq.json",
        data: encoder.encode("[]"),
        compressed: true,
      },
      {
        name: "Report/StaticResources/SharedResources/BaseThemes/theme.json",
        data: encoder.encode(themeContent),
        compressed: true,
      },
      {
        name: "DataModel/data.json",
        data: encoder.encode(JSON.stringify(dataBundle)),
        compressed: true,
      },
    ];

    return packZip(entries);
  }

  public saveProject(customFilename?: string): void {
    const filename = normalizeName(
      customFilename || this.state.activeProject().filename,
    );

    const zipBytes = this.exportArchive();
    this.triggerDownload(zipBytes, filename);

    const now = new Date();
    const watermark = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    this.state.updateProjectStatus("saved [synchronized]", watermark);
    this.state.announce(`Project ${filename} saved successfully.`);
  }

  public async openFile(file: File): Promise<boolean> {
    try {
      const bytes = await readBytes(file);
      const filename = normalizeName(file.name);

      const parsed = isZip(bytes) ? parseArchive(bytes) : parseJson(bytes);
      if (parsed.tables) {
        this.state.syncTables(parsed.tables);
      }
      if (parsed.rows) {
        for (const [tableName, tableRows] of Object.entries(parsed.rows)) {
          this.state.setTableRows(tableName, tableRows);
        }
      }

      const descriptor: ProjectDescriptor = {
        filename,
        statusPill: "loaded [saved]",
        branch: DEFAULT_BRANCH,
        watermark: DEFAULT_WATERMARK,
      };

      this.state.setProjectState(
        descriptor,
        parsed.pages,
        parsed.visualsMap,
        parsed.measures ? [...parsed.measures] : undefined,
      );
      return true;
    } catch (err: unknown) {
      this.state.announceError(
        `Opening ${file.name}`,
        err instanceof Error && err.message
          ? `corrupt or invalid .rcp project archive (${err.message})`
          : "corrupt or invalid .rcp project archive",
      );
      return false;
    }
  }

  public createProject(projectName?: string): void {
    this.state.createNewProject(projectName);
  }

  public renameProject(newFilename: string): boolean {
    return this.state.renameProject(newFilename);
  }

  private triggerDownload(data: Uint8Array, filename: string): void {
    if (typeof document === "undefined") {
      return;
    }
    const blob = new Blob([new Uint8Array(data)], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
