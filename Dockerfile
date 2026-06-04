# Extend official vLLM image with audio transcription support
FROM vllm/vllm-openai:latest

# Install audio processing dependencies required for speech-to-text
RUN pip install --no-cache-dir "vllm[audio]" 2>/dev/null || \
    pip install --no-cache-dir av soundfile librosa
