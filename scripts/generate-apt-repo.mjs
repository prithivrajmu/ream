import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const releaseDir = path.resolve(process.argv[2] ?? "release");
const outputDir = path.resolve(process.argv[3] ?? "dist/apt");
const poolDir = path.join(outputDir, "pool/main/r/ream");
const distro = "stable";
const component = "main";
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));

function inferArchitecture(fileName) {
  if (fileName.includes("arm64")) {
    return "arm64";
  }

  if (fileName.includes("x64") || fileName.includes("amd64")) {
    return "amd64";
  }

  return "amd64";
}

function fallbackControlFields(fileName) {
  const maintainer = packageJson.build?.linux?.maintainer
    ?? `${packageJson.author?.name ?? "Ream Maintainers"} <${packageJson.author?.email ?? "maintainers@example.com"}>`;

  return new Map([
    ["Package", packageJson.name],
    ["Version", packageJson.version],
    ["Architecture", inferArchitecture(fileName)],
    ["Maintainer", maintainer],
    ["Section", "office"],
    ["Priority", "optional"],
    ["Homepage", packageJson.homepage],
    ["Description", packageJson.build?.linux?.description ?? packageJson.description]
  ]);
}

async function findDebFiles(directory) {
  const entries = await fs.readdir(directory);
  const debs = entries
    .filter((entry) => entry.endsWith(".deb"))
    .sort((left, right) => left.localeCompare(right));

  if (debs.length === 0) {
    throw new Error(`No .deb artifacts found in ${directory}`);
  }

  return debs;
}

function parseControlFields(controlText) {
  const fields = new Map();
  let currentKey = "";

  for (const line of controlText.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith(" ") && currentKey) {
      fields.set(currentKey, `${fields.get(currentKey)}\n${line}`);
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    currentKey = line.slice(0, separator);
    fields.set(currentKey, line.slice(separator + 1).trimStart());
  }

  return fields;
}

async function fileHash(algorithm, filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash(algorithm).update(buffer).digest("hex");
}

async function packageStanza(debName) {
  const sourcePath = path.join(releaseDir, debName);
  const destinationPath = path.join(poolDir, debName);
  await fs.copyFile(sourcePath, destinationPath);

  let fields;

  try {
    const { stdout } = await execFileAsync("dpkg-deb", ["-f", sourcePath]);
    fields = parseControlFields(stdout);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    console.warn(`dpkg-deb is not available; using inferred package metadata for ${debName}.`);
    fields = fallbackControlFields(debName);
  }

  const packageArchitecture = fields.get("Architecture");

  if (!packageArchitecture) {
    throw new Error(`Could not read Architecture from ${debName}`);
  }

  const stats = await fs.stat(sourcePath);
  const relativeDebPath = path.posix.join("pool/main/r/ream", debName);

  const orderedFields = [
    "Package",
    "Version",
    "Architecture",
    "Maintainer",
    "Installed-Size",
    "Depends",
    "Section",
    "Priority",
    "Homepage",
    "Description"
  ];

  const lines = [];

  for (const field of orderedFields) {
    if (fields.has(field)) {
      lines.push(`${field}: ${fields.get(field)}`);
    }
  }

  lines.push(`Filename: ${relativeDebPath}`);
  lines.push(`Size: ${stats.size}`);
  lines.push(`MD5sum: ${await fileHash("md5", sourcePath)}`);
  lines.push(`SHA1: ${await fileHash("sha1", sourcePath)}`);
  lines.push(`SHA256: ${await fileHash("sha256", sourcePath)}`);

  return {
    architecture: packageArchitecture,
    stanza: lines.join("\n")
  };
}

async function gzipFile(sourcePath, destinationPath) {
  await pipeline(createReadStream(sourcePath), createGzip({ level: 9 }), createWriteStream(destinationPath));
}

async function releaseHashLines(algorithm, files) {
  const hashName = algorithm === "md5" ? "MD5Sum" : algorithm.toUpperCase();
  const lines = [`${hashName}:`];

  for (const filePath of files) {
    const absolutePath = path.join(outputDir, "dists", distro, filePath);
    const stats = await fs.stat(absolutePath);
    const digest = await fileHash(algorithm, absolutePath);
    lines.push(` ${digest} ${stats.size} ${filePath}`);
  }

  return lines.join("\n");
}

await fs.mkdir(poolDir, { recursive: true });

const debFiles = await findDebFiles(releaseDir);
const packagesByArchitecture = new Map();

for (const debFile of debFiles) {
  const packageInfo = await packageStanza(debFile);
  const packages = packagesByArchitecture.get(packageInfo.architecture) ?? [];
  packages.push(packageInfo.stanza);
  packagesByArchitecture.set(packageInfo.architecture, packages);
}

const releaseFiles = [];

for (const [packageArchitecture, packageStanzas] of [...packagesByArchitecture.entries()].sort()) {
  const binaryDir = path.join(outputDir, "dists", distro, component, `binary-${packageArchitecture}`);
  await fs.mkdir(binaryDir, { recursive: true });

  const packagesPath = path.join(binaryDir, "Packages");
  const packagesGzPath = `${packagesPath}.gz`;
  await fs.writeFile(packagesPath, `${packageStanzas.join("\n\n")}\n`);
  await gzipFile(packagesPath, packagesGzPath);

  releaseFiles.push(`${component}/binary-${packageArchitecture}/Packages`);
  releaseFiles.push(`${component}/binary-${packageArchitecture}/Packages.gz`);
}

const releasePath = path.join(outputDir, "dists", distro, "Release");
const architectures = [...packagesByArchitecture.keys()].sort().join(" ");
const releaseText = [
  "Origin: Ream",
  "Label: Ream",
  `Suite: ${distro}`,
  `Codename: ${distro}`,
  "Version: 1.0",
  `Architectures: ${architectures}`,
  "Components: main",
  "Description: Ream desktop package repository",
  `Date: ${new Date().toUTCString()}`,
  await releaseHashLines("md5", releaseFiles),
  await releaseHashLines("sha1", releaseFiles),
  await releaseHashLines("sha256", releaseFiles)
].join("\n");

await fs.writeFile(releasePath, `${releaseText}\n`);
await fs.copyFile("packaging/apt/setup.sh", path.join(outputDir, "setup.sh"));

console.log(`Wrote APT repository to ${path.relative(process.cwd(), outputDir)} with ${debFiles.length} package(s).`);
