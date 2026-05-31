# Lightweight CPU-only backend (GPU inference is handled by vLLM)
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install curl (required by uv installer) and ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv
ADD https://astral.sh/uv/install.sh /uv-installer.sh
RUN sh /uv-installer.sh && rm /uv-installer.sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# Copy project metadata first for Docker layer caching
COPY backend/pyproject.toml ./

# Create venv and install dependencies
RUN uv sync --no-dev

# Install debugpy for remote debugging
RUN uv pip install --no-cache-dir debugpy

# Copy source code
COPY backend/src ./src

# Copy frontend assets so FastAPI can serve them
COPY index.html index.js index.css ./static/

# Expose app port and debugpy port
EXPOSE 8000 5678

# Entrypoint handles normal vs debug mode
COPY backend/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
