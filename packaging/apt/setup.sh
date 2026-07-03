#!/usr/bin/env bash
set -euo pipefail

APT_BASE_URL="${REAM_APT_BASE_URL:-https://prithivrajmu.github.io/ream/apt}"
KEYRING_PATH="/usr/share/keyrings/ream-archive-keyring.gpg"
SOURCE_PATH="/etc/apt/sources.list.d/ream.list"
ARCHITECTURE="$(dpkg --print-architecture)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this setup script with sudo." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg

curl -fsSL "${APT_BASE_URL}/ream-archive-keyring.gpg" -o "${KEYRING_PATH}"
chmod 0644 "${KEYRING_PATH}"

echo "deb [arch=${ARCHITECTURE} signed-by=${KEYRING_PATH}] ${APT_BASE_URL} stable main" > "${SOURCE_PATH}"
apt-get update

echo "Ream APT repository is configured. Install with: sudo apt install ream"
