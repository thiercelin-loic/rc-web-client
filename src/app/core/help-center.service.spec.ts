import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { HelpCenterService } from './help-center.service';

describe('HelpCenterService', () => {
  let service: HelpCenterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HelpCenterService);
  });

  it('maps known diagnostics to documentation', () => {
    const result = service.resolveDiagnostic('ERR_CIRCULAR_DEP');

    expect(result.slug).toBe('err-circular-dep');
    expect(result.url).toBe('https://rollercoaster.com/docs/errors/err-circular-dep');
    expect(result.title).toContain('Circular Dependency');
  });

  it('normalizes unknown diagnostic codes without failing', () => {
    expect(service.getErrorDocumentationUrl('custom_issue')).toBe(
      'https://rollercoaster.com/docs/errors/custom-issue'
    );
  });
});
