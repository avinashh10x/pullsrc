import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// esbuild rather than Vite: the extension has three independent entry points
// and no framework, so a bundler config of ten lines does the whole job.

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
  // model-viewer is only imported when a page has 3D assets; splitting keeps
  // that ~1MB out of the panel's initial load.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  target: "chrome116",
  platform: "browser",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  // Mirrors the "@/*" path alias in tsconfig so extension code can import the
  // site's parsers directly instead of keeping a second copy of them.
  alias: { "@": resolve(here, "..", "src") },
  // playwright-core is pulled in transitively by the server helpers but never
  // reached at run time in the extension; stub it so it can't break the bundle.
  external: ["playwright-core", "node:fs", "node:path"],
};

async function copyStatic() {
  await cp(resolve(here, "manifest.json"), resolve(out, "manifest.json"));
  await cp(resolve(src, "panel.html"), resolve(out, "panel.html"));
  await cp(resolve(src, "panel.css"), resolve(out, "panel.css"));
  await cp(resolve(here, "..", "public", "logo.png"), resolve(out, "icon128.png"));
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
