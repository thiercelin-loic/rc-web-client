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
import { packZipArchive } from '../../core/zip-archive';

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

  it('manages global Import file-only connectors and toggle state', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.ingestion.importMenuOpen()).toBe(false);

    component.ingestion.toggleImportMenu();
    expect(component.ingestion.importMenuOpen()).toBe(true);

    expect(component.ingestion.fileConnectors.every((c) => c.category === 'file')).toBe(true);
    expect(component.ingestion.fileConnectors.map((c) => c.id)).toEqual([
      'excel',
      'csv',
      'json',
      'xml',
      'parquet',
    ]);

    component.ingestion.triggerFileConnector('json');
    expect(component.ingestion.selectedConnectorId()).toBe('json');
    expect(component.ingestion.importMenuOpen()).toBe(false);
  });

  it('opens pre-ingestion Navigator modal, previews raw unpromoted sheets, and generates standard 4-step Power Query pipeline', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.ingestion.isNavigatorModalOpen()).toBe(false);

    // Open Navigator for workbook/CSV
    component.ingestion.openNavigatorForText(
      'Financial Sample.xlsx',
      'XLSX',
      'XLSX',
      'Segment,Country,Product\nGovernment,Canada,Carretera\nMidmarket,Germany,Carretera',
    );

    expect(component.ingestion.isNavigatorModalOpen()).toBe(true);
    expect(component.ingestion.navigatorSheets().length).toBeGreaterThanOrEqual(1);

    const sheet = component.ingestion.selectedNavigatorSheet();
    expect(sheet).toBeDefined();
    // Navigator raw preview starts with Column1, Column2... and row 0 has header text
    expect(sheet?.columns[0].name).toBe('Column1');
    expect(sheet?.rows[0]['Column1']).toBe('Segment');

    // Confirm Navigator import and run reactive sync
    component.ingestion.confirmNavigatorAndLoad();
    fixture.detectChanges();
    expect(component.ingestion.isNavigatorModalOpen()).toBe(false);

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

  it('extracts real worksheet names, shared strings, and cell rows from an OpenXML .xlsx binary archive', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const encoder = new TextEncoder();

    const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Stats NBA" sheetId="1" r:id="rId1"/>
        </sheets>
      </workbook>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`;
    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
        <si><t>Joueur</t></si>
        <si><t>Saison</t></si>
        <si><t>Matchs Joués (GP)</t></si>
        <si><t>Minutes (MIN)</t></si>
        <si><t>Jimmy Butler</t></si>
        <si><t>2014-15</t></si>
      </sst>`;
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="B1" t="s"><v>1</v></c>
            <c r="C1" t="s"><v>2</v></c>
            <c r="D1" t="s"><v>3</v></c>
          </row>
          <row r="2">
            <c r="A2" t="s"><v>4</v></c>
            <c r="B2" t="s"><v>5</v></c>
            <c r="C2"><v>60</v></c>
            <c r="D2"><v>18.6</v></c>
          </row>
        </sheetData>
      </worksheet>`;

    const xlsxBytes = packZipArchive([
      { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(relsXml) },
      { name: 'xl/sharedStrings.xml', data: encoder.encode(sharedStringsXml) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet1Xml) },
    ]);

    component.ingestion.openNavigatorForBinary(
      'Performances_NBA_10_Saisons.xlsx',
      'XLSX',
      'XLSX',
      xlsxBytes.buffer as ArrayBuffer,
      '',
    );

    const sheets = component.ingestion.navigatorSheets();
    expect(sheets.map((s) => s.name)).toEqual(['Stats NBA']);
    expect(sheets[0].rows[0]).toEqual({
      Column1: 'Joueur',
      Column2: 'Saison',
      Column3: 'Matchs Joués (GP)',
      Column4: 'Minutes (MIN)',
    });
    expect(sheets[0].rows[1]).toEqual({
      Column1: 'Jimmy Butler',
      Column2: '2014-15',
      Column3: 60,
      Column4: 18.6,
    });

    component.ingestion.confirmNavigatorAndLoad('transform');
    fixture.detectChanges();

    expect(component.columns().map((c) => c.name)).toEqual([
      'Joueur',
      'Saison',
      'Matchs Joués (GP)',
      'Minutes (MIN)',
    ]);
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0]).toEqual({
      Joueur: 'Jimmy Butler',
      Saison: '2014-15',
      'Matchs Joués (GP)': 60,
      'Minutes (MIN)': 18.6,
    });
  });

  it('unnests structured JSON documents in Navigator instead of parsing syntax lines as CSV', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const sampleJson = JSON.stringify(
      [
        {
          joueur: 'Gianluigi Donnarumma',
          position: 'Gardien',
          statistiques_par_saison: [
            {
              saison: '2014-15',
              matchs_joues: 35,
              minutes_jouees: 1803,
              buts_encaisses: 32,
            },
            {
              saison: '2015-16',
              matchs_joues: 30,
              minutes_jouees: 2700,
              buts_encaisses: 29,
            },
          ],
        },
      ],
      null,
      2,
    );

    component.ingestion.openNavigatorForText(
      'Performances_Ligue1_10_Saisons.json',
      'REST',
      'JSON',
      sampleJson,
    );

    const sheets = component.ingestion.navigatorSheets();
    expect(sheets.map((s) => s.name)).toEqual(['Performances_Ligue1_10_Saisons']);
    expect(sheets[0].columns.map((c) => c.name)).toEqual([
      'Column1',
      'Column2',
      'Column3',
      'Column4',
      'Column5',
      'Column6',
    ]);
    expect(sheets[0].rows[0]).toEqual({
      Column1: 'joueur',
      Column2: 'position',
      Column3: 'saison',
      Column4: 'matchs_joues',
      Column5: 'minutes_jouees',
      Column6: 'buts_encaisses',
    });

    component.ingestion.confirmNavigatorAndLoad('transform');
    fixture.detectChanges();

    expect(component.columns().map((c) => `${c.name}:${c.type}`)).toEqual([
      'joueur:String',
      'position:String',
      'saison:String',
      'matchs_joues:Int64',
      'minutes_jouees:Int64',
      'buts_encaisses:Int64',
    ]);
    expect(component.rows().length).toBe(2);
    expect(component.rows()[0]).toEqual({
      joueur: 'Gianluigi Donnarumma',
      position: 'Gardien',
      saison: '2014-15',
      matchs_joues: 35,
      minutes_jouees: 1803,
      buts_encaisses: 32,
    });
  });

  it('mounts all transformation and apply actions in a single right-aligned workspace toolbar', async () => {
    const fixture = TestBed.createComponent(DataPrepComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const header = el.querySelector('.rc-page-header.rc-workspace-header');
    expect(header).toBeTruthy();
    expect(el.querySelector('.rc-rquery-ribbon')).toBeNull();

    const expectedIds = [
      '#data-prep-filter-btn',
      '#data-prep-change-type-btn',
      '#data-prep-unpivot-btn',
      '#data-prep-groupby-btn',
      '#data-prep-custom-column-btn',
      '#data-prep-merge-queries-btn',
      '#data-prep-shaping-btn',
      '#data-prep-range-params-btn',
      '#data-prep-refresh-btn',
      '#data-prep-apply-close-btn',
    ];
    for (const id of expectedIds) {
      expect(header?.querySelector(id)).toBeTruthy();
    }
  });
});
