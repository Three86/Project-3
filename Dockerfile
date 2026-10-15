FROM node:22-alpine
# Tesseract OCR reads skill levels from in-game screenshots
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data EFT_LOGS_DIR=/eft-logs EFT_SCREENSHOTS_DIR=/eft-screenshots
COPY package.json package-lock.json ./
# sharp (prebuilt for Alpine) enlarges small screenshots before OCR
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://localhost:3000/api/status >/dev/null || exit 1
CMD ["node", "server/index.js"]
