import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, beforeEach } from "vitest";
import axe from "axe-core";
import { AppComponent } from "./app";
import { routes } from "./app.routes";

describe("AppComponent accessibility", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideZonelessChangeDetection(), provideRouter(routes)],
    });
  });

  it("has no automated axe violations on the shell", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
    const results = await axe.run(fixture.nativeElement, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  }, 15000);
});
