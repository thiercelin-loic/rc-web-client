import {
  DataPrepColumn,
  WorkbookSheet,
} from '../../features/data-prep/data-prep.model';

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
