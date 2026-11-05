import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DagDiagnosticMarker,
  SemanticModelApiPayload,
  SemanticModelService,
} from '../../core/semantic-model.service';
import { StateManagerService } from '../../core/state-manager.service';

export interface ModelColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey?: boolean;
  readonly isForeignKey?: boolean;
  readonly isHidden?: boolean;
  readonly description?: string;
  readonly displayFolder?: string;
  readonly summarizeBy?: string;
}

export interface ModelTable {
  readonly name: string;
  readonly role: 'FACT' | 'DIMENSION';
  readonly position: { x: number; y: number };
  readonly columns: readonly ModelColumn[];
  readonly isHidden?: boolean;
  readonly isDateTable?: boolean;
  readonly dateColumn?: string;
  readonly description?: string;
}

export interface ModelRelationship {
  readonly name: string;
  readonly fromTable: string;
  readonly fromCol: string;
  readonly toTable: string;
  readonly toCol: string;
  readonly cardinality: string;
  readonly crossFilter: string;
  readonly isActive?: boolean;
  readonly bridgeTable?: string;
  readonly description?: string;
}

export interface RenderedRelationship {
  readonly rel: ModelRelationship;
  readonly pathD: string;
  readonly labelText: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly isBiDirectional: boolean;
}

export type ModelSection = 'Inspector' | 'Properties' | 'Entities' | 'Definition';
export type ModelLayoutMode = 'kimball' | 'collie';

const TABLE_CARD_WIDTH = 220;
const TABLE_HEADER_HEIGHT = 38;
const TABLE_ROW_HEIGHT = 22;

function estimateTableCardHeight(columnCount: number): number {
  return TABLE_HEADER_HEIGHT + Math.max(columnCount, 1) * TABLE_ROW_HEIGHT + 16;
}

export function layoutStarSchemaTables(
  rawTables: ReadonlyArray<{
    readonly name: string;
    readonly role: 'FACT' | 'DIMENSION';
    readonly columns: readonly ModelColumn[];
    readonly isHidden?: boolean;
    readonly isDateTable?: boolean;
    readonly dateColumn?: string;
    readonly description?: string;
  }>,
  mode: ModelLayoutMode = 'kimball',
): ModelTable[] {
  if (rawTables.length === 0) {
    return [];
  }

  const factTables = rawTables.filter((tbl) => tbl.role === 'FACT');
  const hasExplicitFacts = factTables.length > 0;
  const centerHubTables = hasExplicitFacts ? factTables : [rawTables[0]];
  const centerNames = new Set(centerHubTables.map((tbl) => tbl.name));
  const peripheralTables = rawTables.filter((tbl) => !centerNames.has(tbl.name));

  const positionMap = new Map<string, { x: number; y: number }>();

  if (mode === 'collie') {
    // Collie vertical filter-flow layout: Dimension tables on top, Fact tables below
    let topX = 48;
    let maxTopBottom = 36;
    const topTables = peripheralTables.length > 0 ? peripheralTables : centerHubTables;
    for (const tbl of topTables) {
      positionMap.set(tbl.name, { x: topX, y: 36 });
      const cardBottom = 36 + estimateTableCardHeight(tbl.columns.length);
      if (cardBottom > maxTopBottom) {
        maxTopBottom = cardBottom;
      }
      topX += TABLE_CARD_WIDTH + 36;
    }

    if (peripheralTables.length > 0) {
      const totalFactWidth =
        centerHubTables.length * TABLE_CARD_WIDTH +
        Math.max(0, centerHubTables.length - 1) * 48;
      const totalDimSpan = Math.max(topX - 36, TABLE_CARD_WIDTH + 96);
      let factX = Math.max(48, Math.round((totalDimSpan - totalFactWidth) / 2));
      const factY = maxTopBottom + 72;
      for (const tbl of centerHubTables) {
        positionMap.set(tbl.name, { x: factX, y: factY });
        factX += TABLE_CARD_WIDTH + 48;
      }
    }
  } else {
    // Kimball central star layout: Fact tables in the center, Dimensions on left & right wings
    const leftWing = peripheralTables.filter((_, idx) => idx % 2 === 0);
    const rightWing = peripheralTables.filter((_, idx) => idx % 2 === 1);

    let leftY = 36;
    for (const tbl of leftWing) {
      positionMap.set(tbl.name, { x: 56, y: leftY });
      leftY += estimateTableCardHeight(tbl.columns.length) + 28;
    }

    let rightY = 36;
    for (const tbl of rightWing) {
      const singleRightOffset =
        rightWing.length === 1 && leftWing.length > 1 ? 100 : rightY;
      positionMap.set(tbl.name, { x: 704, y: singleRightOffset });
      rightY = singleRightOffset + estimateTableCardHeight(tbl.columns.length) + 28;
    }

    const maxWingBottom = Math.max(leftY, rightY, 320);
    const totalCenterHeight = centerHubTables.reduce(
      (sum, tbl) => sum + estimateTableCardHeight(tbl.columns.length) + 28,
      -28,
    );
    let centerY = Math.max(
      44,
      Math.round((maxWingBottom - totalCenterHeight) / 2),
    );

    for (const tbl of centerHubTables) {
      positionMap.set(tbl.name, { x: 380, y: centerY });
      centerY += estimateTableCardHeight(tbl.columns.length) + 28;
    }
  }

  return rawTables.map((tbl) => ({
    name: tbl.name,
    role: tbl.role,
    position: positionMap.get(tbl.name) ?? { x: 380, y: 80 },
    columns: tbl.columns,
    isHidden: tbl.isHidden,
    isDateTable: tbl.isDateTable,
    dateColumn: tbl.dateColumn,
    description: tbl.description,
  }));
}

const INITIAL_SCHEMA_TABLES: readonly ModelTable[] = [];

@Component({
  selector: 'rc-model-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-view.component.html',
  styleUrl: './model-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelViewComponent implements OnInit {
  private readonly semanticModelService = inject(SemanticModelService);
  public readonly state = inject(StateManagerService);

  public readonly activeMobileTab = signal<'model' | 'properties'>('model');
  public readonly layoutMode = signal<ModelLayoutMode>('kimball');
  public readonly selectedTable = signal<string>('');
  public readonly selectedColumn = signal<string>('');
  public readonly discourageImplicitMeasures = signal<boolean>(true);
  public readonly dagDiagnostics = signal<readonly DagDiagnosticMarker[]>([]);

  // New relationship creation state
  public readonly isCreatingRel = signal<boolean>(false);
  public readonly newRelFromTable = signal<string>('');
  public readonly newRelFromCol = signal<string>('');
  public readonly newRelToTable = signal<string>('');
  public readonly newRelToCol = signal<string>('');

  public readonly expandedSections = signal<Record<ModelSection, boolean>>({
    Inspector: true,
    Properties: true,
    Entities: true,
    Definition: true,
  });

  public readonly expandedEntities = signal<Record<string, boolean>>({});

  public readonly isAllCollapsed = computed(() =>
    Object.values(this.expandedSections()).every((expanded) => !expanded),
  );

  public readonly tables = signal<readonly ModelTable[]>(INITIAL_SCHEMA_TABLES);

  public readonly relationships = signal<readonly ModelRelationship[]>([]);

  public readonly selectedRel = signal<ModelRelationship>({
    name: '',
    fromTable: '',
    fromCol: '',
    toTable: '',
    toCol: '',
    cardinality: 'ManyToOne',
    crossFilter: 'Single',
    isActive: true,
    description: '',
  });

  public readonly activeTable = computed<ModelTable | undefined>(
    () =>
      this.tables().find((t) => t.name === this.selectedTable()) ??
      this.tables()[0],
  );

  public readonly activeColumn = computed<ModelColumn | undefined>(() => {
    const tbl = this.activeTable();
    if (!tbl || tbl.columns.length === 0) {
      return undefined;
    }
    const colName = this.selectedColumn();
    return tbl.columns.find((c) => c.name === colName) ?? tbl.columns[0];
  });

  public readonly newRelFromColumns = computed<readonly ModelColumn[]>(() => {
    const tbl = this.tables().find((t) => t.name === this.newRelFromTable());
    return tbl ? tbl.columns : [];
  });

  public readonly newRelToColumns = computed<readonly ModelColumn[]>(() => {
    const tbl = this.tables().find((t) => t.name === this.newRelToTable());
    return tbl ? tbl.columns : [];
  });

  public readonly relationshipModelingWarning = computed<string | null>(() => {
    const rel = this.selectedRel();
    if (!rel.name) {
      return null;
    }
    if (rel.crossFilter === 'Both') {
      return 'Bi-directional cross-filtering at the model level slows performance and risks ambiguous filter paths. Prefer CALCULATE with CROSSFILTER in RAX measures unless required for dynamic RLS.';
    }
    if (rel.cardinality === 'ManyToMany') {
      return 'Many-to-many relationship detected. Best practice is to create a shared dimension table with DISTINCT(UNION(...)) and replace with two 1 : * relationships.';
    }
    if (rel.isActive === false) {
      return `Inactive relationship. Activate in RAX formulas via CALCULATE([Measure], USERELATIONSHIP('${rel.fromTable}'[${rel.fromCol}], '${rel.toTable}'[${rel.toCol}])).`;
    }
    return null;
  });

  public readonly dagCanvasBounds = computed(() => {
    const currentTables = this.tables();
    let maxRight = 960;
    let maxBottom = 520;
    for (const tbl of currentTables) {
      maxRight = Math.max(maxRight, tbl.position.x + TABLE_CARD_WIDTH + 60);
      maxBottom = Math.max(
        maxBottom,
        tbl.position.y + estimateTableCardHeight(tbl.columns.length) + 48,
      );
    }
    return { width: maxRight, height: maxBottom };
  });

  public readonly renderedRelationships = computed<
    readonly RenderedRelationship[]
  >(() => {
    const tableByName = new Map(this.tables().map((tbl) => [tbl.name, tbl]));
    const rendered: RenderedRelationship[] = [];

    for (const rel of this.relationships()) {
      const fromTbl = tableByName.get(rel.fromTable);
      const toTbl = tableByName.get(rel.toTable);
      if (!fromTbl || !toTbl) {
        continue;
      }

      const fromColIndex = Math.max(
        0,
        fromTbl.columns.findIndex((col) => col.name === rel.fromCol),
      );
      const toColIndex = Math.max(
        0,
        toTbl.columns.findIndex((col) => col.name === rel.toCol),
      );

      const fromY =
        fromTbl.position.y +
        TABLE_HEADER_HEIGHT +
        6 +
        fromColIndex * TABLE_ROW_HEIGHT +
        10;
      const toY =
        toTbl.position.y +
        TABLE_HEADER_HEIGHT +
        6 +
        toColIndex * TABLE_ROW_HEIGHT +
        10;

      const toIsLeft = toTbl.position.x + 110 < fromTbl.position.x + 110;
      const x1 = toIsLeft
        ? toTbl.position.x + TABLE_CARD_WIDTH
        : fromTbl.position.x + TABLE_CARD_WIDTH;
      const y1 = toIsLeft ? toY : fromY;
      const x2 = toIsLeft ? fromTbl.position.x : toTbl.position.x;
      const y2 = toIsLeft ? fromY : toY;

      const dx = Math.max(44, Math.round(Math.abs(x2 - x1) * 0.48));
      const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      let labelText = '1 : *';
      if (rel.cardinality === 'OneToOne') {
        labelText = '1 : 1';
      } else if (rel.cardinality === 'ManyToMany') {
        labelText = '* : *';
      } else {
        labelText = toIsLeft ? '1 : *' : '* : 1';
      }

      rendered.push({
        rel,
        pathD,
        labelText,
        labelX: Math.round((x1 + x2) / 2),
        labelY: Math.round((y1 + y2) / 2) - 8,
        isBiDirectional: rel.crossFilter === 'Both',
      });
    }

    return rendered;
  });

  public readonly activeRsdl = computed(() => {
    const rel = this.selectedRel();
    const lines: string[] = [];
    if (this.discourageImplicitMeasures()) {
      lines.push('modelProperty discourageImplicitMeasures = true');
    }
    const tbl = this.activeTable();
    if (tbl?.description) {
      lines.push(`/// ${tbl.description}`);
    }
    const col = this.activeColumn();
    if (col?.description) {
      lines.push(`/// Column '${col.name}': ${col.description}`);
    }
    if (rel.description) {
      lines.push(`/// ${rel.description}`);
    }
    lines.push(
      `relationship '${rel.name}'`,
      `  fromColumn: '${rel.fromTable}'[${rel.fromCol}]`,
      `  toColumn: '${rel.toTable}'[${rel.toCol}]`,
      `  cardinality: ${rel.cardinality}`,
      `  crossFilter: ${rel.crossFilter}`,
      `  isActive: ${rel.isActive ?? true}`,
    );
    return lines.join('\n');
  });

  public ngOnInit(): void {
    if (this.state.sharedTables && this.state.sharedTables.length > 0) {
      this.syncFromSharedTables(this.state.sharedTables);
    }
    this.semanticModelService.loadDefault().subscribe({
      next: (payload: SemanticModelApiPayload) => {
        if (payload?.tables?.length) {
          this.semanticModelService.syncToStateManager(payload, this.state);
          this.state.announce(`Semantic model loaded: ${payload.name}`);

          const mappedTables = layoutStarSchemaTables(
            payload.tables.map((tbl) => ({
              name: tbl.name,
              role: tbl.role,
              isHidden: tbl.isHidden,
              isDateTable:
                tbl.isDateTable ??
                /calendar|datum|date/i.test(tbl.name),
              dateColumn: tbl.dateColumn || this.inferDateColumnName(tbl.columns),
              description: tbl.description || '',
              columns: tbl.columns.map((c) => ({
                name: c.name,
                dataType: c.dataType,
                isPrimaryKey: c.isPrimaryKey,
                isForeignKey: c.isForeignKey,
                isHidden: c.isHidden,
                description: c.description || '',
                displayFolder: c.displayFolder || '',
                summarizeBy: c.summarizeBy || (c.isPrimaryKey || c.isForeignKey ? 'none' : 'default'),
              })),
            })),
            this.layoutMode(),
          );
          this.tables.set(mappedTables);

          if (!mappedTables.some((tbl) => tbl.name === this.selectedTable())) {
            const primaryHub =
              mappedTables.find((tbl) => tbl.role === 'FACT') ??
              mappedTables[0];
            this.selectedTable.set(primaryHub.name);
            this.selectedColumn.set(primaryHub.columns[0]?.name ?? '');
            this.expandedEntities.set({ [primaryHub.name]: true });
          }

          if (payload.relationships?.length) {
            const mappedRels: ModelRelationship[] = payload.relationships.map(
              (r) => ({
                name: r.name,
                fromTable: r.fromTable,
                fromCol: r.fromColumn,
                toTable: r.toTable,
                toCol: r.toColumn,
                cardinality:
                  r.cardinality === 'MANY_TO_ONE'
                    ? 'ManyToOne'
                    : r.cardinality === 'ONE_TO_ONE'
                      ? 'OneToOne'
                      : 'ManyToMany',
                crossFilter:
                  r.crossFilterDirection === 'BOTH' ? 'Both' : 'Single',
                isActive: r.isActive,
                bridgeTable: r.bridgeTable,
              }),
            );
            this.relationships.set(mappedRels);
            if (mappedRels.length > 0) {
              this.selectedRel.set(mappedRels[0]);
            }
          } else {
            this.inferRelationshipsFromTables(mappedTables);
          }
        }
      },
      error: () => {
        if (this.state.sharedTables && this.state.sharedTables.length > 0) {
          this.syncFromSharedTables(this.state.sharedTables);
        }
      },
    });
  }

  private inferDateColumnName(columns: readonly { name: string; dataType: string }[]): string {
    const found = columns.find(
      (c) => /date/i.test(c.dataType) || /^date$/i.test(c.name) || /date/i.test(c.name),
    );
    return found ? found.name : '';
  }

  private syncFromSharedTables(sharedTables: readonly any[]): void {
    const mappedTables = layoutStarSchemaTables(
      sharedTables.map((tbl) => ({
        name: tbl.name,
        role: tbl.role,
        isHidden: !!tbl.isHidden,
        isDateTable: !!tbl.isDateTable || /calendar|datum|date/i.test(tbl.name),
        dateColumn: tbl.dateColumn || this.inferDateColumnName(tbl.columns || []),
        description: tbl.description || '',
        columns: (tbl.columns || []).map((c: any) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.keyType === 'PK' || !!c.isPrimaryKey,
          isForeignKey: c.keyType === 'FK' || !!c.isForeignKey,
          isHidden: !!c.isHidden,
          description: c.description || '',
          displayFolder: c.displayFolder || '',
          summarizeBy: c.summarizeBy || (c.keyType === 'PK' || c.keyType === 'FK' ? 'none' : 'default'),
        })),
      })),
      this.layoutMode(),
    );
    this.tables.set(mappedTables);
    if (!mappedTables.some((tbl) => tbl.name === this.selectedTable())) {
      const primaryHub =
        mappedTables.find((tbl) => tbl.role === 'FACT') ?? mappedTables[0];
      if (primaryHub) {
        this.selectedTable.set(primaryHub.name);
        this.selectedColumn.set(primaryHub.columns[0]?.name ?? '');
        this.expandedEntities.set({ [primaryHub.name]: true });
      }
    }
    if (this.relationships().length === 0 && mappedTables.length > 1) {
      this.inferRelationshipsFromTables(mappedTables);
    }
  }

  private inferRelationshipsFromTables(currentTables: readonly ModelTable[]): void {
    const inferred: ModelRelationship[] = [];
    const activePairSet = new Set<string>();

    const pkLookup = new Map<string, { table: string; col: string }>();
    for (const tbl of currentTables) {
      if (tbl.role === 'DIMENSION' || tbl.isDateTable) {
        for (const col of tbl.columns) {
          if (col.isPrimaryKey) {
            pkLookup.set(col.name.toLowerCase(), { table: tbl.name, col: col.name });
          }
        }
      }
    }

    for (const tbl of currentTables) {
      for (const col of tbl.columns) {
        if (!col.isForeignKey) {
          continue;
        }
        const target = pkLookup.get(col.name.toLowerCase());
        if (target && target.table !== tbl.name) {
          const pairKey = [tbl.name.toLowerCase(), target.table.toLowerCase()].sort().join('::');
          const isFirstActive = !activePairSet.has(pairKey);
          if (isFirstActive) {
            activePairSet.add(pairKey);
          }
          inferred.push({
            name: `${tbl.name}_${col.name}_to_${target.table}`,
            fromTable: tbl.name,
            fromCol: col.name,
            toTable: target.table,
            toCol: target.col,
            cardinality: 'ManyToOne',
            crossFilter: 'Single',
            isActive: isFirstActive,
          });
        }
      }
    }

    if (inferred.length > 0) {
      this.relationships.set(inferred);
      this.selectedRel.set(inferred[0]);
    }
  }

  public setLayoutMode(mode: ModelLayoutMode): void {
    this.layoutMode.set(mode);
    const current = this.tables();
    if (current.length > 0) {
      this.tables.set(layoutStarSchemaTables(current, mode));
    }
    const modeLabel =
      mode === 'collie'
        ? 'Collie vertical filter-flow layout (dimensions top, facts bottom)'
        : 'Kimball central star layout (fact center, dimensions radiating)';
    this.state.announce(`Applied ${modeLabel}.`);
  }

  public nudgeTablePosition(tableName: string, dx: number, dy: number): void {
    this.tables.update((list) =>
      list.map((tbl) =>
        tbl.name === tableName
          ? {
              ...tbl,
              position: {
                x: Math.max(16, tbl.position.x + dx),
                y: Math.max(16, tbl.position.y + dy),
              },
            }
          : tbl,
      ),
    );
  }

  public isSectionExpanded(section: ModelSection): boolean {
    return this.expandedSections()[section] ?? false;
  }

  public toggleSection(section: ModelSection): void {
    this.expandedSections.update((sections) => {
      const next = !sections[section];
      const updated = { ...sections, [section]: next };
      if (section === 'Inspector') updated.Properties = next;
      if (section === 'Properties') updated.Inspector = next;
      return updated;
    });
  }

  public toggleCollapseAll(): void {
    const willExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Inspector: willExpand,
      Properties: willExpand,
      Entities: willExpand,
      Definition: willExpand,
    });
  }

  public isEntityExpanded(tableName: string): boolean {
    return this.expandedEntities()[tableName] ?? false;
  }

  public toggleEntityExpanded(tableName: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.expandedEntities.update((map) => ({
      ...map,
      [tableName]: !map[tableName],
    }));
  }

  public onSelectTable(name: string): void {
    this.selectedTable.set(name);
    const tbl = this.tables().find((t) => t.name === name);
    if (tbl && tbl.columns.length > 0) {
      const hasCurrentCol = tbl.columns.some((c) => c.name === this.selectedColumn());
      if (!hasCurrentCol) {
        this.selectedColumn.set(tbl.columns[0].name);
      }
    }
    const relatedRel = this.relationships().find(
      (rel) => rel.fromTable === name || rel.toTable === name,
    );
    if (relatedRel) {
      this.selectedRel.set(relatedRel);
    }
    this.state.announce(`Selected table: ${name}`);
  }

  public onSelectColumn(tableName: string, colName: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedTable.set(tableName);
    this.selectedColumn.set(colName);
    this.state.announce(`Selected column: ${tableName}[${colName}]`);
  }

  public onSelectRelationship(rel: ModelRelationship): void {
    this.selectedRel.set(rel);
    this.selectedTable.set(rel.toTable);
    this.state.announce(`Selected relationship: ${rel.name}`);
  }

  public updateCardinality(cardinality: string): void {
    const current = this.selectedRel();
    const nextCrossFilter =
      cardinality === 'ManyToMany' ? 'Both' : current.crossFilter;
    const updated: ModelRelationship = {
      ...current,
      cardinality,
      crossFilter: nextCrossFilter,
    };
    this.selectedRel.set(updated);
    this.relationships.update((list) =>
      list.map((r) => (r.name === current.name ? updated : r)),
    );
    this.persistModelToBackend();
    if (cardinality === 'ManyToMany') {
      this.state.announce(
        'Updated relationship cardinality: ManyToMany. Warning: prefer a shared bridge dimension table with two 1 : * relationships.',
        { safe: true },
      );
    } else {
      this.state.announce(`Updated relationship cardinality: ${cardinality}`);
    }
  }

  public updateCrossFilter(crossFilter: string): void {
    const current = this.selectedRel();
    const updated: ModelRelationship = { ...current, crossFilter };
    this.selectedRel.set(updated);
    this.relationships.update((list) =>
      list.map((r) => (r.name === current.name ? updated : r)),
    );
    this.persistModelToBackend();
    if (crossFilter === 'Both') {
      this.state.announce(
        'Updated relationship cross-filter: Both. Warning: model-level bi-directional filtering degrades performance; prefer CROSSFILTER in RAX.',
        { safe: true },
      );
    } else {
      this.state.announce(`Updated relationship cross-filter: ${crossFilter}`);
    }
  }

  public toggleRelActive(): void {
    const current = this.selectedRel();
    const nextActive = !(current.isActive !== false);
    const updated: ModelRelationship = { ...current, isActive: nextActive };
    this.selectedRel.set(updated);
    this.relationships.update((list) =>
      list.map((r) => (r.name === current.name ? updated : r)),
    );
    this.persistModelToBackend();
    this.state.announce(
      `Relationship ${current.name} is now ${nextActive ? 'Active' : 'Inactive'}`,
    );
  }

  public startNewRelationship(): void {
    const tbls = this.tables();
    if (tbls.length < 2) {
      this.state.announce('At least two tables are required to create a relationship.');
      return;
    }
    const fromTbl = tbls.find((t) => t.role === 'FACT') ?? tbls[0];
    const toTbl = tbls.find((t) => t.name !== fromTbl.name) ?? tbls[1];
    this.newRelFromTable.set(fromTbl.name);
    this.newRelFromCol.set(fromTbl.columns[0]?.name ?? '');
    this.newRelToTable.set(toTbl.name);
    this.newRelToCol.set(toTbl.columns[0]?.name ?? '');
    this.isCreatingRel.set(true);
  }

  public cancelNewRelationship(): void {
    this.isCreatingRel.set(false);
  }

  public onNewRelFromTableChange(tableName: string): void {
    this.newRelFromTable.set(tableName);
    const tbl = this.tables().find((t) => t.name === tableName);
    this.newRelFromCol.set(tbl?.columns[0]?.name ?? '');
  }

  public onNewRelToTableChange(tableName: string): void {
    this.newRelToTable.set(tableName);
    const tbl = this.tables().find((t) => t.name === tableName);
    this.newRelToCol.set(tbl?.columns[0]?.name ?? '');
  }

  public createRelationship(
    fromTable = this.newRelFromTable(),
    fromCol = this.newRelFromCol(),
    toTable = this.newRelToTable(),
    toCol = this.newRelToCol(),
    cardinality = 'ManyToOne',
    crossFilter = 'Single',
  ): ModelRelationship | null {
    if (!fromTable || !fromCol || !toTable || !toCol || fromTable === toTable) {
      this.state.announce('Select two distinct tables and columns to link.');
      return null;
    }

    const pairHasActive = this.relationships().some(
      (r) =>
        r.isActive !== false &&
        ((r.fromTable.toLowerCase() === fromTable.toLowerCase() &&
          r.toTable.toLowerCase() === toTable.toLowerCase()) ||
          (r.fromTable.toLowerCase() === toTable.toLowerCase() &&
            r.toTable.toLowerCase() === fromTable.toLowerCase())),
    );

    const isActive = !pairHasActive;
    const relName = `${fromTable}_${fromCol}_to_${toTable}_${toCol}`;
    const newRel: ModelRelationship = {
      name: relName,
      fromTable,
      fromCol,
      toTable,
      toCol,
      cardinality,
      crossFilter: cardinality === 'ManyToMany' ? 'Both' : crossFilter,
      isActive,
    };

    this.relationships.update((list) => [...list.filter((r) => r.name !== relName), newRel]);
    this.selectedRel.set(newRel);
    this.isCreatingRel.set(false);
    this.persistModelToBackend();

    if (!isActive) {
      this.state.announce(
        `Created secondary relationship ${relName} as Inactive. Use USERELATIONSHIP in RAX to activate it.`,
      );
    } else {
      this.state.announce(`Created relationship: ${relName}`);
    }
    return newRel;
  }

  public deleteRelationship(relName = this.selectedRel().name): void {
    if (!relName) {
      return;
    }
    const remaining = this.relationships().filter((r) => r.name !== relName);
    this.relationships.set(remaining);
    this.selectedRel.set(
      remaining[0] ?? {
        name: '',
        fromTable: '',
        fromCol: '',
        toTable: '',
        toCol: '',
        cardinality: 'ManyToOne',
        crossFilter: 'Single',
        isActive: true,
      },
    );
    this.persistModelToBackend();
    this.state.announce(`Deleted relationship: ${relName}`);
  }

  public toggleTableHidden(tableName = this.activeTable()?.name): void {
    if (!tableName) {
      return;
    }
    let nextHidden = false;
    this.tables.update((list) =>
      list.map((tbl) => {
        if (tbl.name === tableName) {
          nextHidden = !tbl.isHidden;
          return { ...tbl, isHidden: nextHidden };
        }
        return tbl;
      }),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(
      `Table ${tableName} is now ${nextHidden ? 'hidden in Report View' : 'visible in Report View'}.`,
    );
  }

  public toggleMarkAsDateTable(isDateTable: boolean): void {
    const tbl = this.activeTable();
    if (!tbl) {
      return;
    }
    const defaultDateCol =
      tbl.dateColumn || this.inferDateColumnName(tbl.columns) || tbl.columns[0]?.name || '';
    this.tables.update((list) =>
      list.map((item) =>
        item.name === tbl.name
          ? {
              ...item,
              isDateTable,
              dateColumn: isDateTable ? defaultDateCol : '',
            }
          : item,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(
      isDateTable
        ? `Marked ${tbl.name} as Date Table (key column: ${defaultDateCol || 'None'}).`
        : `Unmarked ${tbl.name} as Date Table.`,
    );
  }

  public updateDateColumn(dateColumn: string): void {
    const tbl = this.activeTable();
    if (!tbl) {
      return;
    }
    this.tables.update((list) =>
      list.map((item) =>
        item.name === tbl.name
          ? { ...item, isDateTable: true, dateColumn }
          : item,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(`Set Date Table column for ${tbl.name} to ${dateColumn}.`);
  }

  public updateTableDescription(description: string): void {
    const tbl = this.activeTable();
    if (!tbl) {
      return;
    }
    this.tables.update((list) =>
      list.map((item) =>
        item.name === tbl.name ? { ...item, description } : item,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
  }

  public toggleColumnHidden(
    tableName = this.activeTable()?.name,
    colName = this.activeColumn()?.name,
    event?: Event,
  ): void {
    if (event) {
      event.stopPropagation();
    }
    if (!tableName || !colName) {
      return;
    }
    let nextHidden = false;
    this.tables.update((list) =>
      list.map((tbl) =>
        tbl.name === tableName
          ? {
              ...tbl,
              columns: tbl.columns.map((c) => {
                if (c.name === colName) {
                  nextHidden = !c.isHidden;
                  return { ...c, isHidden: nextHidden };
                }
                return c;
              }),
            }
          : tbl,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(
      `Column ${tableName}[${colName}] is now ${nextHidden ? 'hidden' : 'visible'} in Report View.`,
    );
  }

  public updateColumnDisplayFolder(displayFolder: string): void {
    const tbl = this.activeTable();
    const col = this.activeColumn();
    if (!tbl || !col) {
      return;
    }
    this.tables.update((list) =>
      list.map((item) =>
        item.name === tbl.name
          ? {
              ...item,
              columns: item.columns.map((c) =>
                c.name === col.name ? { ...c, displayFolder } : c,
              ),
            }
          : item,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(
      `Assigned ${tbl.name}[${col.name}] to display folder "${displayFolder || 'Root'}".`,
    );
  }

  public updateColumnSummarizeBy(summarizeBy: string): void {
    const tbl = this.activeTable();
    const col = this.activeColumn();
    if (!tbl || !col) {
      return;
    }
    this.tables.update((list) =>
      list.map((item) =>
        item.name === tbl.name
          ? {
              ...item,
              columns: item.columns.map((c) =>
                c.name === col.name ? { ...c, summarizeBy } : c,
              ),
            }
          : item,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(
      `Updated summarization for ${tbl.name}[${col.name}] to ${summarizeBy}.`,
    );
  }

  public updateColumnDescription(description: string): void {
    const tbl = this.activeTable();
    const col = this.activeColumn();
    if (!tbl || !col) {
      return;
    }
    this.tables.update((list) =>
      list.map((item) =>
        item.name === tbl.name
          ? {
              ...item,
              columns: item.columns.map((c) =>
                c.name === col.name ? { ...c, description } : c,
              ),
            }
          : item,
      ),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
  }

  public hideAllForeignKeys(): void {
    let hiddenCount = 0;
    this.tables.update((list) =>
      list.map((tbl) => ({
        ...tbl,
        columns: tbl.columns.map((c) => {
          if (c.isForeignKey && !c.isHidden) {
            hiddenCount++;
            return { ...c, isHidden: true, summarizeBy: 'none' };
          }
          return c;
        }),
      })),
    );
    this.syncTablesToState();
    this.persistModelToBackend();
    this.state.announce(
      `Finalized semantic model: hid ${hiddenCount} foreign key columns from Report View.`,
    );
  }

  public toggleDiscourageImplicitMeasures(): void {
    const next = !this.discourageImplicitMeasures();
    this.discourageImplicitMeasures.set(next);
    if (next) {
      this.tables.update((list) =>
        list.map((tbl) => ({
          ...tbl,
          columns: tbl.columns.map((c) => ({ ...c, summarizeBy: 'none' })),
        })),
      );
      this.syncTablesToState();
      this.persistModelToBackend();
    }
    this.state.announce(
      next
        ? 'Enabled Discourage Implicit Measures across the semantic model (explicit RAX measures required).'
        : 'Disabled Discourage Implicit Measures.',
    );
  }

  public getTablePrimaryKey(table?: ModelTable): string {
    if (!table) return 'None';
    const pkCol = table.columns.find((c) => c.isPrimaryKey);
    return pkCol ? pkCol.name : 'None';
  }

  public copyRsdlToClipboard(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard
        .writeText(this.activeRsdl())
        .then(() => {
          this.state.announce('RSDL definition copied to clipboard.');
        })
        .catch(() => {
          this.state.announce('RSDL copied.');
        });
    } else {
      this.state.announce('RSDL definition ready.');
    }
  }

  public toSemanticModelPayload(): SemanticModelApiPayload {
    return {
      name: this.state.activeProject().filename.replace(/\.rcp$/, '') || 'Untitled Project',
      fiscalYearStartMonth: 1,
      tables: this.tables().map((tbl) => ({
        name: tbl.name,
        role: tbl.role,
        partitionColumn: tbl.dateColumn || '',
        estimatedRows: 100,
        scdType2: false,
        description: tbl.description || '',
        isHidden: !!tbl.isHidden,
        isDateTable: !!tbl.isDateTable,
        dateColumn: tbl.dateColumn || '',
        columns: tbl.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: !!c.isPrimaryKey,
          isForeignKey: !!c.isForeignKey,
          isHidden: !!c.isHidden,
          description: c.description || '',
          displayFolder: c.displayFolder || '',
          summarizeBy: c.summarizeBy || 'default',
        })),
      })),
      relationships: this.relationships().map((r) => ({
        name: r.name,
        fromTable: r.fromTable,
        fromColumn: r.fromCol,
        toTable: r.toTable,
        toColumn: r.toCol,
        cardinality:
          r.cardinality === 'OneToOne'
            ? 'ONE_TO_ONE'
            : r.cardinality === 'ManyToMany'
              ? 'MANY_TO_MANY'
              : 'MANY_TO_ONE',
        crossFilterDirection: r.crossFilter === 'Both' ? 'BOTH' : 'SINGLE',
        isActive: r.isActive !== false,
        bridgeTable: r.bridgeTable,
      })),
      measures: this.state.measures.map((m) => ({
        id: m.id,
        label: m.label,
        name: m.label,
        table: m.table,
        tableName: m.table,
        formula: m.formula,
        raxExpression: m.formula,
      })),
      rlsRolePredicates: {},
    };
  }

  private syncTablesToState(): void {
    const current = this.tables();
    if (current.length === 0) {
      return;
    }
    this.state.syncTables(
      current.map((t, idx) => ({
        id: `tbl-${idx}-${t.name}`,
        name: t.name,
        role: t.role,
        isHidden: !!t.isHidden,
        isDateTable: !!t.isDateTable,
        dateColumn: t.dateColumn || '',
        description: t.description || '',
        columns: t.columns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          keyType: c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : 'None',
          isHidden: !!c.isHidden,
          description: c.description || '',
          displayFolder: c.displayFolder || '',
          summarizeBy: c.summarizeBy === 'none' ? 'None' : 'Sum',
        })),
      })),
    );
  }

  private persistModelToBackend(): void {
    if (this.tables().length === 0) {
      return;
    }
    this.semanticModelService.save(this.toSemanticModelPayload()).subscribe();
  }

  public onValidateDag(): void {
    const localDiagnostics: DagDiagnosticMarker[] = [];
    const tableMap = new Map(
      this.tables().map((t) => [t.name.toLowerCase(), t]),
    );
    const activePairs = new Map<string, string[]>();
    const adjacency = new Map<string, string[]>();

    for (const rel of this.relationships()) {
      const fromKey = rel.fromTable.toLowerCase();
      const toKey = rel.toTable.toLowerCase();
      const fromTbl = tableMap.get(fromKey);
      const toTbl = tableMap.get(toKey);

      if (
        fromTbl &&
        toTbl &&
        fromTbl.role === 'DIMENSION' &&
        toTbl.role === 'DIMENSION'
      ) {
        localDiagnostics.push({
          severity: 'ERROR',
          code: 'ERR_SNOWFLAKE_REJECTED',
          message: `Snowflake link between dimensions '${fromTbl.name}' and '${toTbl.name}' detected; merge dimensions in Data Preparation.`,
        });
      }

      if (rel.crossFilter === 'Both') {
        localDiagnostics.push({
          severity: 'WARNING',
          code: 'WARN_BIDIRECTIONAL_FILTER',
          message: `Bi-directional cross-filtering on '${rel.name}' degrades performance; prefer CALCULATE with CROSSFILTER in RAX.`,
        });
      }

      if (rel.cardinality === 'ManyToMany' && !rel.bridgeTable) {
        localDiagnostics.push({
          severity: 'WARNING',
          code: 'WARN_MANY_TO_MANY',
          message: `Many-to-many relationship '${rel.name}' detected; consider a shared bridge dimension with two 1 : * links.`,
        });
      }

      const list = adjacency.get(fromKey) ?? [];
      list.push(toKey);
      adjacency.set(fromKey, list);

      if (rel.isActive !== false) {
        const pairKey = [fromKey, toKey].sort().join('::');
        const pairRels = activePairs.get(pairKey) ?? [];
        pairRels.push(rel.name);
        activePairs.set(pairKey, pairRels);
      }
    }

    for (const [pairKey, relNames] of activePairs.entries()) {
      if (relNames.length > 1) {
        localDiagnostics.push({
          severity: 'ERROR',
          code: 'ERR_AMBIGUOUS_PATH',
          message: `Multiple active relationships between (${pairKey}): ${relNames.join(', ')}. Set secondary relationships to Inactive and use USERELATIONSHIP.`,
        });
      }
    }

    const visitState = new Map<string, number>();
    const detectCycle = (node: string): boolean => {
      visitState.set(node, 1);
      for (const neighbor of adjacency.get(node) ?? []) {
        const st = visitState.get(neighbor) ?? 0;
        if (st === 1 || (st === 0 && detectCycle(neighbor))) {
          return true;
        }
      }
      visitState.set(node, 2);
      return false;
    };

    for (const node of adjacency.keys()) {
      if ((visitState.get(node) ?? 0) === 0 && detectCycle(node)) {
        localDiagnostics.push({
          severity: 'ERROR',
          code: 'ERR_CIRCULAR_DEP',
          message: `Circular relationship dependency cycle detected involving '${node}'.`,
        });
        break;
      }
    }

    for (const tbl of this.tables()) {
      for (const col of tbl.columns) {
        if (col.isForeignKey && !col.isHidden) {
          localDiagnostics.push({
            severity: 'WARNING',
            code: 'WARN_UNHIDDEN_FOREIGN_KEY',
            message: `Foreign key '${tbl.name}[${col.name}]' is visible; hide foreign keys in Model View so users filter via the dimension table.`,
          });
        }
      }
    }

    this.dagDiagnostics.set(localDiagnostics);
    const errorCount = localDiagnostics.filter((d) => d.severity === 'ERROR').length;
    const warningCount = localDiagnostics.filter((d) => d.severity === 'WARNING').length;

    if (errorCount > 0) {
      this.state.announce(
        `DAG Validation: ${errorCount} schema issue(s) detected (${localDiagnostics[0].message})`,
        { safe: true },
      );
    } else if (warningCount > 0) {
      this.state.announce(
        `DAG Validation: Star schema is consistent and acyclic (0 circular dependencies, ${warningCount} modeling warning(s)).`,
        { safe: true },
      );
    } else {
      this.state.announce(
        'DAG Validation: Star schema is consistent and acyclic (0 circular dependencies).',
      );
    }

    if (this.tables().length > 0) {
      this.semanticModelService.validate(this.toSemanticModelPayload()).subscribe({
        next: (report) => {
          if (report?.diagnostics && report.diagnostics.length > 0) {
            this.dagDiagnostics.set(report.diagnostics);
          }
        },
      });
    }
  }
}
