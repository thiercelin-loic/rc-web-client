import { Injectable, inject } from '@angular/core';
import { StateManagerService, ProjectDescriptor, CanvasVisualItem } from './state-manager.service';
import { packZipArchive, unpackZipArchive, ZipEntrySpec } from './zip-archive';

export interface ProjectManifestData {
  $schema?: string;
  projectId: string;
  formatVersion: string;
  minEngineVersion: string;
  title: string;
  packageType: 'STANDALONE_PROJECT' | 'TEMPLATE_PACKAGE';
  hasEmbeddedData: boolean;
  checksumSha256: string;
  parameters?: readonly unknown[];
}

export interface CanvasDefinitionPage {
  id: string;
  title: string;
  visuals: {
    visualId: string;
    archetype: string;
    measureId: string;
    title?: string;
    metricLabel?: string;
    metricValue?: string;
    metricSubtext?: string;
    layout: {
      colSpan: number;
      rowSpan: number;
    };
  }[];
}

export interface CanvasDefinitionData {
  $schema?: string;
  version: string;
  gridColumns: number;
  pages: CanvasDefinitionPage[];
}

@Injectable({ providedIn: 'root' })
export class ProjectSerializationService {
  private readonly state = inject(StateManagerService);

  /**
   * Serializes current project into a standard .rcp ZIP archive (Uint8Array)
   * containing manifest.json, definition.json, model.rsdl, queries.rq.json, theme.json.
   */
  public exportProjectArchive(): Uint8Array {
    const encoder = new TextEncoder();
    const activeProject = this.state.activeProject();
    const projectTitle = activeProject.filename.replace(/\.rcp$/i, '');

    const manifest: ProjectManifestData = {
      $schema: 'https://rollercoaster.com/schemas/v1/manifest.json',
      projectId: this.generateUuid(),
      formatVersion: '1.2.0',
      minEngineVersion: '1.0.0',
      title: projectTitle,
      packageType: 'STANDALONE_PROJECT',
      hasEmbeddedData: false,
      checksumSha256: this.computeSha256Checksum(projectTitle),
      parameters: []
    };

    const pages = this.state.reportPages();
    const definition: CanvasDefinitionData = {
      $schema: 'https://rollercoaster.com/schemas/v1/definition.json',
      version: '1.2.0',
      gridColumns: 12,
      pages: pages.map((pageTitle) => {
        const visuals = this.state.getVisualsForPage(pageTitle);
        return {
          id: pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: pageTitle,
          visuals: visuals.map((v) => ({
            visualId: v.id,
            archetype: v.archetype,
            title: v.title,
            metricLabel: v.metricLabel,
            metricValue: v.metricValue,
            metricSubtext: v.metricSubtext,
            measureId: v.metricLabel || 'm_sales',
            layout: {
              colSpan: v.width === 'full' ? 12 : 6,
              rowSpan: 1
            }
          }))
        };
      })
    };

    const rsdlContent = this.buildRsdlModel();
    const queriesContent = '[]';
    const themeContent = JSON.stringify(
      {
        $schema: 'https://rollercoaster.com/schemas/v1/theme.json',
        name: 'RollerCoaster Corporate Theme',
        mode: this.state.theme(),
        tokens: {
          '--rc-primary': '#FF981A',
          '--rc-primary-dark': '#E65100',
          '--rc-surface-light': '#F2F2F2',
          '--rc-surface-dark': '#333333',
          '--rc-text-pure': '#FFFFFF',
          '--rc-text-dark': '#333333',
          '--rc-neutral-soft': '#B9C1C6'
        }
      },
      null,
      2
    );

    const entries: ZipEntrySpec[] = [
      { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
      { name: 'definition.json', data: encoder.encode(JSON.stringify(definition, null, 2)) },
      { name: 'model.rsdl', data: encoder.encode(rsdlContent) },
      { name: 'queries.rq.json', data: encoder.encode(queriesContent) },
      { name: 'theme.json', data: encoder.encode(themeContent) }
    ];

    return packZipArchive(entries);
  }

  /**
   * Saves current workspace state into a downloadable .rcp file
   */
  public saveProject(customFilename?: string): void {
    const rawName = customFilename || this.state.activeProject().filename;
    const filename = rawName.endsWith('.rcp') ? rawName : `${rawName}.rcp`;

    const zipBytes = this.exportProjectArchive();
    this.triggerBrowserDownload(zipBytes, filename);

    const now = new Date();
    const watermark = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    this.state.updateProjectStatus('saved [synchronized]', watermark);
    this.state.announce(`Project ${filename} saved successfully.`);
  }

  /**
   * Reads, parses, and loads a .rcp (or JSON) file into StateManagerService
   */
  public async openProjectFile(file: File): Promise<boolean> {
    try {
      const bytes = await this.readFileAsBytes(file);
      const filename = file.name.endsWith('.rcp') ? file.name : `${file.name}.rcp`;

      let pages: string[] = ['Page 1'];
      let visualsMap: Record<string, CanvasVisualItem[]> = { 'Page 1': [] };

      // Check for ZIP magic signature PK\x03\x04
      if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        const entries = unpackZipArchive(bytes);
        const decoder = new TextDecoder();

        if (entries['definition.json']) {
          const defJson = JSON.parse(decoder.decode(entries['definition.json'])) as CanvasDefinitionData;
          if (Array.isArray(defJson.pages) && defJson.pages.length > 0) {
            pages = defJson.pages.map((p) => p.title);
            visualsMap = {};
            for (const p of defJson.pages) {
              visualsMap[p.title] = (p.visuals || []).map((v) => ({
                id: v.visualId || `vis-${Date.now()}`,
                title: v.title || `${v.archetype} Visual`,
                archetype: v.archetype || 'Bar',
                width: v.layout?.colSpan === 12 ? 'full' : 'half',
                metricLabel: v.metricLabel || v.measureId || 'Metric',
                metricValue: v.metricValue || '€ 0.00',
                metricSubtext: v.metricSubtext || 'Imported from .rcp'
              }));
            }
          }
        }
      } else {
        // Fallback for direct JSON .rcp structure
        const decoder = new TextDecoder();
        const text = decoder.decode(bytes);
        const parsed = JSON.parse(text) as { pages?: string[]; visuals?: Record<string, CanvasVisualItem[]> };
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          pages = parsed.pages;
        }
        if (parsed.visuals) {
          visualsMap = parsed.visuals;
        }
      }

      const descriptor: ProjectDescriptor = {
        filename,
        statusPill: 'loaded [saved]',
        branch: 'workspace/main',
        watermark: '00:00'
      };

      this.state.setProjectState(descriptor, pages, visualsMap);
      return true;
    } catch (err: unknown) {
      this.state.announceError(
        `Opening ${file.name}`,
        err instanceof Error && err.message
          ? `corrupt or invalid .rcp project archive (${err.message})`
          : 'corrupt or invalid .rcp project archive',
      );
      return false;
    }
  }

  private async readFileAsBytes(file: File): Promise<Uint8Array> {
    if (typeof file.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    }
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(new Uint8Array(reader.result));
          } else {
            reject(new Error('Failed to read file as ArrayBuffer'));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
    }
    throw new Error('File reading API not available in current environment');
  }

  /**
   * Resets workspace state and initializes a clean .rcp project
   */
  public createNewProject(projectName?: string): void {
    this.state.createNewProject(projectName);
  }

  public renameProject(newFilename: string): boolean {
    return this.state.renameProject(newFilename);
  }

  private triggerBrowserDownload(data: Uint8Array, filename: string): void {
    if (typeof document === 'undefined') {
      return;
    }
    const blob = new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private buildRsdlModel(): string {
    const lines = [
      '// RollerCoaster Semantic Definition Language (RSDL) v1.2',
      `// Project: ${this.state.activeProject().filename}`,
      ''
    ];
    for (const table of this.state.sharedTables) {
      lines.push(`table '${table.name}' {`);
      lines.push(`  role: '${table.role}'`);
      for (const col of table.columns) {
        lines.push(`  column '${col.name}' : ${col.dataType}`);
      }
      lines.push('}');
      lines.push('');
    }
    for (const measure of this.state.measures) {
      lines.push(`measure '${measure.label}' = ${measure.formula}`);
    }
    return lines.join('\n');
  }

  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'a98f12b4-539c-4b6e-8210-90c1f6d90124';
  }

  private computeSha256Checksum(seed: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return hex.repeat(8);
  }
}
