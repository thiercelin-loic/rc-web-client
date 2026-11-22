import { Injectable, signal } from "@angular/core";
import { DEFAULT_WAIT_LABEL, LOADING_DELAY_MS } from "./loading.constants";

@Injectable({ providedIn: "root" })
export class LoadingService {
  public readonly activeCount = signal<number>(0);
  public readonly isWaiting = signal<boolean>(false);
  public readonly waitLabel = signal<string>(DEFAULT_WAIT_LABEL);

  private timer: ReturnType<typeof setTimeout> | null = null;

  public beginRequest(label: string = DEFAULT_WAIT_LABEL): void {
    this.waitLabel.set(label);
    const nextCount = this.activeCount() + 1;
    this.activeCount.set(nextCount);

    if (nextCount === 1 && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.activeCount() > 0) {
          this.isWaiting.set(true);
        }
      }, LOADING_DELAY_MS);
    }
  }

  public endRequest(): void {
    const nextCount = Math.max(0, this.activeCount() - 1);
    this.activeCount.set(nextCount);

    if (nextCount === 0) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.isWaiting.set(false);
    }
  }
}
