import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ModelViewComponent,
  layoutStarSchemaTables,
} from './model-view.component';

describe('ModelViewComponent', () => {
  beforeEach(() => {
    window.localStorage?.clear();
    TestBed.configureTestingModule({
      imports: [ModelViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('instantiates the component with an empty model until user tables are provided', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeDefined();
    expect(fixture.componentInstance.tables().length).toBe(0);
    expect(fixture.componentInstance.relationships().length).toBe(0);
  });

  it('toggles accordion sections and collapse all', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isSectionExpanded('Inspector')).toBe(true);
    expect(component.isSectionExpanded('Properties')).toBe(true);

    component.toggleSection('Inspector');
    expect(component.isSectionExpanded('Inspector')).toBe(false);
    expect(component.isSectionExpanded('Properties')).toBe(false);

    component.toggleSection('Properties');
    expect(component.isSectionExpanded('Inspector')).toBe(true);
    expect(component.isSectionExpanded('Properties')).toBe(true);

    component.toggleCollapseAll();
    expect(component.isSectionExpanded('Inspector')).toBe(false);
    expect(component.isSectionExpanded('Properties')).toBe(false);
    expect(component.isSectionExpanded('Entities')).toBe(false);
    expect(component.isSectionExpanded('Definition')).toBe(false);
    expect(component.isAllCollapsed()).toBe(true);

    component.toggleCollapseAll();
    expect(component.isSectionExpanded('Inspector')).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);
  });

  it('toggles entity expansion in datasets tree', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isEntityExpanded('dim_calendar')).toBe(false);

    component.toggleEntityExpanded('dim_calendar');
    expect(component.isEntityExpanded('dim_calendar')).toBe(true);
  });

  it('selects table and updates active table and relationship', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.tables.set(
      layoutStarSchemaTables([
        {
          name: 'fact_transactions',
          role: 'FACT',
          columns: [{ name: 'date_id', dataType: 'Int32', isForeignKey: true }],
        },
        {
          name: 'dim_calendar',
          role: 'DIMENSION',
          columns: [{ name: 'date_id', dataType: 'Int32', isPrimaryKey: true }],
        },
      ]),
    );
    component.relationships.set([
      {
        name: 'transactions_to_calendar',
        fromTable: 'fact_transactions',
        fromCol: 'date_id',
        toTable: 'dim_calendar',
        toCol: 'date_id',
        cardinality: 'ManyToOne',
        crossFilter: 'Single',
        isActive: true,
      },
    ]);

    component.onSelectTable('dim_calendar');
    expect(component.selectedTable()).toBe('dim_calendar');
    expect(component.activeTable()?.name).toBe('dim_calendar');
    expect(component.selectedRel().name).toBe('transactions_to_calendar');
  });

  it('updates relationship cardinality and cross-filter semantics', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.updateCardinality('OneToOne');
    expect(component.selectedRel().cardinality).toBe('OneToOne');
    expect(component.activeRsdl()).toContain('cardinality: OneToOne');

    component.updateCrossFilter('Both');
    expect(component.selectedRel().crossFilter).toBe('Both');
    expect(component.activeRsdl()).toContain('crossFilter: Both');

    component.toggleRelActive();
    expect(component.selectedRel().isActive).toBe(false);
    expect(component.activeRsdl()).toContain('isActive: false');
  });

  it('toggles mobile navigation tabs', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.activeMobileTab()).toBe('model');

    component.activeMobileTab.set('properties');
    expect(component.activeMobileTab()).toBe('properties');
  });

  it('validates DAG consistency', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onValidateDag();
    expect(component.state.liveAnnouncement()).toContain('DAG Validation');
  });

  it('positions 5+ star-schema tables dynamically without coordinate overlap and renders SVG links', async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.renderedRelationships().length).toBe(
      component.relationships().length,
    );

    const fiveTables = layoutStarSchemaTables([
      {
        name: 'fact_operations',
        role: 'FACT',
        columns: [{ name: 'id', dataType: 'Int64', isPrimaryKey: true }],
      },
      {
        name: 'dim_calendar',
        role: 'DIMENSION',
        columns: [{ name: 'date_id', dataType: 'Int32', isPrimaryKey: true }],
      },
      {
        name: 'dim_entity',
        role: 'DIMENSION',
        columns: [{ name: 'entity_id', dataType: 'Int32', isPrimaryKey: true }],
      },
      {
        name: 'dim_item',
        role: 'DIMENSION',
        columns: [{ name: 'item_id', dataType: 'Int32', isPrimaryKey: true }],
      },
      {
        name: 'dim_region',
        role: 'DIMENSION',
        columns: [{ name: 'region_id', dataType: 'Int32', isPrimaryKey: true }],
      },
    ]);

    const coordKeys = fiveTables.map(
      (tbl) => `${tbl.position.x}:${tbl.position.y}`,
    );
    expect(new Set(coordKeys).size).toBe(5);

    const sectionBadges = fixture.nativeElement.querySelectorAll(
      '.rc-tools-section-header .badge',
    );
    expect(sectionBadges.length).toBe(0);
  });
});
