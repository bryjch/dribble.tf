#!/usr/bin/env python3
"""Converts VTF textures to WebP for the viewmodel build (build-viewmodels.mjs).

Reads a JSON list of {"vtf": path, "out": path, "max": pixels, "alpha": bool} on stdin, converts
each one whose output is missing, scaled down so neither side exceeds `max` and keeping the alpha
channel only when `alpha` asks for it, and prints a JSON object mapping each output path to
{"alpha": bool} or {"error": message}.

Jobs with "sky": true are faces of one skybox (with "face": lf, rt, ft, bk, up or dn), written
square and all the same size. TF2's side faces are often half height: the game draws them over
the top half of the cube face and repeats their bottom row below the horizon, so they're padded
that way here. Each face is then turned for the viewer's cube map, whose world is Source's
(z up) while cube maps assume y up; the Blender-built skies were turned the same way.
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


# How each Source sky face is turned for three's cube map (see the docstring). The up face's turn
# was found by matching its edges to the side faces' top rows (sky_morningsnow_01); dn is left
# as it is, as TF2's are a single colour.
SKY_TURNS = {
    'lf': Image.Transpose.ROTATE_90,
    'rt': Image.Transpose.ROTATE_270,
    'bk': Image.Transpose.ROTATE_180,
    'up': Image.Transpose.ROTATE_270,
}


def sky_faces(jobs, results):
    faces = {}
    for job in jobs:
        try:
            image = Parser(job['vtf']).get_image().convert('RGB')
            limit = int(job.get('max', 1024))
            if max(image.size) > limit:
                image.thumbnail((limit, limit), Image.LANCZOS)
            width, height = image.size
            if height < width:
                square = Image.new('RGB', (width, width))
                square.paste(image, (0, 0))
                below = image.crop((0, height - 1, width, height)).resize((width, width - height))
                square.paste(below, (0, height))
                image = square
            turn = SKY_TURNS.get(job.get('face'))
            faces[job['out']] = image.transpose(turn) if turn is not None else image
        except Exception as error:  # noqa: BLE001 - reported per face
            results[job['out']] = {'error': str(error)}
    side = max((image.width for image in faces.values()), default=0)
    for out, image in faces.items():
        if image.size != (side, side):
            image = image.resize((side, side), Image.LANCZOS)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        image.save(out, 'WEBP', quality=85, method=6)
        results[out] = {'alpha': False}


def main():
    jobs = json.load(sys.stdin)
    results = {}
    sky_faces([job for job in jobs if job.get('sky')], results)
    for job in jobs:
        if job.get('sky'):
            continue
        try:
            results[job['out']] = convert(job)
        except Exception as error:  # noqa: BLE001 - reported per texture
            results[job['out']] = {'error': str(error)}
    json.dump(results, sys.stdout)


if __name__ == '__main__':
    main()
