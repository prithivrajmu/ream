export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name: string;
  assets?: ReleaseAsset[];
}

export interface UpdateCandidate {
  version: string;
  assetName: string;
  url: string;
}

export function releaseVersion(tag: string): string | null {
  const match = /(\d+\.\d+\.\d+)$/.exec(tag.trim());
  return match?.[1] ?? null;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part));
  const b = right.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const delta = (Number.isFinite(a[index]) ? a[index] : 0) - (Number.isFinite(b[index]) ? b[index] : 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

export function selectAppUpdate(releases: GithubRelease[], currentVersion: string, platform: NodeJS.Platform, arch: string): UpdateCandidate | null {
  const newer = releases
    .map((release) => ({ release, version: releaseVersion(release.tag_name) }))
    .filter((item): item is { release: GithubRelease; version: string } => item.version !== null && compareVersions(item.version, currentVersion) > 0)
    .sort((left, right) => compareVersions(right.version, left.version));

  for (const item of newer) {
    const asset = matchingAsset(item.release.assets ?? [], item.version, platform, arch);
    if (asset) {
      return { version: item.version, assetName: asset.name, url: asset.browser_download_url };
    }
  }
  return null;
}

function matchingAsset(assets: ReleaseAsset[], version: string, platform: NodeJS.Platform, arch: string): ReleaseAsset | null {
  const wanted = assetNames(version, platform, arch);
  for (const name of wanted) {
    const asset = assets.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase() && candidate.browser_download_url);
    if (asset) return asset;
  }
  return null;
}

function assetNames(version: string, platform: NodeJS.Platform, arch: string): string[] {
  if (platform === "darwin") return [`Ream-${version}-${arch}.dmg`, `Ream-${version}-${arch}.zip`];
  if (platform === "linux" && arch === "x64") return [`Ream-${version}-x64.AppImage`];
  return [];
}
