export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Photos smaller than this are logos and signatures, not a bill. */
export const MIN_PHOTO_BYTES = 150 * 1024;

const isPdf = (file) => file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.filename ?? '');
const isPhoto = (file) => /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimeType ?? '');
const size = (file) => file.content?.byteLength ?? 0;

/** The PDFs; when there are none, photos big enough to be a bill. At most five, each under 10 MB. */
export function billFiles(attachments) {
  const fits = attachments.filter((file) => size(file) > 0 && size(file) <= MAX_FILE_BYTES);
  const pdfs = fits.filter(isPdf);
  const chosen = pdfs.length > 0 ? pdfs : fits.filter((file) => isPhoto(file) && size(file) >= MIN_PHOTO_BYTES);
  return chosen.slice(0, MAX_FILES).map((file) => ({
    name: file.filename ?? null,
    mime: isPdf(file) ? 'application/pdf' : file.mimeType,
    data: Buffer.from(file.content).toString('base64'),
  }));
}
