// Zip the built `dist/` into web-ext-artifacts/<name>-<version>.zip, ready to
// upload to the Chrome Web Store or Microsoft Edge Add-ons. Run `npm run
// package` (which builds first). Uses jszip so it works without a system `zip`.
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const outDir = join(root, "web-ext-artifacts");

if (!existsSync(distDir)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const zip = new JSZip();
let fileCount = 0;
for await (const file of walk(distDir)) {
  zip.file(relative(distDir, file).split("\\").join("/"), await readFile(file));
  fileCount += 1;
}

await mkdir(outDir, { recursive: true });
const outFile = join(outDir, `${pkg.name}-${pkg.version}.zip`);
const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await writeFile(outFile, buffer);

const { size } = await stat(outFile);
console.log(`Packaged ${fileCount} files -> ${relative(root, outFile)} (${(size / 1024).toFixed(1)} KB)`);
