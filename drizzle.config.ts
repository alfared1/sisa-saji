import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/postgres",
  },
  // PostGIS creates its own tables (spatial_ref_sys) and views; never touch them.
  extensionsFilters: ["postgis"],
  strict: true,
  verbose: true,
});
