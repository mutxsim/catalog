import { describe, expect, it } from "vitest";
import { downloadImage } from "@/lib/remote-image";
import { PRODUCT_CSV_HEADER } from "@/lib/csv";

describe("image_url import safety", () => {
  it("rejects non-http links", async () => {
    await expect(downloadImage("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(downloadImage("ftp://example.com/a.png")).rejects.toThrow(/http/);
  });
  it("rejects private and loopback addresses", async () => {
    for (const u of ["http://127.0.0.1/a.png", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/x.jpg", "http://192.168.1.1/x.png", "http://[::1]/x.png", "http://localhost/x.png"])
      await expect(downloadImage(u)).rejects.toThrow(/private/);
  });
  it("rejects links with credentials", async () => {
    await expect(downloadImage("https://user:pw@example.com/a.png")).rejects.toThrow(/credentials/);
  });
  it("includes image_url and in_stock columns in the CSV", () => {
    expect(PRODUCT_CSV_HEADER.slice(-2)).toEqual(["image_url", "in_stock"]);
  });
});
