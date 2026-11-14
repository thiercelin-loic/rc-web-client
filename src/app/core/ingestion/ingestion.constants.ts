export const BOM_PREFIX = /^\uFEFF/;
export const INT_PATTERN = /^-?\d+$/;
export const FLOAT_PATTERN = /^-?\d+\.\d+$/;
export const BOOL_PATTERN = /^(true|false|yes|no)$/i;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
export const EXT_PATTERN = /\.[^/.]+$/;
export const XLS_PATTERN = /\.xlsx?$/i;

export const DEFAULT_DATASET = 'Dataset';
export const DEFAULT_XML = 'XmlData';
export const DEFAULT_SHEET = 'Sheet1';
export const DEFAULT_VALUE_KEY = 'Value';
export const COLUMN_PREFIX = 'Column';

export const STRING_TYPE = 'String';
export const INT_TYPE = 'Int64';
export const FLOAT_TYPE = 'Float64';
export const BOOL_TYPE = 'Boolean';
export const DATE_TYPE = 'Date';

export const COMMA_SEP = ',';
export const SEMICOLON_SEP = ';';
export const TAB_SEP = '\t';

export const DEFAULT_EXTENSIONS = '.csv,.tsv,.json,.txt,.xml,.xlsx,.parquet,.avro';
export const OPENXML_RELS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const MULTI_SHEET_PATTERN = /^sheet\d*$/i;
