# Ream Linux Packaging

Ream packages three x64 Linux formats through Electron Builder:

- AppImage for portable desktop use.
- DEB for Debian and Ubuntu based distributions.
- tar.gz for manual installation or other distributions.

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

Open the AppImage or unpacked build on a clean Linux desktop. Confirm that the
Ream icon, desktop launcher, tray icon, main window, and minimize-to-overlay
flow work. Linux packages are not signed by default; publish checksums with the
release.
