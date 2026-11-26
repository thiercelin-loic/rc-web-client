import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import {
  ModelColumn,
  ModelLayoutMode,
  ModelRelationship,
  ModelSection,
  ModelTable,
  RenderedRelationship,
  SemanticModelApiPayload,
  SemanticModelService,
  TABLE_CARD_WIDTH,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  cardHeight,
  isPrimaryKey,
  layoutTables,
} from "../../core/model/model.service";
import { SharedTable, StateManagerService } from "../../core/state/state.service";

export { isPrimaryKey, layoutTables };
export type {
  ModelColumn,
  ModelLayoutMode,
  ModelRelationship,
  ModelSection,
  ModelTable,
  RenderedRelationship,
};

@Component({
  selector: "rc-model-view",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./model-view.component.html",
  styleUrl: "./model-view.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelViewComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly modelService = inject(SemanticModelService);
  public readonly state = inject(StateManagerService);

  public readonly activeMobileTab = signal<"model" | "properties">("model");
  public readonly selectedTable = signal<string>("");
  public readonly selectedColumn = signal<string>("");

  public readonly isCreatingRel = signal<boolean>(false);
  public readonly newRelFromTable = signal<string>("");
  public readonly newRelFromCol = signal<string>("");
  public readonly newRelToTable = signal<string>("");
  public readonly newRelToCol = signal<string>("");

  public readonly expandedSections = signal<Record<ModelSection, boolean>>({
    Inspector: true,
    Properties: true,
    Entities: false,
    Definition: false,
  });

  public readonly expandedEntities = signal<Record<string, boolean>>({});

  public readonly isAllCollapsed = computed(() =>
    Object.values(this.expandedSections()).every((expanded) => !expanded),
  );

  public readonly tables = this.modelService.tables;
  public readonly relationships = this.modelService.relationships;
  public readonly selectedRel = this.modelService.selectedRel;
  public readonly dagValidation = this.modelService.dagValidation;
  public readonly dagDiagnostics = this.modelService.dagDiagnostics;
  public readonly discourageImplicitMeasures =
    this.modelService.discourageImplicitMeasures;
  public readonly layoutMode = this.modelService.layoutMode;
  public readonly activeRsdl = this.modelService.activeRsdl;
  public readonly suggestedDates = this.modelService.suggestedDates;
  public readonly lastError = this.modelService.lastError;

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

  public readonly suggestedDateCol = computed<string>(() => {
    const tbl = this.activeTable();
    if (!tbl) {
      return "";
    }
    return tbl.dateColumn || this.suggestedDates()[tbl.name] || "";
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
    if (rel.crossFilter === "Both") {
      return "Bi-directional cross-filtering at the model level slows performance and risks ambiguous filter paths. Prefer CALCULATE with CROSSFILTER in RAX measures unless required for dynamic RLS.";
    }
    if (rel.cardinality === "ManyToMany") {
      return "Many-to-many relationship detected. Best practice is to create a shared dimension table with DISTINCT(UNION(...)) and replace with two 1 : * relationships.";
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
        tbl.position.y + cardHeight(tbl.columns.length) + 48,
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

      let labelText = "1 : *";
      if (rel.cardinality === "OneToOne") {
        labelText = "1 : 1";
      } else if (rel.cardinality === "ManyToMany") {
        labelText = "* : *";
      } else {
        labelText = toIsLeft ? "1 : *" : "* : 1";
      }

      rendered.push({
        rel,
        pathD,
        labelText,
        labelX: Math.round((x1 + x2) / 2),
        labelY: Math.round((y1 + y2) / 2) - 8,
        isBiDirectional: rel.crossFilter === "Both",
      });
    }

    return rendered;
  });

  public ngOnInit(): void {
    if (this.state.sharedTables.length > 0) {
      this.syncShared(this.state.sharedTables);
      return;
    }
    this.modelService
      .loadDefault()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload: SemanticModelApiPayload) => {
          if (payload?.tables?.length) {
            this.modelService.applyPayload(payload, undefined, true);
            this.state.announce(`Semantic model loaded: ${payload.name}`);
            this.ensureSelection();
          }
        },
      });
  }

  private syncShared(sharedTables: readonly SharedTable[]): void {
    this.modelService.syncShared(sharedTables);
    this.ensureSelection();
  }

  private ensureSelection(): void {
    const mappedTables = this.tables();
    if (
      mappedTables.length > 0 &&
      !mappedTables.some((tbl) => tbl.name === this.selectedTable())
    ) {
      const primaryHub =
        mappedTables.find((tbl) => tbl.role === "FACT") ?? mappedTables[0];
      if (primaryHub) {
        this.selectedTable.set(primaryHub.name);
        this.selectedColumn.set(primaryHub.columns[0]?.name ?? "");
        this.expandedEntities.set({ [primaryHub.name]: true });
      }
    }
  }

  public clearError(): void {
    this.modelService.clearError();
  }

  public setLayout(mode: ModelLayoutMode): void {
    this.modelService.setLayout(mode);
    const modeLabel =
      mode === "collie"
        ? "Collie vertical filter-flow layout (dimensions top, facts bottom)"
        : "Kimball central star layout (fact center, dimensions radiating)";
    this.state.announce(`Applied ${modeLabel}.`);
  }

  public nudgeTable(tableName: string, dx: number, dy: number): void {
    this.modelService.nudgeTable(tableName, dx, dy);
  }

  public sectionExpanded(section: ModelSection): boolean {
    return this.expandedSections()[section] ?? false;
  }

  public toggleSection(section: ModelSection): void {
    this.expandedSections.update((sections) => {
      const next = !sections[section];
      const updated = { ...sections, [section]: next };
      if (section === "Inspector") updated.Properties = next;
      if (section === "Properties") updated.Inspector = next;
      return updated;
    });
  }

  public toggleAll(): void {
    const willExpand = this.isAllCollapsed();
    this.expandedSections.set({
      Inspector: willExpand,
      Properties: willExpand,
      Entities: willExpand,
      Definition: willExpand,
    });
  }

  public entityExpanded(tableName: string): boolean {
    return this.expandedEntities()[tableName] ?? false;
  }

  public toggleEntity(tableName: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.expandedEntities.update((map) => ({
      ...map,
      [tableName]: !map[tableName],
    }));
  }

  public selectTable(name: string): void {
    this.selectedTable.set(name);
    const tbl = this.tables().find((t) => t.name === name);
    if (tbl && tbl.columns.length > 0) {
      const hasCurrentCol = tbl.columns.some(
        (c) => c.name === this.selectedColumn(),
      );
      if (!hasCurrentCol) {
        this.selectedColumn.set(tbl.columns[0].name);
      }
    }
    const relatedRel = this.relationships().find(
      (rel) => rel.fromTable === name || rel.toTable === name,
    );
    if (relatedRel) {
      this.modelService.selectRelationship(relatedRel);
    }
    this.state.announce(`Selected table: ${name}`);
  }

  public selectColumn(tableName: string, colName: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedTable.set(tableName);
    this.selectedColumn.set(colName);
    this.state.announce(`Selected column: ${tableName}[${colName}]`);
  }

  public selectRelationship(rel: ModelRelationship): void {
    this.modelService.selectRelationship(rel);
    this.selectedTable.set(rel.toTable);
    this.state.announce(`Selected relationship: ${rel.name}`);
  }

  public updateCardinality(cardinality: string): void {
    this.modelService
      .updateCardinality(cardinality)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        if (cardinality === "ManyToMany") {
          this.state.announce(
            "Updated relationship cardinality: ManyToMany. Warning: prefer a shared bridge dimension table with two 1 : * relationships.",
            { safe: true },
          );
        } else {
          this.state.announce(
            `Updated relationship cardinality: ${cardinality}`,
          );
        }
      });
  }

  public updateFilter(crossFilter: string): void {
    this.modelService
      .updateFilter(crossFilter)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        if (crossFilter === "Both") {
          this.state.announce(
            "Updated relationship cross-filter: Both. Warning: model-level bi-directional filtering degrades performance; prefer CROSSFILTER in RAX.",
            { safe: true },
          );
        } else {
          this.state.announce(
            `Updated relationship cross-filter: ${crossFilter}`,
          );
        }
      });
  }

  public toggleActive(): void {
    this.modelService
      .toggleActive()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const updated = this.selectedRel();
        this.state.announce(
          `Relationship ${updated.name} is now ${updated.isActive ? "Active" : "Inactive"}`,
        );
      });
  }

  public startRelationship(): void {
    const tbls = this.tables();
    if (tbls.length < 2) {
      this.state.announce(
        "At least two tables are required to create a relationship.",
      );
      return;
    }
    const fromTbl = tbls.find((t) => t.role === "FACT") ?? tbls[0];
    const toTbl = tbls.find((t) => t.name !== fromTbl.name) ?? tbls[1];
    this.newRelFromTable.set(fromTbl.name);
    this.newRelFromCol.set(fromTbl.columns[0]?.name ?? "");
    this.newRelToTable.set(toTbl.name);
    this.newRelToCol.set(toTbl.columns[0]?.name ?? "");
    this.isCreatingRel.set(true);
  }

  public cancelRelationship(): void {
    this.isCreatingRel.set(false);
  }

  public changeFromTable(tableName: string): void {
    this.newRelFromTable.set(tableName);
    const tbl = this.tables().find((t) => t.name === tableName);
    this.newRelFromCol.set(tbl?.columns[0]?.name ?? "");
  }

  public changeToTable(tableName: string): void {
    this.newRelToTable.set(tableName);
    const tbl = this.tables().find((t) => t.name === tableName);
    this.newRelToCol.set(tbl?.columns[0]?.name ?? "");
  }

  public createRelationship(
    fromTable = this.newRelFromTable(),
    fromCol = this.newRelFromCol(),
    toTable = this.newRelToTable(),
    toCol = this.newRelToCol(),
    cardinality = "ManyToOne",
    crossFilter = "Single",
  ): void {
    if (!fromTable || !fromCol || !toTable || !toCol) {
      this.state.announce("Select tables and columns to link.");
      return;
    }
    this.modelService
      .createRelationship(
        fromTable,
        fromCol,
        toTable,
        toCol,
        cardinality,
        crossFilter,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        this.isCreatingRel.set(false);
        const created = this.selectedRel();
        if (created.isActive === false) {
          this.state.announce(
            `Created secondary relationship ${created.name} as Inactive. Use USERELATIONSHIP in RAX to activate it.`,
          );
        } else {
          this.state.announce(`Created relationship: ${created.name}`);
        }
      });
  }

  public deleteRelationship(relName = this.selectedRel().name): void {
    if (!relName) {
      return;
    }
    this.modelService
      .deleteRelationship(relName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(`Deleted relationship: ${relName}`);
        }
      });
  }

  public setRole(
    tableName = this.activeTable()?.name,
    role: "FACT" | "DIMENSION",
  ): void {
    if (!tableName) {
      return;
    }
    this.modelService
      .setRole(tableName, role)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(`Table ${tableName} role updated to ${role}`);
        }
      });
  }

  public toggleKey(
    tableName = this.activeTable()?.name,
    colName = this.activeColumn()?.name,
  ): void {
    if (!tableName || !colName) {
      return;
    }
    this.modelService
      .toggleKey(tableName, colName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(
            `Toggled primary key for ${tableName}[${colName}].`,
          );
        }
      });
  }

  public toggleTable(tableName = this.activeTable()?.name): void {
    if (!tableName) {
      return;
    }
    this.modelService
      .toggleTable(tableName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const updated = this.tables().find((t) => t.name === tableName);
        this.state.announce(
          `Table ${tableName} is now ${updated?.isHidden ? "hidden in Report View" : "visible in Report View"}.`,
        );
      });
  }

  public markDate(isDateTable: boolean): void {
    const tbl = this.activeTable();
    if (!tbl) {
      return;
    }
    const candidateCol = isDateTable ? this.suggestedDateCol() : undefined;
    this.modelService
      .markDate(tbl.name, isDateTable, candidateCol || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const updated = this.tables().find((t) => t.name === tbl.name);
        this.state.announce(
          isDateTable
            ? `Marked ${tbl.name} as Date Table (key column: ${updated?.dateColumn || "None"}).`
            : `Unmarked ${tbl.name} as Date Table.`,
        );
      });
  }

  public setDateCol(dateColumn: string): void {
    const tbl = this.activeTable();
    if (!tbl) {
      return;
    }
    this.modelService
      .setDateCol(tbl.name, dateColumn)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(
            `Set Date Table column for ${tbl.name} to ${dateColumn}.`,
          );
        }
      });
  }

  public setTableDesc(description: string): void {
    this.modelService
      .setTableDesc(this.activeTable()?.name, description)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  public toggleColumn(
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
    this.modelService
      .toggleColumn(tableName, colName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const tbl = this.tables().find((t) => t.name === tableName);
        const col = tbl?.columns.find((c) => c.name === colName);
        this.state.announce(
          `Column ${tableName}[${colName}] is now ${col?.isHidden ? "hidden" : "visible"} in Report View.`,
        );
      });
  }

  public setFolder(displayFolder: string): void {
    const tbl = this.activeTable();
    const col = this.activeColumn();
    if (!tbl || !col) {
      return;
    }
    this.modelService
      .setFolder(tbl.name, col.name, displayFolder)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(
            `Assigned ${tbl.name}[${col.name}] to display folder "${displayFolder || "Root"}".`,
          );
        }
      });
  }

  public setSummary(summarizeBy: string): void {
    const tbl = this.activeTable();
    const col = this.activeColumn();
    if (!tbl || !col) {
      return;
    }
    this.modelService
      .setSummary(tbl.name, col.name, summarizeBy)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(
            `Updated summarization for ${tbl.name}[${col.name}] to ${summarizeBy}.`,
          );
        }
      });
  }

  public setSortBy(sortByColumn: string): void {
    const tbl = this.activeTable();
    const col = this.activeColumn();
    if (!tbl || !col) {
      return;
    }
    this.modelService
      .setSortBy(tbl.name, col.name, sortByColumn)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(
            sortByColumn
              ? `Configured ${tbl.name}[${col.name}] to sort by [${sortByColumn}].`
              : `Cleared sort-by column for ${tbl.name}[${col.name}].`,
          );
        }
      });
  }

  public setColDesc(description: string): void {
    this.modelService
      .setColDesc(
        this.activeTable()?.name,
        this.activeColumn()?.name,
        description,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  public hideKeys(): void {
    this.modelService
      .hideKeys()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.state.announce(
            "Finalized semantic model: hid all foreign key columns from Report View.",
          );
        }
      });
  }

  public toggleImplicit(): void {
    this.modelService
      .toggleImplicit()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (!res) return;
        const next = this.discourageImplicitMeasures();
        this.state.announce(
          next
            ? "Enabled Discourage Implicit Measures across the semantic model (explicit RAX measures required)."
            : "Disabled Discourage Implicit Measures.",
        );
      });
  }

  public primaryKey(table?: ModelTable): string {
    if (!table) return "None";
    const pkCol = table.columns.find((c) => c.isPrimaryKey);
    return pkCol ? pkCol.name : "None";
  }

  public copyRsdl(): void {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(this.activeRsdl())
        .then(() => {
          this.state.announce("RSDL definition copied to clipboard.");
        })
        .catch(() => {
          this.state.announce("RSDL copied.");
        });
    } else {
      this.state.announce("RSDL definition ready.");
    }
  }

  public validateDag(): void {
    this.modelService
      .validateDag()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((diagnostics) => {
        const errorCount = diagnostics.filter(
          (d) => d.severity === "ERROR",
        ).length;
        const warningCount = diagnostics.filter(
          (d) => d.severity === "WARNING",
        ).length;

        if (errorCount > 0) {
          this.state.announce(
            `DAG Validation: ${errorCount} schema issue(s) detected (${diagnostics[0].message})`,
            { safe: true },
          );
        } else if (warningCount > 0) {
          this.state.announce(
            `DAG Validation: Star schema is consistent and acyclic (0 circular dependencies, ${warningCount} modeling warning(s)).`,
            { safe: true },
          );
        } else {
          this.state.announce(
            "DAG Validation: Star schema is consistent and acyclic (0 circular dependencies).",
          );
        }
      });
  }
}
