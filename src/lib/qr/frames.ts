/**
 * Multi-frame ("animated") QR: a long text is cut into numbered frames shown in a loop,
 * the scanner collects them in any order. Frame: `msvf:<id>:<index>/<total>:<chunk>`,
 * where `id` is a short hash of the whole text – frames of another payload never mix in,
 * and the assembled text is verified against it.
 */
export const FRAME_PREFIX = 'msvf:';
export const DEFAULT_CHUNK_SIZE = 360;
const MAX_FRAMES = 500;

const frameId = (text: string): string => {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

/** Text that fits into `chunkSize` is returned as a single unchanged element. */
export const splitFrames = (text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] => {
  const size = Math.max(1, Math.floor(chunkSize));
  if (text.length <= size) return [text];
  const total = Math.ceil(text.length / size);
  const id = frameId(text);
  return Array.from(
    { length: total },
    (_, i) => `${FRAME_PREFIX}${id}:${i + 1}/${total}:${text.slice(i * size, (i + 1) * size)}`,
  );
};

export interface FrameResult {
  complete: boolean;
  text?: string;
  received: number;
  total: number;
  isFrame: boolean;
}

const FRAME_RE = /^msvf:([0-9a-z]+):(\d+)\/(\d+):([\s\S]*)$/;

export class FrameCollector {
  private id: string | undefined;
  private total = 0;
  private parts = new Map<number, string>();

  reset = (): void => {
    this.id = undefined;
    this.total = 0;
    this.parts = new Map();
  };

  /** Feed every decoded QR text; a non-frame text completes immediately as-is. */
  add = (text: string): FrameResult => {
    const m = FRAME_RE.exec(text);
    if (!m) return { complete: true, text, received: 1, total: 1, isFrame: false };

    const [, id, indexRaw, totalRaw, chunk] = m;
    const index = Number(indexRaw);
    const total = Number(totalRaw);
    if (total < 2 || total > MAX_FRAMES || index < 1 || index > total) {
      return { complete: false, received: this.parts.size, total: this.total, isFrame: true };
    }
    // A different payload appeared in front of the camera – start over with it.
    if (id !== this.id || total !== this.total) {
      this.id = id;
      this.total = total;
      this.parts = new Map();
    }
    this.parts.set(index, chunk);
    if (this.parts.size < total) {
      return { complete: false, received: this.parts.size, total, isFrame: true };
    }

    let full = '';
    for (let i = 1; i <= total; i++) full += this.parts.get(i) ?? '';
    if (frameId(full) !== id) {
      this.reset();
      return { complete: false, received: 0, total, isFrame: true };
    }
    this.reset();
    return { complete: true, text: full, received: total, total, isFrame: true };
  };
}
