#!/usr/bin/env python3
"""Extract specific files from Valve VPK archives.

Replaces vpk.exe (Windows-only) using the cross-platform vpk Python library.

Usage:
    python extract-vpk.py --vpk <vpk_dir_path> --extract <relative/path> --output <output_dir>

The --vpk argument should point to a *_dir.vpk file (the VPK directory file).
The --extract argument is the relative path inside the VPK (e.g. materials/skybox/sky_dustbowl_01bk.vtf).
"""

import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser(description='Extract files from VPK archives')
    parser.add_argument('--vpk', required=True, help='Path to the VPK _dir.vpk file')
    parser.add_argument('--extract', required=True, help='Relative path to extract from VPK')
    parser.add_argument('--output', required=True, help='Output directory (files extracted relative to this)')
    args = parser.parse_args()

    vpk_path = os.path.abspath(args.vpk)
    output_dir = os.path.abspath(args.output)
    relative_path = args.extract.replace('\\', '/')

    if not os.path.isfile(vpk_path):
        print(f'Error: VPK file not found: {vpk_path}', file=sys.stderr)
        sys.exit(1)

    try:
        import vpk
    except ImportError:
        print('Error: vpk not installed. Run: pip install vpk', file=sys.stderr)
        sys.exit(1)

    try:
        pak = vpk.open(vpk_path)
    except Exception as e:
        print(f'Error opening VPK: {e}', file=sys.stderr)
        sys.exit(1)

    # Normalize the search path (VPK paths use forward slashes, lowercase)
    search = relative_path.lower()

    # Try exact match first, then case-insensitive scan
    matched_path = None
    if relative_path in pak:
        matched_path = relative_path
    else:
        for entry_path in pak:
            if entry_path.lower() == search:
                matched_path = entry_path
                break

    if matched_path is None:
        # Not found — exit silently (caller checks for output file existence)
        sys.exit(0)

    output_path = os.path.join(output_dir, relative_path)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    data = pak[matched_path].read()
    with open(output_path, 'wb') as f:
        f.write(data)

    print(f'Extracted: {output_path}')


if __name__ == '__main__':
    main()
