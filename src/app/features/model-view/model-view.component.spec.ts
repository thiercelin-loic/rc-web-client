import { provideZonelessChangeDetection } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_MODEL_ID,
  MODELS_DEFAULT_ENDPOINT,
  MODELS_ENDPOINT,
  MODELS_INFER_ENDPOINT,
  MODELS_RSDL_ENDPOINT,
  ModelMutationResult,
  SemanticModelService,
} from "../../core/model/model.service";
import { ModelViewComponent, layoutTables } from "./model-view.component";

function buildMutationResult(
  overrides: Partial<ModelMutationResult> = {},
): ModelMutationResult {
  return {
    schema: {
      modelId: DEFAULT_MODEL_ID,
      name: "Test Model",
      fiscalYearStartMonth: 1,
      discourageImplicitMeasures: false,
      tables: [
        {
          name: "fact_orders",
          role: "FACT",
          columns: [
            { name: "order_id", dataType: "Int64", isPrimaryKey: true },
            { name: "cust_id", dataType: "Int32", isForeignKey: true },
          ],
        },
        {
          name: "dim_customer",
          role: "DIMENSION",
          columns: [{ name: "cust_id", dataType: "Int32", isPrimaryKey: true }],
        },
      ],
      relationships: [
        {
          name: "fact_orders_cust_id_to_dim_customer",
          fromTable: "fact_orders",
          fromColumn: "cust_id",
          toTable: "dim_customer",
          toColumn: "cust_id",
          cardinality: "MANY_TO_ONE",
          crossFilterDirection: "SINGLE",
          isActive: true,
        },
      ],
      measures: [],
      rlsRolePredicates: {},
    },
    dagValidation: {
      valid: true,
      hasCycles: false,
      hasAmbiguousActivePaths: false,
      violatesStarSchema: false,
      diagnostics: [],
    },
    rsdl: "model 'Test Model'\n  relationship 'fact_orders_cust_id_to_dim_customer'",
    ...overrides,
  };
}

describe("ModelViewComponent", () => {
  let service: SemanticModelService;
  let httpMock: HttpTestingController;

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
    service = TestBed.inject(SemanticModelService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("instantiates the component with an empty model until user tables are provided", async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const defaultReq = httpMock.expectOne(MODELS_DEFAULT_ENDPOINT);
    defaultReq.flush({ modelId: DEFAULT_MODEL_ID, name: "Empty", tables: [], relationships: [] });

    expect(fixture.componentInstance).toBeDefined();
    expect(fixture.componentInstance.tables().length).toBe(0);
    expect(fixture.componentInstance.relationships().length).toBe(0);
  });

  it("toggles accordion sections and collapse all", async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.sectionExpanded("Inspector")).toBe(true);
    expect(component.sectionExpanded("Properties")).toBe(true);

    component.toggleSection("Inspector");
    expect(component.sectionExpanded("Inspector")).toBe(false);
    expect(component.sectionExpanded("Properties")).toBe(false);

    component.toggleSection("Properties");
    expect(component.sectionExpanded("Inspector")).toBe(true);
    expect(component.sectionExpanded("Properties")).toBe(true);

    component.toggleAll();
    expect(component.sectionExpanded("Inspector")).toBe(false);
    expect(component.sectionExpanded("Properties")).toBe(false);
    expect(component.sectionExpanded("Entities")).toBe(false);
    expect(component.sectionExpanded("Definition")).toBe(false);
    expect(component.isAllCollapsed()).toBe(true);

    component.toggleAll();
    expect(component.sectionExpanded("Inspector")).toBe(true);
    expect(component.isAllCollapsed()).toBe(false);
  });

  it("delegates relationship routing and active toggles to backend mutation endpoints", async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(MODELS_DEFAULT_ENDPOINT).flush({ tables: [], relationships: [] });

    const component = fixture.componentInstance;
    service.applyMutation(buildMutationResult());

    component.updateCardinality("OneToOne");
    const routingReq = httpMock.expectOne(
      `${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/relationships/fact_orders_cust_id_to_dim_customer/routing`,
    );
    expect(routingReq.request.method).toBe("PATCH");
    expect(routingReq.request.body).toEqual({
      cardinality: "ONE_TO_ONE",
      crossFilterDirection: "SINGLE",
    });
    const oneToOneRes = buildMutationResult({
      rsdl: "cardinality: OneToOne",
    });
    routingReq.flush({
      ...oneToOneRes,
      schema: {
        ...oneToOneRes.schema,
        relationships: [
          {
            ...oneToOneRes.schema.relationships![0],
            cardinality: "ONE_TO_ONE",
          },
        ],
      },
    });
    expect(component.selectedRel().cardinality).toBe("OneToOne");
    expect(component.activeRsdl()).toBe("cardinality: OneToOne");

    component.toggleActive();
    const activeReq = httpMock.expectOne(
      `${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/relationships/fact_orders_cust_id_to_dim_customer/active`,
    );
    expect(activeReq.request.method).toBe("PATCH");
    const inactiveRes = buildMutationResult({ rsdl: "isActive: false" });
    activeReq.flush({
      ...inactiveRes,
      schema: {
        ...inactiveRes.schema,
        relationships: [
          {
            ...inactiveRes.schema.relationships![0],
            isActive: false,
          },
        ],
      },
    });
    expect(component.selectedRel().isActive).toBe(false);
    expect(component.activeRsdl()).toBe("isActive: false");
  });

  it("validates DAG consistency via POST /api/models/rsdl and consumes server diagnostics", async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(MODELS_DEFAULT_ENDPOINT).flush({ tables: [], relationships: [] });

    const component = fixture.componentInstance;
    service.setTables(
      layoutTables([
        {
          name: "fact_orders",
          role: "FACT",
          columns: [{ name: "id", dataType: "Int64", isPrimaryKey: true }],
        },
      ]),
    );
    component.validateDag();
    const req = httpMock.expectOne(MODELS_RSDL_ENDPOINT);
    expect(req.request.method).toBe("POST");
    req.flush({
      schema: { modelId: DEFAULT_MODEL_ID, name: "Test", tables: [], relationships: [] },
      dagValidation: { valid: true, diagnostics: [] },
      rsdl: "// Backend RSDL",
    });
    expect(component.state.liveAnnouncement()).toContain("DAG Validation");
    expect(component.activeRsdl()).toBe("// Backend RSDL");
  });

  it("infers relationships and suggested date columns via POST /api/models/infer-relationships", () => {
    service.setTables(
      layoutTables([
        {
          name: "fact_orders",
          role: "FACT",
          columns: [{ name: "cust_id", dataType: "Int32", isForeignKey: true }],
        },
        {
          name: "dim_customer",
          role: "DIMENSION",
          columns: [{ name: "cust_id", dataType: "Int32", isPrimaryKey: true }],
        },
      ]),
    );

    let inferredCount = 0;
    service.inferRelationships().subscribe((res) => {
      inferredCount = res?.relationships.length ?? 0;
    });

    const inferReq = httpMock.expectOne(MODELS_INFER_ENDPOINT);
    expect(inferReq.request.method).toBe("POST");
    expect(Object.keys(inferReq.request.body)).toEqual(["tables"]);
    inferReq.flush({
      relationships: [
        {
          name: "fact_orders_cust_id_to_dim_customer",
          fromTable: "fact_orders",
          fromColumn: "cust_id",
          toTable: "dim_customer",
          toColumn: "cust_id",
          cardinality: "MANY_TO_ONE",
          crossFilterDirection: "SINGLE",
          isActive: true,
        },
      ],
      dateColumnsByTable: { dim_calendar: "date_key" },
      suggestedDateColumns: { dim_calendar: "date_key" },
    });

    const saveReq = httpMock.expectOne(`${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}`);
    expect(saveReq.request.method).toBe("PUT");
    saveReq.flush(buildMutationResult());

    expect(inferredCount).toBe(1);
    expect(service.relationships()[0].name).toBe(
      "fact_orders_cust_id_to_dim_customer",
    );
    expect(service.suggestedDates()["dim_calendar"]).toBe("date_key");
  });

  it("does not loop infer-relationships when backend returns zero relationships", () => {
    service.setTables(
      layoutTables([
        {
          name: "table_a",
          role: "FACT",
          columns: [{ name: "a_id", dataType: "Int32" }],
        },
        {
          name: "table_b",
          role: "DIMENSION",
          columns: [{ name: "b_date", dataType: "Date" }],
        },
      ]),
    );

    service.inferRelationships().subscribe();

    const inferReq = httpMock.expectOne(MODELS_INFER_ENDPOINT);
    inferReq.flush({
      relationships: [],
      dateColumnsByTable: { table_b: "b_date" },
      suggestedDateColumns: { table_b: "b_date" },
    });

    const saveReq = httpMock.expectOne(`${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}`);
    saveReq.flush(
      buildMutationResult({
        schema: {
          modelId: DEFAULT_MODEL_ID,
          name: "Empty Rels",
          tables: [
            { name: "table_a", role: "FACT", columns: [{ name: "a_id", dataType: "Int32" }] },
            { name: "table_b", role: "DIMENSION", columns: [{ name: "b_date", dataType: "Date" }] },
          ],
          relationships: [],
        },
      }),
    );

    httpMock.verify();
    expect(service.suggestedDates()["table_b"]).toBe("b_date");
  });

  it("delegates relationship create/delete, primary key, date table, hide foreign keys, and implicit measures to backend", async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(MODELS_DEFAULT_ENDPOINT).flush({ tables: [], relationships: [] });

    const component = fixture.componentInstance;
    service.applyMutation(buildMutationResult());

    component.startRelationship();
    component.createRelationship("fact_orders", "cust_id", "dim_customer", "cust_id");
    const createReq = httpMock.expectOne(
      `${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/relationships`,
    );
    expect(createReq.request.method).toBe("POST");
    createReq.flush(buildMutationResult());
    expect(component.isCreatingRel()).toBe(false);

    component.deleteRelationship("fact_orders_cust_id_to_dim_customer");
    const deleteReq = httpMock.expectOne(
      `${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/relationships/fact_orders_cust_id_to_dim_customer`,
    );
    expect(deleteReq.request.method).toBe("DELETE");
    deleteReq.flush(buildMutationResult());

    component.toggleKey("fact_orders", "order_id");
    const pkReq = httpMock.expectOne(`${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/primary-key`);
    expect(pkReq.request.body).toEqual({ tableName: "fact_orders", columnName: "order_id" });
    pkReq.flush(buildMutationResult());

    component.hideKeys();
    const fkReq = httpMock.expectOne(`${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/hide-foreign-keys`);
    expect(fkReq.request.method).toBe("POST");
    fkReq.flush(buildMutationResult());

    component.selectTable("dim_customer");
    component.markDate(true);
    const dateReq = httpMock.expectOne(`${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/date-table`);
    expect(dateReq.request.body.tableName).toBe("dim_customer");
    expect(dateReq.request.body.dateTable).toBe(true);
    dateReq.flush(buildMutationResult());

    component.toggleImplicit();
    const implicitReq = httpMock.expectOne(
      `${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/discourage-implicit-measures`,
    );
    expect(implicitReq.request.method).toBe("POST");
    implicitReq.flush(buildMutationResult());
  });

  it("surfaces RFC 9457 ProblemDetail error without corrupting local state", async () => {
    const fixture = TestBed.createComponent(ModelViewComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(MODELS_DEFAULT_ENDPOINT).flush({ tables: [], relationships: [] });

    const component = fixture.componentInstance;
    service.applyMutation(buildMutationResult());
    const relCountBefore = component.relationships().length;

    component.createRelationship("fact_orders", "cust_id", "fact_orders", "order_id");
    const badReq = httpMock.expectOne(
      `${MODELS_ENDPOINT}/${DEFAULT_MODEL_ID}/relationships`,
    );
    badReq.flush(
      {
        title: "Invalid Request Argument",
        status: 400,
        detail: "Self-join relationships are not supported on table 'fact_orders'.",
        errorCode: "ERR_INVALID_ARGUMENT",
        timestamp: "2026-11-24T15:00:00Z",
      },
      { status: 400, statusText: "Bad Request" },
    );

    expect(component.relationships().length).toBe(relCountBefore);
    expect(component.lastError()?.detail).toBe(
      "Self-join relationships are not supported on table 'fact_orders'.",
    );
    expect(component.state.liveAnnouncement()).toContain("Self-join relationships");
  });

  it("positions 5+ star-schema tables dynamically without coordinate overlap", async () => {
    const fiveTables = layoutTables([
      {
        name: "fact_operations",
        role: "FACT",
        columns: [{ name: "id", dataType: "Int64", isPrimaryKey: true }],
      },
      {
        name: "dim_calendar",
        role: "DIMENSION",
        columns: [{ name: "date_id", dataType: "Int32", isPrimaryKey: true }],
      },
      {
        name: "dim_entity",
        role: "DIMENSION",
        columns: [{ name: "entity_id", dataType: "Int32", isPrimaryKey: true }],
      },
      {
        name: "dim_item",
        role: "DIMENSION",
        columns: [{ name: "item_id", dataType: "Int32", isPrimaryKey: true }],
      },
      {
        name: "dim_region",
        role: "DIMENSION",
        columns: [{ name: "region_id", dataType: "Int32", isPrimaryKey: true }],
      },
    ]);

    const coordKeys = fiveTables.map(
      (tbl) => `${tbl.position.x}:${tbl.position.y}`,
    );
    expect(new Set(coordKeys).size).toBe(5);
  });
});
