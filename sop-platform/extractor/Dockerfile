# ============================================================
# SOP Platform — Frame Extractor Dockerfile
# FFmpeg + PySceneDetect + OpenCV + imagehash
#
# Phase 5 (Mermaid + Chromium): build with INSTALL_MERMAID=true
#   docker build --build-arg INSTALL_MERMAID=true ...
#
# Memory limit: 4G (enforced via docker-compose.yml deploy.resources)
# ============================================================
FROM python:3.11-slim

ARG INSTALL_MERMAID=false

WORKDIR /app

# Core system dependencies (always installed)
# Note: libgl1 replaces libgl1-mesa-glx on Debian bookworm
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    curl \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

# Phase 5 only: Chromium + Node.js + Mermaid CLI
# Install only when INSTALL_MERMAID=true
RUN if [ "$INSTALL_MERMAID" = "true" ]; then \
    apt-get update && apt-get install -y gnupg chromium && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @mermaid-js/mermaid-cli && \
    echo '{"executablePath":"/usr/bin/chromium","args":["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]}' > /app/puppeteer.config.json && \
    rm -rf /var/lib/apt/lists/*; \
fi

# Configure Puppeteer paths (no-op if Chromium not installed)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY . .

# Create /data dir for temp video processing (no volume mount on Azure)
RUN mkdir -p /data

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
