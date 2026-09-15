#!/usr/bin/env bash
# Vendor the OpenISD engine at the commit pinned in OPENISD_SHA.
#
# Downloads the tarball of Johnlon/openisd at that commit, copies
# packages/engine + packages/winisd sources, the golden test fixtures and the
# .wdr driver library into vendor/, then compiles the engine to plain JS with
# tsc (upstream ships TS source only — no build artifacts, not on npm).
#
# One patch is applied: winisd sources import the bare specifier
# '@openisd/engine' (an npm-workspace alias upstream). We rewrite it to a
# relative import so the vendored tree compiles standalone. No logic changes.
#
# To update: change OPENISD_SHA, re-run `npm run vendor`, run `npm test`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(tr -d '[:space:]' < "$ROOT/OPENISD_SHA")"
VENDOR="$ROOT/vendor"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo ">> Fetching Johnlon/openisd @ $SHA"
curl -fsSL "https://codeload.github.com/Johnlon/openisd/tar.gz/$SHA" -o "$WORK/openisd.tar.gz"
tar -xzf "$WORK/openisd.tar.gz" -C "$WORK"
UPSTREAM="$WORK/openisd-$SHA"

rm -rf "$VENDOR"
mkdir -p "$VENDOR/src" "$VENDOR/drivers" "$VENDOR/fixtures/golden"

# --- engine + winisd sources -------------------------------------------------
cp -r "$UPSTREAM/packages/engine/src"  "$VENDOR/src/engine"
cp -r "$UPSTREAM/packages/winisd/src"  "$VENDOR/src/winisd"
cp "$UPSTREAM/LICENSE" "$VENDOR/LICENSE"

# winisd imports '@openisd/engine' (workspace alias) -> relative path
sed -i "s|from '@openisd/engine'|from '../engine/index.js'|g" "$VENDOR/src/winisd/"*.ts

# --- golden fixtures (upstream's own test vectors — our regression suite) ----
cp "$UPSTREAM"/packages/engine/test/fixtures/golden/*.json "$VENDOR/fixtures/golden/"

# --- driver library ----------------------------------------------------------
# Prefix each collection's files with its subdir name — filenames collide
# across collections (e.g. the same driver in matt/ and winisd/).
for sub in demos matt sample winisd; do
  [ -d "$UPSTREAM/drivers/$sub" ] || continue
  for f in "$UPSTREAM/drivers/$sub"/*.wdr; do
    [ -e "$f" ] || continue
    cp "$f" "$VENDOR/drivers/${sub}__$(basename "$f")"
  done
done
DRIVERS=$(find "$VENDOR/drivers" -name '*.wdr' | wc -l)
echo ">> Vendored $DRIVERS .wdr drivers"

# --- compile engine + winisd to JS -------------------------------------------
cat > "$VENDOR/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
EOF
( cd "$VENDOR" && npx --yes -p typescript@5.9 tsc )
echo ">> Compiled vendor/dist"

# --- driver search index -----------------------------------------------------
node "$ROOT/scripts/build-driver-index.mjs"
echo ">> Vendor complete @ $SHA"
