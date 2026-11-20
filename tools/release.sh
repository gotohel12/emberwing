#!/bin/sh
# ARVEX release build: game bundle (+ build.json) → launcher (Windows exe, same version, embeds the shared design system) → GitHub Pages mirror.
# The version comes from package.json only. Run the tests before publishing:  node tests/run-all.mjs --launcher
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs
VERSION=$(node -p "require('./package.json').version")
# the launcher UI shares tokens, fonts and brand with the game
rm -rf launcher/ui/fonts launcher/ui/brand && cp public/arvex.css launcher/ui/ && cp -r public/fonts launcher/ui/fonts && cp -r public/brand launcher/ui/brand
WR=$(ls /usr/lib/llvm*/bin/llvm-windres 2>/dev/null | head -1)
[ -n "$WR" ] && (cd launcher && $WR --target=pe-x86-64 -i arvex.rc -O coff -o rsrc_windows_amd64.syso)
mkdir -p dist public/download
(cd launcher && go vet ./... && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui -X main.launcherVersion=$VERSION" -o ../dist/ARVEX-Launcher.exe .)
cp dist/ARVEX-Launcher.exe public/download/ARVEX-Launcher.exe
(cd dist && rm -f ARVEX-Launcher.zip && zip -q -9 ARVEX-Launcher.zip ARVEX-Launcher.exe)
# the GitHub Pages mirror carries the 1K textures only (the game falls back to them); the full set is served by the game server and the launcher
rm -rf docs && mkdir -p docs && cp -r public/* docs/ && rm -rf docs/download docs/textures/2k docs/textures/4k && touch docs/.nojekyll
echo "ARVEX $VERSION · build $(node -p "require('./public/build.json').id") · launcher $(sha256sum dist/ARVEX-Launcher.exe | cut -c1-16)…"
ls -la dist
