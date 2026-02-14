import type { FlavorNote } from '../types';

export type BrewPngData = {
  title: string;
  sharedAtLabel?: string;
  sections: Array<{
    title?: string;
    rows: Array<{ label: string; value: string }>;
  }>;
  notes: Array<{ label: string; value: FlavorNote[] | null | undefined; empty: string }>;
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) current = next;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export async function downloadBrewAsPng(data: BrewPngData, filename: string): Promise<void> {
  const width = 1200;
  const margin = 48;
  const contentWidth = width - margin * 2;
  const lineH = 30;
  const sectionGap = 18;

  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = 100;
  const pctx = probe.getContext('2d');
  if (!pctx) throw new Error('Canvas is not supported');

  let totalLines = 0;
  pctx.font = '500 24px sans-serif';
  totalLines += 2;
  if (data.sharedAtLabel) totalLines += 1;

  pctx.font = '400 20px sans-serif';
  for (const section of data.sections) {
    if (section.title) totalLines += 1;
    for (const row of section.rows) {
      const lines = wrapText(pctx, `${row.label}: ${row.value || '-'}`, contentWidth);
      totalLines += Math.max(1, lines.length);
    }
    totalLines += 1;
  }
  for (const note of data.notes) {
    const noteText = (note.value && note.value.length > 0)
      ? note.value.map((n) => n.path.join(' / ')).join('  |  ')
      : note.empty;
    const lines = wrapText(pctx, `${note.label}: ${noteText}`, contentWidth);
    totalLines += Math.max(1, lines.length) + 1;
  }

  const height = Math.max(900, margin * 2 + totalLines * lineH + sectionGap * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111827';

  let y = margin;
  ctx.font = '700 34px sans-serif';
  ctx.fillText(data.title, margin, y);
  y += lineH * 1.6;
  if (data.sharedAtLabel) {
    ctx.font = '400 20px sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.fillText(data.sharedAtLabel, margin, y);
    y += lineH * 1.4;
    ctx.fillStyle = '#111827';
  }

  ctx.font = '400 20px sans-serif';
  for (const section of data.sections) {
    if (section.title) {
      ctx.font = '600 22px sans-serif';
      ctx.fillText(section.title, margin, y);
      y += lineH * 1.2;
      ctx.font = '400 20px sans-serif';
    }
    for (const row of section.rows) {
      const lines = wrapText(ctx, `${row.label}: ${row.value || '-'}`, contentWidth);
      for (const line of lines) {
        ctx.fillText(line, margin, y);
        y += lineH;
      }
    }
    y += sectionGap;
  }

  for (const note of data.notes) {
    const noteText = (note.value && note.value.length > 0)
      ? note.value.map((n) => n.path.join(' / ')).join('  |  ')
      : note.empty;
    const lines = wrapText(ctx, `${note.label}: ${noteText}`, contentWidth);
    for (const line of lines) {
      ctx.fillText(line, margin, y);
      y += lineH;
    }
    y += sectionGap;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!blob) throw new Error('PNG encode failed');
  const pngUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(pngUrl);
  }
}
