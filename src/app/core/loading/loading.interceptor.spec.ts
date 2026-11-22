import {
  HttpClient,
  HttpContext,
  provideHttpClient,
  withInterceptors,
} from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS, SKIP_LOADING } from "./loading.constants";
import { loadingInterceptor } from "./loading.interceptor";
import { LoadingService } from "./loading.service";

describe("loadingInterceptor", () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let loading: LoadingService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([loadingInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    loading = TestBed.inject(LoadingService);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it("does not flicker waiting state for fast responses under delay threshold", () => {
    http.get("/api/rax/validate").subscribe();

    expect(loading.activeCount()).toBe(1);
    expect(loading.isWaiting()).toBe(false);

    vi.advanceTimersByTime(LOADING_DELAY_MS - 20);
    expect(loading.isWaiting()).toBe(false);

    httpMock.expectOne("/api/rax/validate").flush({ ok: true });
    expect(loading.activeCount()).toBe(0);
    expect(loading.isWaiting()).toBe(false);
  });

  it("activates waiting state with route label after delay and clears on completion", () => {
    http.post("/api/export/pdf", {}).subscribe();

    vi.advanceTimersByTime(LOADING_DELAY_MS);
    expect(loading.isWaiting()).toBe(true);
    expect(loading.waitLabel()).toBe("Generating export...");

    httpMock.expectOne("/api/export/pdf").flush({ id: "1" });
    expect(loading.activeCount()).toBe(0);
    expect(loading.isWaiting()).toBe(false);
  });

  it("clears waiting state when request errors or is cancelled", () => {
    const sub = http.post("/api/ingestion/preview", {}).subscribe({
      error: () => undefined,
    });

    vi.advanceTimersByTime(LOADING_DELAY_MS);
    expect(loading.isWaiting()).toBe(true);

    sub.unsubscribe();
    expect(loading.activeCount()).toBe(0);
    expect(loading.isWaiting()).toBe(false);

    const errSub = http.get("/api/projects/1").subscribe({
      error: () => undefined,
    });
    vi.advanceTimersByTime(LOADING_DELAY_MS);
    expect(loading.isWaiting()).toBe(true);

    httpMock
      .expectOne("/api/projects/1")
      .flush("Server error", { status: 500, statusText: "Server Error" });
    expect(loading.activeCount()).toBe(0);
    expect(loading.isWaiting()).toBe(false);
    errSub.unsubscribe();
  });

  it("skips tracking when SKIP_LOADING context token is set", () => {
    const context = new HttpContext().set(SKIP_LOADING, true);
    http.get("/api/auth/session", { context }).subscribe();

    vi.advanceTimersByTime(LOADING_DELAY_MS);
    expect(loading.activeCount()).toBe(0);
    expect(loading.isWaiting()).toBe(false);

    httpMock.expectOne("/api/auth/session").flush({});
  });
});
