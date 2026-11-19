#!/bin/sh
# EMBERWING release: bundle -> Windows exe -> zip -> GitHub Pages folder (docs/)
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs
rm -rf desktop/public && cp -r public desktop/public
WR=$(ls /usr/lib/llvm*/bin/llvm-windres 2>/dev/null | head -1)
[ -n "$WR" ] && (cd desktop && $WR --target=pe-x86-64 -i ew.rc -O coff -o rsrc_windows_amd64.syso)
(cd desktop && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../dist/EMBERWING.exe .)
(cd dist && rm -f EMBERWING-PC.zip && zip -q -9 EMBERWING-PC.zip EMBERWING.exe)
rm -rf docs && mkdir -p docs && cp -r public/* docs/ && touch docs/.nojekyll
ls -la dist
