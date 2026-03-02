import argparse
import math
import sys

import bpy
import bmesh
from mathutils import Vector


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--grid", type=int, default=4)
    parser.add_argument("--target", default="worldspawn")

    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    return parser.parse_args(argv)


def get_mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


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


def find_target_object(objects, target_name):
    if target_name:
        matches = [obj for obj in objects if target_name.lower() in obj.name.lower()]
        if matches:
            return sorted(matches, key=lambda obj: len(obj.data.polygons), reverse=True)[0]

    if not objects:
        return None

    return sorted(objects, key=lambda obj: len(obj.data.polygons), reverse=True)[0]


def build_chunk_faces(obj, grid, bounds_min, bounds_max):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    # Collect ALL UV layers (TEXCOORD_0, TEXCOORD_1, ...) so lightmap UVs survive chunking.
    uv_layers = list(bm.loops.layers.uv.values())

    size_x = bounds_max.x - bounds_min.x
    size_y = bounds_max.y - bounds_min.y
    step_x = size_x / grid if grid > 0 else size_x
    step_y = size_y / grid if grid > 0 else size_y

    chunks = {}
    for face in bm.faces:
        center = obj.matrix_world @ face.calc_center_median()

        ix = 0 if step_x == 0 else int((center.x - bounds_min.x) / step_x)
        iy = 0 if step_y == 0 else int((center.y - bounds_min.y) / step_y)

        ix = min(max(ix, 0), grid - 1)
        iy = min(max(iy, 0), grid - 1)

        chunks.setdefault((ix, iy), []).append(face)

    return bm, uv_layers, chunks


def copy_faces_to_object(obj, faces, name, uv_layers, material_slots):
    new_mesh = bpy.data.meshes.new(name)
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

    new_obj = bpy.data.objects.new(name, new_mesh)
    for material in material_slots:
        new_mesh.materials.append(material)

    new_obj.matrix_world = obj.matrix_world.copy()
    bpy.context.scene.collection.objects.link(new_obj)

    return new_obj


def chunk_target_object(target_obj, grid, bounds_min, bounds_max):
    bm, uv_layers, chunks = build_chunk_faces(target_obj, grid, bounds_min, bounds_max)
    material_slots = list(target_obj.data.materials)

    for (ix, iy), faces in chunks.items():
        if not faces:
            continue
        chunk_name = f"chunk_{ix}_{iy}"
        copy_faces_to_object(target_obj, faces, chunk_name, uv_layers, material_slots)

    bm.free()

    bpy.data.objects.remove(target_obj, do_unlink=True)


def main():
    args = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.input)

    mesh_objects = get_mesh_objects()
    if not mesh_objects:
        raise RuntimeError("No mesh objects found in GLB.")

    bounds_min, bounds_max = get_world_bounds(mesh_objects)

    target_obj = find_target_object(mesh_objects, args.target)
    if not target_obj:
        raise RuntimeError("Target mesh not found for chunking.")

    chunk_target_object(target_obj, args.grid, bounds_min, bounds_max)

    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_apply=True,
        export_lights=True,
    )


if __name__ == "__main__":
    main()
