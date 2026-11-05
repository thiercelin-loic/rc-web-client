import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ExportJobReceipt, ExportService } from './export.service';
import { StateManagerService } from './state-manager.service';

describe('ExportService', () => {
  let service: ExportService;
  let state: StateManagerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ExportService,
        StateManagerService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(ExportService);
    state = TestBed.inject(StateManagerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('initializes with null lastExportReceipt signal', () => {
    expect(service.lastExportReceipt()).toBeNull();
  });

  it('blocks export across all formats and sets status bar error when report builder canvas is empty', () => {
    expect(state.activePageVisuals()).toHaveLength(0);

    const expectedFilenames: Record<string, string> = {
      '.pdf': 'Workspace-Report-300DPI.pdf',
      '.xlsx': 'Workspace-Report.xlsx',
      '.parquet': 'Workspace-Report.parquet',
      '.csv': 'Workspace-Report.csv',
      '.tsv': 'Workspace-Report.tsv'
    };

    for (const fmt of ['.pdf', '.xlsx', '.parquet', '.csv', '.tsv'] as const) {
      service.triggerExport('report-1', 'visual-1', fmt).subscribe();
      httpMock.expectNone('/api/reports/export/pdf');
      httpMock.expectNone('/api/reports/report-1/visuals/visual-1/export');
      expect(state.statusIsError()).toBe(true);
      expect(state.isLoading()).toBe(false);
      expect(state.statusMessage()).toBe(
        `Export of ${expectedFilenames[fmt]} failed. Please try again or contact support.`
      );
      expect(service.lastExportReceipt()).toBeNull();
    }
  });

  it('forces light mode during .pdf export and restores dark mode afterwards', () => {
    state.addVisualToActivePage('Bar');
    state.setThemePreference('dark');
    expect(state.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

    const workspaceEl = document.createElement('div');
    workspaceEl.setAttribute('data-bs-theme', 'dark');
    document.body.appendChild(workspaceEl);

    let themeDuringPrint: string | null = null;
    let workspaceThemeDuringPrint: string | null = null;
    let stateThemeDuringPrint: string | null = null;

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      themeDuringPrint = document.documentElement.getAttribute('data-bs-theme');
      workspaceThemeDuringPrint = workspaceEl.getAttribute('data-bs-theme');
      stateThemeDuringPrint = state.theme();
    });

    service.triggerExport('report-1', 'visual-1', '.pdf').subscribe();

    const req = httpMock.expectOne('/api/reports/export/pdf');
    req.flush({
      jobId: 'job-pdf-1',
      format: '.pdf',
      mimeType: 'application/pdf',
      filename: 'Workspace-Report-300DPI.pdf',
      engine: 'Playwright Headless Chromium (300 DPI Vector/Raster)',
      status: 'COMPLETED',
      timestamp: '2026-10-25T14:55:00Z'
    });

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(themeDuringPrint).toBe('light');
    expect(workspaceThemeDuringPrint).toBe('light');
    expect(stateThemeDuringPrint).toBe('light');

    // Restored to dark mode after printing completes
    expect(state.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(workspaceEl.getAttribute('data-bs-theme')).toBe('dark');

    document.body.removeChild(workspaceEl);
    printSpy.mockRestore();
  });

  it('builds valid OpenXML ZIP archive bytes for .xlsx exports with PK magic header', () => {
    const visual = state.addVisualToActivePage('Bar');
    state.updateVisualTitleOnActivePage(visual.id, 'Revenue <Q1> & "Forecast"');

    const receipt: ExportJobReceipt = {
      jobId: 'job-xlsx-1',
      format: '.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'Workspace-Report.xlsx',
      engine: 'Apache POI SXSSFWorkbook (100-row sliding window)',
      status: 'COMPLETED',
      timestamp: '2026-10-25T15:00:00Z'
    };

    const xlsxBytes = service.buildXlsxZipBytes(receipt);
    // Must start with ZIP local file header signature PK\x03\x04
    expect(xlsxBytes[0]).toBe(0x50); // 'P'
    expect(xlsxBytes[1]).toBe(0x4b); // 'K'
    expect(xlsxBytes[2]).toBe(0x03);
    expect(xlsxBytes[3]).toBe(0x04);

    // Must end with ZIP End of Central Directory (EOCD) signature PK\x05\x06 at -22 bytes
    const eocdOffset = xlsxBytes.length - 22;
    expect(xlsxBytes[eocdOffset]).toBe(0x50);
    expect(xlsxBytes[eocdOffset + 1]).toBe(0x4b);
    expect(xlsxBytes[eocdOffset + 2]).toBe(0x05);
    expect(xlsxBytes[eocdOffset + 3]).toBe(0x06);

    const decodedText = new TextDecoder().decode(xlsxBytes);
    expect(decodedText).toContain('[Content_Types].xml');
    expect(decodedText).toContain('xl/workbook.xml');
    expect(decodedText).toContain('xl/worksheets/sheet1.xml');
    expect(decodedText).toContain('Revenue &lt;Q1&gt; &amp; &quot;Forecast&quot;');
  });

  it('builds valid Apache Parquet v1 binary bytes for .parquet exports with PAR1 magic bytes', () => {
    state.addVisualToActivePage('Line');

    const receipt: ExportJobReceipt = {
      jobId: 'job-parquet-1',
      format: '.parquet',
      mimeType: 'application/vnd.apache.parquet',
      filename: 'Workspace-Report.parquet',
      engine: 'Native DuckDB Engine (SNAPPY Columnar)',
      status: 'COMPLETED',
      timestamp: '2026-10-25T15:00:00Z'
    };

    const parquetBytes = service.buildParquetBinaryBytes(receipt);
    expect(parquetBytes.length).toBeGreaterThan(12);

    // Leading magic bytes "PAR1"
    const headMagic = new TextDecoder().decode(parquetBytes.subarray(0, 4));
    expect(headMagic).toBe('PAR1');

    // Trailing magic bytes "PAR1"
    const tailMagic = new TextDecoder().decode(parquetBytes.subarray(parquetBytes.length - 4));
    expect(tailMagic).toBe('PAR1');
  });

  it('builds RFC 4180 compliant tabular .csv content with UTF-8 BOM, semicolon delimiter, and escaped quotes', () => {
    const visual = state.addVisualToActivePage('Matrix');
    state.updateVisualTitleOnActivePage(visual.id, 'Sales; "EMEA" Region');

    const receipt: ExportJobReceipt = {
      jobId: 'job-csv-1',
      format: '.csv',
      mimeType: 'text/csv; charset=utf-8',
      filename: 'Workspace-Report.csv',
      engine: 'Spring WebFlux Reactive (UTF-8 BOM + Semicolon Delimiter)',
      status: 'COMPLETED',
      timestamp: '2026-10-25T15:00:00Z'
    };

    const csvContent = service.buildDelimitedContent(receipt, ';');
    expect(csvContent.startsWith('\uFEFF')).toBe(true);

    const lines = csvContent.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2); // 1 header line + 1 visual row
    expect(lines[0]).toContain('"Project";"Page";"Visual ID";"Visual Title"');
    expect(lines[1]).toContain('"Sales; ""EMEA"" Region"');
  });

  it('gracefully falls back to local synthesis when backend export endpoint fails', () => {
    state.addVisualToActivePage('Bar');
    const downloadSpy = vi.spyOn(service, 'downloadReceiptFile').mockImplementation(() => {});

    let emittedReceipt: ExportJobReceipt | undefined;
    service.triggerExport('report-1', 'visual-1', '.xlsx').subscribe((r) => {
      emittedReceipt = r;
    });

    const req = httpMock.expectOne('/api/reports/report-1/visuals/visual-1/export');
    req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    expect(emittedReceipt).toBeDefined();
    expect(emittedReceipt?.format).toBe('.xlsx');
    expect(emittedReceipt?.filename).toBe('Workspace-Report.xlsx');
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(state.isLoading()).toBe(false);
    expect(state.statusIsError()).toBe(false);

    downloadSpy.mockRestore();
  });
});
