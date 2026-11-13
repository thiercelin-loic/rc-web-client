import {
  ExportChartData,
  ExportSheetSpec,
  ExportVisualSummary,
  TabularExportData,
} from "./export.interface";

type ChartResolver =
  | ((visual: { readonly id: string }) => ExportChartData | null)
  | null;

interface BoundVisual {
  readonly visual: ExportVisualSummary;
  readonly chart: ExportChartData;
}

export function buildSheets(
  visuals: readonly ExportVisualSummary[],
  resolver: ChartResolver,
): readonly ExportSheetSpec[] {
  return visuals.map((visual, index) => {
    const chart = resolver?.(visual);
    const name = formatTab(index + 1, visual.title);
    if (chart && chart.datasets.length > 0) {
      const table = extractChart(chart);
      return {
        name,
        rows: [table.columns, ...table.rows],
      };
    }
    return {
      name,
      rows: [
        ["Title", "Archetype", "Label", "Value"],
        [
          visual.title,
          visual.archetype,
          visual.metricLabel,
          visual.metricValue,
        ],
      ],
    };
  });
}

export function shapeDataset(
  visuals: readonly ExportVisualSummary[],
  resolver: ChartResolver,
): TabularExportData {
  const bound = resolveBound(visuals, resolver);

  if (bound.length === 1) {
    const table = extractChart(bound[0].chart);
    return {
      columns: table.columns,
      rows: table.rows.map((row) => row.map((cell) => String(cell))),
    };
  }

  if (bound.length > 1) {
    return mergeCharts(bound);
  }

  return fallbackDataset(visuals);
}

function resolveBound(
  visuals: readonly ExportVisualSummary[],
  resolver: ChartResolver,
): BoundVisual[] {
  return visuals
    .map((visual) => ({ visual, chart: resolver?.(visual) }))
    .filter((item): item is BoundVisual =>
      Boolean(item.chart && item.chart.datasets.length > 0),
    );
}

function extractChart(chart: ExportChartData): {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
} {
  const columns: string[] = [
    "Category",
    ...chart.datasets.map((ds, idx) => ds.label || `Value ${idx + 1}`),
  ];
  const rows: (string | number)[][] = chart.labels.map((label, rowIndex) => [
    String(label),
    ...chart.datasets.map((ds) => formatNumeric(ds.data[rowIndex])),
  ]);
  return { columns, rows };
}

function mergeCharts(bound: readonly BoundVisual[]): TabularExportData {
  const seriesNames = collectSeries(bound);
  const columns: string[] = ["Visual Title", "Category", ...seriesNames];
  const rows: string[][] = [];

  for (const { visual, chart } of bound) {
    chart.labels.forEach((label, rowIndex) => {
      const values = seriesNames.map((seriesName) => {
        const match = chart.datasets.find(
          (ds, idx) => (ds.label || `Value ${idx + 1}`) === seriesName,
        );
        const val = formatNumeric(match?.data[rowIndex]);
        return String(val);
      });
      rows.push([visual.title, String(label), ...values]);
    });
  }
  return { columns, rows };
}

function collectSeries(bound: readonly BoundVisual[]): string[] {
  const names: string[] = [];
  for (const { chart } of bound) {
    chart.datasets.forEach((ds, idx) => {
      const name = ds.label || `Value ${idx + 1}`;
      if (!names.includes(name)) {
        names.push(name);
      }
    });
  }
  return names;
}

function fallbackDataset(
  visuals: readonly ExportVisualSummary[],
): TabularExportData {
  const columns: readonly string[] = [
    "Visual Title",
    "Archetype",
    "Metric Label",
    "Metric Value",
  ];
  const rows: readonly (readonly string[])[] = visuals.map((visual) => [
    visual.title,
    visual.archetype,
    visual.metricLabel,
    visual.metricValue,
  ]);
  return { columns, rows };
}

function formatNumeric(val: number | undefined): number | string {
  return typeof val === "number" && Number.isFinite(val) ? val : "";
}

function formatTab(index: number, title: string): string {
  const cleaned = (title || `Visual ${index}`)
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidate = `${index} - ${cleaned}`;
  return candidate.length > 31 ? candidate.slice(0, 31).trim() : candidate;
}

