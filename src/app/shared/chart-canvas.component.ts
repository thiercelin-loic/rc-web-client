import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  ChartOptions,
  ChartType,
  registerables,
} from 'chart.js';

import { StateManagerService } from '../core/state-manager.service';

// Register all standard Chart.js controllers, elements, scales, and plugins once for the application module.
Chart.register(...registerables);

export type SupportedChartType = 'bar' | 'line' | 'doughnut' | 'pie' | 'radar';
export type LegendPosition = 'top' | 'bottom' | 'right' | 'hidden';

export interface ChartCanvasDataset {
  readonly label: string;
  readonly data: readonly number[];
  readonly backgroundColor?: string | readonly string[];
  readonly borderColor?: string | readonly string[];
  readonly borderWidth?: number | readonly number[];
  readonly pointRadius?: number | readonly number[];
  readonly pointHoverRadius?: number | readonly number[];
  readonly pointBackgroundColor?: string | readonly string[];
  readonly fill?: boolean;
  readonly tension?: number;
}

export interface ChartCanvasPayload {
  readonly title?: string;
  readonly showTitle?: boolean;
  readonly showGridlines?: boolean;
  readonly highlightCallouts?: boolean;
  readonly legendPosition?: LegendPosition;
  readonly chartType: SupportedChartType;
  readonly labels: readonly string[];
  readonly datasets: readonly ChartCanvasDataset[];
}

export interface ChartThemePalette {
  readonly textColor: string;
  readonly gridColor: string;
  readonly neutralColor: string;
  readonly neutralSubtle: string;
}

/**
 * Resolves the foreground text and grid line color palette based on active application theme.
 * Enforces neutral WCAG 2.1 AA / AAA contrast: pure white (#FFFFFF) in dark mode, deep black (#000000) in light mode.
 */
export function resolveChartThemePalette(theme: 'light' | 'dark'): ChartThemePalette {
  const isDark = theme === 'dark';
  return {
    textColor: isDark ? '#FFFFFF' : '#000000',
    gridColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)',
    neutralColor: isDark ? '#FFFFFF' : '#000000',
    neutralSubtle: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.08)',
  };
}

/**
 * Evaluates whether the given chart archetype represents a radial/circular chart without Cartesian axes.
 */
export function isCircularChartType(chartType: SupportedChartType): boolean {
  return chartType === 'doughnut' || chartType === 'pie';
}

function findPeakValueIndex(values: readonly number[]): number {
  let maxIdx = -1;
  let maxVal = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v) && v > maxVal) {
      maxVal = v;
      maxIdx = i;
    }
  }
  return maxIdx;
}

/**
 * Maps incoming canvas dataset configurations to Chart.js dataset formats.
 * Applies neutral theme-aware fallbacks when dataset colors are omitted.
 */
function buildChartDatasets(
  payload: ChartCanvasPayload,
  palette: ChartThemePalette,
): ChartConfiguration<ChartType>['data']['datasets'] {
  const isLineChart = payload.chartType === 'line';
  return payload.datasets.map((dataset) => {
    const peakIndex =
      payload.highlightCallouts && dataset.data.length > 0
        ? findPeakValueIndex(dataset.data)
        : -1;

    const mapped: Record<string, unknown> = {
      label: dataset.label,
      data: [...dataset.data],
      backgroundColor: (dataset.backgroundColor ??
        (isLineChart ? 'transparent' : palette.neutralSubtle)) as string | string[] | undefined,
      borderColor: (dataset.borderColor ?? palette.neutralColor) as string | string[] | undefined,
      borderWidth: dataset.borderWidth ?? (isLineChart ? 2 : 1),
      fill: dataset.fill ?? false,
      tension: dataset.tension ?? (isLineChart ? 0.35 : 0),
    };

    if (dataset.pointRadius !== undefined) {
      mapped['pointRadius'] = Array.isArray(dataset.pointRadius)
        ? [...dataset.pointRadius]
        : dataset.pointRadius;
    } else if (payload.highlightCallouts === true && isLineChart && peakIndex >= 0) {
      mapped['pointRadius'] = dataset.data.map((_, idx) => (idx === peakIndex ? 6 : 3));
      mapped['pointHoverRadius'] = dataset.data.map((_, idx) => (idx === peakIndex ? 8 : 5));
    } else if (payload.highlightCallouts === false && isLineChart) {
      mapped['pointRadius'] = 2;
      mapped['pointHoverRadius'] = 4;
    }

    if (dataset.pointHoverRadius !== undefined) {
      mapped['pointHoverRadius'] = Array.isArray(dataset.pointHoverRadius)
        ? [...dataset.pointHoverRadius]
        : dataset.pointHoverRadius;
    }

    if (dataset.pointBackgroundColor !== undefined) {
      mapped['pointBackgroundColor'] = Array.isArray(dataset.pointBackgroundColor)
        ? [...dataset.pointBackgroundColor]
        : dataset.pointBackgroundColor;
    }

    return mapped as unknown as ChartConfiguration<ChartType>['data']['datasets'][number];
  });
}

/**
 * Builds Cartesian scale configuration when the chart archetype is not radial/circular.
 */
function buildChartScales(
  isCircular: boolean,
  palette: ChartThemePalette,
  showGridlines?: boolean,
): ChartOptions<ChartType>['scales'] {
  if (isCircular) {
    return undefined;
  }

  const xGrid =
    showGridlines === false
      ? { display: false, color: palette.gridColor }
      : { color: palette.gridColor };
  const yGrid =
    showGridlines === false
      ? { display: false, color: palette.gridColor }
      : { color: palette.gridColor };

  return {
    x: {
      ticks: { color: palette.textColor, font: { size: 11 } },
      grid: xGrid,
    },
    y: {
      beginAtZero: true,
      ticks: { color: palette.textColor, font: { size: 11 } },
      grid: yGrid,
    },
  };
}

/**
 * Pure factory function assembling the full Chart.js configuration object.
 */
export function buildChartConfiguration(
  payload: ChartCanvasPayload,
  theme: 'light' | 'dark',
): ChartConfiguration<ChartType> {
  const palette = resolveChartThemePalette(theme);
  const isCircular = isCircularChartType(payload.chartType);
  const legendPos = payload.legendPosition;
  const legendDisplay = legendPos !== 'hidden';
  const resolvedLegendPosition: 'top' | 'bottom' | 'right' =
    legendPos && legendPos !== 'hidden'
      ? legendPos
      : isCircular
        ? 'right'
        : 'top';

  return {
    type: payload.chartType,
    data: {
      labels: [...payload.labels],
      datasets: buildChartDatasets(payload, palette),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: legendDisplay,
          position: resolvedLegendPosition,
          labels: {
            color: palette.textColor,
            boxWidth: 12,
            font: { size: 11 },
          },
        },
      },
      scales: buildChartScales(isCircular, palette, payload.showGridlines),
    },
  };
}

/**
 * Verifies if the current runtime environment supports HTML5 Canvas rendering.
 * SSR environments (Node.js) and headless test runners (Vitest/JSDOM) lack native
 * Canvas 2D context implementations and throw unhandled errors if Chart.js initializes.
 */
function isCanvasRenderingSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return false;
  }
  return true;
}

@Component({
  selector: 'rc-chart-canvas',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .rc-chart-canvas-container {
        position: relative;
        width: 100%;
        height: 240px;
      }
    `,
  ],
  template: `
    <div class="rc-chart-canvas-container">
      <canvas
        #chartCanvas
        role="img"
        [attr.aria-label]="ariaLabel()"
      ></canvas>
    </div>
  `,
})
export class ChartCanvasComponent {
  private readonly stateManager = inject(StateManagerService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  public readonly chartData = input<ChartCanvasPayload | null>(null);

  private readonly canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');

  private activeChartInstance: Chart | null = null;

  public readonly ariaLabel = computed<string>(() => {
    const payload = this.chartData();
    if (!payload) {
      return 'Analytical chart canvas';
    }
    return payload.title
      ? `${payload.title} (${payload.chartType} chart)`
      : `Analytical ${payload.chartType} chart`;
  });

  constructor() {
    effect(() => {
      const payload = this.chartData();
      const theme = this.stateManager?.theme() ?? 'light';
      const canvasRef = this.canvasElement();

      if (!canvasRef || !payload) {
        this.destroyActiveChart();
        return;
      }

      this.renderChartInstance(canvasRef.nativeElement, payload, theme);
    });

    this.destroyRef.onDestroy(() => {
      this.destroyActiveChart();
    });
  }

  private renderChartInstance(
    canvas: HTMLCanvasElement,
    payload: ChartCanvasPayload,
    theme: 'light' | 'dark',
  ): void {
    this.destroyActiveChart();

    if (!isCanvasRenderingSupported()) {
      return;
    }

    const renderingContext = canvas.getContext('2d');
    if (!renderingContext) {
      return;
    }

    const configuration = buildChartConfiguration(payload, theme);
    this.activeChartInstance = new Chart(renderingContext, configuration);
  }

  private destroyActiveChart(): void {
    if (this.activeChartInstance) {
      this.activeChartInstance.destroy();
      this.activeChartInstance = null;
    }
  }
}
