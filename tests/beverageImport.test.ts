import { expect, it } from 'vitest';
import type { BeanRow, BeverageType } from '../src/logging/types';
import { buildBeverageImportPrompt, parseBeanImportJson, parseBeverageImportJson } from '../src/logging/utils/beanJsonImport';
import { beverageTypeOf, classifyLegacyBean } from '../src/logging/utils/beverage';

it.each<{ name: string | null; expected: BeverageType; type?: BeverageType }>([
  { name: 'Legacy Oolong', expected: 'tea' },
  { name: '봄 수확 우롱', expected: 'tea' },
  { name: 'Assam Black Tea', expected: 'tea' },
  { name: '2014 Aged Pu-erh', expected: 'tea' },
  { name: 'Matcha Geisha Coffee', expected: 'coffee' },
  { name: 'Black Tea Notes', expected: 'coffee' },
  { name: '말차 향미 디카페인', expected: 'coffee' },
  { name: 'Pinot Noir', expected: 'coffee' },
  { name: null, expected: 'coffee' },
  { name: 'Handpicked Sencha', type: 'coffee', expected: 'coffee' },
  { name: 'Matcha', type: 'wine', expected: 'wine' },
])('classifies $name as $expected only if not already set', ({ name, expected, type }) => {
  const row = { bean_name: name, beverage_type: type };
  expect(beverageTypeOf(classifyLegacyBean(row))).toBe(expected);
  expect(row.beverage_type).toBe(type);
});

it('provides tea references, allowed styles and the tea wheel in the prompt', () => {
  const tea = { beverage_type: 'tea', bean_name: 'Garden Tea', producer: 'Tea Farm', process: 'Steamed' } as BeanRow;
  const prompt = buildBeverageImportPrompt('tea', [tea]);
  expect(prompt).toContain('"beverage_type": "tea"');
  expect(prompt).toContain('"teaStyle"');
  expect(prompt).toContain('"harvest"');
  expect(prompt).toContain('"Steamed"');
  expect(prompt).toContain('"Umami"');
  expect(prompt).toContain('copy that spelling and casing');
  expect(prompt).not.toContain('"abv"');
  expect(prompt).not.toContain('"Red Berries"');
});

it('rejects a nameless beverage and drops unknown or out-of-range details without guessing', () => {
  expect(() => parseBeverageImportJson('{"beverage_type":"tea","bean_name":" "}', 'tea')).toThrow();
  const wine = parseBeverageImportJson(JSON.stringify({
    beverage_type: 'wine', bean_name: 'Reserve', beverage_details: { wineStyle: 'unknown', vintage: 2021.5, abv: '105', arbitrary: 7 },
    cup_flavor_notes: ['Floral > Rose', 'floral / rose', 'Vegetal > Grass'],
  }), 'wine');
  expect(wine.beverage_details).toEqual({});
  expect(wine.cup_flavor_notes).toEqual([{ path: ['Floral', 'Rose'], color: '#a65376' }]);
});

it('still parses an untyped coffee result with its roast date and SCA notes', () => {
  const bean = parseBeanImportJson('{"bean_name":"Coffee","roasted_on":"2026-10-01","cup_flavor_notes":["Blueberry"]}');
  expect(bean).toMatchObject({ bean_name: 'Coffee', roasted_on: '2026-10-01',
    cup_flavor_notes: [{ path: ['Fruity', 'Berry', 'Blueberry'] }] });
});
