/**
 * Pure helpers shared by the Data Preparation studio and its unit tests.
 *
 * Step definitions mirror the backend record `com.rollercoaster.ingestion.rquery.RQueryStep`
 * (queries.rq.json), so what the Step Definition panel shows is exactly what the
 * `/api/ingestion/preview` endpoint executes.
 */

export type BackendSourceFormat =
  | "CSV"
  | "TSV"
  | "JSON"
  | "XML"
  | "XLSX"
  | "PARQUET"
  | "AVRO";
export type BackendDataType =
  | "INT64"
  | "FLOAT64"
  | "DECIMAL"
  | "CURRENCY"
  | "BOOLEAN"
  | "ISO_DATE"
  | "ISO_DATETIME"
  | "UTF8_STRING";

export type AggregationFunction = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
export type JoinKind = "INNER" | "LEFT" | "RIGHT" | "FULL";

export interface DataPrepColumn {
  readonly name: string;
  readonly type?: string;
  readonly icon?: string;
}

export interface DataPrepStep {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly detail?: string;
  readonly definition?: Record<string, unknown>;
}

export interface IngestionSource {
  readonly id: string;
  readonly name: string;
  readonly format: "PARQUET" | "CSV" | "XLSX" | "REST";
  readonly path: string;
  readonly enableLoad?: boolean;
  readonly backendFormat?: BackendSourceFormat;
}

export interface SourceSnapshot {
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly rawText?: string;
  readonly rawBase64?: string;
}

export interface WorkbookSheet {
  readonly id: string;
  readonly name: string;
  readonly kind: "Sheet" | "Table";
  readonly columns: readonly DataPrepColumn[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface DataConnector {
  readonly id: string;
  readonly name: string;
  readonly category: "file";
  readonly description: string;
  readonly fileExtensions: string;
}

export const DATA_CONNECTORS: readonly DataConnector[] = [
  {
    id: "excel",
    name: "Excel (.xlsx)",
    category: "file",
    description: "Microsoft Excel workbooks (.xlsx, .xlsm, .xls)",
    fileExtensions: ".xlsx,.xlsm,.xls",
  },
  {
    id: "csv",
    name: "CSV / Text (.csv, .tsv)",
    category: "file",
    description: "Delimited text files (.csv, .tsv, .txt)",
    fileExtensions: ".csv,.tsv,.txt",
  },
  {
    id: "json",
    name: "JSON (.json)",
    category: "file",
    description: "JavaScript Object Notation documents (.json)",
    fileExtensions: ".json",
  },
  {
    id: "xml",
    name: "XML (.xml)",
    category: "file",
    description: "Extensible Markup Language documents (.xml)",
    fileExtensions: ".xml",
  },
  {
    id: "parquet",
    name: "Parquet (.parquet)",
    category: "file",
    description: "Apache Parquet & Avro columnar files (.parquet, .avro)",
    fileExtensions: ".parquet,.avro",
  },
];

export interface RQueryAggregateDefinition {
  readonly outputColumn: string;
  readonly sourceColumn: string;
  readonly function: AggregationFunction;
}

export interface RQueryStepDefinition {
  readonly step: string;
  readonly input?: string;
  readonly uri?: string;
  readonly format?: BackendSourceFormat;
  readonly column?: string;
  readonly type?: BackendDataType;
  readonly oldName?: string;
  readonly newName?: string;
  readonly predicate?: string;
  readonly pivotColumns?: readonly string[];
  readonly nameCol?: string;
  readonly valCol?: string;
  readonly groupColumns?: readonly string[];
  readonly aggregations?: readonly RQueryAggregateDefinition[];
  readonly joinKeys?: readonly string[];
  readonly targetTable?: string;
  readonly joinType?: JoinKind;
  readonly expression?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly onError?: string;
  readonly item?: string;
  readonly kind?: string;
  readonly [key: string]: unknown;
}

/** Display label (column header chip) to backend enum. */
const DISPLAY_TO_BACKEND: Readonly<Record<string, BackendDataType>> = {
  int64: "INT64",
  float64: "FLOAT64",
  decimal: "DECIMAL",
  currency: "CURRENCY",
  boolean: "BOOLEAN",
  date: "ISO_DATE",
  datetime: "ISO_DATETIME",
  string: "UTF8_STRING",
  text: "UTF8_STRING",
};

const BACKEND_TO_DISPLAY: Readonly<Record<BackendDataType, string>> = {
  INT64: "Int64",
  FLOAT64: "Float64",
  DECIMAL: "Decimal",
  CURRENCY: "Currency",
  BOOLEAN: "Boolean",
  ISO_DATE: "Date",
  ISO_DATETIME: "DateTime",
  UTF8_STRING: "String",
};

export function toBackendType(
  displayType: string | undefined,
): BackendDataType {
  const key = (displayType ?? "").trim().toLowerCase();
  if (key in DISPLAY_TO_BACKEND) {
    return DISPLAY_TO_BACKEND[key];
  }
  const upper = (displayType ?? "").trim().toUpperCase();
  return upper in BACKEND_TO_DISPLAY
    ? (upper as BackendDataType)
    : "UTF8_STRING";
}

export function toDisplayType(backendType: string | undefined): string {
  const upper = (backendType ?? "").trim().toUpperCase();
  return upper in BACKEND_TO_DISPLAY
    ? BACKEND_TO_DISPLAY[upper as BackendDataType]
    : "String";
}

export function isNumericType(displayType: string | undefined): boolean {
  return ["int64", "float64", "decimal", "currency"].includes(
    (displayType ?? "").toLowerCase(),
  );
}

/** Derives the backend source format from a file name, or null when the extension is unsupported. */
export function formatFromFileName(
  fileName: string,
): BackendSourceFormat | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "csv":
    case "txt":
      return "CSV";
    case "tsv":
      return "TSV";
    case "json":
      return "JSON";
    case "xml":
      return "XML";
    case "xlsx":
      return "XLSX";
    case "parquet":
      return "PARQUET";
    case "avro":
      return "AVRO";
    default:
      return null;
  }
}

export function isBinaryFormat(format: BackendSourceFormat): boolean {
  return format === "XLSX" || format === "PARQUET" || format === "AVRO";
}

/** Table name used by the semantic model for a dataset file name. */
export function tableNameFromSource(sourceName: string): string {
  return (
    sourceName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_") ||
    "dataset"
  );
}

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterOrEqual"
  | "lessThan"
  | "lessOrEqual"
  | "between"
  | "notEmpty";

export const FILTER_OPERATORS: readonly {
  readonly id: FilterOperator;
  readonly label: string;
}[] = [
  { id: "equals", label: "Equals" },
  { id: "notEquals", label: "Does not equal" },
  { id: "greaterThan", label: "Greater than" },
  { id: "greaterOrEqual", label: "Greater than or equal to" },
  { id: "lessThan", label: "Less than" },
  { id: "lessOrEqual", label: "Less than or equal to" },
  { id: "between", label: "Between (RangeStart <= x < RangeEnd)" },
  { id: "notEmpty", label: "Is not empty" },
];

function quoteLiteral(value: string, numeric: boolean): string {
  return numeric ? value.trim() : `'${value.replace(/'/g, "")}'`;
}

/** Builds the R-Query predicate understood by `RQueryTransformationEngine.evaluateRowPredicate`. */
export function buildPredicate(
  column: string,
  operator: Exclude<FilterOperator, "notEmpty">,
  value: string,
  valueTo: string,
  numeric: boolean,
): string {
  const ref = `[${column}]`;
  switch (operator) {
    case "equals":
      return `${ref} == ${quoteLiteral(value, false)}`;
    case "notEquals":
      return `${ref} != ${quoteLiteral(value, false)}`;
    case "greaterThan":
      return `${ref} > ${quoteLiteral(value, numeric)}`;
    case "greaterOrEqual":
      return `${ref} >= ${quoteLiteral(value, numeric)}`;
    case "lessThan":
      return `${ref} < ${quoteLiteral(value, numeric)}`;
    case "lessOrEqual":
      return `${ref} <= ${quoteLiteral(value, numeric)}`;
    case "between":
      return `${ref} >= ${quoteLiteral(value, numeric)} and ${ref} < ${quoteLiteral(valueTo, numeric)}`;
  }
}

export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Generates an equivalent Power Query M (`let ... in ...`) script for a sequence of R-Query steps.
 */
export function formatMQueryScript(
  sourceName: string,
  steps: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly definition?: Record<string, unknown>;
  }[],
  rangeStart?: string,
  rangeEnd?: string,
): string {
  if (steps.length === 0) {
    return "// No transformation steps recorded";
  }
  const lines: string[] = ["let"];
  if (rangeStart && rangeEnd) {
    lines.push(
      `  RangeStart = #datetime(${rangeStart.replace(/[-T:Z]/g, ", ").replace(/,\s*$/, "")}),`,
    );
    lines.push(
      `  RangeEnd = #datetime(${rangeEnd.replace(/[-T:Z]/g, ", ").replace(/,\s*$/, "")}),`,
    );
  }

  let prevVar = "Source";
  steps.forEach((step, index) => {
    const def = step.definition ?? {};
    const stepType = String(def["step"] ?? step.type);
    const varName =
      index === 0 ? "Source" : `#"${step.name.replace(/"/g, "'")}_${index}"`;

    let expr = prevVar;
    switch (stepType) {
      case "FileSource":
      case "FileSourceStep": {
        const isXlsx =
          sourceName.toLowerCase().endsWith(".xlsx") ||
          sourceName.toLowerCase().endsWith(".xls");
        expr = isXlsx
          ? `Excel.Workbook(File.Contents("${sourceName}"), null, true)`
          : `Csv.Document(File.Contents("${sourceName}"), [Encoding=65001, QuoteStyle=QuoteStyle.None])`;
        break;
      }
      case "Navigation":
      case "NavigationStep": {
        const item = String(def["item"] ?? "Sheet1");
        const kind = String(def["kind"] ?? "Sheet");
        expr = `${prevVar}{[Item="${item}",Kind="${kind}"]}[Data]`;
        break;
      }
      case "PromoteHeaders":
      case "PromoteHeadersStep":
        expr = `Table.PromoteHeaders(${prevVar}, [PromoteAllScalars=true])`;
        break;
      case "ChangeType":
      case "ChangeTypeStep": {
        const col = String(def["column"] ?? "");
        const target = String(def["targetType"] ?? def["type"] ?? "Text");
        expr = `Table.TransformColumnTypes(${prevVar}, {{"${col}", type ${target.toLowerCase()}}})`;
        break;
      }
      case "DetectDataType":
      case "DetectDataTypeStep":
        expr = `Table.TransformColumnTypes(${prevVar}, /* Auto-Detected Schema */)`;
        break;
      case "RenameColumn":
      case "RenameColumnStep": {
        const oldCol = String(def["oldName"] ?? def["original"] ?? "");
        const newCol = String(def["newName"] ?? def["renamed"] ?? "");
        expr = `Table.RenameColumns(${prevVar}, {{"${oldCol}", "${newCol}"}})`;
        break;
      }
      case "TransformColumnNames":
      case "TransformColumnNamesStep": {
        const op = String(
          (def["parameters"] as Record<string, unknown>)?.["operation"] ??
            "UPPERCASE",
        );
        expr = `Table.TransformColumnNames(${prevVar}, Text.${op === "LOWERCASE" ? "Lower" : op === "TRIM" ? "Trim" : "Upper"})`;
        break;
      }
      case "RemoveColumn":
      case "RemoveColumnStep": {
        const col = String(def["column"] ?? "");
        expr = `Table.RemoveColumns(${prevVar}, {"${col}"})`;
        break;
      }
      case "RemoveOtherColumns":
      case "RemoveOtherColumnsStep": {
        const keep =
          ((def["parameters"] as Record<string, unknown>)?.[
            "keepColumns"
          ] as string[]) ?? [];
        expr = `Table.SelectColumns(${prevVar}, {${keep.map((c) => `"${c}"`).join(", ")}})`;
        break;
      }
      case "FilterNulls":
      case "FilterNullsStep": {
        const col = String(def["column"] ?? "");
        expr = `Table.SelectRows(${prevVar}, each [${col}] <> null and [${col}] <> "")`;
        break;
      }
      case "FilterRows":
      case "FilterRowsStep": {
        const pred = String(def["predicate"] ?? "true");
        expr = `Table.SelectRows(${prevVar}, each ${pred})`;
        break;
      }
      case "UnpivotColumns":
      case "UnpivotColumnsStep": {
        const cols = (def["pivotColumns"] as string[]) ?? [];
        const nameCol = String(def["nameCol"] ?? "Attribute");
        const valCol = String(def["valCol"] ?? "Value");
        expr = `Table.Unpivot(${prevVar}, {${cols.map((c) => `"${c}"`).join(", ")}}, "${nameCol}", "${valCol}")`;
        break;
      }
      case "UnpivotOtherColumns":
      case "UnpivotOtherColumnsStep": {
        const anchorCols = (def["groupColumns"] as string[]) ?? [];
        const nameCol = String(def["nameCol"] ?? "Attribute");
        const valCol = String(def["valCol"] ?? "Value");
        expr = `Table.UnpivotOtherColumns(${prevVar}, {${anchorCols.map((c) => `"${c}"`).join(", ")}}, "${nameCol}", "${valCol}")`;
        break;
      }
      case "GroupRows":
      case "GroupRowsStep": {
        const gCols = (def["groupColumns"] as string[]) ?? [];
        const aggs = (def["aggregations"] as RQueryAggregateDefinition[]) ?? [];
        const aggSpec = aggs
          .map(
            (a) =>
              `{"${a.outputColumn}", each List.${a.function}([${a.sourceColumn}])}`,
          )
          .join(", ");
        expr = `Table.Group(${prevVar}, {${gCols.map((c) => `"${c}"`).join(", ")}}, {${aggSpec}})`;
        break;
      }
      case "AddCustomColumn":
      case "AddCustomColumnStep": {
        const newCol = String(def["newName"] ?? "Custom");
        const formula = String(def["expression"] ?? "null");
        expr = `Table.AddColumn(${prevVar}, "${newCol}", each ${formula})`;
        break;
      }
      case "AddIndexColumn":
      case "AddIndexColumnStep": {
        const newCol = String(def["newName"] ?? "Index");
        const params = (def["parameters"] as Record<string, unknown>) ?? {};
        const seed = Number(params["initialValue"] ?? 1);
        const inc = Number(params["increment"] ?? 1);
        expr = `Table.AddIndexColumn(${prevVar}, "${newCol}", ${seed}, ${inc}, Int64.Type)`;
        break;
      }
      case "MergeQueries":
      case "MergeQueriesStep": {
        const target = String(def["targetTable"] ?? "LookupTable");
        const keys = (def["joinKeys"] as string[]) ?? [];
        const kind = String(def["joinType"] ?? "LEFT");
        expr = `Table.NestedJoin(${prevVar}, {${keys.map((k) => `"${k}"`).join(", ")}}, ${target}, {${keys.map((k) => `"${k}"`).join(", ")}}, "${target}", JoinKind.${kind})`;
        break;
      }
      case "FillDown":
      case "FillDownStep": {
        const col = String(def["column"] ?? "");
        expr = `Table.FillDown(${prevVar}, {"${col}"})`;
        break;
      }
      case "Transpose":
      case "TransposeStep":
        expr = `Table.Transpose(${prevVar})`;
        break;
      case "RemoveTopRows":
      case "RemoveTopRowsStep": {
        const count = Number(
          (def["parameters"] as Record<string, unknown>)?.["count"] ?? 1,
        );
        expr = `Table.Skip(${prevVar}, ${count})`;
        break;
      }
      case "RemoveBottomRows":
      case "RemoveBottomRowsStep": {
        const count = Number(
          (def["parameters"] as Record<string, unknown>)?.["count"] ?? 1,
        );
        expr = `Table.RemoveLastN(${prevVar}, ${count})`;
        break;
      }
      case "RemoveDuplicates":
      case "RemoveDuplicatesStep": {
        const cols = (def["groupColumns"] as string[]) ?? [];
        expr =
          cols.length > 0
            ? `Table.Distinct(${prevVar}, {${cols.map((c) => `"${c}"`).join(", ")}})`
            : `Table.Distinct(${prevVar})`;
        break;
      }
      case "SplitColumn":
      case "SplitColumnStep": {
        const col = String(def["column"] ?? "");
        const delim = String(
          (def["parameters"] as Record<string, unknown>)?.["delimiter"] ?? ",",
        );
        expr = `Table.SplitColumn(${prevVar}, "${col}", Splitter.SplitTextByDelimiter("${delim}", QuoteStyle.Csv))`;
        break;
      }
      case "MergeColumns":
      case "MergeColumnsStep": {
        const cols = (def["groupColumns"] as string[]) ?? [];
        const newCol = String(def["newName"] ?? "Merged");
        const sep = String(
          (def["parameters"] as Record<string, unknown>)?.["separator"] ?? " ",
        );
        expr = `Table.CombineColumns(${prevVar}, {${cols.map((c) => `"${c}"`).join(", ")}}, Combiner.CombineTextByDelimiter("${sep}"), "${newCol}")`;
        break;
      }
      case "SortRows":
      case "SortRowsStep": {
        const col = String(def["column"] ?? "");
        const asc =
          (def["parameters"] as Record<string, unknown>)?.["ascending"] !==
          false;
        expr = `Table.Sort(${prevVar}, {{"${col}", Order.${asc ? "Ascending" : "Descending"}}})`;
        break;
      }
      case "InlineCleansing":
      case "InlineCleansingStep": {
        const col = String(def["column"] ?? "");
        const op = String(
          (def["parameters"] as Record<string, unknown>)?.["operation"] ??
            "TRIM",
        );
        expr = `Table.TransformColumns(${prevVar}, {{"${col}", Text.${op === "LOWERCASE" ? "Lower" : op === "UPPERCASE" ? "Upper" : "Trim"}, type text}})`;
        break;
      }
      default:
        expr = `${prevVar} /* ${step.name} */`;
        break;
    }

    const suffix = index < steps.length - 1 ? "," : "";
    lines.push(`  ${varName} = ${expr}${suffix}`);
    prevVar = varName;
  });

  lines.push("in");
  lines.push(`  ${prevVar}`);
  return lines.join("\n");
}

/**
 * Returns the single-line Power Query M expression for an individual active step
 * to populate the interactive formula bar above the table preview.
 */
export function getStepMFormula(
  sourceName: string,
  step: {
    readonly name: string;
    readonly type: string;
    readonly definition?: Record<string, unknown>;
  } | null,
  prevVar = "Source",
): string {
  if (!step) {
    return "";
  }
  const def = step.definition ?? {};
  const stepType = String(def["step"] ?? step.type);

  switch (stepType) {
    case "FileSource":
    case "FileSourceStep": {
      const isXlsx =
        sourceName.toLowerCase().endsWith(".xlsx") ||
        sourceName.toLowerCase().endsWith(".xls");
      return isXlsx
        ? `= Excel.Workbook(File.Contents("${sourceName}"), null, true)`
        : `= Csv.Document(File.Contents("${sourceName}"), [Encoding=65001, QuoteStyle=QuoteStyle.None])`;
    }
    case "Navigation":
    case "NavigationStep": {
      const item = String(def["item"] ?? "Sheet1");
      const kind = String(def["kind"] ?? "Sheet");
      return `= ${prevVar}{[Item="${item}",Kind="${kind}"]}[Data]`;
    }
    case "PromoteHeaders":
    case "PromoteHeadersStep":
      return `= Table.PromoteHeaders(${prevVar}, [PromoteAllScalars=true])`;
    case "ChangeType":
    case "ChangeTypeStep": {
      const col = String(def["column"] ?? "");
      const target = String(def["targetType"] ?? def["type"] ?? "Text");
      return `= Table.TransformColumnTypes(${prevVar}, {{"${col}", type ${target.toLowerCase()}}})`;
    }
    case "DetectDataType":
    case "DetectDataTypeStep":
      return `= Table.TransformColumnTypes(${prevVar}, /* Auto-Detected Schema */)`;
    case "RenameColumn":
    case "RenameColumnStep": {
      const oldCol = String(def["oldName"] ?? def["original"] ?? "");
      const newCol = String(def["newName"] ?? def["renamed"] ?? "");
      return `= Table.RenameColumns(${prevVar}, {{"${oldCol}", "${newCol}"}})`;
    }
    case "FilterRows":
    case "FilterRowsStep": {
      const pred = String(def["predicate"] ?? "true");
      return `= Table.SelectRows(${prevVar}, each ${pred})`;
    }
    case "FilterNulls":
    case "FilterNullsStep": {
      const col = String(def["column"] ?? "");
      return `= Table.SelectRows(${prevVar}, each [${col}] <> null and [${col}] <> "")`;
    }
    case "UnpivotColumns":
    case "UnpivotColumnsStep": {
      const cols = (def["pivotColumns"] as string[]) ?? [];
      const nameCol = String(def["nameCol"] ?? "Attribute");
      const valCol = String(def["valCol"] ?? "Value");
      return `= Table.Unpivot(${prevVar}, {${cols.map((c) => `"${c}"`).join(", ")}}, "${nameCol}", "${valCol}")`;
    }
    case "UnpivotOtherColumns":
    case "UnpivotOtherColumnsStep": {
      const anchorCols = (def["groupColumns"] as string[]) ?? [];
      const nameCol = String(def["nameCol"] ?? "Attribute");
      const valCol = String(def["valCol"] ?? "Value");
      return `= Table.UnpivotOtherColumns(${prevVar}, {${anchorCols.map((c) => `"${c}"`).join(", ")}}, "${nameCol}", "${valCol}")`;
    }
    case "GroupRows":
    case "GroupRowsStep": {
      const gCols = (def["groupColumns"] as string[]) ?? [];
      const aggs = (def["aggregations"] as RQueryAggregateDefinition[]) ?? [];
      const aggSpec = aggs
        .map(
          (a) =>
            `{"${a.outputColumn}", each List.${a.function}([${a.sourceColumn}])}`,
        )
        .join(", ");
      return `= Table.Group(${prevVar}, {${gCols.map((c) => `"${c}"`).join(", ")}}, {${aggSpec}})`;
    }
    case "AddCustomColumn":
    case "AddCustomColumnStep": {
      const newCol = String(def["newName"] ?? "Custom");
      const formula = String(def["expression"] ?? "null");
      return `= Table.AddColumn(${prevVar}, "${newCol}", each ${formula})`;
    }
    case "AddIndexColumn":
    case "AddIndexColumnStep": {
      const newCol = String(def["newName"] ?? "Index");
      const params = (def["parameters"] as Record<string, unknown>) ?? {};
      const seed = Number(params["initialValue"] ?? 1);
      const inc = Number(params["increment"] ?? 1);
      return `= Table.AddIndexColumn(${prevVar}, "${newCol}", ${seed}, ${inc}, Int64.Type)`;
    }
    case "MergeQueries":
    case "MergeQueriesStep": {
      const target = String(def["targetTable"] ?? "LookupTable");
      const keys = (def["joinKeys"] as string[]) ?? [];
      const kind = String(def["joinType"] ?? "LEFT");
      return `= Table.NestedJoin(${prevVar}, {${keys.map((k) => `"${k}"`).join(", ")}}, ${target}, {${keys.map((k) => `"${k}"`).join(", ")}}, "${target}", JoinKind.${kind})`;
    }
    case "Transpose":
    case "TransposeStep":
      return `= Table.Transpose(${prevVar})`;
    case "RemoveDuplicates":
    case "RemoveDuplicatesStep": {
      const cols = (def["groupColumns"] as string[]) ?? [];
      return cols.length > 0
        ? `= Table.Distinct(${prevVar}, {${cols.map((c) => `"${c}"`).join(", ")}})`
        : `= Table.Distinct(${prevVar})`;
    }
    default:
      return `= ${prevVar} /* ${step.name} */`;
  }
}
