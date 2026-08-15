import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/pullsrc/seo";

// Only the landing page. /scan is deliberately absent — it has no content of
// its own and every useful variant of it is a ?url= query string, which is
// exactly the kind of thing that turns into index bloat.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
