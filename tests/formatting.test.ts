import { describe, expect, it, vi } from 'vitest';
import { fmtDate } from '../src/logging/utils/formatting';
import { execFileSync } from 'node:child_process';

describe('fmtDate', () => {
  it.each(['America/Chicago', 'Pacific/Honolulu', 'Asia/Seoul', 'UTC'])('preserves calendar dates in %s', (timezone) => {
    const script = `const fmtDate = ${fmtDate.toString()}; process.stdout.write(JSON.stringify({
      actual: fmtDate('2026-09-14'), expected: new Date(2026, 8, 14).toLocaleDateString()
    }));`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    }));
    expect(result.actual).toBe(result.expected);
  });

  it('constructs date-only values in the local timezone, not UTC', () => {
    const format = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date) {
      return `${this.getFullYear()}-${this.getMonth() + 1}-${this.getDate()} ${this.getHours()}`;
    });
    expect(fmtDate('2026-09-14')).toBe('2026-9-14 0');
    expect(fmtDate('2024-02-29')).toBe('2024-2-29 0');
    expect(fmtDate('2026-03-08')).toBe('2026-3-8 0');
    expect(format).toHaveBeenCalledTimes(3);
  });

  it('preserves local timezone conversion for actual timestamps', () => {
    const timestamp = '2026-09-14T01:00:00Z';
    expect(fmtDate(timestamp)).toBe(new Date(timestamp).toLocaleDateString());
  });

  it.each(['not-a-date', '2026-02-30', '2026-13-01', '2026-00-01'])('preserves invalid input %s', (value) => {
    expect(fmtDate(value)).toBe(value);
  });

  it('returns empty text for missing dates', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate('')).toBe('');
  });
});
