import QRCode from 'qrcode';

type RenderBeanLabelOptions = {
  roasteryText: string | null;
  beanName: string;
  originText: string | null;
  producerProcessText: string | null;
  varietalText: string | null;
  footerText: string;
  qrDataUrl: string;
  qrText?: string | null;
};

const PRINT_LABEL_LENGTH_DOTS = 300;
const PRINT_LABEL_HEIGHT_DOTS = 128;
const LABEL_FONT_14 = '"Galmuri14", sans-serif';
const LABEL_FONT_11 = '"Galmuri11", sans-serif';
const LABEL_FONT_9 = '"Galmuri9", sans-serif';
let labelFontsReady: Promise<void> | null = null;

async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load label QR image'));
    image.src = src;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function renderBeanLabelDataUrl({
  roasteryText,
  beanName,
  originText,
  producerProcessText,
  varietalText,
  footerText,
  qrDataUrl,
  qrText,
}: RenderBeanLabelOptions): Promise<string> {
  await ensureLabelFontsLoaded();
  const qrImage = qrText ? null : await loadImage(qrDataUrl);
  const portraitCanvas = createCanvas(PRINT_LABEL_HEIGHT_DOTS, PRINT_LABEL_LENGTH_DOTS);
  const portraitCtx = portraitCanvas.getContext('2d');
  if (!portraitCtx) {
    throw new Error('Canvas is not available');
  }

  portraitCtx.fillStyle = '#ffffff';
  portraitCtx.fillRect(0, 0, portraitCanvas.width, portraitCanvas.height);
  portraitCtx.imageSmoothingEnabled = false;
  portraitCtx.save();
  portraitCtx.translate(portraitCanvas.width, 0);
  portraitCtx.rotate(Math.PI / 2);
  drawLandscapeLabel(portraitCtx, {
    width: PRINT_LABEL_LENGTH_DOTS,
    height: PRINT_LABEL_HEIGHT_DOTS,
    roasteryText,
    beanName,
    originText,
    producerProcessText,
    varietalText,
    footerText,
    qrImage,
    qrText: qrText ?? null,
  });
  portraitCtx.restore();
  thresholdCanvas(portraitCtx, portraitCanvas.width, portraitCanvas.height);

  return portraitCanvas.toDataURL('image/png');
}

function drawLandscapeLabel(
  ctx: CanvasRenderingContext2D,
  options: Omit<RenderBeanLabelOptions, 'qrDataUrl'> & {
    width: number;
    height: number;
    qrImage: HTMLImageElement | null;
  },
) {
  const {
    width,
    height,
    roasteryText,
    beanName,
    originText,
    producerProcessText,
    varietalText,
    footerText,
    qrImage,
    qrText,
  } = options;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;

  const paddingX = 8;
  const paddingY = 8;
  const qrSize = 90;
  const gap = 8;
  const qrX = width - paddingX - qrSize;
  const qrY = Math.round((height - qrSize) / 2);
  const textWidth = qrX - paddingX - gap;

  let lineY = paddingY;

  if (roasteryText) {
    ctx.fillStyle = '#000000';
    ctx.font = `400 12px ${LABEL_FONT_11}`;
    for (const line of wrapText(ctx, roasteryText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 14;
    }
  }

  ctx.fillStyle = '#000000';
  ctx.font = `400 15px ${LABEL_FONT_14}`;
  for (const line of wrapText(ctx, beanName || '-', textWidth, 2)) {
    ctx.fillText(line, paddingX, lineY);
    lineY += 18;
  }

  if (originText) {
    ctx.fillStyle = '#000000';
    ctx.font = `400 12px ${LABEL_FONT_11}`;
    for (const line of wrapText(ctx, originText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 14;
    }
  }

  if (producerProcessText) {
    ctx.fillStyle = '#000000';
    ctx.font = `400 12px ${LABEL_FONT_11}`;
    for (const line of wrapText(ctx, producerProcessText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 13;
    }
  }

  if (varietalText) {
    ctx.fillStyle = '#000000';
    ctx.font = `400 10px ${LABEL_FONT_9}`;
    for (const line of wrapText(ctx, varietalText, textWidth, 1)) {
      ctx.fillText(line, paddingX, lineY);
      lineY += 12;
    }
  }

  ctx.fillStyle = '#000000';
  ctx.font = `400 10px ${LABEL_FONT_9}`;
  for (const line of wrapText(ctx, footerText, textWidth, 1)) {
    ctx.fillText(line, paddingX, lineY);
    lineY += 12;
  }

  drawQrCode(ctx, { qrImage, qrText: qrText ?? null, x: qrX, y: qrY, size: qrSize });
}

function thresholdCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 16) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
      continue;
    }
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const value = luminance < 180 ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawQrCode(
  ctx: CanvasRenderingContext2D,
  options: {
    qrImage: HTMLImageElement | null;
    qrText: string | null;
    x: number;
    y: number;
    size: number;
  },
) {
  const { qrImage, qrText, x, y, size } = options;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);

  if (qrText) {
    const qr = QRCode.create(qrText, { errorCorrectionLevel: 'L' });
    const moduleCount = qr.modules.size;
    const cellSize = Math.max(1, Math.floor(size / moduleCount));
    const drawnSize = cellSize * moduleCount;
    const offsetX = x + Math.floor((size - drawnSize) / 2);
    const offsetY = y + Math.floor((size - drawnSize) / 2);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        if (qr.modules.get(row, col)) {
          ctx.fillRect(offsetX + col * cellSize, offsetY + row * cellSize, cellSize, cellSize);
        }
      }
    }
    return;
  }

  if (!qrImage) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrImage, x, y, size, size);
  ctx.restore();
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
  const remaining = [...words];

  while (remaining.length > 0 && lines.length < maxLines) {
    let line = remaining.shift() || '';

    while (remaining.length > 0) {
      const candidate = `${line} ${remaining[0]}`;
      if (ctx.measureText(candidate).width > maxWidth) break;
      line = candidate;
      remaining.shift();
    }

    if (lines.length === maxLines - 1 && remaining.length > 0) {
      line = ellipsizeText(ctx, `${line} ${remaining.join(' ')}`.trim(), maxWidth);
      lines.push(line);
      break;
    }

    lines.push(ellipsizeText(ctx, line, maxWidth));
  }

  return lines;
}

async function ensureLabelFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  if (!labelFontsReady) {
    labelFontsReady = Promise.all([
      document.fonts.load(`400 15px ${LABEL_FONT_14}`),
      document.fonts.load(`400 12px ${LABEL_FONT_11}`),
      document.fonts.load(`400 10px ${LABEL_FONT_9}`),
      document.fonts.ready,
    ]).then(() => undefined);
  }
  await labelFontsReady;
}

function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1).trimEnd();
  }
  return `${next}...`;
}
