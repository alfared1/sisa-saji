import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let several dev servers / builds run side by side
  // (e.g. `NEXT_DIST_DIR=.next-e2e`). Defaults to `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
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
