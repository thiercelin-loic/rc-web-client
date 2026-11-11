import { describe, expect, it } from 'vitest';
import {
  extractSheetsFromDelimitedText,
  extractSheetsFromJson,
  extractSheetsFromXml,
  extractTabularRecordsFromJson,
  unpromotedSheetToJsonPayload,
} from './ingestion-parsers';

describe('ingestion-parsers', () => {
  it('parses nested JSON arrays of objects without splitting JSON syntax lines as CSV', () => {
    const jsonText = JSON.stringify(
      [
        {
          joueur: 'Gianluigi Donnarumma',
          position: 'Gardien',
          statistiques_par_saison: [
            {
              saison: '2014-15',
              matchs_joues: 35,
              minutes_jouees: 1803,
              cartons_jaunes: 0,
              cartons_rouges: 0,
              buts_encaisses: 32,
              arrets: 89,
            },
            {
              saison: '2015-16',
              matchs_joues: 30,
              minutes_jouees: 2700,
              cartons_jaunes: 1,
              cartons_rouges: 0,
              buts_encaisses: 29,
              arrets: 95,
            },
          ],
        },
        {
          joueur: 'Bradley Barcola',
          position: 'Attaquant',
          statistiques_par_saison: [
            {
              saison: '2023-24',
              matchs_joues: 25,
              minutes_jouees: 1450,
              cartons_jaunes: 2,
              cartons_rouges: 0,
              buts: 4,
            },
          ],
        },
      ],
      null,
      2,
    );

    const res = extractSheetsFromJson('Performances_Ligue1_10_Saisons.json', `\uFEFF${jsonText}`);
    expect(res.error).toBeUndefined();
    expect(res.sheets.length).toBe(1);

    const sheet = res.sheets[0];
    expect(sheet.id).toBe('table_1');
    expect(sheet.name).toBe('Performances_Ligue1_10_Saisons');
    expect(sheet.kind).toBe('Table');

    // Row 0 contains promoted candidate headers, NOT '[' or '{'
    expect(sheet.rows.length).toBe(4); // 1 header row + 3 season records
    expect(Object.values(sheet.rows[0])).toEqual([
      'joueur',
      'position',
      'saison',
      'matchs_joues',
      'minutes_jouees',
      'cartons_jaunes',
      'cartons_rouges',
      'buts_encaisses',
      'arrets',
      'buts',
    ]);

    expect(sheet.rows[1]['Column1']).toBe('Gianluigi Donnarumma');
    expect(sheet.rows[1]['Column2']).toBe('Gardien');
    expect(sheet.rows[1]['Column3']).toBe('2014-15');
    expect(sheet.rows[1]['Column4']).toBe(35);
    expect(sheet.rows[1]['Column9']).toBe(89);
    expect(sheet.rows[3]['Column1']).toBe('Bradley Barcola');
    expect(sheet.rows[3]['Column10']).toBe(4);

    const normalizedPayload = unpromotedSheetToJsonPayload(sheet);
    expect(normalizedPayload).toBeTruthy();
    const parsedBack = JSON.parse(normalizedPayload!);
    expect(parsedBack.length).toBe(3);
    expect(parsedBack[0].joueur).toBe('Gianluigi Donnarumma');
    expect(parsedBack[2].buts).toBe(4);
  });

  it('creates multiple sheets for root JSON objects wrapping multiple entity arrays and flattens nested objects', () => {
    const multiRoot = JSON.stringify({
      players: [
        { id: 1, meta: { club: 'PSG' }, active: true },
      ],
      clubs: [
        { id: 10, name: 'Paris Saint-Germain', tags: ['Ligue 1', 'UCL'] },
      ],
    });

    const res = extractSheetsFromJson('ligue1_bundle.json', multiRoot);
    expect(res.error).toBeUndefined();
    expect(res.sheets.map((s) => s.name)).toEqual(['players', 'clubs']);
    expect(res.sheets[0].rows[0]).toEqual({ Column1: 'id', Column2: 'meta.club', Column3: 'active' });
    expect(res.sheets[0].rows[1]).toEqual({ Column1: 1, Column2: 'PSG', Column3: true });
    expect(res.sheets[1].rows[1]).toEqual({
      Column1: 10,
      Column2: 'Paris Saint-Germain',
      Column3: 'Ligue 1, UCL',
    });
  });

  it('supports NDJSON and returns an error cleanly for invalid JSON without emitting raw syntax lines', () => {
    const ndjson = '{"id":1,"name":"A"}\n{"id":2,"name":"B"}';
    const ndjsonResult = extractTabularRecordsFromJson(ndjson);
    expect(ndjsonResult.error).toBeUndefined();
    expect(ndjsonResult.rows).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    expect(ndjsonResult.columns.map((c) => `${c.name}:${c.type}`)).toEqual(['id:Int64', 'name:String']);

    const badJson = extractSheetsFromJson('broken.json', '{ "unterminated": [1, 2');
    expect(badJson.error).toBeTruthy();
    expect(badJson.sheets).toEqual([]);
  });

  it('parses XML records with attributes and nested child elements into unpromoted rows', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <players>
        <player id="7">
          <name>Mbappe</name>
          <stats><goals>27</goals></stats>
        </player>
        <player id="10">
          <name>Dembele</name>
          <stats><goals>6</goals></stats>
        </player>
      </players>`;

    const res = extractSheetsFromXml('ligue1.xml', xml);
    expect(res.error).toBeUndefined();
    expect(res.sheets.length).toBe(1);
    expect(res.sheets[0].name).toBe('ligue1');
    expect(res.sheets[0].rows[0]).toEqual({
      Column1: '@id',
      Column2: 'name',
      Column3: 'stats.goals',
    });
    expect(res.sheets[0].rows[1]).toEqual({
      Column1: '7',
      Column2: 'Mbappe',
      Column3: '27',
    });
  });

  it('parses delimited CSV with quoted commas and escaped quotes without splitting embedded commas', () => {
    const csv = '\uFEFF"City, Country",Player,Quote\n"Paris, France","O\'Connor","He said ""Allez"""';
    const res = extractSheetsFromDelimitedText('cities.csv', csv);
    expect(res.sheets[0].name).toBe('cities');
    expect(res.sheets[0].rows[0]).toEqual({
      Column1: 'City, Country',
      Column2: 'Player',
      Column3: 'Quote',
    });
    expect(res.sheets[0].rows[1]).toEqual({
      Column1: 'Paris, France',
      Column2: "O'Connor",
      Column3: 'He said "Allez"',
    });
  });
});

