"""Builds the 3D battle's soldiers on a real human body (MakeHuman, see build_human.py) and writes them to
assets/models/*.glb with their animations.

    python tools/blender/build_men.py

Each soldier is one skinned mesh on the 53-bone game skeleton: the body (only the parts left uncovered),
clothing and armour made from the body's own surface (so they bend with it), and gear bound to a single bone
(helmet to the head, shield to the left forearm, weapon to the right hand). Animations: idle, walk, attack,
block, death. Colours come from small generated textures (mail rings, cloth weave, leather, wood).

Coordinates: metres, Z up, the soldier faces -Y (glTF +Z, the way the battle's units face).
"""
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_human as bh  # noqa: E402
import makehuman_data as mh  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "assets", "models")
FPS = 30

FACTIONS = {
    "ally": {"cloth": (0.86, 0.85, 0.80), "mark": (0.06, 0.06, 0.07)},
    "enemy": {"cloth": (0.46, 0.08, 0.07), "mark": (0.84, 0.66, 0.22)},
}

FRONT = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
RIGHT = Vector((-1, 0, 0))  # the soldier's right hand side


# ---------------------------------------------------------------------------------------------------------
# Textures: small tiling images made here, so nothing is downloaded.

def _image(name, rgb, _size=None):
    size = rgb.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((size, size, 1))], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.pack()
    return img


def _noise(size, scale, seed):
    rng = np.random.default_rng(seed)
    small = rng.random((size // scale + 2, size // scale + 2))
    ys = np.linspace(0, size // scale, size, endpoint=False)
    y0 = ys.astype(int)
    t = (ys - y0)[:, None]
    rows = small[y0] * (1 - t) + small[y0 + 1] * t
    xs = np.linspace(0, size // scale, size, endpoint=False)
    x0 = xs.astype(int)
    u = (xs - x0)[None, :]
    return rows[:, x0] * (1 - u) + rows[:, x0 + 1] * u


def mail_texture(size=256, rings=16):
    """Rows of interlocking rings: bright ring edges, dark gaps, staggered every other row."""
    y, x = np.mgrid[0:size, 0:size] / size * rings
    x = x + (np.floor(y) % 2) * 0.5
    fx, fy = x % 1 - 0.5, (y % 1 - 0.5) * 1.2
    r = np.sqrt(fx ** 2 + fy ** 2)
    ring = np.exp(-((r - 0.36) ** 2) / 0.006)
    shade = 0.22 + 0.55 * ring + 0.08 * _noise(size, 32, 1)
    return np.stack([shade * 0.95, shade * 0.97, shade], axis=2)


def weave_texture(color, size=256, threads=48, seed=2):
    y, x = np.mgrid[0:size, 0:size] / size * threads
    weave = 0.5 + 0.5 * np.sin(x * math.pi * 2) * np.sin(y * math.pi * 2)
    shade = 0.82 + 0.1 * weave + 0.12 * (_noise(size, 16, seed) - 0.5)
    return np.stack([shade * c for c in color], axis=2)


def grain_texture(color, size=256, seed=3, streak=6):
    n = _noise(size, 8, seed)
    stretched = np.repeat(_noise(size, streak, seed + 1)[:, :1], size, axis=1)
    shade = 0.78 + 0.18 * n + 0.14 * (stretched - 0.5)
    return np.stack([shade * c for c in color], axis=2)


def material(name, image, metallic=0.0, roughness=0.8, color=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*color, 1)
    return mat


def make_materials(f):
    return {
        "skin": material("skin", None, color=(0.72, 0.52, 0.42), roughness=0.6),
        # Metal is kept only partly metallic: the battle has no reflection map, and fully metallic parts render black.
        "mail": material("mail", _image("mail", mail_texture(), 256), metallic=0.35, roughness=0.55),
        "steel": material("steel", _image("steel", grain_texture((0.66, 0.68, 0.71), seed=7, streak=2), 128),
                          metallic=0.4, roughness=0.4),
        "cloth": material("cloth", _image("cloth", weave_texture(f["cloth"]), 256), roughness=0.9),
        "mark": material("mark", _image("mark", weave_texture(f["mark"], seed=5), 128), roughness=0.85),
        "hose": material("hose", _image("hose", weave_texture((0.30, 0.26, 0.22), seed=4), 128), roughness=0.95),
        "leather": material("leather", _image("leather", grain_texture((0.22, 0.14, 0.08), seed=9), 128), roughness=0.7),
        "wood": material("wood", _image("wood", grain_texture((0.50, 0.34, 0.19), seed=11, streak=1), 128), roughness=0.75),
    }


# ---------------------------------------------------------------------------------------------------------
# Body regions, by the bone that moves each vertex most.

def dominant_bones(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names[best.group] if best else None)
    return out


ARM_BONES = {"clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r"}
TORSO_BONES = {"pelvis", "spine_01", "spine_02", "spine_03"}
LEG_BONES = {"thigh_l", "thigh_r", "calf_l", "calf_r"}
FOOT_BONES = {"foot_l", "foot_r", "ball_l", "ball_r"}


def surface_layer(body, name, keep, offset, mat, decimate=None):
    """A copy of the body's faces where keep(vertex index) is true for all corners, pushed out along the
    normals by offset. It keeps the body's skin weights, so it bends exactly like the body under it."""
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    drop = [f for f in bm.faces if not all(keep(v.index) for v in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset(v.co)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if decimate:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = decimate
        obj.modifiers.move(len(obj.modifiers) - 1, 0)
    return obj


def remove_faces(obj, drop_vertex):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(drop_vertex(v.index) for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def box_uvs(obj, size=0.25):
    """World-scale box mapping, so a tiling texture keeps the same size everywhere on the part."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        n = face.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for loop in face.loops:
            c = loop.vert.co
            a, b = [(c.y, c.z), (c.x, c.z), (c.x, c.y)][axis]
            loop[uv].uv = (a / size, b / size)
    bm.to_mesh(obj.data)
    bm.free()


# ---------------------------------------------------------------------------------------------------------
# Posing: point a bone's length along a direction given in the armature's space, keeping its twist.

def aim(skeleton, bone, direction, roll=0.0):
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones[bone]
    m = pb.matrix.copy()
    current = Vector(m.col[1][:3]).normalized()
    rot = current.rotation_difference(Vector(direction).normalized())
    if roll:
        rot = Quaternion(Vector(direction).normalized(), roll) @ rot
    head = m.translation.copy()
    pb.matrix = Matrix.Translation(head) @ rot.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m


def turn(skeleton, bone, axis, degrees):
    """Turn a bone (and so everything below it) about an axis in armature space, around its head."""
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones[bone]
    m = pb.matrix.copy()
    head = m.translation.copy()
    rot = Quaternion(Vector(axis).normalized(), math.radians(degrees)).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ m


def rotated(v, axis, degrees):
    return Quaternion(Vector(axis).normalized(), math.radians(degrees)) @ Vector(v)


def reset_pose(skeleton):
    for pb in skeleton.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def fist(skeleton, side, closed=1.0):
    """Curl the fingers of one hand around a grip."""
    s = side
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    hand = pb[f"hand_{s}"].matrix
    across = (pb[f"pinky_01_{s}"].head - pb[f"index_01_{s}"].head).normalized()
    for finger in ("index", "middle", "ring", "pinky"):
        for joint, bend in (("01", 70), ("02", 85), ("03", 60)):
            name = f"{finger}_{joint}_{s}"
            bpy.context.view_layer.update()
            d = Vector(pb[name].matrix.col[1][:3])
            aim(skeleton, name, rotated(d, -across if s == "r" else across, bend * closed))
    aim(skeleton, f"thumb_02_{s}", rotated(Vector(pb[f"thumb_02_{s}"].matrix.col[1][:3]), Vector(hand.col[1][:3]), 40 * closed))


# Stances, built up from the rest pose. Directions are in armature space: -Y front, +Z up, -X the soldier's right.

def stance(skeleton, spear_up=True):
    reset_pose(skeleton)
    aim(skeleton, "upperarm_l", (0.22, -0.45, -1))
    aim(skeleton, "lowerarm_l", (-1, -0.12, 0.12))
    aim(skeleton, "hand_l", (-1, -0.05, 0.0))
    aim(skeleton, "upperarm_r", (-0.22, -0.18, -1))
    aim(skeleton, "lowerarm_r", (-0.05, -1, 0.55) if spear_up else (-0.05, -1, 0.1))
    aim(skeleton, "hand_r", (0.0, -1, 0.2))


def walk_pose(skeleton, phase):
    """phase 0..1 through one stride: legs swing opposite, a small bob and arm sway."""
    stance(skeleton)
    s = math.sin(phase * 2 * math.pi)
    c = math.cos(phase * 2 * math.pi)
    for side, sign in (("l", 1), ("r", -1)):
        swing = 26 * s * sign
        aim(skeleton, f"thigh_{side}", rotated((0.04 * (1 if side == "l" else -1), 0, -1), RIGHT, -swing))
        lift = max(0.0, -s * sign)  # the leg moving forward bends at the knee
        bpy.context.view_layer.update()
        thigh_dir = Vector(skeleton.pose.bones[f"thigh_{side}"].matrix.col[1][:3])
        aim(skeleton, f"calf_{side}", rotated(thigh_dir, RIGHT, 10 + 45 * lift))
        aim(skeleton, f"foot_{side}", rotated((0, -1, -0.35), RIGHT, 0))
    skeleton.pose.bones["pelvis"].location = (0, 0, 0)
    turn(skeleton, "spine_01", UP, 5 * s)
    turn(skeleton, "upperarm_r", RIGHT, -8 * s)
    skeleton.pose.bones["Root"].location = (0, 0, 0.02 * abs(c) - 0.02)


def attack_pose(skeleton, t):
    """Spear thrust: draw back (0..0.35), drive forward (0.35..0.6), recover (0.6..1)."""
    stance(skeleton, spear_up=False)
    if t < 0.35:
        k = t / 0.35
        back, reach = k, 0.0
    elif t < 0.6:
        k = (t - 0.35) / 0.25
        back, reach = 1 - k, k
    else:
        k = (t - 0.6) / 0.4
        back, reach = 0.0, 1 - k
    upper = (-0.25, -0.18 + 0.75 * back - 0.6 * reach, -1 + 0.6 * reach)
    aim(skeleton, "upperarm_r", upper)
    aim(skeleton, "lowerarm_r", (0.15 * reach - 0.05, -1, 0.1 - 0.1 * reach))
    aim(skeleton, "hand_r", (0.0, -1, 0.0))
    turn(skeleton, "spine_02", UP, -18 * back + 14 * reach)
    turn(skeleton, "pelvis", RIGHT, -6 * reach)


def block_pose(skeleton, t):
    """Shield raised to the face and held."""
    stance(skeleton)
    k = min(1.0, t / 0.25)
    aim(skeleton, "upperarm_l", (0.22 - 0.05 * k, -0.45 - 0.55 * k, -1 + 0.8 * k))
    aim(skeleton, "lowerarm_l", (-1, -0.12, 0.12 + 0.35 * k))
    turn(skeleton, "spine_02", RIGHT, -5 * k)


def death_pose(skeleton, t):
    """Knees give, then the body falls backwards and lies still."""
    stance(skeleton, spear_up=False)
    k = min(1.0, t / 0.9)
    ease = k * k * (3 - 2 * k)
    for side in ("l", "r"):
        aim(skeleton, f"thigh_{side}", rotated((0.05 if side == "l" else -0.05, 0, -1), RIGHT, -25 * ease))
        bpy.context.view_layer.update()
        thigh_dir = Vector(skeleton.pose.bones[f"thigh_{side}"].matrix.col[1][:3])
        aim(skeleton, f"calf_{side}", rotated(thigh_dir, RIGHT, 25 * ease))
    # Arms drop out to the sides and lie on the ground.
    aim(skeleton, "upperarm_l", (1, 0.6 * ease, -1 + 0.8 * ease))
    aim(skeleton, "lowerarm_l", (1, 0.3, -0.2))
    aim(skeleton, "upperarm_r", (-1, 0.6 * ease, -1 + 0.8 * ease))
    aim(skeleton, "lowerarm_r", (-1, 0.5, -0.1))
    root = skeleton.pose.bones["Root"]
    bpy.context.view_layer.update()
    m = root.matrix.copy()
    fall = Quaternion(RIGHT, math.radians(88 * ease)).to_matrix().to_4x4()
    root.matrix = Matrix.Translation((0, -0.2 * ease, 0.1 * ease)) @ fall @ m


# ---------------------------------------------------------------------------------------------------------
# Gear, placed in the stance and bound rigidly to one bone.

def bind(obj, skeleton, bone, stance_fn):
    """obj was modelled where it should sit in the stance; move it back to the rest pose of `bone`, give it
    that bone's full weight and the skeleton."""
    stance_fn(skeleton)
    bpy.context.view_layer.update()
    posed = skeleton.pose.bones[bone].matrix.copy()
    rest = skeleton.data.bones[bone].matrix_local.copy()
    obj.data.transform(rest @ posed.inverted())
    obj.data.update()
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = skeleton
    mod = obj.modifiers.new("skeleton", "ARMATURE")
    mod.object = skeleton
    reset_pose(skeleton)
    return obj


def mesh_obj(name, bm, mat, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def lathe(profile, segments, lean=None):
    """A surface of revolution about Z from (radius, z) pairs; lean(z) can push rings towards -Y."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            y_shift = -lean(z) if lean else 0.0
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a) * 1.08 + y_shift, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    return bm


def italo_norman_helm(head_top, radius, mat):
    """Tall cone whose tip leans forward, a brow band and a broad nasal."""
    profile = [(radius * 1.04, 0.0), (radius * 1.03, 0.03), (radius * 0.98, 0.07), (radius * 0.86, 0.12),
               (radius * 0.66, 0.17), (radius * 0.42, 0.21), (radius * 0.18, 0.245), (0.012, 0.26)]
    bm = lathe(profile, 20, lean=lambda z: (z / 0.26) ** 2 * 0.06)
    bmesh.ops.contextual_create(bm, geom=[v for v in bm.verts if v.co.z > 0.255])
    band = lathe([(radius * 1.075, -0.005), (radius * 1.075, 0.032)], 20)
    nasal_bm = bmesh.new()
    bmesh.ops.create_cube(nasal_bm, size=1.0)
    for v in nasal_bm.verts:
        v.co = Vector((v.co.x * 0.032, v.co.y * 0.012, v.co.z * 0.1)) + Vector((0, -radius * 1.1, -0.04))
    helm = mesh_obj("helm", bm, mat)
    band_obj = mesh_obj("helm_band", band, mat)
    nasal = mesh_obj("nasal", nasal_bm, mat, smooth=False)
    for o in (helm, band_obj, nasal):
        o.data.transform(Matrix.Translation(head_top))
    return [helm, band_obj, nasal]


def kite_shield(mat_face, mat_mark, mat_rim):
    """A kite shield 0.95 m tall, curved across, with a painted cross and a leather rim."""
    pts = []
    w, h = 0.27, 0.95
    for i in range(13):
        a = math.pi * i / 12
        pts.append((math.cos(a) * w, h * 0.3 + math.sin(a) * w * 0.55))
    pts += [(-w * 0.92, -h * 0.02), (-w * 0.55, -h * 0.4), (0, -h * 0.7), (w * 0.55, -h * 0.4), (w * 0.92, -h * 0.02)]

    def plate(outline, thick, inset, mat, name):
        bm = bmesh.new()
        verts = [bm.verts.new((x, 0, y)) for x, y in outline]
        face = bm.faces.new(verts)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
        for v in ext["geom"]:
            if isinstance(v, bmesh.types.BMVert):
                v.co.y += thick
        for v in bm.verts:
            v.co.y += (v.co.x / w) ** 2 * 0.07 - inset  # curve back at the edges
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return mesh_obj(name, bm, mat, smooth=False)

    rim = plate([(x * 1.04, y * 1.03) for x, y in pts], 0.02, 0.0, mat_rim, "shield_rim")
    face = plate(pts, 0.025, 0.006, mat_face, "shield")
    bar_v = plate([(-0.035, 0.32), (0.035, 0.32), (0.035, -0.5), (-0.035, -0.5)], 0.004, 0.012, mat_mark, "cross_v")
    bar_h = plate([(-0.2, 0.17), (0.2, 0.17), (0.2, 0.1), (-0.2, 0.1)], 0.004, 0.012, mat_mark, "cross_h")
    boss = bmesh.new()
    bmesh.ops.create_uvsphere(boss, u_segments=12, v_segments=6, radius=0.05)
    for v in boss.verts:
        v.co.y = -abs(v.co.y) * 0.5 - 0.01
        v.co.z += 0.12
    boss_obj = mesh_obj("boss", boss, mat_rim)
    return [rim, face, bar_v, bar_h, boss_obj]


def spear(mat_wood, mat_steel, length=2.6):
    shaft = bmesh.new()
    bmesh.ops.create_cone(shaft, cap_ends=True, segments=8, radius1=0.016, radius2=0.014, depth=length)
    head = bmesh.new()
    bmesh.ops.create_cone(head, cap_ends=True, segments=4, radius1=0.032, radius2=0.0, depth=0.26)
    for v in head.verts:
        v.co.y *= 0.3
        v.co.z += length / 2 + 0.13
    return [mesh_obj("spear_shaft", shaft, mat_wood), mesh_obj("spear_head", head, mat_steel, smooth=False)]


# ---------------------------------------------------------------------------------------------------------

def infantry(zf, f):
    body, skeleton = bh.build(zf)
    mats = make_materials(f)
    dom = dominant_bones(body)
    zs = [v.co.z for v in body.data.vertices]
    knee_z = skeleton.data.bones["calf_l"].head_local.z
    neck_z = skeleton.data.bones["neck_01"].head_local.z
    head = skeleton.data.bones["head"]
    head_verts = [v.co for v, b in zip(body.data.vertices, dom) if b == "head"]
    head_top = max(c.z for c in head_verts)
    head_r = (max(c.x for c in head_verts) - min(c.x for c in head_verts)) / 2
    brow_z = head_top - 0.085

    def is_face(i):
        c = body.data.vertices[i].co
        n = body.data.vertices[i].normal
        return dom[i] == "head" and n.y < -0.35 and c.z < brow_z + 0.005

    # Mail hauberk: torso, arms to the wrist, thighs to just above the knee, and a coif over the head and neck.
    def in_hauberk(i):
        b = dom[i]
        return b in TORSO_BONES or b in ARM_BONES or (b in LEG_BONES and zs[i] > knee_z + 0.08)

    def in_coif(i):
        return (dom[i] in ("neck_01",) or (dom[i] == "head" and not is_face(i)))

    hauberk = surface_layer(body, "hauberk", in_hauberk, lambda co: 0.022, mats["mail"], decimate=0.22)
    coif = surface_layer(body, "coif", in_coif, lambda co: 0.012, mats["mail"], decimate=0.35)
    # Surcoat (tabard) over the mail: torso and hips, front and back.
    surcoat = surface_layer(body, "surcoat", lambda i: dom[i] in TORSO_BONES or (dom[i] in LEG_BONES and zs[i] > knee_z + 0.2),
                            lambda co: 0.036, mats["cloth"], decimate=0.25)
    hose = surface_layer(body, "hose", lambda i: dom[i] in LEG_BONES and zs[i] <= knee_z + 0.1, lambda co: 0.006,
                         mats["hose"], decimate=0.25)
    shoes = surface_layer(body, "shoes", lambda i: dom[i] in FOOT_BONES, lambda co: 0.014, mats["leather"], decimate=0.12)
    # Only the face of the body stays visible; the hands are in mail mittens (below).
    remove_faces(body, lambda i: not is_face(i))
    body.data.materials.clear()
    body.data.materials.append(mats["skin"])
    mod = body.modifiers.new("decimate", "DECIMATE")
    mod.ratio = 0.45
    body.modifiers.move(len(body.modifiers) - 1, 0)
    for part in (hauberk, coif, surcoat, hose, shoes):
        box_uvs(part, 0.18 if part is hauberk or part is coif else 0.3)

    # Cross on the chest and back of the surcoat: thin plates bound to the upper spine.
    marks = []
    chest = skeleton.data.bones["spine_03"].head_local
    for side in (-1, 1):
        for size in ((0.05, 0.3), (0.24, 0.05)):
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            for v in bm.verts:
                v.co = Vector((v.co.x * size[0], v.co.y * 0.004, v.co.z * size[1]))
            o = mesh_obj("mark", bm, mats["mark"], smooth=False)
            front = min(c.y for c in [v.co for v in surcoat.data.vertices if abs(v.co.x) < 0.05 and abs(v.co.z - chest.z) < 0.04]) \
                if side < 0 else max(c.y for c in [v.co for v in surcoat.data.vertices if abs(v.co.x) < 0.05 and abs(v.co.z - chest.z) < 0.04])
            o.data.transform(Matrix.Translation((0, front + side * 0.006, chest.z - 0.02 + (0.03 if size[1] < 0.1 else 0))))
            marks.append(o)
    for o in marks:
        g = o.vertex_groups.new(name="spine_03")
        g.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
        o.parent = skeleton
        m = o.modifiers.new("skeleton", "ARMATURE")
        m.object = skeleton

    helm_parts = italo_norman_helm(Vector((0, head.head_local.y - 0.005, brow_z)), head_r + 0.012, mats["steel"])
    for part in helm_parts:
        g = part.vertex_groups.new(name="head")
        g.add(list(range(len(part.data.vertices))), 1.0, "REPLACE")
        part.parent = skeleton
        m = part.modifiers.new("skeleton", "ARMATURE")
        m.object = skeleton

    # Shield on the left forearm, facing forward in the stance; spear upright in the right fist.
    stance(skeleton)
    bpy.context.view_layer.update()
    fore = skeleton.pose.bones["lowerarm_l"]
    mid = (fore.head + fore.tail) / 2
    shield_parts = kite_shield(mats["cloth"], mats["mark"], mats["leather"])
    for part in shield_parts:
        part.data.transform(Matrix.Translation(mid + Vector((-0.04, -0.15, 0.02))) @ Matrix.Rotation(math.radians(-6), 4, "Z"))
    fists = {}
    for side in ("l", "r"):
        hand = skeleton.pose.bones[f"hand_{side}"]
        fists[side] = hand.head + Vector(hand.matrix.col[1][:3]) * 0.065
    spear_parts = spear(mats["wood"], mats["steel"])
    for part in spear_parts:
        part.data.transform(Matrix.Translation(fists["r"] + Vector((0, 0, 0.55))))
    mittens = []
    for side in ("l", "r"):
        hand = skeleton.pose.bones[f"hand_{side}"]
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.045, v.co.y * 0.06, v.co.z * 0.05))
        mitten = mesh_obj(f"mitten_{side}", bm, mats["mail"])
        # Long axis along the hand, centred on the fist.
        mitten.data.transform(Matrix.Translation(fists[side]) @ Vector((0, 1, 0)).rotation_difference(Vector(hand.matrix.col[1][:3])).to_matrix().to_4x4())
        mittens.append((mitten, f"hand_{side}"))
    reset_pose(skeleton)
    for part in shield_parts:
        bind(part, skeleton, "lowerarm_l", stance)
    for part in spear_parts:
        bind(part, skeleton, "hand_r", stance)
    for mitten, bone in mittens:
        bind(mitten, skeleton, bone, stance)
    for part in shield_parts + spear_parts + helm_parts + marks + [m for m, _ in mittens]:
        box_uvs(part, 0.3)
    return body, skeleton


# ---------------------------------------------------------------------------------------------------------

def bake_action(skeleton, name, length_s, pose_fn, loop=False, step=2):
    """Record pose_fn(t in 0..1) as an action with a key every `step` frames."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    skeleton.animation_data_create()
    skeleton.animation_data.action = action
    frames = max(2, round(length_s * FPS))
    for frame in list(range(0, frames, step)) + [frames]:
        t = frame / frames
        pose_fn(skeleton, 0.0 if (loop and frame == frames) else t)
        bpy.context.view_layer.update()
        for pb in skeleton.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame + 1)
            if pb.name == "Root":
                pb.keyframe_insert("location", frame=frame + 1)
    skeleton.animation_data.action = None
    return action


def animate(skeleton):
    actions = [
        bake_action(skeleton, "idle", 2.0, lambda s, t: (stance(s), turn(s, "spine_02", RIGHT, 1.5 * math.sin(t * 2 * math.pi))), loop=True, step=10),
        bake_action(skeleton, "walk", 1.0, walk_pose, loop=True, step=2),
        bake_action(skeleton, "attack", 0.7, attack_pose, step=2),
        bake_action(skeleton, "block", 0.4, block_pose, step=2),
        bake_action(skeleton, "death", 1.1, death_pose, step=2),
    ]
    # The glTF exporter writes every action that is placed on the skeleton's NLA tracks.
    for action in actions:
        track = skeleton.animation_data.nla_tracks.new()
        track.name = action.name
        track.strips.new(action.name, 1, action)
        track.mute = True
    reset_pose(skeleton)


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_apply=False, export_image_format="AUTO", export_texcoords=True,
                              export_normals=True, export_rest_position_armature=True, export_def_bones=False)


def main():
    zf = mh.package()
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:] or ["ally", "enemy"]
    for side in only:
        body, skeleton = infantry(zf, FACTIONS[side])
        # Apply the decimation now, before skinning is exported.
        for obj in list(bpy.data.objects):
            if obj.type == "MESH":
                bpy.context.view_layer.objects.active = obj
                for mod in list(obj.modifiers):
                    if mod.type == "DECIMATE":
                        bpy.ops.object.modifier_apply(modifier=mod.name)
        # One mesh per soldier: fewer objects to draw (one draw call per material).
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        bpy.context.view_layer.objects.active.name = "soldier"
        animate(skeleton)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
        path = os.path.join(OUT, f"infantry_{side}.glb")
        export(path)
        print(f"{os.path.basename(path)}: {tris} triangles, {os.path.getsize(path)} bytes, "
              f"{len(bpy.data.actions)} actions")


if __name__ == "__main__":
    main()
