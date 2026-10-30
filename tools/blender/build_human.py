"""Builds a rigged human body in Blender from the MakeHuman data (see makehuman_data.py).

    python tools/blender/build_human.py            # writes a test body to tools/blender/.cache/human_test.glb

The body is a young adult man: the base mesh plus the MakeHuman "male, young, average weight" shape with some
extra muscle. It is skinned to MakeHuman's 53-bone game skeleton (Unreal-style bone names). Metres, Z up,
facing -Y, so the glTF export faces +Z like the battle's units.
"""
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import makehuman_data as mh  # noqa: E402

SCALE = 0.1  # MakeHuman works in decimetres

# The body's shape: (target name, weight).
SHAPE = (
    ("macrodetails/universal-male-young-averagemuscle-averageweight", 1.0),
    ("macrodetails/universal-male-young-maxmuscle-averageweight", 0.35),
    ("macrodetails/caucasian-male-young", 1.0),
)


# Height of the soles in MakeHuman units, set once the body is shaped, so the feet stand on z = 0.
FLOOR = [0.0]


def to_blender(v):
    x, y, z = v
    return Vector((x * SCALE, -z * SCALE, (y - FLOOR[0]) * SCALE))


def shaped_vertices(zf, verts):
    out = [list(v) for v in verts]
    for name, weight in SHAPE:
        for i, (dx, dy, dz) in mh.target(zf, name).items():
            out[i][0] += dx * weight
            out[i][1] += dy * weight
            out[i][2] += dz * weight
    return [tuple(v) for v in out]


def joint_positions(verts, groups):
    """Each "joint-..." helper group is a small cube; its centre is where that joint sits."""
    joints = {}
    for name, faces in groups.items():
        if not name.startswith("joint-"):
            continue
        idx = {i for face in faces for i, _ in face}
        joints[name] = sum((to_blender(verts[i]) for i in idx), Vector()) / len(idx)
    return joints


def build_body(verts, uvs, groups):
    """The skin surface (the "body" group only), with UVs. Returns the object and a map from the base mesh's
    vertex index to the new mesh's."""
    faces = groups["body"]
    used = sorted({i for face in faces for i, _ in face})
    remap = {old: new for new, old in enumerate(used)}
    bm = bmesh.new()
    bverts = [bm.verts.new(to_blender(verts[i])) for i in used]
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in faces:
        try:
            f = bm.faces.new([bverts[remap[i]] for i, _ in face])
        except ValueError:
            continue
        for loop, (_, t) in zip(f.loops, face):
            if t is not None:
                loop[uv_layer].uv = uvs[t]
    mesh = bpy.data.meshes.new("body")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("body", mesh)
    bpy.context.collection.objects.link(obj)
    return obj, remap


def build_armature(rig_def, verts, joints):
    def point(spec):
        if spec["strategy"] == "CUBE":
            return joints[spec["cube_name"]].copy()
        if spec["strategy"] == "MEAN":
            pts = [to_blender(verts[i]) for i in spec["vertex_indices"]]
            return sum(pts, Vector()) / len(pts)
        if spec["strategy"] == "VERTEX":
            return to_blender(verts[spec["vertex_index"]])
        raise ValueError(spec["strategy"])

    arm = bpy.data.armatures.new("skeleton")
    obj = bpy.data.objects.new("skeleton", arm)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    for name, spec in rig_def.items():
        bone = arm.edit_bones.new(name)
        bone.head = point(spec["head"])
        bone.tail = point(spec["tail"])
        if (bone.tail - bone.head).length < 1e-4:
            bone.tail = bone.head + Vector((0, 0, 0.05))
        bone.roll = spec.get("roll", 0)
    for name, spec in rig_def.items():
        if spec.get("parent"):
            arm.edit_bones[name].parent = arm.edit_bones[spec["parent"]]
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def skin(body, skeleton, weight_def, remap):
    for bone, pairs in weight_def.items():
        group = body.vertex_groups.new(name=bone)
        for old, w in pairs:
            if old in remap:
                group.add([remap[old]], w, "REPLACE")
    body.parent = skeleton
    mod = body.modifiers.new("skeleton", "ARMATURE")
    mod.object = skeleton


def build(zf):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    verts, uvs, groups = mh.base_mesh(zf)
    verts = shaped_vertices(zf, verts)
    FLOOR[0] = min(verts[i][1] for face in groups["body"] for i, _ in face)
    joints = joint_positions(verts, groups)
    body, remap = build_body(verts, uvs, groups)
    skeleton = build_armature(mh.rig(zf), verts, joints)
    skin(body, skeleton, mh.weights(zf), remap)
    return body, skeleton


def main():
    zf = mh.package()
    body, skeleton = build(zf)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    height = max(v.co.z for v in body.data.vertices) - min(v.co.z for v in body.data.vertices)
    print(f"body: {len(body.data.vertices)} vertices, {tris} triangles, {height:.2f} m tall, {len(skeleton.data.bones)} bones")
    out = os.path.join(mh.CACHE, "human_test.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                              export_skins=True, export_animations=False)
    print("wrote", out)


if __name__ == "__main__":
    main()
