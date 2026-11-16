import type { MetadataRoute } from "next";

// Lets people add OnSite to their phone's home screen (or install it on a
// computer) like an app: the BB logo, named "OnSite".
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Beshara OnSite",
    short_name: "OnSite",
    description: "All your project communication in one place, from Beshara Builders.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#455C51",
    theme_color: "#455C51",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
