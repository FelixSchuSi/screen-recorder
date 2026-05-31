#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build -d

echo ""
echo "    App:       http://localhost:8000  ← frontend + API"
echo "    Debugpy:   localhost:5678         ← attach VS Code here"
echo ""

docker compose -f docker-compose.yml -f docker-compose.debug.yml logs -f backend
