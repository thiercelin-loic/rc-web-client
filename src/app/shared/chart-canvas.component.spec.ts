import { ComponentRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  ChartCanvasComponent,
  ChartCanvasPayload,
  buildChartConfiguration,
  isCircularChartType,
  resolveChartThemePalette,
} from './chart-canvas.component';

describe('ChartCanvasComponent', () => {
  let component: ChartCanvasComponent;
  let componentRef: ComponentRef<ChartCanvasComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ChartCanvasComponent],
      providers: [provideZonelessChangeDetection()],
    });

    const fixture = TestBed.createComponent(ChartCanvasComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
  });

  describe('Accessibility & Signal Computations', () => {
    it('initializes with fallback accessibility label when chartData is null', () => {
      expect(component.ariaLabel()).toBe('Analytical chart canvas');
    });

    it('computes contextual aria-label when chartData includes a title', () => {
      const payload: ChartCanvasPayload = {
        title: 'Monthly Revenue',
        chartType: 'bar',
        labels: ['Jan', 'Feb'],
        datasets: [{ label: 'Sales', data: [100, 200] }],
      };

      componentRef.setInput('chartData', payload);
      expect(component.ariaLabel()).toBe('Monthly Revenue (bar chart)');
    });

    it('computes generic descriptive aria-label when chartData title is omitted', () => {
      const payload: ChartCanvasPayload = {
        chartType: 'line',
        labels: ['Q1', 'Q2'],
        datasets: [{ label: 'Growth', data: [10, 25] }],
      };

      componentRef.setInput('chartData', payload);
      expect(component.ariaLabel()).toBe('Analytical line chart');
    });
  });

  describe('Pure Utilities & Chart Configuration Builder', () => {
    it('resolves theme palette colors accurately for light and dark modes', () => {
      const lightPalette = resolveChartThemePalette('light');
      expect(lightPalette.textColor).toBe('#000000');
      expect(lightPalette.neutralColor).toBe('#000000');
      expect(lightPalette.gridColor).toBe('rgba(15, 23, 42, 0.08)');

      const darkPalette = resolveChartThemePalette('dark');
      expect(darkPalette.textColor).toBe('#FFFFFF');
      expect(darkPalette.neutralColor).toBe('#FFFFFF');
      expect(darkPalette.gridColor).toBe('rgba(255, 255, 255, 0.08)');
    });

    it('identifies circular chart types accurately', () => {
      expect(isCircularChartType('doughnut')).toBe(true);
      expect(isCircularChartType('pie')).toBe(true);
      expect(isCircularChartType('bar')).toBe(false);
      expect(isCircularChartType('line')).toBe(false);
      expect(isCircularChartType('radar')).toBe(false);
    });

    it('builds cartesian chart configuration with axes and dataset fallbacks for bar/line charts', () => {
      const payload: ChartCanvasPayload = {
        chartType: 'line',
        labels: ['W1', 'W2'],
        datasets: [
          {
            label: 'Visitors',
            data: [500, 800],
            backgroundColor: '#FF981A',
          },
        ],
      };

      const config = buildChartConfiguration(payload, 'light');

      expect(config.type).toBe('line');
      expect(config.data.labels).toEqual(['W1', 'W2']);
      expect(config.data.datasets).toHaveLength(1);
      const firstDataset = config.data.datasets[0] as { borderWidth?: number; tension?: number };
      expect(firstDataset.borderWidth).toBe(2);
      expect(firstDataset.tension).toBe(0.35);
      expect(config.options?.scales?.['x']).toBeDefined();
      expect(config.options?.scales?.['y']).toBeDefined();
      expect(config.options?.plugins?.legend?.position).toBe('top');
    });

    it('omits cartesian scales and places legend on the right for circular charts', () => {
      const payload: ChartCanvasPayload = {
        chartType: 'doughnut',
        labels: ['Direct', 'Referral'],
        datasets: [
          {
            label: 'Traffic Source',
            data: [65, 35],
          },
        ],
      };

      const config = buildChartConfiguration(payload, 'dark');

      expect(config.type).toBe('doughnut');
      expect(config.options?.scales).toBeUndefined();
      expect(config.options?.plugins?.legend?.position).toBe('right');
      expect(config.options?.plugins?.legend?.labels?.color).toBe('#FFFFFF');
    });

    it('applies legendPosition, showGridlines, and highlightCallouts formatting options', () => {
      const payload: ChartCanvasPayload = {
        chartType: 'line',
        labels: ['Q1', 'Q2', 'Q3'],
        datasets: [{ label: 'Revenue', data: [120, 480, 260] }],
        showGridlines: false,
        highlightCallouts: true,
        legendPosition: 'hidden',
      };

      const config = buildChartConfiguration(payload, 'light');
      expect(config.options?.plugins?.legend?.display).toBe(false);
      expect((config.options?.scales?.['x'] as { grid?: { display?: boolean } })?.grid?.display).toBe(false);
      expect((config.options?.scales?.['y'] as { grid?: { display?: boolean } })?.grid?.display).toBe(false);
      const ds = config.data.datasets[0] as { pointRadius?: number[] };
      expect(ds.pointRadius).toEqual([3, 6, 3]);
    });
  });
});
