#!/usr/bin/env bash
# Rebuild and redeploy a single app image into the running k3d cluster.
#
#   bash scripts/redeploy.sh api   → rebuild crypto-api, restart api deployment
#   bash scripts/redeploy.sh web   → rebuild crypto-web, restart web deployment
#
# Use this after code changes instead of a full cluster:up.
# Re-run cluster:up only when secrets or infra manifests change.
set -euo pipefail

CLUSTER="crypto"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

info() { echo "▶ $*"; }

if [[ "$TARGET" != "api" && "$TARGET" != "web" ]]; then
  echo "Usage: $0 [api|web]"
  exit 1
fi

if ! k3d cluster list | grep -q "^${CLUSTER}"; then
  echo "ERROR: cluster '${CLUSTER}' is not running. Run pnpm cluster:up first."
  exit 1
fi

if [[ "$TARGET" == "api" ]]; then
  info "Building API image..."
  docker build -f "${ROOT}/apps/api/Dockerfile" -t crypto-api:latest "${ROOT}"

  info "Importing into cluster..."
  k3d image import crypto-api:latest -c "${CLUSTER}"

  info "Restarting api deployment..."
  kubectl rollout restart deployment/api -n crypto-demo
  kubectl rollout status deployment/api -n crypto-demo --timeout=120s

else
  info "Building Web image..."
  docker build -f "${ROOT}/apps/web/Dockerfile" \
    --build-arg PUBLIC_API_URL="" \
    -t crypto-web:latest "${ROOT}"

  info "Importing into cluster..."
  k3d image import crypto-web:latest -c "${CLUSTER}"

  info "Restarting web deployment..."
  kubectl rollout restart deployment/web -n crypto-demo
  kubectl rollout status deployment/web -n crypto-demo --timeout=120s
fi

echo ""
echo "Done. Pod status:"
kubectl get pods -n crypto-demo -o wide
