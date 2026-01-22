#!/usr/bin/env bash
set -euo pipefail

echo "This script attempts to install LibreDWG and ImageMagick on Debian/Ubuntu systems. Run with sudo if you want it to perform installs."

if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get not available. Please install libredwg and imagemagick manually for your distro."
  exit 1
fi

echo "Updating package lists..."
sudo apt-get update

# Attempt to install libredwg tools (package name may vary by distro/repo)
echo "Attempting to install libredwg-tools and imagemagick..."
sudo apt-get install -y libredwg-tools imagemagick || {
  echo "libredwg-tools not found or install failed. You may need to add backports or compile LibreDWG from source. See https://libredwg.org/ for instructions.";
}

echo "Done. Probe with: curl -s -G 'http://localhost/api/diagnostics.php' --data-urlencode 'probe=dwg'"

echo "If you need the ODA (Teigha) File Converter, obtain it from ODA and install per their docs."
