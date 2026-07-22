// Client-side background-image preparation, shared by the campaign builder
// and the dashboard profile backdrop. Browser-only (canvas/createImageBitmap)
// — call it from client components, never during server rendering.

export const BG_MAX_BYTES = 8 * 1024 * 1024;
export const BG_ALLOWED_RE = /\.(jpg|jpeg|png|webp)$/i;
// Backgrounds load on mobile data at the very top of the funnel — anything
// bigger than this on the long edge gets downscaled and re-encoded before
// upload.
export const BG_MAX_EDGE = 2400;

// Downscale to BG_MAX_EDGE and re-encode as WebP (JPEG where WebP encoding
// isn't supported). Runs at pick time so previews show exactly what will be
// uploaded, and saving stays fast.
export async function processBackgroundImage(
  file: File
): Promise<{ blob: Blob; ext: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, BG_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, ext: file.name.split(".").pop() ?? "jpg" };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };
  const jpeg = await encode("image/jpeg");
  if (jpeg) return { blob: jpeg, ext: "jpg" };
  return { blob: file, ext: file.name.split(".").pop() ?? "jpg" };
}
