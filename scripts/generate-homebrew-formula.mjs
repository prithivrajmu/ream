import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const version = process.env.REAM_VERSION ?? packageJson.version;
const repository = process.env.GITHUB_REPOSITORY ?? "prithivrajmu/ream";
const tag = process.env.REAM_RELEASE_TAG ?? `v${version}`;
const releaseDir = path.resolve(process.argv[2] ?? "release");
const outputFile = path.resolve(process.argv[3] ?? "packaging/homebrew/Formula/ream.rb");

async function findZip(predicate, description) {
  const entries = await fs.readdir(releaseDir);
  const match = entries
    .filter((entry) => entry.endsWith(".zip"))
    .filter(predicate)
    .sort((left, right) => left.localeCompare(right))
    .at(0);

  if (!match) {
    throw new Error(`Could not find ${description} macOS ZIP in ${releaseDir}`);
  }

  return match;
}

async function sha256(fileName) {
  const buffer = await fs.readFile(path.join(releaseDir, fileName));
  return createHash("sha256").update(buffer).digest("hex");
}

const armZip = await findZip((name) => name.includes("arm64"), "arm64");
const intelZip = await findZip((name) => !name.includes("arm64"), "x64");
const armSha = await sha256(armZip);
const intelSha = await sha256(intelZip);
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${tag}`;

const formula = `class Ream < Formula
  desc "Local-first desktop task time tracker with notes and an overlay"
  homepage "https://github.com/${repository}"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${releaseBaseUrl}/${armZip}"
      sha256 "${armSha}"
    end

    on_intel do
      url "${releaseBaseUrl}/${intelZip}"
      sha256 "${intelSha}"
    end
  end

  def install
    prefix.install "Ream.app"

    (bin/"ream").write <<~EOS
      #!/bin/bash
      open "#{prefix}/Ream.app" --args "$@"
    EOS
  end

  test do
    assert_predicate prefix/"Ream.app", :directory?
    assert_predicate bin/"ream", :executable?
  end
end
`;

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, formula);

console.log(`Wrote ${path.relative(process.cwd(), outputFile)} for ${repository}@${tag}.`);
