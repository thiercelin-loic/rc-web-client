export type ExportFormatType = ".pdf" | ".xlsx" | ".parquet" | ".csv" | ".tsv";

export interface ExportJobReceipt {
  readonly jobId: string;
  readonly format: ExportFormatType;
  readonly mimeType: string;
  readonly filename: string;
  readonly engine?: string;
  readonly status: "COMPLETED" | "STREAMING";
  readonly timestamp: string;
  readonly fileContentBase64?: string | null;
}

export interface TabularExportData {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface ExportFormatMeta {
  readonly mimeType: string;
  readonly filename: string;
}

export interface ColumnChunkMetadata {
  readonly columnName: string;
  readonly fileOffset: number;
  readonly totalByteSize: number;
}

export interface ExportChartData {
  readonly labels: readonly string[];
  readonly datasets: readonly {
    readonly label: string;
    readonly data: readonly number[];
  }[];
}

export interface ExportSheetSpec {
  readonly name: string;
  readonly rows: readonly (readonly (string | number)[])[];
}

export interface ExportVisualSummary {
  readonly id: string;
  readonly title: string;
  readonly archetype: string;
  readonly width: "half" | "full";
  readonly metricLabel: string;
  readonly metricValue: string;
  readonly metricSubtext: string;
}

export interface ExportPayload {
  readonly reportId: string;
  readonly visualId: string;
  readonly format: ExportFormatType;
  readonly dpi: number;
  readonly includeBom: boolean;
  readonly delimiter: string;
  readonly contextHash: string;
  readonly projectName: string;
  readonly pageName: string;
  readonly canvasDimensions?: {
    readonly width: number;
    readonly height: number;
    readonly preset?: string;
  };
  readonly visuals: readonly {
    readonly id: string;
    readonly title: string;
    readonly archetype: string;
    readonly width: "half" | "full";
    readonly metricLabel: string;
    readonly metricValue: string;
    readonly metricSubtext: string;
    readonly chartData?: ExportChartData | null;
  }[];
  readonly measures: readonly {
    readonly id: string;
    readonly label: string;
    readonly formula: string;
    readonly table: string;
  }[];
}
