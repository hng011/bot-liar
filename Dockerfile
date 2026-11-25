FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium-headless-shell ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROMIUM_PATH=/usr/bin/chromium-headless-shell \
    CHROMIUM_HEADLESS_SHELL=true \
    NODE_OPTIONS=--max-old-space-size=256 \
    DATA_DIR=/data \
    PORT=8000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
RUN mkdir -p /data /app/.wwebjs_cache && chown node:node /data /app/.wwebjs_cache
COPY src ./src
COPY prompts ./prompts
USER 1000:1000
EXPOSE 8000
CMD ["node", "src/index.ts"]
