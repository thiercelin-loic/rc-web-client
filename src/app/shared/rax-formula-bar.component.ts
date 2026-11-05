import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";

import {
  RaxFunctionSnippet,
  RaxLanguageService,
  RaxValidationResult,
} from "../core/rax-language.service";
import {
  QueryExecutionResult,
  RaxQueryService,
} from "../core/rax-query.service";
import {
  RaxMeasureDescriptor,
  StateManagerService,
} from "../core/state-manager.service";

interface CaretTokenInfo {
  readonly token: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

function extractFormulaTokenAtCaret(
  formula: string,
  caretPosition: number,
): CaretTokenInfo {
  const textBeforeCaret = formula.slice(0, caretPosition);
  const match = textBeforeCaret.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (!match) {
    return { token: "", startIndex: caretPosition, endIndex: caretPosition };
  }
  const token = match[1];
  return {
    token,
    startIndex: caretPosition - token.length,
    endIndex: caretPosition,
  };
}

@Component({
  selector: "rc-rax-formula-bar",
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .rc-rax-bar {
        background-color: var(--rc-card-bg);
        border: 1px solid var(--rc-border-color);
        border-radius: var(--rc-radius-sm);
        padding: 4px 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 42px;
      }
      .rc-measure-select {
        max-width: 170px;
        font-size: var(--rc-font-size-xs);
        font-weight: var(--rc-font-weight-semibold);
        color: var(--rc-text-primary);
        background-color: var(--rc-surface-hover);
        border: 1px solid var(--rc-border-color);
        border-radius: var(--rc-radius-xs);
        padding: 4px 6px;
      }
      .rc-formula-input {
        font-family: var(--rc-font-mono);
        font-size: var(--rc-font-size-sm);
        color: var(--rc-text-primary);
        background: transparent;
        border: solid 1px var(--rc-border-color);
        border-radius: var(--rc-radius-sm);
        padding: 4px 8px;
        flex-grow: 1;
        transition:
          border-color var(--rc-transition-fast),
          box-shadow var(--rc-transition-fast);
      }
      .rc-formula-input:focus-visible,
      .rc-formula-input:focus {
        outline: 2px solid var(--rc-focus-ring, #0d6efd);
        outline-offset: 1px;
        border-color: var(--rc-primary);
        box-shadow: 0 0 0 2px var(--rc-primary-glow);
        background: var(--rc-surface-active);
      }
      .rc-autocomplete-popover {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        max-width: 500px;
        z-index: 1050;
        background: var(--rc-card-bg);
        border: 1px solid var(--rc-card-border);
        border-radius: var(--rc-radius-sm);
        box-shadow: var(--rc-shadow-floating);
        max-height: 240px;
        overflow-y: auto;
      }
      .rc-autocomplete-item {
        cursor: pointer;
        border-radius: var(--rc-radius-xs);
        transition: background-color var(--rc-transition-fast);
      }
      .rc-autocomplete-item:hover,
      .rc-autocomplete-item.active {
        background-color: var(--rc-surface-active);
      }
    `,
  ],
  template: `
    <section
      class="rc-rax-bar position-relative"
      aria-label="RAX analytical formula bar"
    >
      <label for="rc-measure-select-input" class="visually-hidden">
        Measure
      </label>
      <select
        id="rc-measure-select-input"
        class="form-select form-select-sm rc-measure-select flex-shrink-0"
        [ngModel]="activeMeasure().id"
        (ngModelChange)="selectMeasure($event)"
      >
        @if (measures().length === 0) {
          <option value="">No measure selected</option>
        }
        @for (measure of measures(); track measure.id) {
          <option [value]="measure.id">{{ measure.label }}</option>
        }
      </select>

      <div class="position-relative flex-grow-1">
        <label for="rc-rax-formula-input" class="visually-hidden">
          RAX analytical formula for {{ activeMeasure().label }}
        </label>
        <input
          #formulaInput
          id="rc-rax-formula-input"
          type="text"
          class="rc-formula-input w-100"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="hasMatchingSuggestions()"
          aria-controls="rc-rax-suggestions-list"
          [attr.aria-activedescendant]="activeOptionId()"
          [ngModel]="currentFormula()"
          (ngModelChange)="onFormulaDraftChange($event, formulaInput)"
          (keydown)="handleFormulaKeydown($event, formulaInput)"
          (click)="updateCaretPosition(formulaInput)"
          (keyup)="updateCaretPosition(formulaInput)"
          (blur)="onFormulaBlur()"
          placeholder="Enter RAX formula or function"
          spellcheck="false"
          autocomplete="off"
        />

        @if (hasMatchingSuggestions()) {
          <ul
            id="rc-rax-suggestions-list"
            role="listbox"
            class="rc-autocomplete-popover list-unstyled m-0 p-1"
            aria-label="RAX function suggestions"
          >
            @for (suggestion of matchingSuggestions(); track suggestion.label; let suggestionIndex = $index) {
              <li
                role="option"
                [id]="'rc-rax-opt-' + suggestionIndex"
                [attr.aria-selected]="selectedSuggestionIndex() === suggestionIndex"
                class="rc-autocomplete-item d-flex flex-column py-1 px-2"
                [class.active]="selectedSuggestionIndex() === suggestionIndex"
                (mousedown)="$event.preventDefault()"
                (click)="applySuggestion(suggestion, formulaInput)"
                (mouseenter)="onSuggestionHover(suggestionIndex)"
              >
                <div class="d-flex align-items-center justify-content-between">
                  <span class="fw-bold rc-text-primary rc-text-xs">{{
                    suggestion.label
                  }}</span>
                </div>
                <span class="text-secondary rc-text-xs mt-0.5 text-truncate">{{
                  suggestion.doc
                }}</span>
              </li>
            }
          </ul>
        }
      </div>

      <div class="d-flex align-items-center gap-1 flex-shrink-0">
        <button
          type="button"
          class="rc-btn rc-btn-sm rc-btn-primary px-3 d-inline-flex align-items-center gap-1"
          (click)="executeFormula()"
          [disabled]="isExecuting()"
          aria-label="Execute RAX formula"
        >
          @if (isExecuting()) {
            <span
              class="spinner-border spinner-border-sm"
              role="status"
              aria-hidden="true"
            ></span>
          } @else {
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          }
          <span>Execute</span>
        </button>
      </div>
    </section>
  `,
})
export class RaxFormulaBarComponent {
  private readonly state = inject(StateManagerService);
  private readonly raxService = inject(RaxLanguageService);
  private readonly queryService = inject(RaxQueryService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly activeMeasure = this.state.activeMeasure;
  public readonly measures = computed<readonly RaxMeasureDescriptor[]>(
    () => this.state.measures,
  );
  public readonly autocompleteCatalog = this.raxService.autocompleteCatalog;

  public readonly isExecuting = signal<boolean>(false);
  public readonly lastExecutionTimeMs = signal<number | null>(null);

  private readonly formulaDraft = signal<string | null>(null);
  private readonly caretPosition = signal<number>(0);
  private readonly isDismissed = signal<boolean>(false);
  public readonly selectedSuggestionIndex = signal<number>(0);

  public readonly currentFormula = computed<string>(() => {
    const draft = this.formulaDraft();
    return draft !== null ? draft : this.activeMeasure().formula;
  });

  public readonly currentTokenInfo = computed<CaretTokenInfo>(() => {
    const formula = this.currentFormula();
    const caret = this.caretPosition();
    return extractFormulaTokenAtCaret(formula, caret);
  });

  public readonly matchingSuggestions = computed<readonly RaxFunctionSnippet[]>(
    () => {
      if (this.isDismissed()) {
        return [];
      }
      const { token } = this.currentTokenInfo();
      if (!token || token.length < 1) {
        return [];
      }
      const prefix = token.toUpperCase();
      return this.autocompleteCatalog.filter((snippet) =>
        snippet.label.toUpperCase().startsWith(prefix),
      );
    },
  );

  public readonly hasMatchingSuggestions = computed<boolean>(() => {
    return this.matchingSuggestions().length > 0;
  });

  public readonly activeOptionId = computed<string | null>(() => {
    if (!this.hasMatchingSuggestions()) {
      return null;
    }
    return `rc-rax-opt-${this.selectedSuggestionIndex()}`;
  });

  public readonly validationStatus = computed<RaxValidationResult>(() => {
    return this.raxService.validateAndTokenize(this.currentFormula());
  });

  public readonly hasDiagnostics = computed<boolean>(() => {
    return this.validationStatus().diagnostics.length > 0;
  });

  public readonly diagnosticCount = computed<number>(() => {
    return this.validationStatus().diagnostics.length;
  });

  public readonly firstDiagnosticMessage = computed<string>(() => {
    return this.validationStatus().diagnostics[0]?.message ?? "";
  });

  public readonly hasExecutionTime = computed<boolean>(() => {
    return this.lastExecutionTimeMs() !== null;
  });

  public selectMeasure(measureId: string): void {
    if (!measureId) {
      return;
    }
    this.state.selectMeasure(measureId);
    this.formulaDraft.set(null);
    this.isDismissed.set(true);
  }

  public onFormulaDraftChange(
    newFormula: string,
    inputElement: HTMLInputElement,
  ): void {
    this.formulaDraft.set(newFormula);
    this.isDismissed.set(false);
    this.selectedSuggestionIndex.set(0);
    this.updateCaretPosition(inputElement);
  }

  public updateCaretPosition(inputElement: HTMLInputElement): void {
    const position = inputElement.selectionStart ?? this.currentFormula().length;
    this.caretPosition.set(position);
  }

  public handleFormulaKeydown(
    event: KeyboardEvent,
    inputElement: HTMLInputElement,
  ): void {
    const suggestions = this.matchingSuggestions();
    const hasSuggestions = suggestions.length > 0;

    if (hasSuggestions) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectedSuggestionIndex.update(
          (currentIndex) => (currentIndex + 1) % suggestions.length,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.selectedSuggestionIndex.update((currentIndex) =>
          currentIndex <= 0 ? suggestions.length - 1 : currentIndex - 1,
        );
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = suggestions[this.selectedSuggestionIndex()];
        if (selected) {
          this.applySuggestion(selected, inputElement);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        this.isDismissed.set(true);
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.executeFormula();
    } else if (event.key === "Escape") {
      this.isDismissed.set(true);
    }
  }

  public applySuggestion(
    snippet: RaxFunctionSnippet,
    inputElement: HTMLInputElement,
  ): void {
    if (!snippet) {
      return;
    }

    const formula = this.currentFormula();
    const caret = inputElement.selectionStart ?? this.caretPosition();
    const { startIndex, endIndex } = extractFormulaTokenAtCaret(formula, caret);

    const before = formula.slice(0, startIndex);
    const after = formula.slice(endIndex);
    const insertion = snippet.signature;
    const updatedFormula = before + insertion + after;

    this.formulaDraft.set(updatedFormula);
    this.isDismissed.set(true);

    const parenPosition = insertion.indexOf("(");
    const newCaret =
      parenPosition !== -1
        ? startIndex + parenPosition + 1
        : startIndex + insertion.length;
    this.caretPosition.set(newCaret);

    setTimeout(() => {
      inputElement.value = updatedFormula;
      inputElement.setSelectionRange(newCaret, newCaret);
      inputElement.focus();
    }, 0);
  }

  public onSuggestionHover(index: number): void {
    this.selectedSuggestionIndex.set(index);
  }

  public onFormulaBlur(): void {
    setTimeout(() => {
      this.isDismissed.set(true);
    }, 200);
  }

  public executeFormula(): void {
    if (this.isExecuting()) {
      return;
    }

    const rawFormula = this.currentFormula().trim();
    if (!rawFormula) {
      this.state.announce("Please enter a RAX formula before executing.", {
        safe: true,
      });
      return;
    }

    if (this.hasDiagnostics()) {
      this.state.announce(
        `RAX syntax diagnostic: ${this.firstDiagnosticMessage()}`,
        { safe: true },
      );
      return;
    }

    const targetMeasure = this.resolveTargetMeasure(rawFormula);
    const { formulaExpression } = this.raxService.parseFormulaAssignment(rawFormula);
    const executableExpression = formulaExpression || rawFormula;

    this.dispatchMeasureExecution(targetMeasure, executableExpression);
  }

  public onMeasureChange(measureId: string): void {
    this.selectMeasure(measureId);
  }

  public onFormulaInput(newFormula: string): void {
    this.formulaDraft.set(newFormula);
  }

  public onExecuteFormula(): void {
    this.executeFormula();
  }

  private resolveTargetMeasure(rawFormula: string): RaxMeasureDescriptor {
    const active = this.activeMeasure();
    const { measureName } = this.raxService.parseFormulaAssignment(rawFormula);

    if (measureName) {
      const existingMeasure = this.measures().find(
        (measure) =>
          measure.label.toLowerCase() === measureName.toLowerCase() ||
          measure.id.toLowerCase() === measureName.toLowerCase(),
      );
      const measureId =
        existingMeasure?.id ??
        `meas_${measureName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
      const targetMeasure: RaxMeasureDescriptor = {
        id: measureId,
        label: measureName,
        formula: rawFormula,
        table: existingMeasure?.table ?? (active.table || "Sales"),
      };
      this.state.saveMeasure(targetMeasure);
      this.state.selectMeasure(measureId);
      this.formulaDraft.set(null);
      return targetMeasure;
    }

    if (active.id) {
      const targetMeasure: RaxMeasureDescriptor = { ...active, formula: rawFormula };
      this.state.saveMeasure(targetMeasure);
      return targetMeasure;
    }

    return {
      id: "",
      label: "Ad-hoc Expression",
      formula: rawFormula,
      table: "",
    };
  }

  private dispatchMeasureExecution(
    targetMeasure: RaxMeasureDescriptor,
    executableExpression: string,
  ): void {
    this.isExecuting.set(true);
    this.queryService
      .executeMeasureQuery(targetMeasure.id, executableExpression)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: QueryExecutionResult) => {
          this.handleExecutionSuccess(result, targetMeasure);
        },
        error: (error: unknown) => {
          this.handleExecutionError(error);
        },
      });
  }

  private handleExecutionSuccess(
    result: QueryExecutionResult,
    targetMeasure: RaxMeasureDescriptor,
  ): void {
    this.isExecuting.set(false);
    this.lastExecutionTimeMs.set(result.executionTimeMs);

    const rawMetric = result.rows?.[0]?.["measure_value"];
    const formattedValue = this.formatMetricValue(rawMetric);

    this.state.updateFirstVisualMetric(formattedValue);

    const isLocalFallback = result.cacheKey === "local-fallback";
    const modeLabel = isLocalFallback
      ? "local simulation fallback"
      : `via ${result.routedEngine}`;

    const statusText = targetMeasure.id
      ? `Measure '${targetMeasure.label}' evaluated: ${formattedValue} (${result.executionTimeMs} ms, ${modeLabel})`
      : `RAX expression evaluated: ${formattedValue} (${result.executionTimeMs} ms, ${modeLabel})`;

    this.state.announce(statusText, { safe: true });
  }

  private handleExecutionError(error: unknown): void {
    this.isExecuting.set(false);
    const errorMessage =
      error instanceof Error ? error.message : "Execution failed";
    this.state.announce(`RAX execution error: ${errorMessage}`, { safe: true });
  }

  private formatMetricValue(value: unknown): string {
    if (typeof value === "number") {
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    return value !== null && value !== undefined ? String(value) : "0";
  }
}

