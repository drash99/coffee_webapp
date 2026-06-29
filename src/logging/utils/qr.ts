import QRCode from 'qrcode';

type QrOptions = {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
};

export async function toQrDataUrl(text: string, sizePx: number, options?: QrOptions): Promise<string> {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: options?.errorCorrectionLevel ?? 'M',
    margin: options?.margin ?? 1,
    width: sizePx,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}
