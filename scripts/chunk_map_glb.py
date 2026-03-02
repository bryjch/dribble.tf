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


def is_brush_like_object(obj):
    return obj.type == "MESH" and has_name_prefix(obj, BRUSH_LIKE_PREFIXES)


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
        if is_brush_like_object(obj):
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


def get_brush_category_name(obj):
    name = get_object_name(obj)
    for prefix in BRUSH_LIKE_PREFIXES:
        if name.startswith(prefix):
            return prefix
    return "brush"


def get_or_create_brush_chunk_builder(brush_chunk_builders, chunk_roots, ix, iy, category):
    builder_key = (ix, iy, category)
    builder = brush_chunk_builders.get(builder_key)
    if builder:
        return builder

    builder = {
        "chunk_root": get_or_create_chunk_root(chunk_roots, ix, iy),
        "category": category,
        "bm": bmesh.new(),
        "uv_layers": {},
        "materials": [],
        "material_indices": {},
        "verts": {},
    }
    brush_chunk_builders[builder_key] = builder
    return builder


def get_or_create_builder_uv_layer(builder, layer_name):
    uv_layer = builder["uv_layers"].get(layer_name)
    if uv_layer:
        return uv_layer

    uv_layer = builder["bm"].loops.layers.uv.new(layer_name)
    builder["uv_layers"][layer_name] = uv_layer
    return uv_layer


def get_or_create_builder_material_index(builder, material):
    material_key = material.name_full if material else "__none__"
    material_index = builder["material_indices"].get(material_key)
    if material_index is not None:
        return material_index

    material_index = len(builder["materials"])
    builder["materials"].append(material)
    builder["material_indices"][material_key] = material_index
    return material_index


def copy_brush_face_to_builder(obj, face, uv_layers, builder):
    new_verts = []
    for vert in face.verts:
        # Bake each source vertex into world space so chunk meshes can merge
        # faces from many source objects without depending on source transforms.
        world_position = obj.matrix_world @ vert.co
        vert_key = tuple(round(component, 6) for component in world_position)
        if vert_key not in builder["verts"]:
            builder["verts"][vert_key] = builder["bm"].verts.new(world_position)
        new_verts.append(builder["verts"][vert_key])

    try:
        new_face = builder["bm"].faces.new(new_verts)
    except ValueError:
        return

    material = obj.data.materials[face.material_index] if face.material_index < len(obj.data.materials) else None
    new_face.material_index = get_or_create_builder_material_index(builder, material)

    for src_layer in uv_layers:
        dst_layer = get_or_create_builder_uv_layer(builder, src_layer.name)
        for loop, new_loop in zip(face.loops, new_face.loops):
            new_loop[dst_layer].uv = loop[src_layer].uv.copy()


def build_brush_chunk_object(builder):
    if not builder["bm"].faces:
        builder["bm"].free()
        return None

    object_name = "static_chunk_part"
    new_mesh = bpy.data.meshes.new(object_name)
    builder["bm"].to_mesh(new_mesh)
    builder["bm"].free()

    for material in builder["materials"]:
        new_mesh.materials.append(material)

    new_obj = bpy.data.objects.new(object_name, new_mesh)
    bpy.context.scene.collection.objects.link(new_obj)
    parent_object_preserving_world_transform(new_obj, builder["chunk_root"])
    return new_obj


def chunk_brush_objects(brush_like_objects, grid, bounds_min, bounds_max):
    chunk_roots = {}
    brush_chunk_builders = {}

    for obj in list(brush_like_objects):
        bm, uv_layers, chunks = build_chunk_faces(obj, grid, bounds_min, bounds_max)
        category = get_brush_category_name(obj)

        for (ix, iy), faces in chunks.items():
            if not faces:
                continue

            builder = get_or_create_brush_chunk_builder(
                brush_chunk_builders, chunk_roots, ix, iy, category
            )
            for face in faces:
                copy_brush_face_to_builder(obj, face, uv_layers, builder)

        bm.free()
        bpy.data.objects.remove(obj, do_unlink=True)

    for builder in brush_chunk_builders.values():
        build_brush_chunk_object(builder)

    if not chunk_roots:
        raise RuntimeError("Brush chunking created zero chunk roots.")

    return chunk_roots


def chunk_scene_objects(classified_objects, grid, bounds_min, bounds_max):
    return chunk_brush_objects(classified_objects["brush_like_objects"], grid, bounds_min, bounds_max)


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
