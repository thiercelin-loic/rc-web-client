import { DataConnector } from "./ingestion.interface";

export const DEFAULT_EXTENSIONS =
  ".csv,.tsv,.json,.txt,.xml,.xlsx,.parquet,.avro";
export const MULTI_SHEET_PATTERN = /^sheet\d*$/i;
export const INGESTION_SHEETS_ENDPOINT = "/api/ingestion/sheets";
export const INGESTION_PREVIEW_ENDPOINT = "/api/ingestion/pipeline/preview";

export const DATA_CONNECTORS: readonly DataConnector[] = [
  {
    id: "excel",
    name: "Excel",
    category: "file",
    description: "Microsoft Excel workbooks (.xlsx, .xlsm, .xls)",
    fileExtensions: ".xlsx,.xlsm,.xls",
  },
  {
    id: "csv",
    name: "CSV / Text",
    category: "file",
    description: "Delimited text files (.csv, .tsv, .txt)",
    fileExtensions: ".csv,.tsv,.txt",
  },
  {
    id: "json",
    name: "JSON",
    category: "file",
    description: "JavaScript Object Notation documents (.json)",
    fileExtensions: ".json",
  },
  {
    id: "xml",
    name: "XML",
    category: "file",
    description: "Extensible Markup Language documents (.xml)",
    fileExtensions: ".xml",
  },
];
