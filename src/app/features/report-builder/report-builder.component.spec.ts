import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { ReportBuilderComponent } from './report-builder.component';
import { StateManagerService } from '../../core/state-manager.service';

describe('ReportBuilderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReportBuilderComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('instantiates the component', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeDefined();
  });

  it('renders standardized top-left workspace header title and description matching Model View', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const workspaceHeader = fixture.nativeElement.querySelector(
      '.rc-canvas-container > .rc-page-header.rc-workspace-header',
    ) as HTMLElement;
    expect(workspaceHeader).toBeTruthy();

    const titleEl = workspaceHeader.querySelector('h1');
    const descriptionEl = workspaceHeader.querySelector('p');
    expect(titleEl?.textContent?.trim()).toBe('Report Builder');
    expect(descriptionEl?.textContent?.trim()).toBe(
      'Interactive report canvas and visual page layouts.',
    );

    // Ensure single semantic h1 on page
    const allH1 = fixture.nativeElement.querySelectorAll('h1');
    expect(allH1.length).toBe(1);
  });

  it('adds and removes visuals on the canvas', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.userVisuals()).toHaveLength(0);

    component.addVisual('Bar');
    expect(component.userVisuals()).toHaveLength(1);
    expect(component.userVisuals()[0].title).toBe('Visual 1 - Bar');
    expect(component.userVisuals()[0].width).toBe('half');

    component.toggleVisualWidth(component.userVisuals()[0].id);
    expect(component.userVisuals()[0].width).toBe('full');

    component.removeVisual(component.userVisuals()[0].id);
    expect(component.userVisuals()).toHaveLength(0);
  });

  it('does not query the backend for an unconfigured visual with local table data', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const state = TestBed.inject(StateManagerService);
    state.syncTables([
      {
        id: 'fact-transactions',
        name: 'fact_transactions',
        role: 'FACT',
        columns: [{ name: 'category', dataType: 'VARCHAR', keyType: 'None' }],
        rowCount: 1,
      },
    ]);
    state.setTableRows('fact_transactions', [{ category: 'Alpha' }]);

    const component = fixture.componentInstance;
    component.addVisual('Matrix');
    await fixture.whenStable();

    expect(component.userVisuals()[0].fieldWells).toEqual({});
    TestBed.inject(HttpTestingController).expectNone(
      (request) => request.url.includes('/api/reports/'),
    );
  });

  it('manages visual movability, reordering, and contextual menu state', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addVisual('Bar');
    component.addVisual('Line');
    component.addVisual('Gauge');

    expect(component.userVisuals()).toHaveLength(3);
    const [vis1, vis2, vis3] = component.userVisuals();

    // Check first and last boundary helper methods
    expect(component.isFirstVisual(vis1.id)).toBe(true);
    expect(component.isFirstVisual(vis2.id)).toBe(false);
    expect(component.isLastVisual(vis3.id)).toBe(true);
    expect(component.isLastVisual(vis2.id)).toBe(false);

    // Select visual
    component.selectVisual(vis2.id);
    expect(component.selectedVisualId()).toBe(vis2.id);
    expect(component.selectedVisual()?.title).toBe(vis2.title);

    // Toggle contextual menu
    expect(component.activeVisualMenuId()).toBeNull();
    component.toggleVisualMenu(vis2.id);
    expect(component.activeVisualMenuId()).toBe(vis2.id);
    component.closeVisualMenu();
    expect(component.activeVisualMenuId()).toBeNull();

    // Move visual earlier
    component.moveVisualEarlier(vis2.id);
    expect(component.userVisuals().map((v) => v.id)).toEqual([
      vis2.id,
      vis1.id,
      vis3.id,
    ]);

    // Move visual later
    component.moveVisualLater(vis2.id);
    expect(component.userVisuals().map((v) => v.id)).toEqual([
      vis1.id,
      vis2.id,
      vis3.id,
    ]);

    // Drop visual reorder
    component.onDropVisual({
      previousIndex: 0,
      currentIndex: 2,
    } as any);
    expect(component.userVisuals().map((v) => v.id)).toEqual([
      vis2.id,
      vis3.id,
      vis1.id,
    ]);
  });

  it('renders tools tabs matching app tab style and switches active tab', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.activeStudioTab()).toBe('Visualizations');

    const tabButtons = fixture.nativeElement.querySelectorAll('.rc-page-tab') as NodeListOf<HTMLButtonElement>;
    expect(tabButtons.length).toBe(4);

    const activeTab = fixture.nativeElement.querySelector('.rc-page-tab-group.active') as HTMLElement;
    expect(activeTab).toBeTruthy();

    tabButtons[1].click();
    fixture.detectChanges();
    expect(component.activeStudioTab()).toBe('Filters');

    tabButtons[2].click();
    fixture.detectChanges();
    expect(component.activeStudioTab()).toBe('Data Fields');

    tabButtons[3].click();
    fixture.detectChanges();
    expect(component.activeStudioTab()).toBe('Format');
  });

  it('manages collapsible accordion sections in tools dock', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isSectionExpanded('Visualizations')).toBe(true);
    expect(component.isSectionExpanded('Filters')).toBe(false);

    // Toggle Filters section open
    component.toggleSection('Filters');
    expect(component.isSectionExpanded('Filters')).toBe(true);
    expect(component.activeToolsTab()).toBe('Filters');

    // Collapse All
    component.toggleCollapseAll();
    expect(component.isAllCollapsed()).toBe(true);
    expect(component.isSectionExpanded('Visualizations')).toBe(false);
    expect(component.isSectionExpanded('Filters')).toBe(false);

    // Expand All
    component.toggleCollapseAll();
    expect(component.isAllCollapsed()).toBe(false);
    expect(component.isSectionExpanded('Visualizations')).toBe(true);
    expect(component.isSectionExpanded('Filters')).toBe(true);
  });

  it('manages filter and slicer lifecycle from canvas controls', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.isFilterDropdownOpen()).toBe(false);

    // Toggle dropdown open
    component.toggleFilterDropdown();
    expect(component.isFilterDropdownOpen()).toBe(true);
    component.closeFilterDropdown();
    expect(component.isFilterDropdownOpen()).toBe(false);

    // Apply filter via custom dimension input (domain-neutral, zero mock data)
    component.customDimensionInput.set('status');
    component.selectedFilterOperator.set('EQ');
    component.filterValueInput.set('active');
    expect(component.canApplyFilter()).toBe(true);
    component.applyCustomFilter();

    expect(component.hasActiveFilters()).toBe(true);
    expect(component.activeFilterList()).toHaveLength(1);
    expect(component.activeFilterList()[0].dimension).toBe('status');
    expect(component.activeFilterList()[0].values).toEqual(['active']);

    // Apply another filter with IN operator
    component.customDimensionInput.set('category');
    component.selectedFilterOperator.set('IN');
    component.filterValueInput.set('alpha, beta');
    expect(component.canApplyFilter()).toBe(true);
    component.applyCustomFilter();

    expect(component.activeFilterList()).toHaveLength(2);

    // Remove single filter
    component.removeActiveFilter('status');
    expect(component.activeFilterList()).toHaveLength(1);
    expect(component.activeFilterList()[0].dimension).toBe('category');

    // Reset all filters
    component.resetActiveFilters();
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.activeFilterList()).toHaveLength(0);
  });

  it('switches to Filters tab in Tools sidebar and manipulates filters', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.switchToolsTab('Filters');
    fixture.detectChanges();
    expect(component.activeToolsTab()).toBe('Filters');

    // Apply filter from Filters tools panel using domain-neutral fields
    component.customDimensionInput.set('priority');
    component.selectedFilterOperator.set('EQ');
    component.filterValueInput.set('high');
    component.applyCustomFilter();
    fixture.detectChanges();

    expect(component.hasActiveFilters()).toBe(true);
    expect(component.activeFilterList()).toHaveLength(1);
    expect(component.activeFilterList()[0].dimension).toBe('priority');

    // Verify tools section headers maintain clean typography without redundant badges (per purging-redundant-interface-badges.md)
    const sectionBadges = fixture.nativeElement.querySelectorAll(
      '.rc-tools-section-header .badge',
    );
    expect(sectionBadges.length).toBe(0);
  });

  it('provides archetype-aware field wells with zero demonstrative data in initial state', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    // Verify initial state is completely empty of demonstrative data
    expect(component.hasAssignedWells()).toBe(false);
    expect(component.getSlotFields('values')).toHaveLength(0);

    // Verify default Bar archetype provides correct BI slots
    expect(component.selectedArchetype()).toBe('Bar');
    const barSlots = component.activeArchetypeSlots();
    expect(barSlots.map((slot) => slot.id)).toEqual(['values', 'category', 'breakdown']);

    // Switch archetype to Gauge and verify slots adapt reactively
    component.selectedArchetype.set('Gauge');
    fixture.detectChanges();
    const gaugeSlots = component.activeArchetypeSlots();
    expect(gaugeSlots.map((slot) => slot.id)).toEqual(['values', 'target', 'min', 'max']);

    // Assign real field to values slot
    component.assignFieldToSlot('values', 'total_revenue');
    expect(component.hasAssignedWells()).toBe(true);
    expect(component.getSlotFields('values')).toEqual(['total_revenue']);

    // Remove field
    component.removeFieldFromSlot('values', 'total_revenue');
    expect(component.hasAssignedWells()).toBe(false);
    expect(component.getSlotFields('values')).toHaveLength(0);

    // Test clear all
    component.assignFieldToSlot('values', 'metric_a');
    component.assignFieldToSlot('target', 'metric_b');
    expect(component.hasAssignedWells()).toBe(true);
    component.clearAllFieldWells();
    expect(component.hasAssignedWells()).toBe(false);
  });

  it('manages Power BI canvas presets and dimensions reactively', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    // Default preset is 16:9 HD (1280 × 720)
    expect(component.selectedCanvasPreset()).toBe('16:9');
    expect(component.activeCanvasDimensions()).toEqual({ width: 1280, height: 720 });

    // Verify presets list matches Power BI standard
    const presetIds = component.canvasPresets.map((preset) => preset.id);
    expect(presetIds).toEqual(['16:9', '4:3', 'Letter', 'Tooltip', 'Custom']);

    // Switch to 4:3
    component.setCanvasPreset('4:3');
    expect(component.selectedCanvasPreset()).toBe('4:3');
    expect(component.activeCanvasDimensions()).toEqual({ width: 960, height: 720 });

    // Switch to Letter (816 × 1056 Portrait)
    component.setCanvasPreset('Letter');
    expect(component.selectedCanvasPreset()).toBe('Letter');
    expect(component.activeCanvasDimensions()).toEqual({ width: 816, height: 1056 });

    // Switch to Tooltip (320 × 240)
    component.setCanvasPreset('Tooltip');
    expect(component.selectedCanvasPreset()).toBe('Tooltip');
    expect(component.activeCanvasDimensions()).toEqual({ width: 320, height: 240 });

    // Switch to Custom and set user-defined dimensions
    component.setCanvasPreset('Custom');
    component.updateCustomCanvasWidth(1440);
    component.updateCustomCanvasHeight(900);
    expect(component.activeCanvasDimensions()).toEqual({ width: 1440, height: 900 });

    // Test Full HD tip shortcut
    component.setCanvasPreset('16:9');
    component.applyFullHdCustomTip();
    expect(component.selectedCanvasPreset()).toBe('Custom');
    expect(component.customCanvasWidth()).toBe(1920);
    expect(component.customCanvasHeight()).toBe(1080);
    expect(component.activeCanvasDimensions()).toEqual({ width: 1920, height: 1080 });

    // Verify DOM sheet reflects activeCanvasDimensions
    fixture.detectChanges();
    const sheet = fixture.nativeElement.querySelector('.rc-report-page-sheet') as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(sheet.style.maxWidth).toBe('1920px');
    expect(sheet.style.minHeight).toBe('1080px');
  });

  it('manages color theme customization and updates chart payloads reactively', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    // Default palette is neutral
    expect(component.selectedPalette()).toBe('neutral');

    const sampleVisual = {
      id: 'vis-1',
      title: 'Sales Overview',
      archetype: 'Bar',
      width: 'half' as const,
      metricLabel: 'Gross Sales',
      metricValue: '€100K',
      metricSubtext: '1,000 units',
    };

    // Default neutral palette on light theme yields #000000
    const lightPayload = component.getVisualChartData(sampleVisual);
    expect(lightPayload.datasets[0].borderColor).toBe('#000000');

    // Switch to amber
    component.setPalette('amber');
    expect(component.selectedPalette()).toBe('amber');
    expect(component.activePaletteColor()).toBe('#FF981A');
    const amberPayload = component.getVisualChartData(sampleVisual);
    expect(amberPayload.datasets[0].borderColor).toBe('#FF981A');

    // Switch to cobalt blue
    component.setPalette('blue');
    expect(component.activePaletteColor()).toBe('#2563EB');
    const bluePayload = component.getVisualChartData(sampleVisual);
    expect(bluePayload.datasets[0].borderColor).toBe('#2563EB');

    // Switch to custom color
    component.setPalette('custom');
    component.setCustomColor('#7C3AED');
    expect(component.activePaletteColor()).toBe('#7C3AED');
    const customPayload = component.getVisualChartData(sampleVisual);
    expect(customPayload.datasets[0].borderColor).toBe('#7C3AED');
  });

  it('does not render auto-assign button or mention in empty visual cards', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addVisual('Bar');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).not.toContain('Auto-assign');
    expect((component as any).bindDefaultFieldsForVisual).toBeUndefined();
  });

  it('wires Format section controls (Visual Title, Gridlines, Callouts, Legend Position) to chart payloads', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.addVisual('Line');
    const visual = component.userVisuals()[0];

    expect(component.showVisualTitle()).toBe(true);
    expect(component.showGridlines()).toBe(true);
    expect(component.highlightCallouts()).toBe(true);
    expect(component.legendPosition()).toBe('top');

    component.setShowVisualTitle(false);
    component.setShowGridlines(false);
    component.setHighlightCallouts(false);
    component.setLegendPosition('bottom');
    fixture.detectChanges();

    const payload = component.getVisualChartData(visual);
    expect(payload.showTitle).toBe(false);
    expect(payload.showGridlines).toBe(false);
    expect(payload.highlightCallouts).toBe(false);
    expect(payload.legendPosition).toBe('bottom');
  });

  it('evaluates live dataset rows bound via Field Wells and filters with EQ, NEQ, IN, and BETWEEN Page Filters', async () => {
    const fixture = TestBed.createComponent(ReportBuilderComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const state = component.state;

    state.syncTables([
      {
        id: 'user_tbl_orders',
        name: 'orders',
        role: 'FACT',
        columns: [
          { name: 'region', dataType: 'VARCHAR' },
          { name: 'amount', dataType: 'DOUBLE', summarizeBy: 'Sum' },
        ],
      },
    ]);
    state.setTableRows('orders', [
      { region: 'EU', amount: 250 },
      { region: 'EU', amount: 150 },
      { region: 'US', amount: 600 },
      { region: 'APAC', amount: 90 },
    ]);

    component.addVisual('Bar');
    const barVisual = component.userVisuals()[0];
    component.assignFieldToSlot('category', 'orders.region');
    component.assignFieldToSlot('values', 'orders.amount');
    fixture.detectChanges();

    // Unfiltered aggregation across 3 regions
    const initialChart = component.getVisualChartData(barVisual);
    expect(initialChart.labels).toEqual(['EU', 'US', 'APAC']);
    expect(initialChart.datasets[0].data).toEqual([400, 600, 90]);

    // EQ filter
    state.applyFilter('orders.region', 'EQ', ['EU']);
    const eqChart = component.getVisualChartData(barVisual);
    expect(eqChart.labels).toEqual(['EU']);
    expect(eqChart.datasets[0].data).toEqual([400]);

    // NEQ filter
    state.resetFilters();
    state.applyFilter('orders.region', 'NEQ', ['US']);
    const neqChart = component.getVisualChartData(barVisual);
    expect(neqChart.labels).toEqual(['EU', 'APAC']);
    expect(neqChart.datasets[0].data).toEqual([400, 90]);

    // IN filter via custom filter form
    state.resetFilters();
    component.selectedFilterDimension.set('orders.region');
    component.selectedFilterOperator.set('IN');
    component.filterValueInput.set('EU, US');
    component.applyCustomFilter();
    const inChart = component.getVisualChartData(barVisual);
    expect(inChart.labels).toEqual(['EU', 'US']);
    expect(inChart.datasets[0].data).toEqual([400, 600]);

    // BETWEEN filter via custom filter form
    state.resetFilters();
    component.selectedFilterDimension.set('orders.amount');
    component.selectedFilterOperator.set('BETWEEN');
    component.filterValueInput.set('100, 300');
    component.applyCustomFilter();
    const betweenChart = component.getVisualChartData(barVisual);
    expect(betweenChart.labels).toEqual(['EU']);
    expect(betweenChart.datasets[0].data).toEqual([400]);
  });
});
