import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import axe from 'axe-core';
import { AccessibiliteComponent } from './accessibility.component';

describe('AccessibiliteComponent (RGAA 4.1.2 & WCAG 2.1 AA Compliance)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AccessibiliteComponent],
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('instantiates cleanly with English accessibility declaration', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeDefined();
  });

  it('renders accessibility content with structured sections without redundant eyebrow', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const rootContainer = fixture.nativeElement.querySelector('.rc-canvas-container');
    expect(rootContainer).toBeTruthy();

    const mainContent = rootContainer.querySelector('#main-content');
    expect(mainContent).toBeTruthy();

    const article = mainContent.querySelector('article');
    expect(article).toBeTruthy();
    expect(article.textContent).toContain('Commitment and Scope');
    expect(article.textContent).toContain('RGAA 4.1.2');

    const eyebrow = rootContainer.querySelector('.rc-page-eyebrow');
    expect(eyebrow).toBeNull();
    expect(rootContainer.textContent).not.toContain('Regulatory Compliance');
  });

  it('strictly eliminates the "Back to Dashboard" button and any dashboard references', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const textContent = fixture.nativeElement.textContent;
    expect(textContent).not.toContain('Back to Dashboard');
    expect(textContent).not.toContain('Dashboard');

    const links = fixture.nativeElement.querySelectorAll('a');
    for (const link of Array.from(links) as HTMLAnchorElement[]) {
      expect(link.textContent).not.toContain('Dashboard');
      expect(link.getAttribute('routerLink')).not.toBe('/report-builder');
    }
  });

  it('renders directly in English with no language toggle buttons', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('article[lang="en"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('article[lang="fr"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('#a11y-lang-fr-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('#a11y-lang-en-btn')).toBeNull();
  });

  it('contains all mandatory RGAA 4.1.2 and WCAG sections in English', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    // 1. Commitment and Scope
    expect(text).toContain('Commitment and Scope');
    expect(text).toContain('Article 47 of French Law No. 2005-102');

    // 2. Compliance Status
    expect(text).toContain('Compliance Status');
    expect(text).toContain('partially compliant');

    // 3. Test Results
    expect(text).toContain('Test Results');
    expect(text).toContain('78%');
    expect(text).toContain('84%');

    // 4. Non-Accessible Content
    expect(text).toContain('Non-Accessible Content');
    expect(text).toContain('Non-Compliance');
    expect(text).toContain('Disproportionate Burden Derogations');
    expect(text).toContain('Exempted Content');

    // 5. Multi-Year Accessibility Plan
    expect(text).toContain('Multi-Year Accessibility Plan');
    expect(text).toContain('2026–2028');
    expect(text).toContain('2026');

    // 6. Statement Establishment and Audit Details
    expect(text).toContain('Statement Establishment and Audit Details');
    expect(text).toContain('axe-core');

    // 7. Feedback and Contact
    expect(text).toContain('Feedback and Contact');
    expect(text).toContain('accessibility@rollercoaster.com');

    // 8. Legal Remediation Channels
    expect(text).toContain('Legal Remediation Channels');
    expect(text).toContain('Défenseur des droits');
    expect(text).toContain('Libre réponse 71120');
  });

  it('enforces single-concept headings without ampersands (&)', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const headings = fixture.nativeElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const heading of Array.from(headings) as HTMLElement[]) {
      expect(heading.textContent).not.toContain('&');
    }
  });

  it('passes automated axe accessibility checks with zero violations', async () => {
    const fixture = TestBed.createComponent(AccessibiliteComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const results = await axe.run(fixture.nativeElement, {
      rules: {
        'color-contrast': { enabled: true },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
