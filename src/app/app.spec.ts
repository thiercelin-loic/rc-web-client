import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AppComponent } from './app';
import { routes } from './app.routes';

describe('AppComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('instantiates root component cleanly', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeDefined();
  });

  it('blocks export and displays error alert in bottom status bar when report builder is empty', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    expect(app.state.activePageVisuals()).toHaveLength(0);

    app.triggerQuickExport('.pdf');
    fixture.detectChanges();

    httpMock.expectNone('/api/reports/export/pdf');
    expect(app.state.statusIsError()).toBe(true);
    expect(app.state.statusMessage()).toBe(
      'Export of Workspace-Report-300DPI.pdf failed: page "Page 1" has no visuals to export — add at least one visual on the canvas first.'
    );

    const footerEl = fixture.nativeElement.querySelector('footer.rc-zone-status') as HTMLElement;
    expect(footerEl.classList.contains('rc-zone-status-error')).toBe(true);
    expect(footerEl.textContent).toContain(
      'Export of Workspace-Report-300DPI.pdf failed: page "Page 1" has no visuals to export — add at least one visual on the canvas first.'
    );
  });

  it('renders .pdf export in light mode even when user is in dark mode', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    app.state.addVisualToActivePage('Bar');
    app.state.setThemePreference('dark');
    fixture.detectChanges();

    const layoutEl = fixture.nativeElement.querySelector('.app-workspace-layout') as HTMLElement;
    expect(layoutEl.getAttribute('data-bs-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

    let layoutThemeDuringPrint: string | null = null;
    let docThemeDuringPrint: string | null = null;

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      layoutThemeDuringPrint = layoutEl.getAttribute('data-bs-theme');
      docThemeDuringPrint = document.documentElement.getAttribute('data-bs-theme');
    });

    app.triggerQuickExport('.pdf');

    const req = httpMock.expectOne('/api/reports/export/pdf');
    req.flush({
      jobId: 'job-pdf-header',
      format: '.pdf',
      mimeType: 'application/pdf',
      filename: 'Workspace-Report-300DPI.pdf',
      engine: 'Playwright Headless Chromium (300 DPI Vector/Raster)',
      status: 'COMPLETED',
      timestamp: '2026-10-25T14:55:00Z'
    });

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(layoutThemeDuringPrint).toBe('light');
    expect(docThemeDuringPrint).toBe('light');

    // Restores dark mode after PDF export completes
    expect(layoutEl.getAttribute('data-bs-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

    printSpy.mockRestore();
  });

  it('toggles project roll list menu and triggers save/new project actions', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    expect(app.projectMenuOpen()).toBe(false);

    app.toggleProjectMenu();
    fixture.detectChanges();
    expect(app.projectMenuOpen()).toBe(true);

    const saveSpy = vi.spyOn(app.projectService, 'saveProject').mockImplementation(() => {});
    app.onSaveProject();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(app.projectMenuOpen()).toBe(false);

    app.toggleProjectMenu();
    expect(app.projectMenuOpen()).toBe(true);

    const createSpy = vi.spyOn(app.projectService, 'createNewProject').mockImplementation(() => {});
    app.onCreateNewProject();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(app.projectMenuOpen()).toBe(false);

    // Escape closes project menu
    app.toggleProjectMenu();
    expect(app.projectMenuOpen()).toBe(true);
    app.onEscapeKey();
    expect(app.projectMenuOpen()).toBe(false);

    saveSpy.mockRestore();
    createSpy.mockRestore();
  });

  it('supports renaming active project via rename methods and keyboard controls', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    expect(app.editingProject()).toBe(false);

    // Start rename
    app.startRenameProject();
    expect(app.editingProject()).toBe(true);
    expect(app.editingProjectValue()).toBe('Untitled Project');

    // Cancel rename via cancelRenameProject
    app.cancelRenameProject();
    expect(app.editingProject()).toBe(false);

    // Start rename and cancel via Escape
    app.startRenameProject();
    expect(app.editingProject()).toBe(true);
    app.onEscapeKey();
    expect(app.editingProject()).toBe(false);

    // Start rename, type new name, commit
    app.startRenameProject();
    app.editingProjectValue.set('Quarterly-Review-2026');
    app.commitRenameProject();
    expect(app.editingProject()).toBe(false);
    expect(app.state.activeProject().filename).toBe('Quarterly-Review-2026.rcp');
    expect(app.state.activeProject().statusPill).toBe('draft [unsaved]');
  });

  it('renders distinct adapted vector logos for each export format in the export menu', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    app.toggleExportMenu();
    fixture.detectChanges();

    const menuEl = fixture.nativeElement.querySelector('.rc-export-menu') as HTMLElement;
    expect(menuEl).toBeTruthy();

    const items = menuEl.querySelectorAll<HTMLButtonElement>('button.dropdown-item');
    expect(items.length).toBe(app.exportFormats.length);

    items.forEach((item, index) => {
      const svg = item.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(item.textContent).toContain(app.exportFormats[index]);
    });
  });

  it('does not render report page tabs in top ribbon as they are scoped to report builder', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const ribbonPageTab = fixture.nativeElement.querySelector('.rc-ribbon .rc-page-tab-title');
    expect(ribbonPageTab).toBeNull();
  });

  it('renders the single semantic h1 page title on the left and project menu on the right of the ribbon', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    const pageTitleH1 = fixture.nativeElement.querySelector('header.rc-zone-ribbon #rc-ribbon-page-title') as HTMLElement;
    expect(pageTitleH1).toBeTruthy();
    expect(pageTitleH1.tagName.toLowerCase()).toBe('h1');
    expect(pageTitleH1.textContent?.trim()).toBe(app.currentPageTitle());

    const rightCluster = fixture.nativeElement.querySelector('header.rc-zone-ribbon > div:last-child') as HTMLElement;
    expect(rightCluster).toBeTruthy();

    const projectContainer = rightCluster.querySelector('#rc-current-project-container');
    const exportContainer = rightCluster.querySelector('#export-dropdown-container');
    expect(projectContainer).toBeTruthy();
    expect(exportContainer).toBeTruthy();

    // Verify project container appears before export container in right cluster
    const children = Array.from(rightCluster.children);
    expect(children.indexOf(projectContainer!)).toBeLessThan(children.indexOf(exportContainer!));
  });

  it('provides global Import file roll-list menu matching Export and Load/Transform Navigator workflow', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    const importBtn = fixture.nativeElement.querySelector('#ribbon-import-btn') as HTMLButtonElement;
    expect(importBtn).toBeTruthy();
    expect(importBtn.textContent).toContain('Import');

    importBtn.click();
    fixture.detectChanges();
    expect(app.ingestion.importMenuOpen()).toBe(true);

    const menuEl = fixture.nativeElement.querySelector('.rc-import-menu') as HTMLElement;
    expect(menuEl).toBeTruthy();

    const items = menuEl.querySelectorAll<HTMLButtonElement>('button.dropdown-item');
    expect(items.length).toBe(app.ingestion.fileConnectors.length);
    items.forEach((item, index) => {
      const svg = item.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(item.textContent).toContain(app.ingestion.fileConnectors[index].name);
      expect(app.ingestion.fileConnectors[index].category).toBe('file');
    });

    app.onEscapeKey();
    fixture.detectChanges();
    expect(app.ingestion.importMenuOpen()).toBe(false);

    // Trigger Navigator and Load directly into StateManagerService
    app.ingestion.openText(
      'sales_global.csv',
      'CSV',
      'CSV',
      'Region,Revenue\nEurope,1200\nNorth America,2400',
    );
    fixture.detectChanges();
    expect(app.ingestion.isNavigatorModalOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('#navigator-modal-title')).toBeTruthy();

    app.ingestion.confirmNavigator('load');
    fixture.detectChanges();
    expect(app.ingestion.isNavigatorModalOpen()).toBe(false);
    expect(app.state.sharedTables.some((t) => t.name === 'sales_global')).toBe(true);
    expect(app.state.getTableRows('sales_global').length).toBe(2);
  });

  it('caps Navigator preview DOM rows at 100 while loading full JSON dataset rows', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const app = fixture.componentInstance;
    const records = Array.from({ length: 125 }, (_, i) => ({
      joueur: `Joueur ${i + 1}`,
      buts: i,
    }));

    app.ingestion.openText(
      'Performances_Ligue1_10_Saisons.json',
      'REST',
      'JSON',
      JSON.stringify(records, null, 2),
    );
    fixture.detectChanges();

    const bodyRows = fixture.nativeElement.querySelectorAll('.rc-preview-table tbody tr');
    expect(bodyRows.length).toBe(100);

    app.ingestion.confirmNavigator('load');
    fixture.detectChanges();
    expect(app.state.getTableRows('Performances_Ligue1_10_Saisons').length).toBe(125);
  });

  it('renders Full Screen button before project container and toggles full screen mode with telemetry', async () => {
    const originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const originalRequestFullscreen = Object.getOwnPropertyDescriptor(document.documentElement, 'requestFullscreen');
    const originalExitFullscreen = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');

    let currentFullscreenEl: Element | null = null;
    const requestFullscreenMock = vi.fn(async () => {
      currentFullscreenEl = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const exitFullscreenMock = vi.fn(async () => {
      currentFullscreenEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => currentFullscreenEl,
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreenMock,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreenMock,
    });

    try {
      const fixture = TestBed.createComponent(AppComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const app = fixture.componentInstance;
      const rightCluster = fixture.nativeElement.querySelector('header.rc-zone-ribbon > div:last-child') as HTMLElement;
      const fullscreenBtn = rightCluster.querySelector('#ribbon-fullscreen-btn') as HTMLButtonElement;
      const projectContainer = rightCluster.querySelector('#rc-current-project-container') as HTMLElement;

      expect(fullscreenBtn).toBeTruthy();
      expect(projectContainer).toBeTruthy();

      const children = Array.from(rightCluster.children);
      expect(children.indexOf(fullscreenBtn)).toBeLessThan(children.indexOf(projectContainer));

      expect(app.isFullscreen()).toBe(false);
      expect(fullscreenBtn.getAttribute('aria-label')).toBe('Enter full screen mode');
      expect(fullscreenBtn.textContent).toContain('Full Screen');
      expect(fullscreenBtn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

      // Enter full screen via click
      fullscreenBtn.click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
      expect(app.isFullscreen()).toBe(true);
      expect(app.state.statusMessage()).toBe('Entered full screen mode.');
      expect(fullscreenBtn.getAttribute('aria-label')).toBe('Exit full screen mode');
      expect(fullscreenBtn.textContent).toContain('Exit Full Screen');

      // Exit full screen via click
      fullscreenBtn.click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
      expect(app.isFullscreen()).toBe(false);
      expect(app.state.statusMessage()).toBe('Exited full screen mode.');
      expect(fullscreenBtn.getAttribute('aria-label')).toBe('Enter full screen mode');
      expect(fullscreenBtn.textContent).toContain('Full Screen');

      // External Escape / browser fullscreenchange syncs signal
      currentFullscreenEl = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      fixture.detectChanges();
      expect(app.isFullscreen()).toBe(true);

      currentFullscreenEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      fixture.detectChanges();
      expect(app.isFullscreen()).toBe(false);
      expect(app.state.statusMessage()).toBe('Exited full screen mode.');
    } finally {
      if (originalFullscreenElement) {
        Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement);
      } else {
        delete (document as unknown as Record<string, unknown>)['fullscreenElement'];
      }
      if (originalRequestFullscreen) {
        Object.defineProperty(document.documentElement, 'requestFullscreen', originalRequestFullscreen);
      } else {
        delete (document.documentElement as unknown as Record<string, unknown>)['requestFullscreen'];
      }
      if (originalExitFullscreen) {
        Object.defineProperty(document, 'exitFullscreen', originalExitFullscreen);
      } else {
        delete (document as unknown as Record<string, unknown>)['exitFullscreen'];
      }
    }
  });

  it('announces graceful feedback when full screen toggle is rejected or unsupported', async () => {
    const originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const originalRequestFullscreen = Object.getOwnPropertyDescriptor(document.documentElement, 'requestFullscreen');
    const originalWebkitRequestFullscreen = Object.getOwnPropertyDescriptor(document.documentElement, 'webkitRequestFullscreen');

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: undefined,
    });

    try {
      const fixture = TestBed.createComponent(AppComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const app = fixture.componentInstance;
      await app.toggleFullscreen();
      expect(app.isFullscreen()).toBe(false);
      expect(app.state.statusMessage()).toBe('Full screen mode is not supported in this browser.');

      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value: vi.fn().mockRejectedValue(new Error('Permission denied')),
      });

      await app.toggleFullscreen();
      expect(app.isFullscreen()).toBe(false);
      expect(app.state.statusIsError()).toBe(true);
      expect(app.state.statusMessage()).toBe('Unable to toggle full screen mode.');
    } finally {
      if (originalFullscreenElement) {
        Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement);
      } else {
        delete (document as unknown as Record<string, unknown>)['fullscreenElement'];
      }
      if (originalRequestFullscreen) {
        Object.defineProperty(document.documentElement, 'requestFullscreen', originalRequestFullscreen);
      } else {
        delete (document.documentElement as unknown as Record<string, unknown>)['requestFullscreen'];
      }
      if (originalWebkitRequestFullscreen) {
        Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', originalWebkitRequestFullscreen);
      } else {
        delete (document.documentElement as unknown as Record<string, unknown>)['webkitRequestFullscreen'];
      }
    }
  });
});

