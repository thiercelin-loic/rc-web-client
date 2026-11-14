import { describe, expect, it } from 'vitest';
import { extractDelimited } from './delimited.parser';
import { extractJson, extractRecords } from './json.parser';
import { toPayload } from './sheet.builder';
import { extractXml } from './xml.parser';

describe('ingestion-parsers', () => {
  it('parses nested JSON arrays of objects without splitting JSON syntax lines as CSV', () => {
    const jsonText = JSON.stringify(
      [
        {
          entity: 'Entity A',
          category: 'Type 1',
          periodic_metrics: [
            {
              period: '2023-P1',
              runs: 35,
              duration: 1803,
              warnings: 0,
              errors: 0,
              failures: 32,
              retries: 89,
            },
            {
              period: '2024-P1',
              runs: 30,
              duration: 2700,
              warnings: 1,
              errors: 0,
              failures: 29,
              retries: 95,
            },
          ],
        },
        {
          entity: 'Entity B',
          category: 'Type 2',
          periodic_metrics: [
            {
              period: '2024-P2',
              runs: 25,
              duration: 1450,
              warnings: 2,
              errors: 0,
              successes: 4,
            },
          ],
        },
      ],
      null,
      2,
    );

    const res = extractJson('Metrics_Dataset_Sample.json', `\uFEFF${jsonText}`);
    expect(res.error).toBeUndefined();
    expect(res.sheets.length).toBe(1);

    const sheet = res.sheets[0];
    expect(sheet.id).toBe('table_1');
    expect(sheet.name).toBe('Metrics_Dataset_Sample');
    expect(sheet.kind).toBe('Table');

    // Row 0 contains promoted candidate headers, NOT '[' or '{'
    expect(sheet.rows.length).toBe(4); // 1 header row + 3 period records
    expect(Object.values(sheet.rows[0])).toEqual([
      'entity',
      'category',
      'period',
      'runs',
      'duration',
      'warnings',
      'errors',
      'failures',
      'retries',
      'successes',
    ]);

    expect(sheet.rows[1]['Column1']).toBe('Entity A');
    expect(sheet.rows[1]['Column2']).toBe('Type 1');
    expect(sheet.rows[1]['Column3']).toBe('2023-P1');
    expect(sheet.rows[1]['Column4']).toBe(35);
    expect(sheet.rows[1]['Column9']).toBe(89);
    expect(sheet.rows[3]['Column1']).toBe('Entity B');
    expect(sheet.rows[3]['Column10']).toBe(4);

    const normalizedPayload = toPayload(sheet);
    expect(normalizedPayload).toBeTruthy();
    const parsedBack = JSON.parse(normalizedPayload ?? '[]') as ReadonlyArray<Record<string, unknown>>;
    expect(parsedBack.length).toBe(3);
    expect(parsedBack[0]['entity']).toBe('Entity A');
    expect(parsedBack[2]['successes']).toBe(4);
  });

  it('creates multiple sheets for root JSON objects wrapping multiple entity arrays and flattens nested objects', () => {
    const multiRoot = JSON.stringify({
      nodes: [
        { id: 1, meta: { region: 'Zone-A' }, active: true },
      ],
      clusters: [
        { id: 10, name: 'Cluster Alpha', tags: ['Tier-1', 'Core'] },
      ],
    });

    const res = extractJson('dataset_bundle.json', multiRoot);
    expect(res.error).toBeUndefined();
    expect(res.sheets.map((s) => s.name)).toEqual(['nodes', 'clusters']);
    expect(res.sheets[0].rows[0]).toEqual({ Column1: 'id', Column2: 'meta.region', Column3: 'active' });
    expect(res.sheets[0].rows[1]).toEqual({ Column1: 1, Column2: 'Zone-A', Column3: true });
    expect(res.sheets[1].rows[1]).toEqual({
      Column1: 10,
      Column2: 'Cluster Alpha',
      Column3: 'Tier-1, Core',
    });
  });

  it('supports NDJSON and returns an error cleanly for invalid JSON without emitting raw syntax lines', () => {
    const ndjson = '{"id":1,"name":"A"}\n{"id":2,"name":"B"}';
    const ndjsonResult = extractRecords(ndjson);
    expect(ndjsonResult.error).toBeUndefined();
    expect(ndjsonResult.rows).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    expect(ndjsonResult.columns.map((c) => `${c.name}:${c.type}`)).toEqual(['id:Int64', 'name:String']);

    const badJson = extractJson('broken.json', '{ "unterminated": [1, 2');
    expect(badJson.error).toBeTruthy();
    expect(badJson.sheets).toEqual([]);
  });

  it('parses XML records with attributes and nested child elements into unpromoted rows', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <records>
        <record id="7">
          <name>Sensor A</name>
          <stats><count>27</count></stats>
        </record>
        <record id="10">
          <name>Sensor B</name>
          <stats><count>6</count></stats>
        </record>
      </records>`;

    const res = extractXml('records.xml', xml);
    expect(res.error).toBeUndefined();
    expect(res.sheets.length).toBe(1);
    expect(res.sheets[0].name).toBe('records');
    expect(res.sheets[0].rows[0]).toEqual({
      Column1: '@id',
      Column2: 'name',
      Column3: 'stats.count',
    });
    expect(res.sheets[0].rows[1]).toEqual({
      Column1: '7',
      Column2: 'Sensor A',
      Column3: '27',
    });
  });

  it('parses delimited CSV with quoted commas and escaped quotes without splitting embedded commas', () => {
    const csv = '\uFEFF"Location, Code",Entity,Note\n"Sector-1, North","Unit\'A","Status ""OK"""';
    const res = extractDelimited('locations.csv', csv);
    expect(res.sheets[0].name).toBe('locations');
    expect(res.sheets[0].rows[0]).toEqual({
      Column1: 'Location, Code',
      Column2: 'Entity',
      Column3: 'Note',
    });
    expect(res.sheets[0].rows[1]).toEqual({
      Column1: 'Sector-1, North',
      Column2: "Unit'A",
      Column3: 'Status "OK"',
    });
  });
});
