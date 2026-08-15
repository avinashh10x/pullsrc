import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/pullsrc/seo";

// /scan is deliberately absent: every useful variant of it is a ?url= query
// string, which is index bloat.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
