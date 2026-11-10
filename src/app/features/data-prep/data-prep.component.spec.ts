import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  DataPrepComponent,
  INITIAL_INGESTION_SOURCES,
  INITIAL_PREP_STEPS,
} from './data-prep.component';
import { StateManagerService } from '../../core/state-manager.service';

describe('DataPrepComponent', () => {
  beforeEach(() => {
    window.localStorage?.clear();
    TestBed.configureTestingModule({
      imports: [DataPrepComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        StateManagerService,
      ],
    });
  });

  it('instantiates the component with enterprise initial state', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeDefined();
    expect(component.sources().length).toBe(0);
    expect(component.appliedSteps().length).toBe(0);
    expect(component.selectedSource()).toBeNull();
  });

  it('toggles accordion sections and handles collapse all correctly', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isSectionExpanded('Steps')).toBe(true);
    expect(component.isSectionExpanded('Definition')).toBe(true);
    expect(component.isSectionExpanded('Quarantine')).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);

    component.toggleSection('Steps');
    expect(component.isSectionExpanded('Steps')).toBe(false);

    component.toggleSection('Steps');
    expect(component.isSectionExpanded('Steps')).toBe(true);

    component.toggleCollapseAll();
    expect(component.isSectionExpanded('Steps')).toBe(false);
    expect(component.isSectionExpanded('Definition')).toBe(false);
    expect(component.isSectionExpanded('Quarantine')).toBe(false);
    expect(component.isAllCollapsed()).toBe(true);

    component.toggleCollapseAll();
    expect(component.isSectionExpanded('Steps')).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);
  });

  it('updates selected source when onSelectSource is triggered', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadUserDataset('source_1.csv', 'CSV', 'id,val\n1,10');
    component.loadUserDataset('source_2.csv', 'CSV', 'id,val\n2,20');

    const targetSource = component.sources()[1];
    component.onSelectSource(targetSource);

    expect(component.selectedSourceId()).toBe(targetSource.id);
    expect(component.selectedSource()?.name).toBe(targetSource.name);
  });

  it('updates selected step and synchronizes JSON definition', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadUserDataset('source_1.csv', 'CSV', 'id,val\n1,10');
    component.changeColumnType('val', 'Float64');

    expect(component.appliedSteps().length).toBe(2);
    component.onSelectStep(1);

    expect(component.selectedStepIndex()).toBe(1);
    const activeStep = component.activeStep();
    expect(activeStep?.name).toContain('Change Type');

    const json = component.activeStepDefinitionJson();
    expect(json).toContain('ChangeType');
  });

  it('announces user actions to StateManagerService without alerts', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    const state = TestBed.inject(StateManagerService);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    component.onApplyAndLoad();
    expect(state.statusMessage()).toContain('R-Query');

    component.onRunIncrementalRefresh();
    expect(state.statusMessage()).toContain('Incremental refresh');
  });

  it('formats cell values cleanly according to column data types', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const row = {
      transaction_id: 'TX-1',
      net_amount: 1500.5,
      MarginRate: 0.854,
      missing_key: null,
    };

    expect(component.formatCellValue(row, 'missing_key')).toBe('—');
    expect(component.formatCellValue(row, 'transaction_id')).toBe('TX-1');
    expect(component.formatCellValue(row, 'MarginRate')).toBe('85.4%');
    expect(component.formatCellValue(row, 'net_amount')).toBe('€1,500.50');
  });

  it('executes R-Query transformations (Filter, Unpivot, Group By, Custom Column, Index, Shaping) and supports time-travel step preview', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadUserDataset(
      'sales_q1.csv',
      'CSV',
      'region,jan,feb\nNorth,100,150\nSouth,200,250\nNorth,50,50',
    );
    expect(component.rows().length).toBe(3);

    // 1. Unpivot jan & feb
    component.unpivotMode.set('selected');
    component.unpivotColumns.set(['jan', 'feb']);
    component.unpivotAttrName.set('Month');
    component.unpivotValName.set('Revenue');
    component.applyUnpivotStep();
    expect(component.rows().length).toBe(6);
    expect(component.columns().map((c) => c.name)).toEqual(['region', 'Month', 'Revenue']);

    // 2. Filter Revenue > 100
    component.filterColumn.set('Revenue');
    component.filterOperator.set('greaterThan');
    component.filterValue.set('100');
    component.applyFilterStep();
    expect(component.rows().length).toBe(3);

    // 3. Time-travel back to Step 0 (Source Ingestion) and forward to latest
    component.onSelectStep(0);
    expect(component.rows().length).toBe(3);
    expect(component.columns().map((c) => c.name)).toEqual(['region', 'jan', 'feb']);

    component.onSelectStep(2);
    expect(component.rows().length).toBe(3);

    // 4. Add Custom Column & Surrogate Index
    component.customColumnMode.set('expression');
    component.customColumnName.set('DoubleRev');
    component.customColumnExpression.set('[Revenue] * 2');
    component.applyCustomColumnStep();
    expect(component.rows()[0]['DoubleRev']).toBe(300);

    component.customColumnMode.set('index');
    component.customColumnName.set('RowKey');
    component.indexInitialValue.set(1);
    component.indexIncrement.set(1);
    component.applyCustomColumnStep();
    expect(component.rows()[0]['RowKey']).toBe(1);
    expect(component.rows()[1]['RowKey']).toBe(2);

    // 5. M-Query script generation check
    expect(component.activeMQueryScript()).toContain('Table.Unpivot');
    expect(component.activeMQueryScript()).toContain('Table.SelectRows');
    expect(component.activeMQueryScript()).toContain('Table.AddIndexColumn');
  });

  it('isolates non-coercible rows in quarantineStats and replaces redundant ChangeType steps on the same column', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadUserDataset('dirty.csv', 'CSV', 'id,amount\n1,100\n2,INVALID_NUM\n3,300');
    expect(component.rows().length).toBe(3);

    component.changeColumnType('amount', 'Int64');
    expect(component.rows().length).toBe(2);
    expect(component.quarantineStats().rowsQuarantined).toBe(1);
    expect(component.appliedSteps().length).toBe(2);

    // Changing type on the same column again replaces the existing ChangeType step instead of stacking
    component.changeColumnType('amount', 'Float64');
    expect(component.appliedSteps().length).toBe(2);
    expect(component.activeStep()?.detail).toContain('Float64');
  });

  it('supports Enable Load toggle for staging queries and step deletion', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    const state = TestBed.inject(StateManagerService);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.loadUserDataset('staging_lookup.csv', 'CSV', 'code,label\nA,Alpha\nB,Beta');
    const src = component.sources()[0];

    // Disable load on staging query
    component.toggleSourceEnableLoad(src.id);
    expect(component.selectedSource()?.enableLoad).toBe(false);
    expect(state.sharedTables.some((t) => t.name === 'staging_lookup')).toBe(false);

    // Apply & Load should keep staging query out of semantic model
    component.onApplyAndLoad();
    expect(state.sharedTables.some((t) => t.name === 'staging_lookup')).toBe(false);

    // Re-enable load and commit
    component.toggleSourceEnableLoad(src.id);
    component.onApplyAndLoad();
    expect(state.sharedTables.some((t) => t.name === 'staging_lookup')).toBe(true);

    // Step deletion restores prior state
    component.removeColumn('label');
    expect(component.columns().length).toBe(1);
    component.removeStep(1);
    expect(component.columns().length).toBe(2);
  });

  it('manages Get Data modal connectors, filtering by category and search term', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isGetDataModalOpen()).toBe(false);

    component.onAddSource();
    expect(component.isGetDataModalOpen()).toBe(true);

    component.onSelectConnectorCategory('file');
    expect(component.filteredConnectors().every((c) => c.category === 'file')).toBe(true);
    expect(component.filteredConnectors().some((c) => c.id === 'excel')).toBe(true);

    component.connectorSearchQuery.set('SQL');
    component.onSelectConnectorCategory('all');
    expect(component.filteredConnectors().some((c) => c.name.includes('SQL'))).toBe(true);

    component.onSelectConnector('sqlserver');
    expect(component.selectedConnectorId()).toBe('sqlserver');

    component.onCloseGetDataModal();
    expect(component.isGetDataModalOpen()).toBe(false);
  });

  it('opens pre-ingestion Navigator modal, previews raw unpromoted sheets, and generates standard 4-step Power Query pipeline', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isNavigatorModalOpen()).toBe(false);

    // Open Navigator for workbook/CSV
    component.openNavigatorForText(
      'Financial Sample.xlsx',
      'XLSX',
      'XLSX',
      'Segment,Country,Product\nGovernment,Canada,Carretera\nMidmarket,Germany,Carretera',
    );

    expect(component.isNavigatorModalOpen()).toBe(true);
    expect(component.navigatorSheets().length).toBeGreaterThanOrEqual(1);

    const sheet = component.selectedNavigatorSheet();
    expect(sheet).toBeDefined();
    // Navigator raw preview starts with Column1, Column2... and row 0 has header text
    expect(sheet?.columns[0].name).toBe('Column1');
    expect(sheet?.rows[0]['Column1']).toBe('Segment');

    // Confirm Navigator import
    component.confirmNavigatorAndLoad();
    expect(component.isNavigatorModalOpen()).toBe(false);

    // Assert 4-step Power Query chain
    const steps = component.appliedSteps();
    expect(steps.length).toBe(4);
    expect(steps[0].type).toBe('FileSource');
    expect(steps[1].type).toBe('Navigation');
    expect(steps[2].type).toBe('PromoteHeaders');
    expect(steps[3].type).toBe('DetectDataType');

    // Final state (Step 3: Changed Type) has promoted headers and coerced data rows
    expect(component.selectedStepIndex()).toBe(3);
    expect(component.columns().map((c) => c.name)).toEqual(['Segment', 'Country', 'Product']);
    expect(component.rows().length).toBe(2);
    expect(component.activeStepFormula()).toContain('Table.TransformColumnTypes');

    // Time-travel back to Step 1 (Navigation): unpromoted raw columns
    component.onSelectStep(1);
    expect(component.selectedStepIndex()).toBe(1);
    expect(component.columns().map((c) => c.name)).toEqual(['Column1', 'Column2', 'Column3']);
    expect(component.rows().length).toBe(3); // includes row 0 (Segment, Country...)
    expect(component.activeStepFormula()).toContain('Item="Sheet1",Kind="Sheet"');

    // Time-travel forward to Step 2 (Promoted Headers)
    component.onSelectStep(2);
    expect(component.selectedStepIndex()).toBe(2);
    expect(component.columns().map((c) => c.name)).toEqual(['Segment', 'Country', 'Product']);
    expect(component.rows().length).toBe(2);
    expect(component.activeStepFormula()).toContain('Table.PromoteHeaders');
  });
});
