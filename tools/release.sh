#!/bin/sh
# ARVEX SURVIVAL release: game bundle → launcher (Windows exe, embeds the shared design system) → GitHub Pages mirror
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs
# the launcher UI shares tokens, fonts and brand with the game
rm -rf launcher/ui/fonts launcher/ui/brand && cp public/arvex.css launcher/ui/ && cp -r public/fonts launcher/ui/fonts && cp -r public/brand launcher/ui/brand
WR=$(ls /usr/lib/llvm*/bin/llvm-windres 2>/dev/null | head -1)
[ -n "$WR" ] && (cd launcher && $WR --target=pe-x86-64 -i arvex.rc -O coff -o rsrc_windows_amd64.syso)
mkdir -p dist public/download
(cd launcher && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../dist/ARVEX-Launcher.exe .)
cp dist/ARVEX-Launcher.exe public/download/ARVEX-Launcher.exe
(cd dist && rm -f ARVEX-Launcher.zip && zip -q -9 ARVEX-Launcher.zip ARVEX-Launcher.exe)
rm -rf docs && mkdir -p docs && cp -r public/* docs/ && rm -rf docs/download && touch docs/.nojekyll
ls -la dist
