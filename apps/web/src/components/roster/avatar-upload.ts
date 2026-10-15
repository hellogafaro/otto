// Uploads become small square data URLs so an oversized photo can neither
// bloat the persisted roster nor blow the localStorage quota.
const AVATAR_UPLOAD_SIZE = 128;

export const AVATAR_UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function downscaleAvatarImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_UPLOAD_SIZE;
    canvas.height = AVATAR_UPLOAD_SIZE;
    const context = canvas.getContext("2d");

    if (context === null) throw new Error("Canvas 2D is unavailable.");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_UPLOAD_SIZE,
      AVATAR_UPLOAD_SIZE,
    );

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
