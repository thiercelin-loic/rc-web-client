import {
  CanvasVisualItem,
  RaxMeasureDescriptor,
  SharedTable,
} from "../state-manager.service";

export interface ProjectManifestData {
  readonly $schema?: string;
  readonly projectId: string;
  readonly formatVersion: string;
  readonly minEngineVersion: string;
  readonly title: string;
  readonly packageType: "STANDALONE_PROJECT" | "TEMPLATE_PACKAGE";
  readonly hasEmbeddedData: boolean;
  readonly checksumSha256: string;
  readonly parameters?: readonly unknown[];
}

export interface CanvasVisualDef {
  readonly visualId: string;
  readonly archetype: string;
  readonly measureId: string;
  readonly title?: string;
  readonly metricLabel?: string;
  readonly metricValue?: string;
  readonly metricSubtext?: string;
  readonly sortBy?: "value" | "axis";
  readonly sortOrder?: "asc" | "desc";
  readonly fieldWells?: Readonly<Record<string, readonly string[]>>;
  readonly layout: {
    readonly colSpan: number;
    readonly rowSpan: number;
  };
}

export interface CanvasDefinitionPage {
  readonly id: string;
  readonly title: string;
  readonly visuals: readonly CanvasVisualDef[];
}

export interface CanvasDefinitionData {
  readonly $schema?: string;
  readonly version: string;
  readonly gridColumns: number;
  readonly pages: readonly CanvasDefinitionPage[];
}

export interface ProjectThemeData {
  readonly $schema: string;
  readonly name: string;
  readonly mode: string;
  readonly tokens: Readonly<Record<string, string>>;
}

export interface RawProjectJson {
  readonly pages?: readonly string[];
  readonly visuals?: Readonly<Record<string, readonly CanvasVisualItem[]>>;
}

export interface ProjectDataBundle {
  readonly tables: readonly SharedTable[];
  readonly rows: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly measures: readonly RaxMeasureDescriptor[];
}

export interface ParsedProjectState {
  readonly pages: string[];
  readonly visualsMap: Record<string, CanvasVisualItem[]>;
  readonly tables?: readonly SharedTable[];
  readonly rows?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly measures?: readonly RaxMeasureDescriptor[];
}

export interface RsdlSource {
  readonly filename: string;
  readonly tables: readonly SharedTable[];
  readonly measures: readonly RaxMeasureDescriptor[];
}
