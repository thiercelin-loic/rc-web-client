import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { CompositeFilterContext, StateManagerService, THEME_STORAGE_KEY } from './state-manager.service';

describe('CompositeFilterContext', () => {
  it('creates immutable filter contexts and stable hashes', () => {
    const initial = new CompositeFilterContext();
    const next = initial.withFilter('Region', 'EQ', ['DACH']);

    expect(initial.getSelectedValue('Region')).toBe('All');
    expect(next.getSelectedValue('Region')).toBe('DACH');
    expect(next.toContextHash()).toMatch(/^[0-9a-f]{8}$/);
    expect(next.toContextHash()).toBe(
      new CompositeFilterContext().withFilter('Region', 'EQ', ['DACH']).toContextHash()
    );
  });
});

describe('StateManagerService', () => {
  let service: StateManagerService;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateManagerService);
  });

  it('loads semantic cache state only for the authenticated user scope', () => {
    window.localStorage.setItem(
      'rc_user',
      JSON.stringify({ id: 'user-two' }),
    );
    window.localStorage.setItem(
      'rc_tables_state:user-one',
      JSON.stringify([
        {
          id: 'user-one-table',
          name: 'PrivateTable',
          role: 'FACT',
          columns: [],
        },
      ]),
    );
    window.localStorage.setItem(
      'rc_tables_state:user-two',
      JSON.stringify([
        {
          id: 'user-two-table',
          name: 'PrivateTable',
          role: 'FACT',
          columns: [],
        },
      ]),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const scopedService = TestBed.inject(StateManagerService);

    expect(scopedService.sharedTables).toEqual([
      {
        id: 'user-two-table',
        name: 'PrivateTable',
        role: 'FACT',
        columns: [],
      },
    ]);
  });

  it('updates filter signals and announcements', () => {
    service.applyFilter('Region', 'EQ', ['DACH']);

    expect(service.selectedRegion()).toBe('DACH');
    expect(service.liveAnnouncement()).toContain('Region EQ DACH');
  });

  it('starts with an empty customFormulaText to allow placeholder display', () => {
    expect(service.customFormulaText()).toBe('');
  });

  it('starts without seeded measures', () => {
    expect(service.measures).toHaveLength(0);
    expect(service.activeMeasure().label).toBe('No measure selected');
  });

  it('tracks status messages and loading state for bottom status bar', () => {
    expect(service.statusMessage()).toBe('Ready');
    expect(service.isLoading()).toBe(false);
    expect(service.statusIsError()).toBe(false);

    service.announce('Loaded enterprise schema model.');
    expect(service.statusMessage()).toBe('Loaded enterprise schema model.');
    expect(service.isLoading()).toBe(false);
    expect(service.statusIsError()).toBe(false);

    service.announce('Unable to save semantic model: permission denied.');
    expect(service.statusMessage()).toBe('Unable to save semantic model: permission denied.');
    expect(service.statusIsError()).toBe(true);

    service.announceError('Saving semantic model');
    expect(service.statusMessage()).toBe('Saving semantic model failed.');

    service.announceError('Saving semantic model', new Error('disk quota exceeded'));
    expect(service.statusMessage()).toBe('Saving semantic model failed: disk quota exceeded.');

    service.setLoading(true, 'Exporting 300 DPI PDF...');
    expect(service.statusMessage()).toBe('Exporting 300 DPI PDF...');
    expect(service.isLoading()).toBe(true);
    expect(service.statusIsError()).toBe(false);

    service.setLoading(false);
    expect(service.statusMessage()).toBe('Ready');
    expect(service.isLoading()).toBe(false);
    expect(service.statusIsError()).toBe(false);
  });

  it('reports safe, detailed request outcomes without exposing request URLs', () => {
    service.recordExchange('request', 'GET', '/api/private-model', null, 0);
    expect(service.statusMessage()).toBe('GET request sent.');
    expect(service.statusMessage()).not.toContain('/api/private-model');

    service.recordExchange('success', 'GET', '/api/private-model', 200, 84.6);
    expect(service.statusMessage()).toBe('GET request completed successfully (200) in 85 ms.');
    expect(service.statusIsError()).toBe(false);

    service.recordExchange('error', 'POST', '/api/private-model', 503, 121.2);
    expect(service.statusMessage()).toBe('POST request failed (503) after 121 ms.');
    expect(service.statusIsError()).toBe(true);
    expect(service.statusMessage()).not.toContain('/api/private-model');
  });

  describe('Report page visual isolation', () => {
    it('keeps visuals scoped to the page they were added on', () => {
      service.addVisualToActivePage('Line');
      expect(service.activePageVisuals()).toHaveLength(1);

      service.addReportPage();
      expect(service.activePage()).toBe('Page 2');
      expect(service.activePageVisuals()).toHaveLength(0);

      service.addVisualToActivePage('Bar');
      service.addVisualToActivePage('Donut');
      expect(service.activePageVisuals()).toHaveLength(2);

      service.selectPage('Page 1');
      expect(service.activePageVisuals()).toHaveLength(1);
      expect(service.activePageVisuals()[0].archetype).toBe('Line');
    });

    it('clears only the active page canvas', () => {
      service.addVisualToActivePage('Line');
      service.addReportPage();
      service.addVisualToActivePage('Bar');

      service.clearActivePageVisuals();
      expect(service.getVisualsForPage('Page 2')).toHaveLength(0);
      expect(service.getVisualsForPage('Page 1')).toHaveLength(1);
    });

    it('carries visuals across rename and drops them on removal', () => {
      service.addVisualToActivePage('Gauge');
      service.renameReportPage('Page 1', 'Overview');
      expect(service.getVisualsForPage('Overview')).toHaveLength(1);
      expect(service.getVisualsForPage('Page 1')).toHaveLength(0);

      service.addReportPage();
      service.removeReportPage('Overview');
      expect(service.getVisualsForPage('Overview')).toHaveLength(0);
    });

    it('reorders and moves visuals on the active page', () => {
      const vis1 = service.addVisualToActivePage('Bar');
      const vis2 = service.addVisualToActivePage('Line');
      const vis3 = service.addVisualToActivePage('Donut');

      expect(service.activePageVisuals().map((v) => v.id)).toEqual([
        vis1.id,
        vis2.id,
        vis3.id,
      ]);

      // Move last visual to first
      service.reorderVisualsOnActivePage(2, 0);
      expect(service.activePageVisuals().map((v) => v.id)).toEqual([
        vis3.id,
        vis1.id,
        vis2.id,
      ]);

      // Move directional earlier / later
      service.moveVisualOnActivePage(vis2.id, 'earlier');
      expect(service.activePageVisuals().map((v) => v.id)).toEqual([
        vis3.id,
        vis2.id,
        vis1.id,
      ]);

      service.moveVisualOnActivePage(vis3.id, 'later');
      expect(service.activePageVisuals().map((v) => v.id)).toEqual([
        vis2.id,
        vis3.id,
        vis1.id,
      ]);
    });
  });
  describe('Theme Management (System & Manual)', () => {
    it('defaults to system theme when no manual preference is stored', () => {
      expect(service.themePreference()).toBe('system');
      expect(service.isSystemTheme()).toBe(true);
      expect(service.theme()).toBe(service.systemTheme());
      expect(document.documentElement.getAttribute('data-bs-theme')).toBe(service.theme());
    });

    it('manually toggles theme between light and dark and persists preference', () => {
      const initial = service.theme();
      const expectedNext = initial === 'light' ? 'dark' : 'light';

      service.toggleTheme();
      expect(service.theme()).toBe(expectedNext);
      expect(service.themePreference()).toBe(expectedNext);
      expect(service.isSystemTheme()).toBe(false);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(expectedNext);
      expect(document.documentElement.getAttribute('data-bs-theme')).toBe(expectedNext);

      // Toggle back
      service.toggleTheme();
      expect(service.theme()).toBe(initial);
      expect(service.themePreference()).toBe(initial);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(initial);
      expect(document.documentElement.getAttribute('data-bs-theme')).toBe(initial);
    });

    it('allows resetting manual theme override back to follow system preference', () => {
      service.setThemePreference('dark');
      expect(service.themePreference()).toBe('dark');
      expect(service.isSystemTheme()).toBe(false);

      service.resetThemeToSystem();
      expect(service.themePreference()).toBe('system');
      expect(service.isSystemTheme()).toBe(true);
      expect(service.theme()).toBe(service.systemTheme());
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
      expect(document.documentElement.getAttribute('data-bs-theme')).toBe(service.systemTheme());
    });

    it('dynamically adapts resolved theme when system mode changes while in system preference', () => {
      service.resetThemeToSystem();
      expect(service.isSystemTheme()).toBe(true);

      // Simulate system theme changing to dark
      service.systemTheme.set('dark');
      expect(service.theme()).toBe('dark');

      // Simulate system theme changing to light
      service.systemTheme.set('light');
      expect(service.theme()).toBe('light');

      // If manual override is active, system changes do not override user choice
      service.setThemePreference('dark');
      service.systemTheme.set('light');
      expect(service.theme()).toBe('dark');
    });
  });
});
