import type { MetadataRoute } from "next";
import { withBasePath } from "@/lib/base-path";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "omp web",
    short_name: "omp web",
    description: "Web UI for the oh-my-pi (omp) coding agent",
    id: withBasePath("/"),
    scope: withBasePath("/"),
    start_url: withBasePath("/"),
    display: "standalone",
    background_color: "#FAF9F6",
    theme_color: "#FAF9F6",
    // Chrome's install prompt requires both a 192px and a 512px PNG.
    icons: [
      { src: withBasePath("/icon.svg"), type: "image/svg+xml", sizes: "any" },
      { src: withBasePath("/icon-192.png"), sizes: "192x192", type: "image/png" },
      { src: withBasePath("/icon.png"), sizes: "512x512", type: "image/png" },
    ],
  };
}
