"""AI OCR sidecar for the Tarkov tracker.

Runs RapidOCR (PaddleOCR detection + recognition models on ONNX Runtime, CPU only). The tracker
starts one process per OCR run and sends one JSON request per line on stdin:

  {"id": 1, "file": "/path/shot.png"}                      -> every text line on the image
  {"id": 2, "file": "/path/shot.png", "box": [x, y, w, h]}  -> only that rectangle

and gets one JSON line back per request:

  {"id": 1, "lines": [{"text": "Level: 3", "left": 150, "top": 90, "width": 80, "height": 18, "score": 0.98}]}
  {"id": 2, "error": "..."}

A line "ready" is printed once the model has loaded.
"""
import json
import sys

import cv2
from rapidocr_onnxruntime import RapidOCR


def to_lines(result):
    lines = []
    for box, text, score in result or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        left, top = min(xs), min(ys)
        lines.append({
            "text": text,
            "left": round(left),
            "top": round(top),
            "width": round(max(xs) - left),
            "height": round(max(ys) - top),
            "score": round(float(score), 3),
        })
    return lines


def handle(engine, req):
    img = cv2.imread(req["file"], cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cannot read image")
    box = req.get("box")
    if box:
        x, y, w, h = (max(0, int(round(v))) for v in box)
        img = img[y:y + h, x:x + w]
        if img.size == 0:
            return []
    result, _ = engine(img)
    lines = to_lines(result)
    if box:
        for line in lines:
            line["left"] += x
            line["top"] += y
    return lines


def main():
    engine = RapidOCR()
    print("ready", flush=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            out = {"id": req.get("id"), "lines": handle(engine, req)}
        except Exception as err:  # report per request, keep serving
            out = {"id": req.get("id"), "error": str(err)}
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
