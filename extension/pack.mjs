import { createWriteStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";

// The Chrome Web Store wants manifest.json at the ZIP root, so this archives
// the *contents* of dist/ rather than the folder. Zipping the folder itself is
// the most common upload rejection.
//
// Hand-rolled because a store-ready zip is ~60 lines of the format and not
// worth another dependency.

const deflate = promisify(deflateRaw);
const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "dist");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// CRC-32, needed per entry by the zip spec.
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

try {
  await stat(DIST);
} catch {
  console.error("extension/dist missing — run `npm run build:ext` first");
  process.exit(1);
}

const files = (await walk(DIST)).sort();
const local = [];
const central = [];
let offset = 0;

for (const file of files) {
  const name = relative(DIST, file).split("\\").join("/");
  const raw = await readFile(file);
  const packed = await deflate(raw);
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(raw);

  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0, 6);
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt32LE(0, 10); // fixed timestamp keeps builds reproducible
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(raw.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  local.push(head, nameBuf, packed);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(packed.length, 20);
  dir.writeUInt32LE(raw.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt32LE(offset, 42);
  central.push(dir, nameBuf);

  offset += head.length + nameBuf.length + packed.length;
  console.log(`  ${name} (${raw.length} → ${packed.length})`);
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const { version } = JSON.parse(await readFile(join(DIST, "manifest.json"), "utf8"));
const target = resolve(here, `pullsrc-extension-v${version}.zip`);
await new Promise((done, fail) => {
  const out = createWriteStream(target);
  out.on("error", fail);
  out.on("close", done);
  out.write(Buffer.concat([...local, centralBuf, end]));
  out.end();
});

console.log(`\npacked ${files.length} files → ${relative(process.cwd(), target)}`);
