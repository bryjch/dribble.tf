import argparse
import math
import sys

import bpy
import bmesh
from mathutils import Vector

CHUNKABLE_PREFIXES = ("worldspawn", "func_detail", "func_brush", "prop_static")
BRUSH_LIKE_PREFIXES = ("worldspawn", "func_detail", "func_brush")
STATIC_PROP_PREFIXES = ("prop_static",)
# These categories remain outside static chunk roots so runtime culling does not
# accidentally hide dynamic props, helpers, lights, or non-mesh scene content.
SKIPPED_PREFIXES = ("prop_dynamic", "prop_physics")
HELPER_TYPES = {"LIGHT", "CAMERA", "EMPTY", "ARMATURE", "LATTICE", "CURVE"}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--grid", type=int, default=8)
    # Kept for CLI compatibility with convert-map.mjs; chunking now runs on the
    # whole scene instead of a single target object.
    parser.add_argument("--target", default="worldspawn")

    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    return parser.parse_args(argv)


def get_object_name(obj):
    return str(getattr(obj, "name", "") or "").lower()


def has_name_prefix(obj, prefixes):
    return get_object_name(obj).startswith(prefixes)


def is_chunkable_mesh_object(obj):
    return obj.type == "MESH" and has_name_prefix(obj, CHUNKABLE_PREFIXES)


def should_skip_chunking(obj):
    if obj.type in HELPER_TYPES:
        return True
    if obj.type != "MESH":
        return True
    return has_name_prefix(obj, SKIPPED_PREFIXES)


def classify_scene_objects():
    mesh_objects = []
    chunkable_mesh_objects = []
    non_chunkable_objects = []
    brush_like_objects = []
    static_prop_objects = []

    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            mesh_objects.append(obj)

        if should_skip_chunking(obj) or not is_chunkable_mesh_object(obj):
            non_chunkable_objects.append(obj)
            continue

        chunkable_mesh_objects.append(obj)
        if has_name_prefix(obj, BRUSH_LIKE_PREFIXES):
            brush_like_objects.append(obj)
        elif has_name_prefix(obj, STATIC_PROP_PREFIXES):
            static_prop_objects.append(obj)

    return {
        "mesh_objects": mesh_objects,
        "chunkable_mesh_objects": chunkable_mesh_objects,
        "non_chunkable_objects": non_chunkable_objects,
        "brush_like_objects": brush_like_objects,
        "static_prop_objects": static_prop_objects,
    }


def get_world_bounds(objects):
    min_v = Vector((math.inf, math.inf, math.inf))
    max_v = Vector((-math.inf, -math.inf, -math.inf))

    for obj in objects:
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            min_v.x = min(min_v.x, world_corner.x)
            min_v.y = min(min_v.y, world_corner.y)
            min_v.z = min(min_v.z, world_corner.z)
            max_v.x = max(max_v.x, world_corner.x)
            max_v.y = max(max_v.y, world_corner.y)
            max_v.z = max(max_v.z, world_corner.z)

    return min_v, max_v


def world_point_to_chunk_coords(point, grid, bounds_min, bounds_max):
    size_x = bounds_max.x - bounds_min.x
    size_y = bounds_max.y - bounds_min.y
    step_x = size_x / grid if grid > 0 else size_x
    step_y = size_y / grid if grid > 0 else size_y

    ix = 0 if step_x == 0 else int((point.x - bounds_min.x) / step_x)
    iy = 0 if step_y == 0 else int((point.y - bounds_min.y) / step_y)

    ix = min(max(ix, 0), grid - 1)
    iy = min(max(iy, 0), grid - 1)

    return ix, iy


def get_or_create_chunk_root(chunk_roots, ix, iy):
    chunk_key = (ix, iy)
    chunk_root = chunk_roots.get(chunk_key)
    if chunk_root:
        return chunk_root

    chunk_root = bpy.data.objects.new(f"chunk_{ix}_{iy}", None)
    bpy.context.scene.collection.objects.link(chunk_root)
    chunk_roots[chunk_key] = chunk_root
    return chunk_root


def build_chunk_faces(obj, grid, bounds_min, bounds_max):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    # Collect ALL UV layers (TEXCOORD_0, TEXCOORD_1, ...) so lightmap UVs survive chunking.
    uv_layers = list(bm.loops.layers.uv.values())

    chunks = {}
    for face in bm.faces:
        center = obj.matrix_world @ face.calc_center_median()
        ix, iy = world_point_to_chunk_coords(center, grid, bounds_min, bounds_max)

        chunks.setdefault((ix, iy), []).append(face)

    return bm, uv_layers, chunks


def parent_object_preserving_world_transform(obj, parent):
    world_matrix = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world_matrix


def copy_faces_to_object(obj, faces, chunk_root, uv_layers, material_slots):
    object_name = "static_chunk_part"
    new_mesh = bpy.data.meshes.new(object_name)
    new_bm = bmesh.new()

    # Create matching UV layers in the new bmesh (preserves TEXCOORD_0, TEXCOORD_1, etc.)
    new_uv_layers = []
    for src_layer in uv_layers:
        new_uv_layers.append(new_bm.loops.layers.uv.new(src_layer.name))

    vert_map = {}

    for face in faces:
        new_verts = []
        for vert in face.verts:
            key = vert.index
            if key not in vert_map:
                vert_map[key] = new_bm.verts.new(vert.co.copy())
            new_verts.append(vert_map[key])

        try:
            new_face = new_bm.faces.new(new_verts)
        except ValueError:
            continue

        new_face.material_index = face.material_index

        for src_layer, dst_layer in zip(uv_layers, new_uv_layers):
            for loop, new_loop in zip(face.loops, new_face.loops):
                new_loop[dst_layer].uv = loop[src_layer].uv.copy()

    new_bm.to_mesh(new_mesh)
    new_bm.free()

    new_obj = bpy.data.objects.new(object_name, new_mesh)
    for material in material_slots:
        new_mesh.materials.append(material)

    new_obj.matrix_world = obj.matrix_world.copy()
    bpy.context.scene.collection.objects.link(new_obj)
    parent_object_preserving_world_transform(new_obj, chunk_root)

    return new_obj


def chunk_brush_object(obj, grid, bounds_min, bounds_max, chunk_roots):
    bm, uv_layers, chunks = build_chunk_faces(obj, grid, bounds_min, bounds_max)
    material_slots = list(obj.data.materials)

    for (ix, iy), faces in chunks.items():
        if not faces:
            continue
        chunk_root = get_or_create_chunk_root(chunk_roots, ix, iy)
        copy_faces_to_object(obj, faces, chunk_root, uv_layers, material_slots)

    bm.free()

    bpy.data.objects.remove(obj, do_unlink=True)


def chunk_scene_objects(classified_objects, grid, bounds_min, bounds_max):
    chunk_roots = {}

    for obj in list(classified_objects["brush_like_objects"]):
        chunk_brush_object(obj, grid, bounds_min, bounds_max, chunk_roots)

    return chunk_roots


def main():
    args = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.input)

    classified_objects = classify_scene_objects()

    mesh_objects = classified_objects["mesh_objects"]
    if not mesh_objects:
        raise RuntimeError("No mesh objects found in GLB.")

    chunkable_mesh_objects = classified_objects["chunkable_mesh_objects"]
    if not chunkable_mesh_objects:
        raise RuntimeError(
            "No chunkable mesh objects found. Expected prefixes: "
            + ", ".join(CHUNKABLE_PREFIXES)
        )

    bounds_min, bounds_max = get_world_bounds(chunkable_mesh_objects)
    chunk_scene_objects(classified_objects, args.grid, bounds_min, bounds_max)

    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_apply=True,
        export_lights=True,
    )


if __name__ == "__main__":
    main()
