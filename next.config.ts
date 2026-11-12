import { existsSync, writeFileSync } from "node:fs";
import type { NextConfig } from "next";

// Separate build dirs let several dev servers / builds run side by side
// (e.g. `NEXT_DIST_DIR=.next-e2e`). Defaults to `.next`.
const distDir = process.env.NEXT_DIST_DIR || ".next";

/**
 * Next appends `<distDir>/types/**` to the tsconfig it type-checks with. For a
 * custom dist dir that would rewrite the committed tsconfig.json on every run,
 * so those runs use a git-ignored `tsconfig.<dist>.local.json` that extends it.
 */
function tsconfigPathFor(dir: string): string | undefined {
  if (dir === ".next") return undefined;
  const file = `tsconfig.${dir.replace(/[^A-Za-z0-9_-]/g, "") || "dist"}.local.json`;
  if (!existsSync(file)) {
    const config = {
      extends: "./tsconfig.json",
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", "**/*.mts"],
    };
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  return file;
}

const nextConfig: NextConfig = {
  distDir,
  typescript: { tsconfigPath: tsconfigPathFor(distDir) },
  // Per-build id for the service worker URL (/sw.js?v=…): each deploy installs
  // a new worker, shows the update prompt and purges old static caches.
  env: {
    NEXT_PUBLIC_SW_BUILD: process.env.NODE_ENV === "production" ? Date.now().toString(36) : "dev",
  },
  // Loaded from node_modules at runtime instead of bundled (OTP email over SMTP).
  serverExternalPackages: ["nodemailer"],
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
