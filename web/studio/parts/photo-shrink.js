// Photos are made smaller on the phone before they're kept (Studio R4 Decided 2): at most 2000 px on
// the long side, JPEG at quality 0.82, the server's own rule (photo.rs), and re-drawn so nothing
// from the camera's notes (where it was taken) comes along. A photo this phone can't read is kept as
// it was, and the server still makes it fit. `shrinkPlan` is plain and tested
// (tests/web/studio-photo-shrink.test.mjs); `shrinkPhoto` is the thin canvas half.

export const MAX_SIDE = 2000;
export const QUALITY = 0.82;

/** The size to draw a photo at: `{ width, height }`, the long side at most `max`, never larger. */
export function shrinkPlan(width, height, max = MAX_SIDE) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  if (!w || !h) return null;
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** A JPEG name for a shrunk photo: "IMG_0042.HEIC" → "IMG_0042.jpg". */
export function jpegName(name) {
  const base = String(name || "photo").replace(/\.[a-z0-9]{2,5}$/i, "") || "photo";
  return `${base}.jpg`;
}

/** Whether a photo is drawn again: never a moving GIF or something that isn't a picture. */
export const shrinks = (file) => /^image\//i.test(String(file?.type || "")) ? !/gif/i.test(file.type) : /\.(jpe?g|png|webp|avif|hei[cf])$/i.test(String(file?.name || ""));

/**
 * The photo made smaller, as a File, or the original when this phone can't read it. Never throws.
 * `env` is for tests: `{ createImageBitmap, OffscreenCanvas, document }`.
 */
export async function shrinkPhoto(file, env = globalThis) {
  if (!shrinks(file) || typeof env.createImageBitmap !== "function") return file;
  let bitmap = null;
  try {
    bitmap = await env.createImageBitmap(file, { imageOrientation: "from-image" });
    const plan = shrinkPlan(bitmap.width, bitmap.height);
    if (!plan) return file;
    const canvas = typeof env.OffscreenCanvas === "function" ? new env.OffscreenCanvas(plan.width, plan.height) : Object.assign(env.document.createElement("canvas"), plan);
    const context = canvas.getContext("2d");
    // A see-through picture becomes white behind, not black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, plan.width, plan.height);
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY })
      : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || !blob.size) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
