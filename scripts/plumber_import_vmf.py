import argparse
import io
import os
import re
import shutil
import sys
import struct
import lzma
import zipfile
import bpy


def restore_plumber_binary_if_needed():
    """Restore plumber.pyd if Blender left it as plumber.pyd.unloaded."""

    if os.name != "nt":
        return

    extensions_root = bpy.utils.user_resource("EXTENSIONS")
    if not extensions_root:
        return

    candidate_roots = [
        os.path.join(extensions_root, "user_default", "plumber"),
        os.path.join(extensions_root, "system", "plumber"),
    ]

    for plumber_root in candidate_roots:
        if not os.path.isdir(plumber_root):
            continue

        extension_path = os.path.join(plumber_root, "plumber.pyd")
        if os.path.isfile(extension_path):
            return

        unloaded_path = os.path.join(os.path.dirname(plumber_root), "plumber.pyd.unloaded")
        if not os.path.isfile(unloaded_path):
            continue

        os.makedirs(plumber_root, exist_ok=True)
        try:
            os.replace(unloaded_path, extension_path)
        except OSError:
            shutil.copy2(unloaded_path, extension_path)

        if os.path.isfile(extension_path):
            print(f"[Plumber] Restored extension module: {extension_path}")
            return


def load_plumber_api():
    restore_plumber_binary_if_needed()

    try:
        from bl_ext.user_default.plumber.api import GameFileSystem, import_vmf

        return GameFileSystem, import_vmf
    except ModuleNotFoundError as error:
        if "bl_ext.user_default.plumber.plumber" in str(error):
            extensions_root = bpy.utils.user_resource("EXTENSIONS")
            raise RuntimeError(
                "Plumber extension binary is missing. Expected plumber.pyd for the active "
                "Blender user extension install. Reinstall the Plumber extension for this "
                "Blender version or restore plumber.pyd from plumber.pyd.unloaded. "
                f"Extensions root: {extensions_root}"
            ) from error
        raise


GameFileSystem, import_vmf = load_plumber_api()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vmf", required=True)
    parser.add_argument("--bsp", required=False, default=None)
    parser.add_argument("--game-dir", required=True)
    parser.add_argument("--asset-search-path", required=False, default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--hl2-dir", required=False, default=None)
    parser.add_argument("--extra-search-path", required=False, action="append", default=[])
    parser.add_argument("--allow-missing-materials", action="store_true")
    parser.add_argument("--missing-materials-out", required=False, default=None)

    # Optional VMF import features.
    #
    # Props are disabled by default because they can balloon output size and require
    # many model/material dependencies.
    parser.add_argument("--import-props", action="store_true")
    parser.add_argument("--import-lights", action="store_true")
    parser.add_argument("--import-entities", action="store_true")
    parser.add_argument("--import-overlays", action="store_true")
    # Include tool/invisible solids (clip, nodraw, etc). By default we skip them to
    # better match in-game rendering.
    parser.add_argument("--import-invisible-solids", action="store_true")
    parser.add_argument("--lightmap-dir", required=False, default=None,
                        help="(Reserved for future lightmap support)")

    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    return parser.parse_args(argv)


def split_search_paths(values):
    if not values:
        return []

    if isinstance(values, str):
        values = [values]

    results = []
    for value in values:
        if not value:
            continue
        for part in re.split(r"[;,]", value):
            part = part.strip()
            if part:
                results.append(part)
    return results


def collect_vpk_paths(root_dir):
    if not root_dir or not os.path.isdir(root_dir):
        return []

    entries = [
        os.path.join(root_dir, name)
        for name in os.listdir(root_dir)
        if name.lower().endswith(".vpk")
    ]
    if not entries:
        return []

    dir_vpks = [path for path in entries if path.lower().endswith("_dir.vpk")]
    return sorted(dir_vpks) if dir_vpks else sorted(entries)


def build_search_paths(game_dir, hl2_dir, extra_paths):
    paths = []
    seen = set()

    def add(kind, path_value):
        if not path_value:
            return
        normalized = os.path.normpath(path_value)
        key = f"{kind}:{normalized.lower()}"
        if key in seen:
            return
        if kind == "DIR" and not os.path.isdir(normalized):
            return
        if kind == "VPK" and not os.path.isfile(normalized):
            return
        seen.add(key)
        paths.append((kind, normalized))

    add("DIR", game_dir)
    add("DIR", os.path.join(game_dir, "custom"))
    add("DIR", os.path.join(game_dir, "download"))

    # Include per-addon directories/VPKs under tf/custom.
    custom_dir = os.path.join(game_dir, "custom")
    if os.path.isdir(custom_dir):
        for name in sorted(os.listdir(custom_dir), key=lambda value: value.lower()):
            candidate = os.path.join(custom_dir, name)
            if os.path.isdir(candidate):
                add("DIR", candidate)
                continue
            if name.lower().endswith(".vpk"):
                add("VPK", candidate)

    for vpk_path in collect_vpk_paths(game_dir):
        add("VPK", vpk_path)

    if hl2_dir:
        add("DIR", hl2_dir)
        add("DIR", os.path.join(hl2_dir, "custom"))
        add("DIR", os.path.join(hl2_dir, "download"))

        hl2_custom_dir = os.path.join(hl2_dir, "custom")
        if os.path.isdir(hl2_custom_dir):
            for name in sorted(os.listdir(hl2_custom_dir), key=lambda value: value.lower()):
                candidate = os.path.join(hl2_custom_dir, name)
                if os.path.isdir(candidate):
                    add("DIR", candidate)
                    continue
                if name.lower().endswith(".vpk"):
                    add("VPK", candidate)

        for vpk_path in collect_vpk_paths(hl2_dir):
            add("VPK", vpk_path)

    for extra in extra_paths:
        if extra.lower().endswith(".vpk"):
            add("VPK", extra)
        else:
            add("DIR", extra)

            # Some embedded BSP assets end up under "materials/materials".
            # Adding "<assetRoot>/materials" as a search root makes
            # "materials/<x>" resolve to "<assetRoot>/materials/materials/<x>".
            materials_dir = os.path.join(extra, "materials")
            if os.path.isdir(materials_dir):
                add("DIR", materials_dir)

    return paths


LUMP_TEXDATA_STRING_DATA = 43
LUMP_TEXDATA_STRING_TABLE = 44
LUMP_PAKFILE = 40
LUMP_COUNT = 64


def _normalize_slashes(value):
    return value.replace("\\", "/")


def normalize_material_reference(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None

    # Ignore obvious non-path material values (eg entity keyvalues like "material" "0").
    if cleaned.isdigit():
        return None

    cleaned = _normalize_slashes(cleaned)
    cleaned = re.sub(r"/+", "/", cleaned)
    # Trim whitespace in each path segment to handle BSPs that contain
    # texdata strings like "maps/jump_negative_t11 /...".
    cleaned = "/".join(part.strip() for part in cleaned.split("/"))
    cleaned = cleaned.strip("/")
    if not cleaned:
        return None

    if cleaned.lower().startswith("materials/"):
        cleaned = cleaned[len("materials/") :]

    if not cleaned.lower().endswith(".vmt"):
        cleaned = f"{cleaned}.vmt"

    return f"materials/{cleaned.lower()}"


def is_ignored_material(material_path):
    if not material_path:
        return False
    normalized = normalize_material_reference(material_path)
    if not normalized:
        return True
    rel = normalized[len("materials/") :]
    base = os.path.basename(rel)

    # Tool textures are not intended for visible rendering.
    if rel.startswith("tools/"):
        return True

    # Some custom packs put tool textures elsewhere (eg hamtools/toolsnodraw).
    if base.startswith("tools"):
        for keyword in (
            "nodraw",
            "clip",
            "playerclip",
            "npcclip",
            "hint",
            "skip",
            "trigger",
            "origin",
            "areaportal",
            "occluder",
            "regen",
            "hurt",
        ):
            if keyword in base:
                return True

    # Heuristic catch-all for common invisible utility materials.
    for keyword in (
        "nodraw",
        "playerclip",
        "npcclip",
        "clip",
        "hint",
        "skip",
        "areaportal",
        "occluder",
    ):
        if keyword in base:
            return True

    return False


def read_vmf_materials(vmf_path):
    text = ""
    with open(vmf_path, "r", encoding="utf-8", errors="ignore") as handle:
        text = handle.read()

    matches = re.findall(r'"material"\s+"([^"]+)"', text, flags=re.IGNORECASE)
    materials = set()
    for match in matches:
        value = match.strip().replace("\\", "/")
        value = re.sub(r"/+", "/", value).strip("/")
        if not value:
            continue
        if value.lower().startswith("materials/"):
            value = value[len("materials/") :]
        value = value.strip("/")
        if not value.lower().endswith(".vmt"):
            value = f"{value}.vmt"
        materials.add(f"materials/{value}")
    return sorted(materials)


def read_vmf_brush_side_materials(vmf_path):
    """Collect materials from VMF brush faces (side blocks only).

    This avoids false positives from entity keyvalues like "material" "0".
    """

    materials = set()
    stack = []
    pending = None

    def push_block(name):
        stack.append(name)

    def pop_block():
        if stack:
            stack.pop()

    with open(vmf_path, "r", encoding="utf-8", errors="ignore") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue

            if line == "{":
                if pending is not None:
                    push_block(pending)
                    pending = None
                else:
                    push_block("{")
                continue

            if line == "}":
                pop_block()
                pending = None
                continue

            # VMF uses bare identifiers for block types (eg "entity", "solid", "side").
            if not line.startswith('"') and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", line):
                pending = line.lower()
                continue

            # Key-values.
            if not line.startswith('"'):
                continue

            match = re.match(r'^"(?P<key>[^"]+)"\s+"(?P<value>.*)"\s*$', line)
            if not match:
                continue
            key = match.group("key").strip().lower()
            if key != "material":
                continue
            if "side" not in stack:
                continue

            normalized = normalize_material_reference(match.group("value"))
            if normalized:
                materials.add(normalized)

    return sorted(materials)


def read_bsp_materials(bsp_path):
    if not bsp_path or not os.path.isfile(bsp_path):
        return None

    with open(bsp_path, "rb") as handle:
        header = handle.read(8)
        if len(header) < 8:
            raise RuntimeError("BSP header is incomplete.")

        lumps = []
        for _ in range(LUMP_COUNT):
            entry = handle.read(16)
            if len(entry) != 16:
                raise RuntimeError("BSP lump table is incomplete.")
            fileofs, filelen, _version, _fourcc = struct.unpack("<4i", entry)
            lumps.append((fileofs, filelen))

        def decompress_lzma_lump(data, lump_index):
            if len(data) < 17:
                raise RuntimeError(f"LZMA lump {lump_index} header is incomplete.")
            if data[:4] != b"LZMA":
                return data

            uncompressed_size = struct.unpack_from("<I", data, 4)[0]
            compressed_size = struct.unpack_from("<I", data, 8)[0]
            props = data[12:17]
            compressed_data = data[17 : 17 + compressed_size]

            if len(compressed_data) != compressed_size:
                raise RuntimeError(
                    f"LZMA lump {lump_index} truncated: expected {compressed_size} bytes, got {len(compressed_data)}"
                )

            header = props + struct.pack("<Q", uncompressed_size)
            try:
                return lzma.decompress(header + compressed_data, format=lzma.FORMAT_ALONE)
            except lzma.LZMAError as error:
                raise RuntimeError(f"Failed to decompress LZMA lump {lump_index}: {error}")

        def read_lump(index):
            if index >= len(lumps):
                return b""
            offset, length = lumps[index]
            if length <= 0:
                return b""
            handle.seek(offset)
            data = handle.read(length)
            if data.startswith(b"LZMA"):
                return decompress_lzma_lump(data, index)
            return data

        string_data = read_lump(LUMP_TEXDATA_STRING_DATA)
        string_table = read_lump(LUMP_TEXDATA_STRING_TABLE)

    if not string_data or not string_table:
        raise RuntimeError("BSP is missing texdata string lumps.")

    count = len(string_table) // 4
    if count == 0:
        raise RuntimeError("BSP texdata string table is empty.")

    materials = set()
    for index in range(count):
        offset = struct.unpack_from("<i", string_table, index * 4)[0]
        if offset < 0 or offset >= len(string_data):
            continue
        end = string_data.find(b"\x00", offset)
        if end == -1:
            end = len(string_data)
        raw = string_data[offset:end]
        name = raw.decode("utf-8", errors="ignore").strip()
        if not name:
            continue
        value = name.replace("\\", "/").strip("/")
        if not value:
            continue
        if value.lower().startswith("materials/"):
            value = value[len("materials/") :]
        if not value.lower().endswith(".vmt"):
            value = f"{value}.vmt"
        materials.add(f"materials/{value}")

    if not materials:
        raise RuntimeError("BSP texdata string table produced no materials.")

    return sorted(materials)


def material_exists_in_dirs(material_path, dir_paths):
    normalized = material_path.replace("\\", "/")
    normalized = normalized.lstrip("/")
    for directory in dir_paths:
        if not directory:
            continue
        candidate = os.path.join(directory, normalized)
        if os.path.isfile(candidate):
            return True
    return False


def find_material_in_dirs(material_path, dir_paths):
    normalized = material_path.replace("\\", "/")
    normalized = normalized.lstrip("/")
    for directory in dir_paths:
        if not directory:
            continue
        candidate = os.path.join(directory, normalized)
        if os.path.isfile(candidate):
            return candidate
    return None


def get_map_name_from_bsp(bsp_path):
    if not bsp_path:
        return None
    base = os.path.basename(bsp_path)
    name, _ = os.path.splitext(base)
    return name


def get_map_name_from_vmf(vmf_path):
    base = os.path.basename(vmf_path)
    name, _ = os.path.splitext(base)
    return name


def check_missing_materials(fs, vmf_path, dir_paths, bsp_path=None):
    # We import VMF geometry, so only brush side materials referenced in the VMF
    # should be considered required.
    missing = []
    for material_path in read_vmf_brush_side_materials(vmf_path):
        if is_ignored_material(material_path):
            continue
        if material_exists_in_dirs(material_path, dir_paths):
            continue
        if fs.file_exists(material_path):
            continue
        missing.append(material_path)
    return missing


class BspPakFile:
    def __init__(self, bsp_path):
        self.bsp_path = bsp_path
        self._zip = None
        self._buffer = None
        self._path_map = {}
        self._basename_map = {}

    def _read_lump_table(self, handle):
        header = handle.read(8)
        if len(header) < 8:
            raise RuntimeError("BSP header is incomplete.")
        lumps = []
        for _ in range(LUMP_COUNT):
            entry = handle.read(16)
            if len(entry) != 16:
                raise RuntimeError("BSP lump table is incomplete.")
            fileofs, filelen, _version, _fourcc = struct.unpack("<4i", entry)
            lumps.append((fileofs, filelen))
        return lumps

    def _load(self):
        if self._zip is not None:
            return
        if not self.bsp_path or not os.path.isfile(self.bsp_path):
            self._zip = None
            self._buffer = None
            self._path_map = {}
            self._basename_map = {}
            return

        with open(self.bsp_path, "rb") as handle:
            lumps = self._read_lump_table(handle)
            offset, length = lumps[LUMP_PAKFILE]
            if length <= 0:
                self._zip = None
                self._buffer = None
                self._path_map = {}
                self._basename_map = {}
                return
            handle.seek(offset)
            data = handle.read(length)

        # Pakfile lumps are usually raw zip data.
        self._buffer = io.BytesIO(data)
        self._zip = zipfile.ZipFile(self._buffer)
        self._path_map = {}
        self._basename_map = {}

        for name in self._zip.namelist():
            normalized = self._normalize_zip_path(name)
            if not normalized:
                continue
            self._path_map.setdefault(normalized, []).append(name)
            self._basename_map.setdefault(os.path.basename(normalized), []).append(normalized)

    def _normalize_zip_path(self, zip_name):
        if not zip_name:
            return None
        value = _normalize_slashes(str(zip_name)).strip().lstrip("/")
        value = re.sub(r"/+", "/", value)
        value = "/".join(part.strip() for part in value.split("/"))
        if not value:
            return None

        lower = value.lower()
        index = lower.find("materials/")
        if index != -1:
            value = value[index:]
        value = value.strip().lstrip("/")
        if not value:
            return None

        parts = []
        for part in value.split("/"):
            if not part or part == ".":
                continue
            if part == "..":
                return None
            parts.append(part)
        if not parts:
            return None
        return "/".join(parts).lower()

    def find_exact(self, normalized_material_path):
        self._load()
        key = normalize_material_reference(normalized_material_path)
        if not key:
            return []
        return self._path_map.get(key, [])

    def find_by_basename(self, basename):
        self._load()
        if not basename:
            return []
        key = str(basename).lower()
        return list(self._basename_map.get(key, []))

    def find_wvt_patch_candidates(self, rel_without_ext):
        self._load()
        if not rel_without_ext:
            return []
        target = f"{rel_without_ext}_wvt_patch.vmt".lower()
        matches = []
        for normalized in (self._path_map or {}).keys():
            if not normalized.startswith("materials/maps/"):
                continue
            if normalized.endswith(target):
                matches.append(normalized)
        return matches

    def extract_to(self, zip_name, dest_root, dest_relative):
        self._load()
        if not self._zip:
            return None
        if not zip_name or not dest_root or not dest_relative:
            return None

        dest_relative = _normalize_slashes(str(dest_relative)).lstrip("/")
        dest_path = os.path.join(dest_root, *dest_relative.split("/"))
        if os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0:
            return dest_path

        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with self._zip.open(zip_name, "r") as src:
            with open(dest_path, "wb") as dst:
                dst.write(src.read())
        return dest_path

    def read_bytes_for_normalized(self, normalized_path):
        self._load()
        if not self._zip:
            return None
        hits = self._path_map.get(str(normalized_path).lower(), [])
        if not hits:
            return None
        with self._zip.open(hits[0], "r") as src:
            return src.read()


def ensure_material_aliases(fs, vmf_path, map_name, asset_dirs, dir_paths):
    # Backwards-compatible stub; aliasing is now handled during missing-material resolution.
    return


def _copy_file(src_path, dest_path):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(src_path, "rb") as src_handle:
        with open(dest_path, "wb") as dst_handle:
            dst_handle.write(src_handle.read())


def _find_files_by_basename(search_roots, basename, limit=3):
    if not basename:
        return []
    basename_lower = str(basename).lower()
    hits = []
    for root in search_roots:
        if not root or not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                if name.lower() != basename_lower:
                    continue
                hits.append(os.path.join(dirpath, name))
                if len(hits) >= limit:
                    return hits
    return hits


def ensure_material_resolved(material_path, fs, dir_paths, pak, alias_root, asset_dirs):
    normalized = normalize_material_reference(material_path)
    if not normalized:
        return True

    # Already available.
    if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
        return True

    if not alias_root or not os.path.isdir(alias_root):
        return False

    rel = normalized[len("materials/") :]
    alias_path = os.path.join(alias_root, "materials", *rel.split("/"))

    # 1) Extract exact match from BSP pakfile (also fixes path traversal entries).
    if pak:
        hits = pak.find_exact(normalized)
        if hits:
            pak.extract_to(hits[0], alias_root, normalized)
            if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
                return True

        alt = f"materials/materials/{rel}"
        hits = pak.find_exact(alt)
        if hits:
            # Extract to expected path.
            pak.extract_to(hits[0], alias_root, normalized)
            if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
                return True

    # 2) WVT patch fallback: copy a unique *_wvt_patch.vmt into the expected path.
    rel_no_ext, _ext = os.path.splitext(rel)
    patch_basename = f"{os.path.basename(rel_no_ext)}_wvt_patch.vmt"

    patch_files = _find_files_by_basename(asset_dirs, patch_basename, limit=3)
    if len(patch_files) == 1:
        os.makedirs(os.path.dirname(alias_path), exist_ok=True)
        _copy_file(patch_files[0], alias_path)
        if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
            return True
    elif len(patch_files) == 0 and pak:
        normalized_patches = pak.find_wvt_patch_candidates(rel_no_ext)
        if len(normalized_patches) == 1:
            data = pak.read_bytes_for_normalized(normalized_patches[0])
            if data is not None:
                os.makedirs(os.path.dirname(alias_path), exist_ok=True)
                with open(alias_path, "wb") as handle:
                    handle.write(data)
                if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
                    return True

    # 3) Unique basename fallback within embedded assets.
    base = os.path.basename(rel)
    disk_hits = _find_files_by_basename(asset_dirs, base, limit=3)
    if len(disk_hits) == 1:
        os.makedirs(os.path.dirname(alias_path), exist_ok=True)
        _copy_file(disk_hits[0], alias_path)
        if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
            return True
    elif len(disk_hits) == 0 and pak:
        pak_hits = pak.find_by_basename(base)
        if len(pak_hits) == 1:
            data = pak.read_bytes_for_normalized(pak_hits[0])
            if data is not None:
                os.makedirs(os.path.dirname(alias_path), exist_ok=True)
                with open(alias_path, "wb") as handle:
                    handle.write(data)
                if material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized):
                    return True

    return material_exists_in_dirs(normalized, dir_paths) or fs.file_exists(normalized)


def main():
    args = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)

    extra_paths = split_search_paths(args.extra_search_path)
    asset_paths = split_search_paths(args.asset_search_path)

    # Add derived material roots for embedded assets.
    derived_asset_paths = []
    for path_value in asset_paths:
        if not path_value or not os.path.isdir(path_value):
            continue
        materials_dir = os.path.join(path_value, "materials")
        if os.path.isdir(materials_dir):
            derived_asset_paths.append(materials_dir)

    search_paths = build_search_paths(
        args.game_dir, args.hl2_dir, extra_paths + asset_paths + derived_asset_paths
    )
    fs = GameFileSystem.from_search_paths("TF2", search_paths)
    dir_paths = [path for kind, path in search_paths if kind == "DIR"]

    map_name = get_map_name_from_bsp(args.bsp) or get_map_name_from_vmf(args.vmf)

    alias_root = None
    for path_value in asset_paths:
        if path_value and os.path.isdir(path_value):
            alias_root = path_value
            break
    if not alias_root:
        for path_value in derived_asset_paths:
            if path_value and os.path.isdir(path_value):
                alias_root = path_value
                break

    pak = BspPakFile(args.bsp) if args.bsp and os.path.isfile(args.bsp) else None

    # Attempt to resolve missing materials from BSP pakfile / embedded assets before failing.
    required_materials = []
    ignored_materials = []
    for material_path in read_vmf_brush_side_materials(args.vmf):
        if is_ignored_material(material_path):
            ignored_materials.append(material_path)
            continue
        required_materials.append(material_path)

    for material_path in required_materials:
        ensure_material_resolved(
            material_path,
            fs,
            dir_paths,
            pak,
            alias_root,
            asset_paths,
        )

    missing_materials = []
    for material_path in required_materials:
        normalized = normalize_material_reference(material_path)
        if not normalized:
            continue
        if material_exists_in_dirs(normalized, dir_paths):
            continue
        if fs.file_exists(normalized):
            continue
        missing_materials.append(normalized)

    if missing_materials:
        if args.missing_materials_out:
            os.makedirs(os.path.dirname(args.missing_materials_out), exist_ok=True)
            with open(args.missing_materials_out, "w", encoding="utf-8") as handle:
                handle.write("\n".join(missing_materials))

        if not args.allow_missing_materials:
            raise RuntimeError(
                f"Missing materials ({len(missing_materials)}). See {args.missing_materials_out}"
            )

    import_vmf(
        fs,
        args.vmf,
        from_game=False,
        asset_search_path=args.asset_search_path,
        vmf_import_brushes=True,
        vmf_import_overlays=bool(args.import_overlays),
        vmf_import_props=bool(args.import_props),
        vmf_import_lights=bool(args.import_lights),
        vmf_import_entities=bool(args.import_entities),
        vmf_import_sky=False,
        vmf_import_sky_camera=False,
        vmf_merge_solids="SEPARATE",
        vmf_invisible_solids="IMPORT" if args.import_invisible_solids else "SKIP",
        material_import_materials=True,
        material_simple_materials=True,
    )

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_apply=True,
        export_lights=True,
    )


if __name__ == "__main__":
    main()
