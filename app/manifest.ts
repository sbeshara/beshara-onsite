import type { MetadataRoute } from "next";

// Lets people add OnSite to their phone's home screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Beshara OnSite",
    short_name: "OnSite",
    description: "All your project communication in one place, from Beshara Builders.",
    start_url: "/",
    display: "standalone",
    background_color: "#F3F5F4",
    theme_color: "#455C51",
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon.png", sizes: "64x64", type: "image/png" },
    ],
  };
}
