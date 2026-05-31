#!/bin/bash
set -e

if [ "${DEBUG}" = "1" ]; then
    echo "Starting in debug mode on port 5678..."
    WAIT_FLAG=""
    if [ "${WAIT_FOR_CLIENT}" = "1" ]; then
        WAIT_FLAG="--wait-for-client"
    fi
    uv run python -m debugpy --listen 0.0.0.0:5678 ${WAIT_FLAG} src/main.py
else
    echo "Starting backend..."
    uv run python src/main.py
fi
