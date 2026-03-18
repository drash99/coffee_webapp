type RenderBeanLabelOptions = {
  roasteryText: string | null;
  beanName: string;
  originText: string | null;
  producerProcessText: string | null;
  varietalText: string | null;
  footerText: string;
  qrDataUrl: string;
};

async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load label QR image'));
    image.src = src;
  });
}

export async function renderBeanLabelDataUrl({
  roasteryText,
  beanName,
  originText,
  producerProcessText,
  varietalText,
  footerText,
  qrDataUrl,
}: RenderBeanLabelOptions): Promise<string> {
  const width = 520;
  const height = 240;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas is not available');
  }

  const qrImage = await loadImage(qrDataUrl);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  const paddingX = 24;
  const paddingY = 22;
  const qrSize = 160;
  const qrX = width - paddingX - qrSize;
  const qrY = Math.round((height - qrSize) / 2);
  const textWidth = qrX - paddingX - 18;

  let lineY = paddingY + 18;

  if (roasteryText) {
    ctx.fillStyle = '#92400e';
    ctx.font = 'bold 18px sans-serif';
    for (const line of wrapText(ctx, roasteryText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 22;
    }
  }

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 29px sans-serif';
  const beanLines = wrapText(ctx, beanName || '-', textWidth, 2);
  for (const line of beanLines) {
    ctx.fillText(line, paddingX, lineY);
    lineY += 32;
  }

  if (originText) {
    ctx.fillStyle = '#374151';
    ctx.font = '18px sans-serif';
    for (const line of wrapText(ctx, originText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 22;
    }
  }

  if (producerProcessText) {
    ctx.fillStyle = '#4b5563';
    ctx.font = '17px sans-serif';
    for (const line of wrapText(ctx, producerProcessText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 19;
    }
  }

  if (varietalText) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '16px sans-serif';
    for (const line of wrapText(ctx, varietalText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 18;
    }
  }

  ctx.fillStyle = '#6b7280';
  ctx.font = '17px sans-serif';
  for (const line of wrapText(ctx, footerText, textWidth, 2)) {
    ctx.fillText(line, paddingX, lineY);
    lineY += 20;
  }

  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  return canvas.toDataURL('image/png');
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['-'];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  const consumedWords = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const remaining = words.slice(consumedWords);
  const finalLine = current || remaining.shift() || '';
  const tail = [finalLine, ...remaining].join(' ').trim();
  if (tail) {
    lines.push(ellipsizeText(ctx, tail, maxWidth));
  }

  return lines.slice(0, maxLines);
}

function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1).trimEnd();
  }
  return `${next}...`;
}
