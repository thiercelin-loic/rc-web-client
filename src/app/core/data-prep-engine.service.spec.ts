import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { DataPrepEngineService } from './data-prep-engine.service';
import { DataPrepColumn, DataPrepStep } from '../features/data-prep/data-prep.model';

describe('DataPrepEngineService', () => {
  let engine: DataPrepEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataPrepEngineService],
    });
    engine = TestBed.inject(DataPrepEngineService);
  });

  it('coerces values accurately across supported data types', () => {
    expect(engine.coerceValue('123', 'Int64')).toEqual({ valid: true, value: 123 });
    expect(engine.coerceValue('€ 45.67', 'Float64')).toEqual({ valid: true, value: 45.67 });
    expect(engine.coerceValue('true', 'Boolean')).toEqual({ valid: true, value: true });
    expect(engine.coerceValue('no', 'Boolean')).toEqual({ valid: true, value: false });
    expect(engine.coerceValue('2025-01-15', 'Date')).toEqual({ valid: true, value: '2025-01-15' });
    expect(engine.coerceValue('abc', 'Int64')).toEqual({ valid: false, value: null });
  });

  it('evaluates comparison predicates including compound and conditions', () => {
    const row = { Points: 25, Player: 'Jimmy Butler' };
    expect(engine.evaluatePredicate(row, '[Points] >= 20 and [Player] == "Jimmy Butler"')).toBe(true);
    expect(engine.evaluatePredicate(row, '[Points] < 20')).toBe(false);
    expect(engine.evaluatePredicate(row, '[Player] != "Luka Doncic"')).toBe(true);
  });

  it('evaluates custom ANTLR RAX formulas including arithmetic, concatenation, and conditionals', () => {
    const row = { Points: 20, Bonus: 5, First: 'Jimmy', Last: 'Butler', RawCode: 'A123B' };
    expect(engine.evaluateCustomExpression(row, '[Points] + [Bonus]')).toEqual({ value: 25 });
    expect(engine.evaluateCustomExpression(row, '[First] & " " & [Last]')).toEqual({ value: 'Jimmy Butler' });
    expect(engine.evaluateCustomExpression(row, 'Text.Select([RawCode], {"0".."9"})')).toEqual({ value: '123' });
    expect(engine.evaluateCustomExpression(row, 'if [Points] > 15 then "Star" else "Bench"')).toEqual({ value: 'Star' });
  });

  it('evaluates a full pipeline chain deterministically', () => {
    const initialCols: DataPrepColumn[] = [
      { name: 'Column1', type: 'String', icon: 'String' },
      { name: 'Column2', type: 'String', icon: 'String' },
      { name: 'Column3', type: 'String', icon: 'String' },
    ];
    const initialRows: Record<string, unknown>[] = [
      { Column1: 'Player', Column2: 'Points', Column3: 'Active' },
      { Column1: 'Jimmy Butler', Column2: '25', Column3: 'true' },
      { Column1: 'Luka Doncic', Column2: '30', Column3: 'true' },
      { Column1: 'Bench Player', Column2: '5', Column3: 'false' },
    ];

    const steps: DataPrepStep[] = [
      {
        id: 's1',
        name: 'Promoted Headers',
        type: 'PromoteHeaders',
        definition: { step: 'PromoteHeaders' },
      },
      {
        id: 's2',
        name: 'Detect Types',
        type: 'DetectDataType',
        definition: { step: 'DetectDataType' },
      },
      {
        id: 's3',
        name: 'Filter Star Players',
        type: 'FilterRows',
        definition: { step: 'FilterRows', predicate: '[Points] >= 20' },
      },
    ];

    const result = engine.evaluateStepsLocally(initialCols, initialRows, steps);

    expect(result.columns.map((c) => c.name)).toEqual(['Player', 'Points', 'Active']);
    expect(result.columns.find((c) => c.name === 'Points')?.type).toBe('Int64');
    expect(result.columns.find((c) => c.name === 'Active')?.type).toBe('Boolean');
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]['Player']).toBe('Jimmy Butler');
    expect(result.rows[0]['Points']).toBe(25);
    expect(result.rows[1]['Player']).toBe('Luka Doncic');
    expect(result.rows[1]['Points']).toBe(30);
  });
});

