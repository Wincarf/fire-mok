# Fire Mok API — raster tiles + JSON endpoints.
# Build:  docker build -t fire-mok .
# Run:    docker run -p 8000:8000 -v "$PWD/data:/app/data" fire-mok
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# deps first (layer cache): pipeline project defines the shared venv
COPY pipeline/pyproject.toml pipeline/uv.lock ./pipeline/
RUN cd pipeline && uv sync --frozen --no-install-project

COPY pipeline/pipeline ./pipeline/pipeline
COPY api ./api

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["/app/pipeline/.venv/bin/uvicorn", "--app-dir", "/app/api", "app:app", "--host", "0.0.0.0", "--port", "8000"]
