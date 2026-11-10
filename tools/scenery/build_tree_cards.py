"""Builds the tree cards of the woods on the horizon (the owner, 2026-11-10: use existing assets) by
photographing Poly Haven's "Tree Small 02" (CC0, https://polyhaven.com; 4.6 million polygons, far too many to
draw) from three sides in Blender, on a transparent background, in soft daylight.

    python3 tools/scenery/build_tree_cards.py      (needs the bpy module: pip install bpy)

Writes assets/scenery/tree_card_{0,1,2}.webp (RGBA). The model goes to tools/scenery/.cache (not committed).
"""
import json
import math
import sys
import urllib.request
from pathlib import Path

import bpy  # must come first: it makes mathutils importable
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / ".cache" / "tree_small_02"
OUT = ROOT / "assets" / "scenery"
SIZE = 768


def fetch():
    gltf = CACHE / "tree_small_02_1k.gltf"
    if gltf.exists():
        return gltf
    CACHE.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen("https://api.polyhaven.com/files/tree_small_02", timeout=60) as r:
        files = json.load(r)["gltf"]["1k"]["gltf"]
    for url, rel in [(files["url"], gltf.name)] + [(v["url"], k) for k, v in files["include"].items()]:
        target = CACHE / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=600) as r:
            target.write_bytes(r.read())
    return gltf


def main():
    gltf = fetch()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(gltf))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    centre = (lo + hi) / 2
    height = hi.z - lo.z
    span = max(hi.x - lo.x, hi.y - lo.y, height)
    print(f"tree: {len(meshes)} meshes, {height:.1f} m tall, span {span:.1f} m", file=sys.stderr)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    # Daylight: a sun from above and the side, and a pale blue sky all round.
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.65, 0.8, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    # An orthographic camera looking level at the tree, the tree filling the picture, its foot at the bottom edge.
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = span * 1.02
    scene.collection.objects.link(camera)
    scene.camera = camera
    OUT.mkdir(parents=True, exist_ok=True)
    for i, turn in enumerate((0, 120, 240)):
        a = math.radians(turn)
        distance = span * 3
        look_at = Vector((centre.x, centre.y, lo.z + span * 1.02 / 2))
        camera.location = look_at + Vector((math.sin(a) * distance, -math.cos(a) * distance, 0))
        camera.rotation_euler = (math.radians(90), 0, a)
        png = CACHE / f"tree_card_{i}.png"
        scene.render.filepath = str(png)
        bpy.ops.render.render(write_still=True)
        from PIL import Image
        Image.open(png).save(OUT / f"tree_card_{i}.webp", quality=86, method=6)
        print(OUT / f"tree_card_{i}.webp", (OUT / f"tree_card_{i}.webp").stat().st_size, file=sys.stderr)
    print(json.dumps({"height": height, "span": span}), file=sys.stderr)


if __name__ == "__main__":
    main()
