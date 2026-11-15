#!/usr/bin/env python3
"""Converts VTF textures to WebP for the viewmodel build (build-viewmodels.mjs).

Reads a JSON list of {"vtf": path, "out": path, "max": pixels, "alpha": bool} on stdin, converts
each one whose output is missing, scaled down so neither side exceeds `max` and keeping the alpha
channel only when `alpha` asks for it, and prints a JSON object mapping each output path to
{"alpha": bool} or {"error": message}.
"""

import json
import os
import sys

from PIL import Image
from vtf2img import Parser


def has_alpha(image):
    if image.mode != 'RGBA':
        return False
    lo, _ = image.getchannel('A').getextrema()
    return lo < 250


def convert(job):
    out = job['out']
    if os.path.exists(out):
        with Image.open(out) as existing:
            return {'alpha': has_alpha(existing.convert('RGBA'))}
    image = Parser(job['vtf']).get_image().convert('RGBA')
    limit = int(job.get('max', 512))
    if max(image.size) > limit:
        image.thumbnail((limit, limit), Image.LANCZOS)
    alpha = bool(job.get('alpha')) and has_alpha(image)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    (image if alpha else image.convert('RGB')).save(out, 'WEBP', quality=82, method=6)
    return {'alpha': alpha}


def main():
    jobs = json.load(sys.stdin)
    results = {}
    for job in jobs:
        try:
            results[job['out']] = convert(job)
        except Exception as error:  # noqa: BLE001 - reported per texture
            results[job['out']] = {'error': str(error)}
    json.dump(results, sys.stdout)


if __name__ == '__main__':
    main()
