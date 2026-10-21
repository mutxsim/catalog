import type { NextConfig } from "next";

const supabase = (() => {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return { protocol: u.protocol.replace(":", "") as "http" | "https", hostname: u.hostname, port: u.port };
  } catch {
    return null;
  }
})();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Local end-to-end tests serve images from localhost, which the optimizer refuses to fetch.
    unoptimized: process.env.NEXT_IMAGE_UNOPTIMIZED === "1",
    remotePatterns: [
      ...(supabase ? [{ ...supabase, pathname: "/storage/v1/object/public/**" }] : []),
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24,
  },
  experimental: {
    // Product images up to 5 MB are uploaded through server actions.
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Private order links must not leak through the Referer header.
      { source: "/order/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }, { key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
