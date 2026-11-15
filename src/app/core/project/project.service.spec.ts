import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { StateManagerService } from "../state-manager.service";
import { packZip, unpackZipArchive } from "../zip-archive";
import { PROJECT_FORMAT_VERSION } from "./project.constants";
import { ProjectService } from "./project.service";

describe("ProjectService", () => {
  let service: ProjectService;
  let stateManager: StateManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StateManagerService, ProjectService],
    });
    service = TestBed.inject(ProjectService);
    stateManager = TestBed.inject(StateManagerService);
  });

  it("exports project archive with all required specification files", () => {
    stateManager.addVisualToActivePage("Bar");
    const zipBytes = service.exportArchive();
    expect(zipBytes).toBeDefined();
    expect(zipBytes.length).toBeGreaterThan(0);

    const files = unpackZipArchive(zipBytes);

    expect(files["Version/manifest.json"]).toBeDefined();
    expect(files["Report/Layout.json"]).toBeDefined();
    expect(files["DataModel/model.rsdl"]).toBeDefined();
    expect(files["Settings/queries.rq.json"]).toBeDefined();
    expect(
      files["Report/StaticResources/SharedResources/BaseThemes/theme.json"],
    ).toBeDefined();
    expect(files["DataModel/data.json"]).toBeDefined();

    const manifest = JSON.parse(
      new TextDecoder().decode(files["Version/manifest.json"]),
    );
    expect(manifest.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(manifest.packageType).toBe("STANDALONE_PROJECT");

    const definition = JSON.parse(
      new TextDecoder().decode(files["Report/Layout.json"]),
    );
    expect(definition.pages).toBeDefined();
    expect(definition.pages.length).toBeGreaterThan(0);
  });

  it("opens and restores a valid .rcp archive file", async () => {
    const manifestContent = JSON.stringify({
      formatVersion: "1.2.0",
      title: "Finance Deepdive",
      packageType: "STANDALONE_PROJECT",
    });
    const definitionContent = JSON.stringify({
      version: "1.2.0",
      gridColumns: 12,
      pages: [
        {
          id: "finance-deepdive",
          title: "Finance Deepdive",
          visuals: [
            {
              visualId: "vis-1",
              archetype: "Line",
              measureId: "m_sales",
              layout: { colSpan: 6, rowSpan: 1 },
            },
          ],
        },
      ],
    });

    const entries = [
      {
        name: "manifest.json",
        data: new TextEncoder().encode(manifestContent),
      },
      {
        name: "definition.json",
        data: new TextEncoder().encode(definitionContent),
      },
      {
        name: "model.rsdl",
        data: new TextEncoder().encode("// RSDL definition"),
      },
      { name: "queries.rq.json", data: new TextEncoder().encode("[]") },
      { name: "theme.json", data: new TextEncoder().encode('{"name":"Test"}') },
    ];

    const zipBytes = packZip(entries);
    const mockFile = new File(
      [zipBytes as unknown as BlobPart],
      "finance_q3.rcp",
      {
        type: "application/x-rollercoaster-project",
      },
    );
    mockFile.arrayBuffer = async () =>
      zipBytes.buffer.slice(
        zipBytes.byteOffset,
        zipBytes.byteOffset + zipBytes.byteLength,
      ) as ArrayBuffer;

    await service.openFile(mockFile);

    expect(stateManager.activeProject().filename).toBe("finance_q3.rcp");
    expect(stateManager.activePage()).toBe("Finance Deepdive");
    expect(stateManager.reportPages()).toContain("Finance Deepdive");
    expect(stateManager.activePageVisuals()).toHaveLength(1);
    expect(stateManager.activePageVisuals()[0].archetype).toBe("Line");
  });

  it("handles corrupt archive gracefully by setting error status", async () => {
    const corruptBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const mockCorruptFile = new File(
      [corruptBytes as unknown as BlobPart],
      "invalid.rcp",
      {
        type: "application/octet-stream",
      },
    );
    mockCorruptFile.arrayBuffer = async () =>
      corruptBytes.buffer.slice(
        corruptBytes.byteOffset,
        corruptBytes.byteOffset + corruptBytes.byteLength,
      ) as ArrayBuffer;

    await service.openFile(mockCorruptFile);

    expect(stateManager.statusIsError()).toBe(true);
    expect(stateManager.statusMessage()).toContain(
      "Opening invalid.rcp failed",
    );
  });

  it("creates a new blank project and updates state", () => {
    stateManager.addVisualToActivePage("Pie");
    expect(stateManager.activePageVisuals().length).toBeGreaterThan(0);

    service.createProject("Blank Canvas.rcp");

    expect(stateManager.activeProject().filename).toBe("Blank Canvas.rcp");
    expect(stateManager.activePageVisuals()).toHaveLength(0);
    expect(stateManager.statusIsError()).toBe(false);
  });

  it("renames active project via service and state manager", () => {
    const success = service.renameProject("Quarterly Financials");
    expect(success).toBe(true);
    expect(stateManager.activeProject().filename).toBe(
      "Quarterly Financials.rcp",
    );
    expect(stateManager.activeProject().statusPill).toBe("draft [unsaved]");
  });

  it("rejects empty project names during rename", () => {
    const success = service.renameProject("   ");
    expect(success).toBe(false);
  });

  it("round-trips visual bindings, tables, rows, and measures across accounts", async () => {
    stateManager.syncTables([
      {
        id: "tbl-1",
        name: "elections",
        role: "FACT",
        columns: [
          { name: "candidate", dataType: "TEXT" },
          { name: "voix", dataType: "INTEGER" },
        ],
      },
    ]);
    stateManager.setTableRows("elections", [
      { candidate: "A", voix: 100 },
      { candidate: "B", voix: 80 },
    ]);
    const visual = stateManager.addVisualToActivePage("Bar");
    stateManager.updateVisualSort(visual.id, "value", "desc");
    stateManager.updateVisualFieldWells(visual.id, {
      axis: ["candidate"],
      values: ["voix"],
    });

    const zipBytes = service.exportArchive();

    stateManager.syncTables([]);
    stateManager.setTableRows("elections", []);
    service.createProject("Empty");

    const mockFile = new File(
      [zipBytes as unknown as BlobPart],
      "elections.rcp",
      {
        type: "application/x-rollercoaster-project",
      },
    );
    mockFile.arrayBuffer = async () =>
      zipBytes.buffer.slice(
        zipBytes.byteOffset,
        zipBytes.byteOffset + zipBytes.byteLength,
      ) as ArrayBuffer;

    const loaded = await service.openFile(mockFile);
    expect(loaded).toBe(true);
    expect(stateManager.sharedTables).toHaveLength(1);
    expect(stateManager.sharedTables[0].name).toBe("elections");
    expect(stateManager.getTableRows("elections")).toHaveLength(2);
    expect(stateManager.activePageVisuals()[0].fieldWells).toEqual({
      axis: ["candidate"],
      values: ["voix"],
    });
    expect(stateManager.activePageVisuals()[0].sortBy).toBe("value");
    expect(stateManager.activePageVisuals()[0].sortOrder).toBe("desc");
  });
});
