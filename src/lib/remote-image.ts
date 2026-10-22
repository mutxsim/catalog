import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Download an image from a public URL for the CSV import, safely:
 * only http(s), only public IP addresses (no internal/cloud metadata hosts),
 * at most 3 redirects, 10 MB, 15 seconds. The result is normalised with sharp
 * (any common format in, WebP out, max 1200px) so storage stays consistent.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links are supported");
  if (url.username || url.password) throw new Error("Links with credentials aren't allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("Link points to a private address");
}

export async function downloadImage(rawUrl: string): Promise<{ bytes: Uint8Array; ext: "webp"; mime: "image/webp" }> {
  let url = new URL(rawUrl);
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response | null = null;
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublic(url);
    res = await fetch(url, {
      redirect: "manual",
      signal: deadline,
      cache: "no-store",
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", "User-Agent": "Mozilla/5.0 (catalog image import)" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`Server returned ${res?.status ?? "no response"}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Image is larger than 10 MB");

  // Stream with a hard size cap.
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Image is larger than 10 MB");
    }
    chunks.push(value);
  }
  const input = Buffer.concat(chunks);

  const sharp = (await import("sharp")).default;
  try {
    const out = await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { bytes: new Uint8Array(out), ext: "webp", mime: "image/webp" };
  } catch {
    throw new Error("The link isn't an image (or the image is damaged)");
  }
}
