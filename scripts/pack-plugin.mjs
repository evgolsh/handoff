// Writes dist/handoff-plugin-<version>.zip, the package for OpenAI's plugin portal (ChatGPT and Codex):
// plugin.json, mcp.json, skills/, assets/, README.md and LICENSE from plugin/, at the archive root, and nothing
// else. The Claude files (.claude-plugin/, .mcp.json) stay out. Fixed timestamps, so the same input gives the
// same ZIP.
//
//   npm run pack:plugin
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = "plugin";
const INCLUDE = ["plugin.json", "mcp.json", "README.md", "LICENSE", "skills", "assets"];

const { version } = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((n) => walk(join(p, n))) : [p]);
const files = INCLUDE.flatMap((n) => walk(join(ROOT, n))).filter((p) => !p.endsWith(".DS_Store"));

const DOS_DATE = (1 << 5) | 1; // 1980-01-01, 00:00
const locals = [];
const centrals = [];
let offset = 0;
for (const path of files) {
  const name = Buffer.from(relative(ROOT, path).split("\\").join("/"));
  const data = readFileSync(path);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
  central.writeUInt32LE(offset, 42);
  locals.push(local, name, packed);
  centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}
const dir = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync("dist", { recursive: true });
const out = join("dist", `handoff-plugin-${version}.zip`);
writeFileSync(out, Buffer.concat([...locals, dir, end]));
console.log(`wrote ${out}: ${files.length} files`);
