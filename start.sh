#!/usr/bin/env bash
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
JWT_SECRET="${JWT_SECRET:-dev-secret}"
WORKSPACE_DIR="${WORKSPACE_DIR:-$PWD}"
PORT="${PORT:-5174}"
export ADMIN_PASSWORD JWT_SECRET WORKSPACE_DIR PORT
echo "WORKSPACE_DIR=$WORKSPACE_DIR"
echo "PORT=$PORT"
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev
