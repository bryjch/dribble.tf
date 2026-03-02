#!/usr/bin/env python3
"""Convert VTF (Valve Texture Format) files to standard image formats.

Replaces VTFCmd (Windows-only) using the cross-platform vtf2img library.

Usage:
    python convert-vtf.py --file <vtf_path> --output <output_dir> --format tga
"""

import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser(description='Convert VTF files to standard image formats')
    parser.add_argument('--file', required=True, help='Path to the VTF file')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--format', default='tga', choices=['tga', 'png', 'webp', 'jpg'],
                        help='Output image format (default: tga)')
    args = parser.parse_args()

    vtf_path = os.path.abspath(args.file)
    output_dir = os.path.abspath(args.output)

    if not os.path.isfile(vtf_path):
        print(f'Error: VTF file not found: {vtf_path}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    try:
        from vtf2img import Parser
    except ImportError:
        print('Error: vtf2img not installed. Run: pip install vtf2img', file=sys.stderr)
        sys.exit(1)

    try:
        from PIL import Image
    except ImportError:
        print('Error: Pillow not installed. Run: pip install Pillow', file=sys.stderr)
        sys.exit(1)

    basename = os.path.splitext(os.path.basename(vtf_path))[0]
    output_path = os.path.join(output_dir, f'{basename}.{args.format}')

    with open(vtf_path, 'rb') as f:
        vtf = Parser(f.read())

    image = vtf.to_image()

    if args.format == 'tga':
        # TGA doesn't support RGBA well in all pipelines; convert to RGB if no alpha needed
        if image.mode == 'RGBA':
            # Check if alpha channel is fully opaque
            alpha = image.split()[-1]
            if alpha.getextrema() == (255, 255):
                image = image.convert('RGB')
        image.save(output_path)
    elif args.format == 'webp':
        image.save(output_path, 'WEBP', quality=92)
    elif args.format == 'jpg':
        if image.mode in ('RGBA', 'LA', 'PA'):
            image = image.convert('RGB')
        image.save(output_path, 'JPEG', quality=92)
    else:
        image.save(output_path)

    print(f'Converted: {output_path}')


if __name__ == '__main__':
    main()
