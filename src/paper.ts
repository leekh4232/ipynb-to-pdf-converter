// Paper sizes in millimetres as [short edge, long edge]. Orientation decides
// which edge becomes the width, so the table needs no landscape variants.
// B4/B5 are the JIS sizes that Korean/Japanese office printers label B4/B5.
// Widescreen is nb_convert.py's horizontal mode (16:9 slide, 13.333 × 7.5 in).
// Tablets are the screen's logical (CSS px at 2×) size, so a page fills the
// screen at 100%; stored in mm like the rest (1 CSS px = 25.4/96 mm).
const px = (short: number, long: number): [number, number] => [(short * 25.4) / 96, (long * 25.4) / 96];

export const PAPER_SIZES: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B4: [257, 364],
  B5: [182, 257],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Widescreen: [190.5, 338.7],
  iPadPro13: px(1032, 1376),
  iPadPro11: px(834, 1210),
  iPadAir13: px(1024, 1366),
  iPad11: px(820, 1180),
  iPadMini: px(744, 1133),
  GalaxyTabS11: px(800, 1280),
  GalaxyTabS11Ultra: px(924, 1480),
};

export const DEFAULT_PAPER_SIZE = 'A4';

const CSS_PX_PER_MM = 96 / 25.4;

export interface PageDimensions {
  key: string;
  widthPx: number;
  heightPx: number;
}

// The webview treats 1 CSS px as 1/96 in and the PDF assembly converts at
// 0.75 pt per px, so converting at 96 dpi keeps the physical size exact.
export function resolvePageDimensions(
  size: string | undefined,
  orientation: string | undefined
): PageDimensions {
  const key = size && size in PAPER_SIZES ? size : DEFAULT_PAPER_SIZE;
  const [short, long] = PAPER_SIZES[key];
  const [widthMm, heightMm] = orientation === 'landscape' ? [long, short] : [short, long];
  return {
    key,
    widthPx: Math.round(widthMm * CSS_PX_PER_MM),
    heightPx: Math.round(heightMm * CSS_PX_PER_MM),
  };
}
