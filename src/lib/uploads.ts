/** Identify an image by its magic bytes — never trust the browser's file type or name. */
export type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { mime: "image/png", ext: "png" };
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  return null;
}

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function readUpload(
  file: FormDataEntryValue | null,
  maxBytes: number,
  allowed: ImageKind["mime"][],
): Promise<{ bytes: Uint8Array; kind: ImageKind } | { error: string } | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > maxBytes) return { error: `Image must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind || !allowed.includes(kind.mime)) {
    return { error: `Unsupported image. Use ${allowed.map((m) => m.split("/")[1].toUpperCase()).join(", ")}.` };
  }
  return { bytes, kind };
}
