import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// esbuild, not Vite: no framework and two entry points, so ten lines suffice.

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "src");
const out = resolve(here, "dist");
const watch = process.argv.includes("--watch");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const options = {
  entryPoints: {
    background: resolve(src, "background.ts"),
    panel: resolve(src, "panel.ts"),
  },
  outdir: out,
  bundle: true,
  format: "esm",
  // Keeps model-viewer's ~1MB out of the panel's initial load.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  target: "chrome116",
  platform: "browser",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  // Mirrors tsconfig's "@/*" so the site's parsers are imported, not copied.
  alias: { "@": resolve(here, "..", "src") },
  // Pulled in transitively by the server helpers, never reached at run time.
  external: ["playwright-core", "node:fs", "node:path"],
};

async function copyStatic() {
  await cp(resolve(here, "manifest.json"), resolve(out, "manifest.json"));
  await cp(resolve(src, "panel.html"), resolve(out, "panel.html"));
  await cp(resolve(src, "panel.css"), resolve(out, "panel.css"));
  await cp(resolve(here, "icons"), resolve(out, "icons"), { recursive: true });
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  await copyStatic();
  console.log("watching… load extension/dist as an unpacked extension");
} else {
  await build(options);
  await copyStatic();
  console.log("built to extension/dist");
}
