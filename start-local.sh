#!/usr/bin/env bash
# Starts a persistent port-forward from localhost:18080 → nginx-ingress:80
# bypassing Docker Desktop which owns port 80 on the host.
# Run this once before starting the frontend dev server.
set -e

PORT=18080

# Kill any existing port-forward on 18080
pkill -f "kubectl port-forward.*ingress-nginx-controller.*${PORT}" 2>/dev/null || true
sleep 0.5

echo "[start-local] Starting kubectl port-forward on localhost:${PORT} → ingress-nginx:80"

# Run port-forward in a loop so it restarts if the pod is replaced
while true; do
  kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller "${PORT}:80" \
    2>&1 | sed 's/^/[pf] /' || true
  echo "[start-local] port-forward exited, restarting in 2s..."
  sleep 2
done
