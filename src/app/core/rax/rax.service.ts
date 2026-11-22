import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import {
  Observable,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  switchMap,
} from "rxjs";
import {
  RAX_AUTOCOMPLETE_CATALOG,
  RAX_DIAGNOSTICS_ENDPOINT,
  RAX_VALIDATE_ENDPOINT,
} from "./rax.constants";
import {
  BackendRaxValidationResponse,
  DiagnosticMarker,
  RaxFunctionSnippet,
  RaxParsedFormula,
  RaxToken,
  RaxValidationResult,
} from "./rax.interface";

export type {
  DiagnosticMarker,
  RaxFunctionSnippet,
  RaxParsedFormula,
  RaxToken,
  RaxValidationResult,
} from "./rax.interface";

@Injectable({ providedIn: "root" })
export class RaxService {
  private readonly http = inject(HttpClient);

  public readonly autocompleteCatalog: readonly RaxFunctionSnippet[] =
    RAX_AUTOCOMPLETE_CATALOG;

  public inspectFormula(
    formula: string,
    defaultMeasureName = "New Measure",
  ): Observable<RaxValidationResult> {
    return this.http
      .post<BackendRaxValidationResponse>(RAX_VALIDATE_ENDPOINT, {
        workspaceId: "default",
        formula,
        defaultMeasureName,
      })
      .pipe(map((res) => this.mapResponse(res)));
  }

  public validateDiagnostics(
    workspaceId: string,
    formula: string,
  ): Observable<readonly DiagnosticMarker[]> {
    return this.http.post<readonly DiagnosticMarker[]>(
      RAX_DIAGNOSTICS_ENDPOINT,
      {
        workspaceId,
        formula,
      },
    );
  }

  public liveDiagnostics(
    workspaceId: string,
    formula$: Observable<string>,
  ): Observable<readonly DiagnosticMarker[]> {
    return formula$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((formula) =>
        formula.trim()
          ? this.validateDiagnostics(workspaceId, formula).pipe(
              catchError(() => of([])),
            )
          : of([]),
      ),
    );
  }

  public parseFormula(rawFormula: string): RaxParsedFormula {
    if (!rawFormula || !rawFormula.trim()) {
      return { measureName: null, formulaExpression: "" };
    }
    const trimmed = rawFormula.trim();
    const defineMatch = trimmed.match(
      /^DEFINE\s+MEASURE\s+(?:'[^']+'\s*)?(?:\[([^\]]+)\]|'([^']+)'|([A-Za-z0-9_]+))\s*=\s*([\s\S]*)$/i,
    );
    if (defineMatch) {
      const name = defineMatch[1] ?? defineMatch[2] ?? defineMatch[3];
      return {
        measureName: name ? name.trim() : null,
        formulaExpression: (defineMatch[4] ?? "").trim(),
      };
    }
    if (/^VAR\b/i.test(trimmed)) {
      return { measureName: null, formulaExpression: trimmed };
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const candidate = trimmed.slice(0, eqIdx).trim();
      if (!candidate.includes("(") && /^[\w\s\-'[\]]+$/.test(candidate)) {
        const bracketMatch = candidate.match(
          /(?:'[^']+'|(?:\w+))?\[([^\]]+)\]$/,
        );
        const measureName = bracketMatch
          ? bracketMatch[1].trim()
          : candidate.replace(/^'|'$/g, "").trim();
        return {
          measureName,
          formulaExpression: trimmed.slice(eqIdx + 1).trim(),
        };
      }
    }
    return { measureName: null, formulaExpression: trimmed };
  }

  private mapResponse(res: BackendRaxValidationResponse): RaxValidationResult {
    const tokens: RaxToken[] = (res.tokens ?? []).map((t) => ({
      type: (t.type as RaxToken["type"]) || "plain",
      value: t.text,
    }));
    const diagnostics: DiagnosticMarker[] = (res.diagnostics ?? []).map(
      (d) => ({
        ...d,
        severity: (d.severity?.toLowerCase() ??
          "error") as DiagnosticMarker["severity"],
      }),
    );
    return {
      isValid: res.isValid,
      statusLabel: res.statusLabel,
      measureName: res.measureName,
      formulaExpression: res.formulaExpression,
      diagnostics,
      tokens,
    };
  }
}
