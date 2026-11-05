import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * RGAA 4.1.2, European Standard EN 301 549 & WCAG 2.1 Level AA Accessibility Statement (/accessibility)
 * Documents compliance with French Law No. 2005-102 (Article 47), RGAA 4.1.2 Section 1.6.1 (Mandatory Declaration Format),
 * Section 1.8.2 (Multi-Year Plan 2026-2028 and Annual Action Plan), and the platform architecture rules.
 */
@Component({
  selector: 'rc-accessibility',
  imports: [],
  templateUrl: './accessibility.component.html',
  styleUrl: './accessibility.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class accessibilityComponent {}
export { accessibilityComponent as AccessibiliteComponent, accessibilityComponent as AccessibilityComponent };
