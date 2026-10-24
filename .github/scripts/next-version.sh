#!/usr/bin/env sh
# Calcula el siguiente tag de versión (SPEC 25). Lee los tags existentes por stdin, uno por línea,
# e imprime el siguiente subiendo el parche del más alto:
#
#   git tag --list | .github/scripts/next-version.sh
#
# Sin tags vX.Y.Z → v0.1.0. El orden es por versión (v0.1.10 > v0.1.9), no alfabético. Los tags
# que no son exactamente vX.Y.Z se ignoran. Subir el menor o el mayor se hace a mano creando el tag
# (v0.2.0); a partir de ahí este script sigue desde él (v0.2.1).
set -eu

latest=$(grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 || true)

if [ -z "$latest" ]; then
  echo v0.1.0
  exit 0
fi

major=$(echo "$latest" | cut -d. -f1)
minor=$(echo "$latest" | cut -d. -f2)
patch=$(echo "$latest" | cut -d. -f3)
echo "v$major.$minor.$((patch + 1))"
