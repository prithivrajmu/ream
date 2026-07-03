# Ream Linux Packaging

Ream packages three x64 Linux formats through Electron Builder:

- AppImage for portable desktop use.
- DEB for Debian and Ubuntu based distributions.
- tar.gz for manual installation or other distributions.

## APT install

Community testing releases are distributed through a Ream APT repository hosted
from GitHub Pages:

```bash
curl -fsSL https://prithivrajmu.github.io/ream/apt/setup.sh | sudo bash
sudo apt install ream
```

The setup script installs Ream's public signing key, writes
`/etc/apt/sources.list.d/ream.list`, and refreshes the local package index.
Plain `sudo apt install ream` without adding the Ream source first is a future
upstream distribution path through Debian or Ubuntu package repositories.

## Build

```bash
npm run dist:linux
```

Artifacts are written to `release/`. A fast unpacked smoke build is also
available:

```bash
npm run dist:linux:dir
```

## Release checks

Before publishing, verify the expected artifacts and metadata:

```bash
sha256sum release/Ream-*.AppImage release/Ream-*.deb release/Ream-*.tar.gz
dpkg-deb --info release/Ream-*.deb
```

Generate the APT repository metadata:

```bash
npm run release:apt
```

The repository is written to `dist/apt/` and is intended to be signed during the
release workflow before publishing to GitHub Pages.

Open the AppImage or unpacked build on a clean Linux desktop. Confirm that the
Ream icon, desktop launcher, tray icon, main window, and minimize-to-overlay
flow work. Linux packages are not signed by default; publish checksums with the
release.

## Release checklist

- Build Linux artifacts on x64 Ubuntu from a version tag such as `v0.1.0`.
- Verify the `.deb` package name is `ream`.
- Generate `Packages`, `Packages.gz`, and `Release` metadata with
  `npm run release:apt`.
- Sign `Release` as both `InRelease` and `Release.gpg`.
- Publish the signed APT repository to GitHub Pages.
- Upload AppImage, DEB, tarball, and SHA-256 checksums to GitHub Releases.
