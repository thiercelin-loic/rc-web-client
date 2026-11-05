import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { RaxFormulaBarComponent } from './rax-formula-bar.component';
import { StateManagerService } from '../core/state-manager.service';
import { RaxLanguageService } from '../core/rax-language.service';

describe('RaxFormulaBarComponent', () => {
  let component: RaxFormulaBarComponent;
  let stateService: StateManagerService;
  let raxLanguageService: RaxLanguageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RaxFormulaBarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    const fixture = TestBed.createComponent(RaxFormulaBarComponent);
    component = fixture.componentInstance;
    stateService = TestBed.inject(StateManagerService);
    raxLanguageService = TestBed.inject(RaxLanguageService);
  });

  it('initializes with default active measure formula and no open suggestions', () => {
    expect(component.currentFormula()).toBe(stateService.activeMeasure().formula);
    expect(component.hasMatchingSuggestions()).toBe(false);
    expect(component.matchingSuggestions()).toHaveLength(0);
  });

  it('dynamically computes matching suggestions when user types a function prefix', () => {
    const mockInput = document.createElement('input');
    mockInput.value = 'DIV';
    mockInput.selectionStart = 3;

    component.onFormulaDraftChange('DIV', mockInput);

    expect(component.hasMatchingSuggestions()).toBe(true);
    expect(component.matchingSuggestions().some((suggestion) => suggestion.label === 'DIVIDE')).toBe(true);
    expect(component.selectedSuggestionIndex()).toBe(0);
    expect(component.activeOptionId()).toBe('rc-rax-opt-0');
  });

  it('filters suggestions case-insensitively and returns empty when no prefix matches', () => {
    const mockInput = document.createElement('input');
    mockInput.value = 'calc';
    mockInput.selectionStart = 4;

    component.onFormulaDraftChange('calc', mockInput);
    expect(component.hasMatchingSuggestions()).toBe(true);
    expect(component.matchingSuggestions()[0].label).toBe('CALCULATE');

    mockInput.value = 'NONEXISTENT';
    mockInput.selectionStart = 11;
    component.onFormulaDraftChange('NONEXISTENT', mockInput);
    expect(component.hasMatchingSuggestions()).toBe(false);
  });

  it('replaces only the current token at caret position when suggestion is applied', () => {
    const mockInput = document.createElement('input');
    mockInput.value = 'SUM(DIV';
    mockInput.selectionStart = 7;

    component.onFormulaDraftChange('SUM(DIV', mockInput);
    const divideSnippet = raxLanguageService.autocompleteCatalog.find((snippet) => snippet.label === 'DIVIDE')!;

    component.applySuggestion(divideSnippet, mockInput);

    expect(component.currentFormula()).toContain('DIVIDE(');
    expect(component.currentFormula().startsWith('SUM(')).toBe(true);
    expect(component.hasMatchingSuggestions()).toBe(false);
  });

  it('navigates suggestions with ArrowDown/ArrowUp and dismisses on Escape', () => {
    const mockInput = document.createElement('input');
    mockInput.value = 'USER';
    mockInput.selectionStart = 4;

    component.onFormulaDraftChange('USER', mockInput);
    const initialIndex = component.selectedSuggestionIndex();

    const arrowDownEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
    component.handleFormulaKeydown(arrowDownEvent, mockInput);

    expect(component.selectedSuggestionIndex()).toBe((initialIndex + 1) % component.matchingSuggestions().length);

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    component.handleFormulaKeydown(escapeEvent, mockInput);

    expect(component.hasMatchingSuggestions()).toBe(false);
  });
});
