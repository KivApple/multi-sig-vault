import qrcode from 'qrcode-generator';

// Encode text as UTF-8 (the library default keeps only the low byte of each char).
qrcode.stringToBytes = (text: string): number[] => Array.from(new TextEncoder().encode(text));

export interface QrMatrix {
  size: number;
  /** SVG path of all dark modules in module units (one `h` run per horizontal streak). */
  path: string;
}

/** Above this length the lowest error-correction level keeps the code readable on phone screens. */
const LONG_TEXT = 300;

/** Returns `null` when the text does not fit into a QR code. */
export const buildQrMatrix = (value: string): QrMatrix | null => {
  try {
    const qr = qrcode(0, value.length > LONG_TEXT ? 'L' : 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    let path = '';
    for (let y = 0; y < size; y++) {
      let x = 0;
      while (x < size) {
        if (!qr.isDark(y, x)) {
          x++;
          continue;
        }
        const start = x;
        while (x < size && qr.isDark(y, x)) x++;
        path += `M${start} ${y}h${x - start}v1h-${x - start}z`;
      }
    }
    return { size, path };
  } catch {
    return null;
  }
};
