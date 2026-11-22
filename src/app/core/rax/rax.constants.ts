import { RaxFunctionSnippet } from "./rax.interface";

export const RAX_DIAGNOSTICS_ENDPOINT = "/api/rax/diagnostics";
export const RAX_VALIDATE_ENDPOINT = "/api/rax/diagnostics/validate";

export const RAX_AUTOCOMPLETE_CATALOG: readonly RaxFunctionSnippet[] = [
  {
    label: "CALCULATE",
    signature: "CALCULATE(<Expression>, <Filter1>, <Filter2>...)",
    doc: "Evaluates an expression in a modified filter context with automatic context transition.",
  },
  {
    label: "USERELATIONSHIP",
    signature: "USERELATIONSHIP(<ColumnName1>, <ColumnName2>)",
    doc: "Activates an inactive relationship path (such as DeliveryDate / DueDate) for the duration of CALCULATE.",
  },
  {
    label: "DIVIDE",
    signature: "DIVIDE(<Numerator>, <Denominator>, [<AlternateResult>])",
    doc: "Performs safe division with automatic zero-division handling.",
  },
  {
    label: "TOTALYTD",
    signature: "TOTALYTD(<Expression>, <Dates>, [<Filter>], [<YearEndDate>])",
    doc: "Evaluates the year-to-date value of the expression in the current evaluation context.",
  },
  {
    label: "SAMEPERIODLASTYEAR",
    signature: "SAMEPERIODLASTYEAR(<Dates>)",
    doc: "Shifts the contiguous date dimension selection backward by 1 fiscal year.",
  },
];
