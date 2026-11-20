import QRCode from 'qrcode';

export type BeanLabelContent = {
  roasteryText: string | null;
  beanName: string;
  details: Array<{ label: string; value: string }>;
  footerText: string;
};

type RenderBeanLabelOptions = BeanLabelContent & {
  qrDataUrl: string;
  qrText?: string | null;
};

export const BEAN_LABEL_DIMENSIONS = {
  lengthDots: 300,
  heightDots: 128,
  dpi: 180,
  tapeWidthMm: 24,
  maxLengthMm: 100,
} as const;

export type BeanLabelImages = {
  printDataUrl: string;
  previewDataUrl: string;
  lengthDots: number;
};
const LABEL_FONT_14 = '"Galmuri14", sans-serif';
const LABEL_FONT_11 = '"Galmuri11", sans-serif';
const LABEL_FONT_9 = '"Galmuri9", sans-serif';
let labelFontsReady: Promise<void> | null = null;
const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export class BeanLabelLayoutError extends Error {
  constructor() {
    super('LABEL_TOO_LONG');
    this.name = 'BeanLabelLayoutError';
  }
}

type LabelTextLine = { text: string; font: string; x: number; y: number };
type LabelLayout = {
  lengthDots: number;
  bodyLines: LabelTextLine[];
  footer: LabelTextLine;
  qr: { x: number; y: number; size: number };
};
type MeasureLabelText = (text: string, font: string) => number;

export function planBeanLabelLayout(content: BeanLabelContent, measure: MeasureLabelText): LabelLayout {
  const padding = 8;
  const qrSize = 90;
  const gap = 8;
  const footerFont = `400 10px ${LABEL_FONT_9}`;
  const footerY = BEAN_LABEL_DIMENSIONS.heightDots - 4 - 10;
  const bodyHeight = footerY - padding - 4;
  const blocks = [
    ...(content.roasteryText?.trim() ? [{ text: content.roasteryText, font: `400 12px ${LABEL_FONT_11}`, lineHeight: 14 }] : []),
    { text: content.beanName.trim() || '-', font: `400 15px ${LABEL_FONT_14}`, lineHeight: 18 },
    ...content.details.filter(detail => detail.value.trim()).map(detail => ({
      text: detail.label.trim() ? `${detail.label.trim()}: ${detail.value}` : detail.value,
      font: `400 12px ${LABEL_FONT_11}`,
      lineHeight: 13,
    })),
  ];

  function atLength(lengthDots: number) {
    const textWidth = lengthDots - padding * 2 - qrSize - gap;
    const bodyLines: LabelTextLine[] = [];
    let y = padding;
    for (const block of blocks) {
      for (const text of wrapText(block.text, textWidth, value => measure(value, block.font))) {
        bodyLines.push({ text, font: block.font, x: padding, y });
        y += block.lineHeight;
      }
    }
    return {
      fits: y - padding <= bodyHeight &&
        bodyLines.every(line => measure(line.text, line.font) <= textWidth) &&
        measure(content.footerText, footerFont) <= lengthDots - padding * 2,
      lengthDots,
      bodyLines,
      footer: { text: content.footerText, font: footerFont, x: padding, y: footerY },
      qr: { x: lengthDots - padding - qrSize, y: padding + Math.floor((bodyHeight - qrSize) / 2), size: qrSize },
    };
  }

  let low = BEAN_LABEL_DIMENSIONS.lengthDots as number;
  let high = Math.floor(BEAN_LABEL_DIMENSIONS.maxLengthMm * BEAN_LABEL_DIMENSIONS.dpi / 25.4);
  if (!atLength(high).fits) throw new BeanLabelLayoutError();
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (atLength(middle).fits) high = middle;
    else low = middle + 1;
  }
  return atLength(low);
}

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

export async function renderBeanLabelDataUrl(options: RenderBeanLabelOptions): Promise<string> {
  return (await renderBeanLabelImages(options)).printDataUrl;
}

export async function renderBeanLabelImages({
  roasteryText,
  beanName,
  details,
  footerText,
  qrDataUrl,
  qrText,
}: RenderBeanLabelOptions): Promise<BeanLabelImages> {
  await ensureLabelFontsLoaded();
  const qrImage = qrText ? null : await loadImage(qrDataUrl);
  const landscapeCanvas = createCanvas(BEAN_LABEL_DIMENSIONS.lengthDots, BEAN_LABEL_DIMENSIONS.heightDots);
  const landscapeCtx = landscapeCanvas.getContext('2d');
  if (!landscapeCtx) {
    throw new Error('Canvas is not available');
  }

  const layout = planBeanLabelLayout({ roasteryText, beanName, details, footerText }, (text, font) => {
    landscapeCtx.font = font;
    return landscapeCtx.measureText(text).width;
  });
  landscapeCanvas.width = layout.lengthDots;
  landscapeCtx.fillStyle = '#ffffff';
  landscapeCtx.fillRect(0, 0, landscapeCanvas.width, landscapeCanvas.height);
  landscapeCtx.fillStyle = '#000000';
  landscapeCtx.textBaseline = 'top';
  for (const line of [...layout.bodyLines, layout.footer]) {
    landscapeCtx.font = line.font;
    landscapeCtx.fillText(line.text, line.x, line.y);
  }
  drawQrCode(landscapeCtx, { qrImage, qrText: qrText ?? null, ...layout.qr });
  thresholdCanvas(landscapeCtx, landscapeCanvas.width, landscapeCanvas.height);

  // The SDK feeds the portrait image; preview the same pixels in reading orientation.
  const portraitCanvas = createCanvas(landscapeCanvas.height, landscapeCanvas.width);
  const portraitCtx = portraitCanvas.getContext('2d');
  if (!portraitCtx) throw new Error('Canvas is not available');
  portraitCtx.imageSmoothingEnabled = false;
  portraitCtx.translate(portraitCanvas.width, 0);
  portraitCtx.rotate(Math.PI / 2);
  portraitCtx.drawImage(landscapeCanvas, 0, 0);

  return {
    printDataUrl: portraitCanvas.toDataURL('image/png'),
    previewDataUrl: landscapeCanvas.toDataURL('image/png'),
    lengthDots: layout.lengthDots,
  };
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
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.trim().split(/\r\n|\r|\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (measure(line ? `${line} ${word}` : word) <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      const characters = graphemeSegmenter
        ? Array.from(graphemeSegmenter.segment(word), part => part.segment) : Array.from(word);
      for (const character of characters) {
        if (line && measure(line + character) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
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
