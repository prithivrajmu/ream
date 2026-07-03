import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const releaseDir = path.resolve(process.argv[2] ?? "release");
const outputFile = path.resolve(process.argv[3] ?? path.join(releaseDir, "SHA256SUMS"));
const packageExtensions = new Set([".AppImage", ".deb", ".dmg", ".gz", ".zip"]);

async function listPackageFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      if (name.endsWith(".blockmap")) {
        return false;
      }

      return packageExtensions.has(path.extname(name));
    })
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No release package artifacts found in ${directory}`);
  }

  return files;
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

const packageFiles = await listPackageFiles(releaseDir);
const lines = [];

for (const fileName of packageFiles) {
  const digest = await sha256(path.join(releaseDir, fileName));
  lines.push(`${digest}  ${fileName}`);
}

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${lines.join("\n")}\n`);

console.log(`Wrote ${path.relative(process.cwd(), outputFile)} with ${lines.length} checksum(s).`);
