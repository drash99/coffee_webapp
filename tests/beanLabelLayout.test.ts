import { describe, expect, it } from 'vitest';
import {
  BEAN_LABEL_DIMENSIONS, BeanLabelLayoutError, planBeanLabelLayout, type BeanLabelContent,
} from '../src/logging/utils/beanLabelImage';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const measure = (text: string) => Array.from(segmenter.segment(text)).length * 6;
const compact = (text: string) => text.replace(/\s/g, '');
const base: BeanLabelContent = {
  roasteryText: 'Test Roasters', beanName: 'Panama Geisha',
  details: [
    { label: 'Origin', value: 'Panama / Boquete' },
    { label: 'Producer', value: 'Test Farm' },
    { label: 'Process', value: 'Washed' },
    { label: 'Variety', value: 'Geisha' },
  ],
  footerText: 'Roast: 2026-11-01 / 15g',
};

function fullBody(content: BeanLabelContent) {
  return [content.roasteryText, content.beanName.trim() || '-', ...content.details.filter(detail => detail.value.trim())
    .map(detail => detail.label.trim() ? `${detail.label.trim()}: ${detail.value}` : detail.value)].filter(Boolean).join('');
}

function expectComplete(content: BeanLabelContent) {
  const layout = planBeanLabelLayout(content, measure);
  expect(compact(layout.bodyLines.map(line => line.text).join(''))).toBe(compact(fullBody(content)));
  expect(layout.footer.text).toBe(content.footerText);
  for (const line of layout.bodyLines) {
    expect(line.x + measure(line.text)).toBeLessThanOrEqual(layout.qr.x - 8);
    expect(line.y + Number.parseInt(line.font.split(' ')[1])).toBeLessThanOrEqual(layout.footer.y - 4);
  }
  expect(layout.footer.x + measure(layout.footer.text)).toBeLessThanOrEqual(layout.lengthDots - 8);
  expect(layout.qr.y + layout.qr.size).toBeLessThan(layout.footer.y);
  expect(layout.lengthDots * 25.4 / BEAN_LABEL_DIMENSIONS.dpi).toBeLessThanOrEqual(BEAN_LABEL_DIMENSIONS.maxLengthMm);
  return layout;
}

describe('lossless adaptive label layout', () => {
  it('keeps the minimum length for short content and reserves a full-width footer', () => {
    const layout = expectComplete(base);
    expect(layout.lengthDots).toBe(300);
    expect(layout.footer.y).toBe(114);
  });

  it('uses the shortest length that fits the complete body', () => {
    const content = { ...base, beanName: 'x'.repeat(80) };
    const layout = expectComplete(content);
    expect(layout.lengthDots).toBe(354);
  });

  it('wraps unbroken Korean names without dropping characters', () => {
    const content = { ...base, details: [], beanName: '\uac8c\uc774\uc0e4\uc6cc\uc2dc\ub4dc'.repeat(7) };
    const layout = expectComplete(content);
    expect(layout.bodyLines.filter(line => line.font.includes('15px')).length).toBeGreaterThan(1);
  });

  it.each(['roastery', 'origin', 'producer', 'process', 'variety', 'all'])('retains complete %s metadata and semantic field labels', field => {
    const content: BeanLabelContent = structuredClone(base);
    if (field === 'roastery' || field === 'all') content.roasteryText = 'Long Specialty Coffee Roaster Private Reserve Collection'.repeat(2);
    content.details.forEach((detail, index) => {
      if (field === ['origin', 'producer', 'process', 'variety'][index] || field === 'all') {
        detail.value = `${detail.value} Extended Detailed Metadata With Several Words And Identifiers`.repeat(field === 'all' ? 1 : 2);
      }
    });
    expect(expectComplete(content).lengthDots).toBeGreaterThan(300);
  });

  it('expands for a footer instead of truncating its date or weight', () => {
    const content = { ...base, footerText: 'f'.repeat(60) };
    expect(expectComplete(content).lengthDots).toBe(376);
  });

  it('preserves graphemes containing combining marks and emoji sequences', () => {
    const cluster = 'e\u0301\u{1f469}\u{1f3fd}\u200d\u{1f52c}';
    const content = { ...base, roasteryText: null, details: [], beanName: cluster.repeat(45) };
    const layout = expectComplete(content);
    const lines = layout.bodyLines.map(line => line.text);
    expect(lines.every(line => !/^\p{Mark}|^\u200d|\u200d$/u.test(line))).toBe(true);
    expect(lines.join('')).toBe(content.beanName);
  });

  it('keeps explicit paragraph breaks and skips empty details', () => {
    const content = { ...base, beanName: 'First\nSecond', details: [{ label: 'Empty', value: '  ' }] };
    const layout = expectComplete(content);
    expect(layout.bodyLines.map(line => line.text)).toEqual(['Test Roasters', 'First', 'Second']);
  });

  it.each(['body', 'footer', 'forced lines'])('rejects %s beyond the length/height limit instead of silently omitting it', field => {
    const content = { ...base };
    if (field === 'body') content.beanName = 'x'.repeat(5000);
    if (field === 'footer') content.footerText = 'x'.repeat(5000);
    if (field === 'forced lines') content.beanName = 'line\n'.repeat(20);
    expect(() => planBeanLabelLayout(content, measure)).toThrow(BeanLabelLayoutError);
  });
});
