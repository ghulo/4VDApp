/** Longest side sent to the API; it shrinks again to 800px, so this only saves upload time. */
const LONGEST_SIDE = 1600;

/**
 * Phone photos are often 4-12 MB, over the API's 5 MB limit and slow on shop
 * Wi-Fi. Redraw them as a JPEG no longer than 1600px before uploading. If the
 * browser can't read the file, the original goes up and the API judges it.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    // JPEG has no transparency; a see-through PNG gets a white background instead of black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}
