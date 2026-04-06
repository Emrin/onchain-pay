#!/usr/bin/env bash
set -eu
set -o pipefail 2>/dev/null || true

CLUSTER="crypto"

echo "Deleting k3d cluster '${CLUSTER}'..."
k3d cluster delete "${CLUSTER}"
echo "Done."