import {
  CanvasVisualItem,
  RaxMeasureDescriptor,
  SharedTable,
} from "../state/state.service";

export interface ProjectExportPayload {
  readonly filename: string;
  readonly theme: string;
  readonly pages: readonly string[];
  readonly visualsMap: Readonly<Record<string, readonly CanvasVisualItem[]>>;
  readonly tables: readonly SharedTable[];
  readonly rows: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly measures: readonly RaxMeasureDescriptor[];
}

export interface ProjectArchiveReceipt {
  readonly filename: string;
  readonly archiveBase64: string;
  readonly checksumSha256: string;
}

export interface ProjectImportPayload {
  readonly filename: string;
  readonly archiveBase64: string;
}

export interface ParsedProjectState {
  readonly filename?: string;
  readonly pages: string[];
  readonly visualsMap: Record<string, CanvasVisualItem[]>;
  readonly tables?: readonly SharedTable[];
  readonly rows?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly measures?: readonly RaxMeasureDescriptor[];
}
