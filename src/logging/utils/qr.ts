import QRCode from 'qrcode';

export async function toQrDataUrl(text: string, sizePx: number): Promise<string> {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: sizePx,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

