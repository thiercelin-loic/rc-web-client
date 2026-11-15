import { CanvasVisualItem } from "../state-manager.service";
import { unpackZipArchive } from "../zip-archive";
import {
  DEFAULT_PAGE_TITLE,
  DEFINITION_SCHEMA_URL,
  FALLBACK_UUID,
  MANIFEST_SCHEMA_URL,
  PROJECT_ENGINE_VERSION,
  PROJECT_EXTENSION,
  PROJECT_FORMAT_VERSION,
  PROJECT_GRID_COLUMNS,
  PROJECT_THEME_NAME,
  PROJECT_THEME_TOKENS,
  THEME_SCHEMA_URL,
  ZIP_MAGIC_BYTES,
} from "./project.constants";
import {
  CanvasDefinitionData,
  CanvasDefinitionPage,
  CanvasVisualDef,
  ParsedProjectState,
  ProjectDataBundle,
  ProjectManifestData,
  ProjectThemeData,
  RawProjectJson,
  RsdlSource,
} from "./project.interface";

export function normalizeName(rawName: string): string {
  return rawName.endsWith(PROJECT_EXTENSION)
    ? rawName
    : `${rawName}${PROJECT_EXTENSION}`;
}

export function buildManifest(
  projectTitle: string,
  hasEmbeddedData = false,
): ProjectManifestData {
  return {
    $schema: MANIFEST_SCHEMA_URL,
    projectId: generateUuid(),
    formatVersion: PROJECT_FORMAT_VERSION,
    minEngineVersion: PROJECT_ENGINE_VERSION,
    title: projectTitle,
    packageType: "STANDALONE_PROJECT",
    hasEmbeddedData,
    checksumSha256: computeChecksum(projectTitle),
    parameters: [],
  };
}

export function buildDefinition(
  pages: readonly string[],
  readVisuals: (pageTitle: string) => readonly CanvasVisualItem[],
): CanvasDefinitionData {
  const mappedPages: CanvasDefinitionPage[] = pages.map((pageTitle) => ({
    id: pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: pageTitle,
    visuals: readVisuals(pageTitle).map((visual) => ({
      visualId: visual.id,
      archetype: visual.archetype,
      title: visual.title,
      metricLabel: visual.metricLabel,
      metricValue: visual.metricValue,
      metricSubtext: visual.metricSubtext,
      measureId: visual.metricLabel || "m_sales",
      ...(visual.sortBy ? { sortBy: visual.sortBy } : {}),
      ...(visual.sortOrder ? { sortOrder: visual.sortOrder } : {}),
      ...(visual.fieldWells ? { fieldWells: visual.fieldWells } : {}),
      layout: {
        colSpan: visual.width === "full" ? 12 : 6,
        rowSpan: 1,
      },
    })),
  }));

  return {
    $schema: DEFINITION_SCHEMA_URL,
    version: PROJECT_FORMAT_VERSION,
    gridColumns: PROJECT_GRID_COLUMNS,
    pages: mappedPages,
  };
}

export function buildTheme(mode: string): ProjectThemeData {
  return {
    $schema: THEME_SCHEMA_URL,
    name: PROJECT_THEME_NAME,
    mode,
    tokens: PROJECT_THEME_TOKENS,
  };
}

export function buildRsdl(source: RsdlSource): string {
  const lines = [
    "// RollerCoaster Semantic Definition Language (RSDL)",
    `// Project: ${source.filename}`,
    "",
  ];

  for (const table of source.tables) {
    lines.push(`table '${table.name}' {`);
    lines.push(`  role: '${table.role}'`);
    for (const col of table.columns) {
      lines.push(`  column '${col.name}' : ${col.dataType}`);
    }
    lines.push("}");
    lines.push("");
  }

  for (const measure of source.measures) {
    lines.push(`measure '${measure.label}' = ${measure.formula}`);
  }

  return lines.join("\n");
}

export function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < ZIP_MAGIC_BYTES.length) {
    return false;
  }
  return ZIP_MAGIC_BYTES.every(
    (magicByte, index) => bytes[index] === magicByte,
  );
}

export function parseArchive(bytes: Uint8Array): ParsedProjectState {
  const entries = unpackZipArchive(bytes);
  const decoder = new TextDecoder();
  const dataEntry = entries["DataModel/data.json"] ?? entries["data.json"];
  const dataBundle = dataEntry
    ? (JSON.parse(decoder.decode(dataEntry)) as Partial<ProjectDataBundle>)
    : undefined;

  let pages: string[] = [DEFAULT_PAGE_TITLE];
  let visualsMap: Record<string, CanvasVisualItem[]> = {
    [DEFAULT_PAGE_TITLE]: [],
  };

  const layoutEntry =
    entries["Report/Layout.json"] ?? entries["definition.json"];
  if (layoutEntry) {
    const defJson = JSON.parse(
      decoder.decode(layoutEntry),
    ) as CanvasDefinitionData;
    if (Array.isArray(defJson.pages) && defJson.pages.length > 0) {
      pages = [];
      visualsMap = {};
      for (const page of defJson.pages) {
        pages.push(page.title);
        visualsMap[page.title] = (page.visuals || []).map(
          (visual: CanvasVisualDef) => ({
            id: visual.visualId || `vis-${Date.now()}`,
            title: visual.title || `${visual.archetype} Visual`,
            archetype: visual.archetype || "Bar",
            width: visual.layout?.colSpan === 12 ? "full" : "half",
            metricLabel: visual.metricLabel || visual.measureId || "Metric",
            metricValue: visual.metricValue || "€ 0.00",
            metricSubtext: visual.metricSubtext || "Imported from .rcp",
            ...(visual.sortBy ? { sortBy: visual.sortBy } : {}),
            ...(visual.sortOrder ? { sortOrder: visual.sortOrder } : {}),
            ...(visual.fieldWells
              ? { fieldWells: cloneWells(visual.fieldWells) }
              : {}),
          }),
        );
      }
    }
  }

  return {
    pages,
    visualsMap,
    ...(dataBundle?.tables ? { tables: dataBundle.tables } : {}),
    ...(dataBundle?.rows ? { rows: dataBundle.rows } : {}),
    ...(dataBundle?.measures ? { measures: dataBundle.measures } : {}),
  };
}

function cloneWells(
  wells: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const cloned: Record<string, string[]> = {};
  for (const [key, fields] of Object.entries(wells)) {
    cloned[key] = [...fields];
  }
  return cloned;
}

export function parseJson(bytes: Uint8Array): ParsedProjectState {
  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text) as RawProjectJson;

  const pages =
    Array.isArray(parsed.pages) && parsed.pages.length > 0
      ? [...parsed.pages]
      : [DEFAULT_PAGE_TITLE];

  const visualsMap: Record<string, CanvasVisualItem[]> = {};
  if (parsed.visuals) {
    for (const [pageTitle, visuals] of Object.entries(parsed.visuals)) {
      visualsMap[pageTitle] = [...visuals];
    }
  } else {
    visualsMap[DEFAULT_PAGE_TITLE] = [];
  }

  return { pages, visualsMap };
}

export async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
          return;
        }
        reject(new Error("Failed to read file as ArrayBuffer"));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }
  throw new Error("File reading API not available in current environment");
}

export function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return FALLBACK_UUID;
}

export function computeChecksum(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return hex.repeat(8);
}
