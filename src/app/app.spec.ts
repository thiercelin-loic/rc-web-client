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
      'Export of Workspace-Report-300DPI.pdf failed. Please try again or contact support.'
    );

    const footerEl = fixture.nativeElement.querySelector('footer.rc-zone-status') as HTMLElement;
    expect(footerEl.classList.contains('rc-zone-status-error')).toBe(true);
    expect(footerEl.textContent).toContain(
      'Export of Workspace-Report-300DPI.pdf failed. Please try again or contact support.'
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
});

