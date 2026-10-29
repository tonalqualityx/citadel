/**
 * Designer Portal: in-browser pixel diff (design D7 item 5). No dependency: two RGBA buffers in, a count and a
 * highlight overlay out. `loadImageData` is the only browser-bound part (canvas); the diff itself is pure.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major (the shape of ImageData.data). */
  data: ArrayLike<number>;
}

export interface PixelDiffResult {
  /** Pixels inside the compared area that differ. */
  count: number;
  /** Compared area (the overlap of the two images). */
  width: number;
  height: number;
  /** count / (width * height), 0 when the area is empty. */
  ratio: number;
  /** True when the two images were not the same size (only the overlap was compared). */
  sizeMismatch: boolean;
  /** RGBA overlay of width x height: differing pixels opaque magenta, the rest transparent. */
  overlay: Uint8ClampedArray;
}

export const DIFF_COLOR = [255, 0, 170, 255] as const;
/** Per-channel tolerance (0 to 255) below which a difference is anti-aliasing noise. */
export const DEFAULT_TOLERANCE = 8;

export function diffImageData(a: RgbaImage, b: RgbaImage, tolerance = DEFAULT_TOLERANCE): PixelDiffResult {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const overlay = new Uint8ClampedArray(width * height * 4);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      let differs = false;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(a.data[ia + c] - b.data[ib + c]) > tolerance) {
          differs = true;
          break;
        }
      }
      if (differs) {
        count++;
        const o = (y * width + x) * 4;
        overlay[o] = DIFF_COLOR[0];
        overlay[o + 1] = DIFF_COLOR[1];
        overlay[o + 2] = DIFF_COLOR[2];
        overlay[o + 3] = DIFF_COLOR[3];
      }
    }
  }
  return {
    count,
    width,
    height,
    ratio: width * height === 0 ? 0 : count / (width * height),
    sizeMismatch: a.width !== b.width || a.height !== b.height,
    overlay,
  };
}

/** Decode an image URL (same origin, so the canvas is never tainted) to RGBA. Browser only. */
export async function loadImageData(url: string): Promise<RgbaImage> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: id.width, height: id.height, data: id.data };
}

/** Load two images and diff them. */
export async function diffImageUrls(beforeUrl: string, afterUrl: string, tolerance = DEFAULT_TOLERANCE): Promise<PixelDiffResult> {
  const [a, b] = await Promise.all([loadImageData(beforeUrl), loadImageData(afterUrl)]);
  return diffImageData(a, b, tolerance);
}
