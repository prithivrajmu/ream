import { describe, expect, it } from "vitest";
import { compareVersions, releaseVersion, selectAppUpdate, type GithubRelease } from "../shared/appUpdates";

const releases: GithubRelease[] = [
  {
    tag_name: "linux-appimage-x64-v0.1.4",
    assets: [{ name: "Ream-0.1.4-x64.AppImage", browser_download_url: "https://example.test/0.1.4.AppImage" }]
  },
  {
    tag_name: "macos-unsigned-v0.1.5",
    assets: [
      { name: "Ream-0.1.5-arm64.dmg", browser_download_url: "https://example.test/0.1.5-arm64.dmg" },
      { name: "Ream-0.1.5-x64.dmg", browser_download_url: "https://example.test/0.1.5-x64.dmg" }
    ]
  },
  {
    tag_name: "linux-appimage-x64-v0.1.5",
    assets: [{ name: "Ream-0.1.5-x64.AppImage", browser_download_url: "https://example.test/0.1.5.AppImage" }]
  }
];

describe("app updates", () => {
  it("reads the version from the release tags", () => {
    expect(releaseVersion("macos-unsigned-v0.1.5")).toBe("0.1.5");
    expect(releaseVersion("linux-appimage-x64-v0.1.5")).toBe("0.1.5");
    expect(releaseVersion("v0.2.0")).toBe("0.2.0");
    expect(releaseVersion("not-a-release")).toBeNull();
  });

  it("orders versions numerically", () => {
    expect(compareVersions("0.1.4", "0.1.5")).toBe(-1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.5", "0.1.5")).toBe(0);
  });

  it("picks the newest installer for this Mac", () => {
    expect(selectAppUpdate(releases, "0.1.4", "darwin", "arm64")).toEqual({
      version: "0.1.5",
      assetName: "Ream-0.1.5-arm64.dmg",
      url: "https://example.test/0.1.5-arm64.dmg"
    });
  });

  it("picks the Linux AppImage and ignores a current build", () => {
    expect(selectAppUpdate(releases, "0.1.4", "linux", "x64")?.assetName).toBe("Ream-0.1.5-x64.AppImage");
    expect(selectAppUpdate(releases, "0.1.5", "linux", "x64")).toBeNull();
    expect(selectAppUpdate(releases, "0.1.4", "linux", "arm64")).toBeNull();
  });
});
