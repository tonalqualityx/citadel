/**
 * Upload reject codes and the sentence the board shows for each. A plain module with no server imports, so both
 * the server (lib/design/track-assets.ts) and client components can import it.
 */

/** The reasons the runner may give when it rejects an upload. Mirrors REJECT_MESSAGES in design-track/upload_handler.py. */
export const UPLOAD_REJECT_CODES = [
  'too_many_pixels', 'not_an_image', 'type_not_allowed', 'pdf_failed', 'svg_refused', 'svg_failed', 'timeout', 'too_large', 'processing_failed',
] as const;
export type UploadRejectCode = (typeof UPLOAD_REJECT_CODES)[number];

/** A plain sentence for a designer, per reject code (the board shows it). */
export const UPLOAD_REJECT_SENTENCES: Record<UploadRejectCode, string> = {
  too_many_pixels: 'This image is bigger than we can handle. Please make it smaller and upload it again.',
  not_an_image: 'We could not read this file as an image or a PDF.',
  type_not_allowed: 'We do not accept this kind of file here.',
  pdf_failed: 'We could not turn this PDF into pictures.',
  svg_refused: 'We could not accept this SVG because it holds things an upload may not, such as scripts, links or other files.',
  svg_failed: 'We could not draw this SVG.',
  timeout: 'This file took too long to open.',
  too_large: 'This file, or the picture made from it, is too large.',
  processing_failed: 'We could not open this file.',
};
