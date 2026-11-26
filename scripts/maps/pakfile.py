#!/usr/bin/env python3
"""Extracts the files a map packs into its BSP (the pakfile lump, a zip) for build-maps.mjs.

Usage: pakfile.py <map.bsp> <out-dir>. Writes each packed file under <out-dir> at its path,
lowercased with forward slashes, as the game looks files up; skips any path that would land
outside <out-dir>. Prints {"files": n, "failed": [names]} as JSON.
"""

import io
import json
import os
import struct
import sys
import zipfile

PAKFILE_LUMP = 40


def main():
    bsp_path, out_dir = sys.argv[1], os.path.abspath(sys.argv[2])
    with open(bsp_path, 'rb') as handle:
        data = handle.read()
    if data[:4] != b'VBSP':
        raise SystemExit(f'{bsp_path} is not a BSP')
    offset, length = struct.unpack_from('<ii', data, 8 + PAKFILE_LUMP * 16)
    if length <= 0:
        json.dump({'files': 0, 'failed': []}, sys.stdout)
        return
    written, failed, seen = 0, [], set()
    with zipfile.ZipFile(io.BytesIO(data[offset:offset + length])) as pak:
        for info in pak.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace('\\', '/').lower().lstrip('/')
            # Some maps pack one file twice, its paths differing only in case; keep the first,
            # as bsp-to-glb does (scripts/lib/bsp-to-glb.patch).
            if name in seen:
                continue
            seen.add(name)
            target = os.path.abspath(os.path.join(out_dir, name))
            if not target.startswith(out_dir + os.sep):
                failed.append(info.filename)
                continue
            try:
                content = pak.read(info)
            except Exception:  # noqa: BLE001 - an unreadable entry is reported, not fatal
                failed.append(info.filename)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, 'wb') as handle:
                handle.write(content)
            written += 1
    json.dump({'files': written, 'failed': failed}, sys.stdout)


if __name__ == '__main__':
    main()
