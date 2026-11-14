import * as PARSER from "./ingestion.constants";
import { ParsedTextResult, XmlGroup } from "./ingestion.interface";
import { buildSheet, collectHeaders, stripBom } from "./sheet.builder";

function collectFields(
  element: Element,
  prefix: string,
  scalars: Record<string, unknown>,
  arrayGroups: XmlGroup[],
): void {
  for (const attr of Array.from(element.attributes)) {
    const attrName = prefix ? `${prefix}.@${attr.name}` : `@${attr.name}`;
    scalars[attrName] = attr.value;
  }

  const children = Array.from(element.children);
  if (children.length === 0) {
    const textVal = element.textContent?.trim() ?? "";
    if (prefix) {
      scalars[prefix] = textVal === "" ? null : textVal;
    } else if (textVal !== "") {
      scalars[PARSER.DEFAULT_VALUE_KEY] = textVal;
    }
    return;
  }

  const groupedByTag = new Map<string, Element[]>();
  for (const child of children) {
    const list = groupedByTag.get(child.tagName) ?? [];
    list.push(child);
    groupedByTag.set(child.tagName, list);
  }

  for (const [tag, group] of groupedByTag.entries()) {
    const childPrefix = prefix ? `${prefix}.${tag}` : tag;
    if (group.length > 1) {
      const allSimple = group.every(
        (el) => el.children.length === 0 && el.attributes.length === 0,
      );
      if (allSimple) {
        scalars[childPrefix] = group
          .map((el) => el.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(", ");
      } else {
        arrayGroups.push({ key: tag, elements: group });
      }
      continue;
    }

    const single = group[0];
    const singleChildren = Array.from(single.children);
    const isWrapper =
      singleChildren.length > 1 &&
      singleChildren.every((c) => c.tagName === singleChildren[0].tagName) &&
      singleChildren.some(
        (c) => c.children.length > 0 || c.attributes.length > 0,
      );
    if (isWrapper && single.attributes.length === 0) {
      arrayGroups.push({ key: tag, elements: singleChildren });
    } else {
      collectFields(single, childPrefix, scalars, arrayGroups);
    }
  }
}

function flattenElement(element: Element): Record<string, unknown>[] {
  const scalars: Record<string, unknown> = {};
  const arrayGroups: XmlGroup[] = [];
  collectFields(element, "", scalars, arrayGroups);

  if (arrayGroups.length === 0) {
    return Object.keys(scalars).length > 0 ? [scalars] : [];
  }

  const primary = arrayGroups[0];
  const expanded: Record<string, unknown>[] = [];
  for (const childEl of primary.elements) {
    const childRows = flattenElement(childEl);
    for (const childRow of childRows) {
      const merged: Record<string, unknown> = { ...scalars };
      for (const [ck, cv] of Object.entries(childRow)) {
        const targetKey = ck in merged ? `${primary.key}.${ck}` : ck;
        merged[targetKey] = cv;
      }
      expanded.push(merged);
    }
  }

  return expanded.length > 0 ? expanded : [scalars];
}

export function extractXml(fileName: string, text: string): ParsedTextResult {
  const baseName =
    fileName.replace(PARSER.EXT_PATTERN, "") || PARSER.DEFAULT_XML;
  const cleaned = stripBom(text).trim();
  if (!cleaned) {
    return {
      sheets: [buildSheet("table_1", baseName, "Table", [], [])],
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, "application/xml");
  if (
    doc.getElementsByTagName("parsererror").length > 0 ||
    !doc.documentElement
  ) {
    return {
      sheets: [],
      error: `Failed to parse XML structure in "${fileName}".`,
    };
  }

  const root = doc.documentElement;
  const rootChildren = Array.from(root.children);
  if (rootChildren.length === 0) {
    const rows = flattenElement(root);
    const headers = collectHeaders(rows);
    return {
      sheets: [buildSheet("table_1", baseName, "Table", headers, rows)],
    };
  }

  const hasRepeating =
    rootChildren.length > 1 ||
    rootChildren[0].children.length > 0 ||
    rootChildren[0].attributes.length > 0;

  let recordElements: Element[] = hasRepeating ? rootChildren : [root];
  if (
    rootChildren.length === 1 &&
    rootChildren[0].children.length > 0 &&
    rootChildren[0].attributes.length === 0 &&
    Array.from(rootChildren[0].children).some(
      (c) => c.children.length > 0 || c.attributes.length > 0,
    )
  ) {
    recordElements = Array.from(rootChildren[0].children);
  }

  const flatRows: Record<string, unknown>[] = [];
  for (const el of recordElements) {
    flatRows.push(...flattenElement(el));
  }
  const headers = collectHeaders(flatRows);
  return {
    sheets: [buildSheet("table_1", baseName, "Table", headers, flatRows)],
  };
}
