import type { MetadataRoute } from "next";

const BASE_URL = "https://tour-activation-mvp.vercel.app";

// Marketing pages only — fan pages, auth, dashboard and admin are
// deliberately excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/faq", "/request-access", "/privacy", "/terms"].map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(),
  }));
}
