// Cut a release build: bump the version (package.json + manifest stay in sync),
// build, package, and print the zip path to upload to the store.
//
// Usage:
//   npm run release            # patch bump (0.1.0 -> 0.1.1)
//   npm run release minor      # 0.1.0 -> 0.2.0
//   npm run release major      # 0.1.0 -> 1.0.0
//   npm run release 1.4.2      # set an explicit version
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const manifestPath = join(root, "public", "manifest.json");

function bump(version, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump "${kind}" — use patch | minor | major | x.y.z`);
}

// Rewrite only the "version" field, preserving formatting (2-space + newline).
function setVersion(path, next) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = next;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = bump(pkg.version, process.argv[2] || "patch");

console.log(`Bumping ${pkg.version} -> ${next}`);
setVersion(pkgPath, next);
setVersion(manifestPath, next);

// build + zip (package.mjs reads the new version for the filename)
execSync("npm run package", { cwd: root, stdio: "inherit" });

const zip = join("web-ext-artifacts", `${pkg.name}-${next}.zip`);
if (!existsSync(join(root, zip))) {
  console.error(`Expected ${zip} but it was not produced.`);
  process.exit(1);
}

console.log("\n──────────────────────────────────────────");
console.log(`✓ v${next} ready. Upload this file to the store:`);
console.log(`  ${zip}`);
console.log("Next: commit the version bump, then upload in the Web Store dashboard.");
console.log("──────────────────────────────────────────");
