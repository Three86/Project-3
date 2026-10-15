FROM node:22-bookworm-slim
# OCR for reading skill/PMC levels from in-game screenshots:
#  - Tesseract (classic engine)
#  - RapidOCR: PaddleOCR models on ONNX Runtime, CPU only (no graphics card needed). ONNX Runtime
#    needs glibc, which is why this image is Debian-based rather than Alpine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng python3 python3-venv libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
COPY requirements-ocr.txt /tmp/requirements-ocr.txt
RUN python3 -m venv /opt/ocr-venv \
 && /opt/ocr-venv/bin/pip install --no-cache-dir -r /tmp/requirements-ocr.txt \
 && /opt/ocr-venv/bin/python -c "import rapidocr_onnxruntime" \
 && rm /tmp/requirements-ocr.txt
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data EFT_LOGS_DIR=/eft-logs EFT_SCREENSHOTS_DIR=/eft-screenshots OCR_AI_PYTHON=/opt/ocr-venv/bin/python
COPY package.json package-lock.json ./
# sharp enlarges small screenshots before OCR
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/index.js"]
