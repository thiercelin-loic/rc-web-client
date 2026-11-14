import {
  DataPrepColumn,
  DataPrepStep,
  IngestionSource,
  WorkbookSheet,
} from '../../features/data-prep/data-prep.model';
import { DataPrepQuarantineRow } from '../../services/api.service';

export type SourceFormat = 'CSV' | 'PARQUET' | 'XLSX' | 'REST';
export type NavigatorMode = 'load' | 'transform';

export interface PipelineSyncEvent {
  readonly sourceId: string;
  readonly stepIndex: number;
  readonly seq: number;
}

export interface DirectDataset {
  readonly source: IngestionSource;
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly initialStep: DataPrepStep;
}

export interface EvalResult {
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly quarantined: DataPrepQuarantineRow[];
}

export interface ParsedTextResult {
  readonly sheets: WorkbookSheet[];
  readonly error?: string;
}

export interface TabularJsonResult {
  readonly columns: DataPrepColumn[];
  readonly rows: Record<string, unknown>[];
  readonly error?: string;
}

export interface ArrayCandidate {
  readonly leafKey: string;
  readonly fullKey: string;
  readonly items: readonly unknown[];
}

export interface XmlGroup {
  readonly key: string;
  readonly elements: readonly Element[];
}
