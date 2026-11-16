#!/usr/bin/env python3
"""Converts a map's decoded textures (PNG, from bsp-to-glb) to WebP for build-maps.mjs.

Reads a JSON list of {"png": path, "out": path, "scale": factor, "max": pixels, "alpha": bool}
on stdin. Each image is scaled by `scale`, then down so neither side exceeds `max`, and keeps its
alpha channel only when `alpha` asks for it (TF2 keeps a specular mask there otherwise). Outputs
that already exist are kept. Prints a JSON object mapping each output path to {} or {"error": ...}.
"""

import json
import os
import sys

from PIL import Image


def convert(job):
    out = job['out']
    if os.path.exists(out):
        return {}
    image = Image.open(job['png'])
    image = image.convert('RGBA' if job.get('alpha') else 'RGB')
    width, height = image.size
    scale = float(job.get('scale', 1))
    width, height = max(1, round(width * scale)), max(1, round(height * scale))
    limit = int(job.get('max', 1024))
    fit = min(1.0, limit / max(width, height))
    size = (max(1, round(width * fit)), max(1, round(height * fit)))
    if size != image.size:
        image = image.resize(size, Image.LANCZOS)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    image.save(out, 'WEBP', quality=82, method=6)
    return {}


def main():
    results = {}
    for job in json.load(sys.stdin):
        try:
            results[job['out']] = convert(job)
        except Exception as error:  # noqa: BLE001 - reported per texture
            results[job['out']] = {'error': str(error)}
    json.dump(results, sys.stdout)


if __name__ == '__main__':
    main()
