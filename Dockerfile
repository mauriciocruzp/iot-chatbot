# Image size ~ 400MB
FROM node:24.12-alpine as builder

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++ \
    && apk add --no-cache git \
    && npm ci \
    && apk del .gyp

FROM node:24.12-alpine as deploy

WORKDIR /app

# Install Chromium and dependencies for WPPConnect
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji

# Set Chromium path for Puppeteer/Playwright
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY . .

RUN npm cache clean --force \
    && addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs \
    && mkdir -p /app/bot_sessions \
    && chown -R nodejs:nodejs /app

USER nodejs

CMD ["npm", "start"]
