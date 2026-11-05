import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ProjectSerializationService } from './project-serialization.service';
import { StateManagerService } from './state-manager.service';
import { packZipArchive, unpackZipArchive } from './zip-archive';

describe('ProjectSerializationService', () => {
  let service: ProjectSerializationService;
  let stateManager: StateManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StateManagerService, ProjectSerializationService]
    });
    service = TestBed.inject(ProjectSerializationService);
    stateManager = TestBed.inject(StateManagerService);
  });

  it('exports project archive with all required specification files', () => {
    stateManager.addVisualToActivePage('Bar');
    const zipBytes = service.exportProjectArchive();
    expect(zipBytes).toBeDefined();
    expect(zipBytes.length).toBeGreaterThan(0);

    const files = unpackZipArchive(zipBytes);

    expect(files['manifest.json']).toBeDefined();
    expect(files['definition.json']).toBeDefined();
    expect(files['model.rsdl']).toBeDefined();
    expect(files['queries.rq.json']).toBeDefined();
    expect(files['theme.json']).toBeDefined();

    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    expect(manifest.formatVersion).toBe('1.2.0');
    expect(manifest.packageType).toBe('STANDALONE_PROJECT');

    const definition = JSON.parse(new TextDecoder().decode(files['definition.json']));
    expect(definition.pages).toBeDefined();
    expect(definition.pages.length).toBeGreaterThan(0);
  });

  it('opens and restores a valid .rcp archive file', async () => {
    const manifestContent = JSON.stringify({
      formatVersion: '1.2.0',
      title: 'Finance Deepdive',
      packageType: 'STANDALONE_PROJECT'
    });
    const definitionContent = JSON.stringify({
      version: '1.2.0',
      gridColumns: 12,
      pages: [
        {
          id: 'finance-deepdive',
          title: 'Finance Deepdive',
          visuals: [
            {
              visualId: 'vis-1',
              archetype: 'Line',
              measureId: 'm_sales',
              layout: { colSpan: 6, rowSpan: 1 }
            }
          ]
        }
      ]
    });

    const entries = [
      { name: 'manifest.json', data: new TextEncoder().encode(manifestContent) },
      { name: 'definition.json', data: new TextEncoder().encode(definitionContent) },
      { name: 'model.rsdl', data: new TextEncoder().encode('// RSDL definition') },
      { name: 'queries.rq.json', data: new TextEncoder().encode('[]') },
      { name: 'theme.json', data: new TextEncoder().encode('{"name":"Test"}') }
    ];

    const zipBytes = packZipArchive(entries);
    const mockFile = new File([zipBytes as unknown as BlobPart], 'finance_q3.rcp', {
      type: 'application/x-rollercoaster-project'
    });
    mockFile.arrayBuffer = async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;

    await service.openProjectFile(mockFile);

    expect(stateManager.activeProject().filename).toBe('finance_q3.rcp');
    expect(stateManager.activePage()).toBe('Finance Deepdive');
    expect(stateManager.reportPages()).toContain('Finance Deepdive');
    expect(stateManager.activePageVisuals()).toHaveLength(1);
    expect(stateManager.activePageVisuals()[0].archetype).toBe('Line');
  });

  it('handles corrupt archive gracefully by setting error status', async () => {
    const corruptBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const mockCorruptFile = new File([corruptBytes as unknown as BlobPart], 'invalid.rcp', {
      type: 'application/octet-stream'
    });
    mockCorruptFile.arrayBuffer = async () => corruptBytes.buffer.slice(corruptBytes.byteOffset, corruptBytes.byteOffset + corruptBytes.byteLength) as ArrayBuffer;

    await service.openProjectFile(mockCorruptFile);

    expect(stateManager.statusIsError()).toBe(true);
    expect(stateManager.statusMessage()).toContain('Opening invalid.rcp failed');
  });

  it('creates a new blank project and updates state', () => {
    stateManager.addVisualToActivePage('Pie');
    expect(stateManager.activePageVisuals().length).toBeGreaterThan(0);

    service.createNewProject('Blank Canvas.rcp');

    expect(stateManager.activeProject().filename).toBe('Blank Canvas.rcp');
    expect(stateManager.activePageVisuals()).toHaveLength(0);
    expect(stateManager.statusIsError()).toBe(false);
  });

  it('renames active project via service and state manager', () => {
    const success = service.renameProject('Quarterly Financials');
    expect(success).toBe(true);
    expect(stateManager.activeProject().filename).toBe('Quarterly Financials.rcp');
    expect(stateManager.activeProject().statusPill).toBe('draft [unsaved]');
  });

  it('rejects empty project names during rename', () => {
    const success = service.renameProject('   ');
    expect(success).toBe(false);
  });
});
