import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  input,
  signal
} from '@angular/core';

declare global {
  interface Window {
    __RC_RENDER_COMPLETE?: boolean;
  }
}

/**
 * Headless Pixel-Perfect 300 DPI Print Route (/print-view/:reportId)
 * Loaded by Playwright Chromium (http://angular:80/print-view/{reportId}) with
 * devicePixelRatio: 3.125. Signals deterministic paint readiness via
 * window.__RC_RENDER_COMPLETE = true prior to CDP Page.printToPDF.
 */
@Component({
  selector: 'rc-print-view',
  imports: [],
  templateUrl: './print-view.component.html',
  styleUrl: './print-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintViewComponent implements AfterViewInit {
  public readonly reportId = input<string>('workspace-report');
  public readonly renderComplete = signal<boolean>(false);

  public ngAfterViewInit(): void {
    if (typeof window !== 'undefined') {
      window.__RC_RENDER_COMPLETE = true;
    }
    this.renderComplete.set(true);
  }
}
