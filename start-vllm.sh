#!/usr/bin/env bash
set -euo pipefail
docker build -t screen-recorder-vllm -f Dockerfile .
docker run -d \
  --name screen-recorder-vllm \
  --gpus all \
  -p 8003:8003 \
  -v huggingface-cache:/root/.cache/huggingface \
  --rm \
  screen-recorder-vllm \
  openai/whisper-large-v3 \
  --port 8003 \
  --dtype float16 \
  --gpu-memory-utilization 0.8 \
  --allowed-origins '["*"]'
