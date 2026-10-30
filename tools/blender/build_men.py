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
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_human as bh  # noqa: E402
import check_soldier  # noqa: E402
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


def mail_height(size=256, rings=16):
    """Rows of interlocking rings, staggered every other row: 1 on a ring, 0 in the gaps."""
    y, x = np.mgrid[0:size, 0:size] / size * rings
    x = x + (np.floor(y) % 2) * 0.5
    fx, fy = x % 1 - 0.5, (y % 1 - 0.5) * 1.2
    r = np.sqrt(fx ** 2 + fy ** 2)
    return np.exp(-((r - 0.36) ** 2) / 0.006)


def mail_texture(size=256):
    ring = mail_height(size)
    shade = 0.34 + 0.36 * ring + 0.05 * _noise(size, 32, 1)
    return np.stack([shade * 0.95, shade * 0.97, shade], axis=2)


def weave_height(size=256, threads=96):
    y, x = np.mgrid[0:size, 0:size] / size * threads
    return 0.5 + 0.5 * np.sin(x * math.pi * 2) * np.sin(y * math.pi * 2)


def weave_texture(color, size=256, seed=2):
    shade = 0.9 + 0.035 * weave_height(size) + 0.08 * (_noise(size, 16, seed) - 0.5) + 0.04 * (_noise(size, 64, seed + 7) - 0.5)
    return np.stack([shade * c for c in color], axis=2)


def grain_texture(color, size=256, seed=3, streak=6):
    n = _noise(size, 8, seed)
    stretched = np.repeat(_noise(size, streak, seed + 1)[:, :1], size, axis=1)
    shade = 0.86 + 0.09 * n + 0.07 * (stretched - 0.5)
    return np.stack([shade * c for c in color], axis=2)


def skin_texture(size=256, seed=21):
    """Even skin with soft blotches of warmer and paler tone, so the face does not look like plastic."""
    base = np.array([0.74, 0.54, 0.44])
    warm = np.array([0.80, 0.46, 0.38])
    n1 = _noise(size, 24, seed)
    n2 = _noise(size, 6, seed + 1)
    mix = np.clip((n1 - 0.45) * 1.6, 0, 1)[..., None]
    rgb = base * (1 - mix) + warm * mix
    return rgb * (0.93 + 0.1 * n2[..., None])


def hair_texture(color, size=128, seed=31):
    """Strands: noise stretched along one axis."""
    strands = np.repeat(_noise(size, 2, seed)[:1, :], size, axis=0)
    shade = 0.7 + 0.5 * (strands - 0.5) + 0.15 * (_noise(size, 16, seed + 1) - 0.5)
    return np.stack([np.clip(shade, 0, 1.3) * c for c in color], axis=2)


def cross_mask(size, u0, u1, v0, v1, bars):
    """1 inside the cross, 0 outside. bars: [(u_min, u_max, v_min, v_max)] in 0..1 texture space; u0..v1 is
    the texture's extent in the same units, so bars can be given in metres."""
    v, u = np.mgrid[0:size, 0:size] / (size - 1)
    u = u0 + u * (u1 - u0)
    v = v0 + v * (v1 - v0)
    mask = np.zeros((size, size))
    for a, b, c, d in bars:
        mask = np.maximum(mask, ((u >= a) & (u <= b) & (v >= c) & (v <= d)).astype(float))
    return mask[..., None]


def normal_image(name, height, strength):
    """A tangent-space normal map from a height field (bumps stand out where height is high)."""
    dy, dx = np.gradient(height)
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(height)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    img = _image(name, (n + 1) / 2)
    img.colorspace_settings.name = "Non-Color"
    return img


def material(name, image, metallic=0.0, roughness=0.8, color=None, normal=None, normal_strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*color, 1)
    if normal is not None and USE_NORMAL_MAPS:
        ntex = nodes.new("ShaderNodeTexImage")
        ntex.image = normal
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


USE_NORMAL_MAPS = True


def make_materials(f):
    weave_n = normal_image("weave_n", weave_height(), 2.5)
    grain_n = normal_image("grain_n", _noise(128, 8, 9), 8.0)
    return {
        "skin": material("skin", _image("skin", skin_texture()), roughness=0.62),
        "hair": material("hair", _image("hair", hair_texture((0.22, 0.14, 0.08))), roughness=0.85),
        "eye": material("eye", None, color=(0.86, 0.84, 0.80), roughness=0.3),
        "iris": material("iris", None, color=(0.16, 0.11, 0.07), roughness=0.3),
        # Metal is kept only partly metallic: the battle has no reflection map, and fully metallic parts render black.
        "mail": material("mail", _image("mail", mail_texture()), metallic=0.35, roughness=0.55,
                         normal=normal_image("mail_n", mail_height(), 6.0)),
        "steel": material("steel", _image("steel", grain_texture((0.66, 0.68, 0.71), size=128, seed=7, streak=2)),
                          metallic=0.4, roughness=0.38),
        "cloth": material("cloth", _image("cloth", weave_texture(f["cloth"])), roughness=0.9, normal=weave_n),
        # Painted wood for the shield face: the faction colour with soft brush and grain variation.
        "paint": material("paint", _image("paint", grain_texture(f["cloth"], size=128, seed=13, streak=3) * 1.12), roughness=0.7),
        "mark": material("mark", _image("mark", weave_texture(f["mark"], size=128, seed=5)), roughness=0.85),
        "hose": material("hose", _image("hose", weave_texture((0.30, 0.26, 0.22), size=128, seed=4)), roughness=0.95,
                         normal=weave_n),
        "leather": material("leather", _image("leather", grain_texture((0.22, 0.14, 0.08), size=128, seed=9)),
                            roughness=0.65, normal=grain_n),
        "dark_wood": material("dark_wood", _image("dark_wood", grain_texture((0.30, 0.20, 0.12), size=128, seed=12, streak=1)),
                              roughness=0.8),
        "wood": material("wood", _image("wood", grain_texture((0.50, 0.34, 0.19), size=128, seed=11, streak=1)),
                         roughness=0.75),
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


EAR_X = 0.066            # half-width of the head at the ears, in metres
FACE_HALF_WIDTH = 0.058  # the face opening of the coif
ARM_BONES = {"clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r"}
TORSO_BONES = {"pelvis", "spine_01", "spine_02", "spine_03"}
LEG_BONES = {"thigh_l", "thigh_r", "calf_l", "calf_r"}
FOOT_BONES = {"foot_l", "foot_r", "ball_l", "ball_r"}


def surface_layer(body, name, keep, offset, mat, decimate=None, smoothing=0, edge_smoothing=0):
    """A copy of the body's faces where keep(vertex index) is true for all corners, pushed out along the
    normals by offset. It keeps the body's skin weights, so it bends exactly like the body under it.
    edge_smoothing straightens its edges: the kept faces end in steps (a neckline like a saw), and each
    pass moves every edge vertex halfway to the middle of its two neighbours along the edge."""
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
    # Cloth and mail hang over the body: smooth away muscle detail first (edges stay where they are).
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smoothing):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    edge = [v for v in bm.verts if v.is_boundary]
    for _ in range(edge_smoothing):
        moved = {}
        for v in edge:
            along = [e.other_vert(v).co for e in v.link_edges if e.is_boundary]
            if len(along) == 2:
                moved[v] = v.co.lerp((along[0] + along[1]) / 2, 0.5)
        for v, co in moved.items():
            v.co = co
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


# The spear's axis in the right hand's own frame, measured when the spear is bound (see infantry()).
SPEAR_AXIS = {"local": None}


def point_spear(skeleton, direction):
    """Turn the right hand about its wrist so the spear points along direction (armature space)."""
    if SPEAR_AXIS["local"] is None:
        return
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones["hand_r"]
    m = pb.matrix.copy()
    current = (m.to_3x3() @ SPEAR_AXIS["local"]).normalized()
    rot = current.rotation_difference(Vector(direction).normalized())
    head = m.translation.copy()
    pb.matrix = Matrix.Translation(head) @ rot.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m


def rotated(v, axis, degrees):
    return Quaternion(Vector(axis).normalized(), math.radians(degrees)) @ Vector(v)


def reset_pose(skeleton):
    for pb in skeleton.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


# Props that come and go (a spear in the hand, a sword in the hand or in its scabbard) each ride on their own
# bone. glTF cannot animate whether a mesh is shown, but it can animate a bone's scale: a bone scaled to
# nothing hides everything bound to it.
PROP_BONES = {"prop_spear": "hand_r", "prop_sword": "hand_r", "prop_sheath": "pelvis"}
HIDDEN = 1e-4


def add_prop_bones(skeleton):
    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    bones = skeleton.data.edit_bones
    for name, parent in PROP_BONES.items():
        b = bones.new(name)
        b.head, b.tail, b.roll = bones[parent].head.copy(), bones[parent].tail.copy(), bones[parent].roll
        b.parent = bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(skeleton)


def show(skeleton, spear=True, sword=False, sheathed=True):
    for name, on in (("prop_spear", spear), ("prop_sword", sword), ("prop_sheath", sheathed)):
        k = 1.0 if on else HIDDEN
        skeleton.pose.bones[name].scale = (k, k, k)


# The scabbard hangs from the belt on its own bone and swings with the left thigh, as far as this, so it rides
# on the skirt (which follows the thighs towards its hem) instead of the leg pushing the skirt through it.
SCABBARD_SWING = 0.5


def add_scabbard_bone(skeleton, mouth, up):
    """A bone at the scabbard's mouth (child of the pelvis); the sheathed sword's bone hangs from it."""
    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    bones = skeleton.data.edit_bones
    b = bones.new("scabbard")
    b.head, b.tail = mouth, mouth - up * 0.2
    b.parent = bones["pelvis"]
    bones["prop_sheath"].parent = b
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(skeleton)


def swing_scabbard(skeleton):
    """Turn the scabbard about its mouth by part of the left thigh's turn (both measured against the pelvis)."""
    bpy.context.view_layer.update()
    pb, rest = skeleton.pose.bones, skeleton.data.bones

    def turned(name):
        return pb[name].matrix.to_3x3() @ rest[name].matrix_local.to_3x3().inverted()

    thigh = (turned("pelvis").inverted() @ turned("thigh_l")).to_quaternion()
    want = Quaternion().slerp(thigh, SCABBARD_SWING).to_matrix()
    own = rest["scabbard"].matrix_local.to_3x3()
    pb["scabbard"].rotation_quaternion = (own.inverted() @ want @ own).to_quaternion()


def reach(skeleton, side, wrist, pole):
    """Two-bone arm: put the wrist at `wrist` (armature space), the elbow bending towards `pole`."""
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    shoulder = pb[f"upperarm_{side}"].head.copy()
    l1 = (pb[f"upperarm_{side}"].tail - pb[f"upperarm_{side}"].head).length
    l2 = (pb[f"lowerarm_{side}"].tail - pb[f"lowerarm_{side}"].head).length
    to = Vector(wrist) - shoulder
    d = max(1e-4, min(to.length, (l1 + l2) * 0.999))
    to.normalize()
    # Distance from the shoulder, along the reach, to the point under the elbow, and the elbow's offset.
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    bend = Vector(pole) - to * Vector(pole).dot(to)
    bend = bend.normalized() if bend.length > 1e-6 else Vector((0, 0, -1))
    elbow = shoulder + to * a + bend * h
    aim(skeleton, f"upperarm_{side}", elbow - shoulder)
    bpy.context.view_layer.update()
    aim(skeleton, f"lowerarm_{side}", shoulder + to * d - pb[f"lowerarm_{side}"].head)


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


# Easing: how a value moves from 0 to 1 over time, so motions speed up and slow down like a body does.

def clamp01(x):
    return max(0.0, min(1.0, x))


def smooth(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def ease_in(x):
    x = clamp01(x)
    return x * x


def ease_out(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def span(t, a, b):
    """Where t is between a and b, as 0..1."""
    return clamp01((t - a) / (b - a))


def bend_leg(skeleton, side, forward_deg, knee_deg, foot_pitch=0.0, out=0.04):
    """Thigh swung forward by forward_deg, knee bent by knee_deg (the shin folds back, behind the knee),
    toes lifted by foot_pitch (negative points them down).
    Turning a downward vector about RIGHT by a positive angle moves it towards the front (-Y)."""
    sx = 1 if side == "l" else -1
    aim(skeleton, f"thigh_{side}", rotated((out * sx, 0, -1), RIGHT, forward_deg))
    bpy.context.view_layer.update()
    thigh = Vector(skeleton.pose.bones[f"thigh_{side}"].matrix.col[1][:3])
    aim(skeleton, f"calf_{side}", rotated(thigh, RIGHT, -knee_deg))
    aim(skeleton, f"foot_{side}", rotated((0, -1, -0.3), RIGHT, foot_pitch))


# Stances, built up from the rest pose. Directions are in armature space: -Y front, +Z up, -X the soldier's right.

def stance(skeleton, spear_up=True, breathe=0.0, shift=0.0, look=0.0, crouch=0.0, sword=False):
    """The guard: shield across the body on the left forearm; in the right fist the spear upright, or with
    sword=True the sword held ready, point up and a little forward.
    breathe -1..1 lifts the chest, shift -1..1 moves the weight onto the left or right leg, look turns the
    head (degrees), crouch 0..1 bends the knees."""
    reset_pose(skeleton)
    root = skeleton.pose.bones["Root"]
    root.location = (0, 0, 0)
    # Weight shift: hips slide over one leg and tilt, that knee locks and the other softens.
    turn(skeleton, "pelvis", FRONT, 2.5 * shift)
    turn(skeleton, "spine_01", FRONT, -2.0 * shift)
    for side, sign in (("l", 1), ("r", -1)):
        soft = clamp01(0.5 - 0.5 * shift * sign)
        bend_leg(skeleton, side, 4 + 10 * crouch + 3 * soft, 6 + 22 * crouch + 8 * soft, -4 * soft)
    turn(skeleton, "spine_03", RIGHT, -1.6 * breathe)
    turn(skeleton, "clavicle_l", FRONT, -1.2 * breathe)
    turn(skeleton, "clavicle_r", FRONT, 1.2 * breathe)
    # Shield arm: the upper arm forward and away from the body, the forearm across the front of the belly,
    # clear of the torso, so the shield stands in front of him.
    aim(skeleton, "upperarm_l", (0.42, -0.62, -1))
    aim(skeleton, "lowerarm_l", (-1, -0.3, 0.14))
    aim(skeleton, "hand_l", (-1, -0.2, 0.0))
    if sword:
        aim(skeleton, "upperarm_r", (-0.35, -0.45, -1))
        aim(skeleton, "lowerarm_r", (-0.12, -1, 0.55))
        aim(skeleton, "hand_r", (-0.05, -1, 0.5))
        point_spear(skeleton, SWORD_GUARD)
        show(skeleton, spear=False, sword=True, sheathed=False)
    else:
        aim(skeleton, "upperarm_r", (-0.22, -0.18, -1))
        aim(skeleton, "lowerarm_r", (-0.05, -1, 0.55) if spear_up else (-0.05, -1, 0.1))
        aim(skeleton, "hand_r", (0.0, -1, 0.2))
        show(skeleton, spear=True, sword=False, sheathed=True)
    turn(skeleton, "head", UP, look)
    # The whole body sinks with the knees.
    root.location = (0, 0, -0.03 * crouch)


SWORD_GUARD = Vector((0.12, -0.5, 1)).normalized()


def wrap(x):
    return (x + math.pi) % (2 * math.pi) - math.pi


def bell(x, centre, width):
    return math.exp(-wrap(x - centre) ** 2 / (2 * width * width))


def idle_pose(skeleton, t, sword=False):
    """Four seconds of standing: two breaths, a slow weight shift and a glance aside. Loops cleanly."""
    a = 2 * math.pi * t
    stance(skeleton, breathe=math.sin(2 * a), shift=0.8 * math.sin(a), look=7 * math.sin(a + 1.3) + 2 * math.sin(3 * a),
           sword=sword)
    turn(skeleton, "upperarm_r", RIGHT, 1.5 * math.sin(a + 0.6))


def walk_pose(skeleton, t, sword=False):
    """One stride (two steps) per second, from the phase p of each leg (thigh angle 22 sin p: furthest
    forward at heel strike, p = 90 deg, furthest back at toe-off, p = -90 deg).
    The knee bends most early in the swing (60 deg, while the thigh is still behind) and is nearly straight
    at heel strike, takes a little give as the weight lands, and the foot rolls off the toes. The body leans
    slightly into the walk; the hips rise over the planted leg, sway towards it and turn against the shoulders."""
    a = 2 * math.pi * t
    stance(skeleton, sword=sword)
    for side, phase in (("l", 0.0), ("r", math.pi)):
        p = a + phase
        knee = 4 + 58 * bell(p, -0.45, 0.6) + 12 * bell(p, 1.9, 0.45)
        toes = -22 * bell(p, -1.75, 0.35) + 12 * bell(p, 1.45, 0.35)
        bend_leg(skeleton, side, 22 * math.sin(p), knee, foot_pitch=toes)
    turn(skeleton, "pelvis", RIGHT, -4)
    turn(skeleton, "spine_02", RIGHT, -3)
    turn(skeleton, "pelvis", UP, 7 * math.sin(a))
    turn(skeleton, "spine_02", UP, -9 * math.sin(a))
    turn(skeleton, "pelvis", FRONT, 3 * math.cos(a))
    turn(skeleton, "head", UP, 5 * math.sin(a))
    turn(skeleton, "upperarm_r", RIGHT, -9 * math.sin(a - 0.5))
    turn(skeleton, "upperarm_l", RIGHT, 3 * math.sin(a + math.pi - 0.5))
    skeleton.pose.bones["Root"].location = (0.018 * math.sin(a), 0, -0.035 * math.sin(a) ** 2 + 0.005)


def attack_pose(skeleton, t):
    """Spear thrust: gather and draw back (0..0.35), drive forward with a step (0.35..0.5), hold the reach a
    moment, then recover to the guard."""
    draw = smooth(span(t, 0.0, 0.35)) * (1 - ease_in(span(t, 0.35, 0.45)))
    reach_ = ease_out(span(t, 0.35, 0.5)) * (1 - smooth(span(t, 0.62, 1.0)))
    stance(skeleton, spear_up=False, crouch=0.35 * draw + 0.5 * reach_)
    bend_leg(skeleton, "l", 4 + 22 * reach_, 8 + 22 * reach_)
    bend_leg(skeleton, "r", 4 - 12 * reach_, 6 + 6 * reach_)
    turn(skeleton, "pelvis", UP, -10 * draw + 12 * reach_)
    turn(skeleton, "spine_02", UP, -16 * draw + 16 * reach_)
    turn(skeleton, "spine_02", RIGHT, -6 * reach_)
    # Underarm thrust: the spear comes down from upright to level as he gathers, then the arm drives it
    # straight ahead, point first.
    level = smooth(span(t, 0.0, 0.3)) * (1 - smooth(span(t, 0.7, 1.0)))
    aim(skeleton, "upperarm_r", (-0.28, -0.15 + 0.85 * draw - 0.75 * reach_, -1 + 0.25 * draw + 0.75 * reach_))
    aim(skeleton, "lowerarm_r", (-0.08 + 0.2 * reach_, -1 + 0.3 * draw, 0.15 - 0.15 * reach_))
    aim(skeleton, "hand_r", (0.0, -1, 0.0))
    upright = Vector((0, -0.05, 1))
    forward = Vector((0.04, -1, 0.06))
    point_spear(skeleton, upright.lerp(forward, level).normalized())
    skeleton.pose.bones["Root"].location.y += -0.12 * reach_


def guard_wrist(skeleton):
    """Where the sword hand's wrist is in the guard (armature space), relative to the right shoulder."""
    stance(skeleton, sword=True)
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    return pb["lowerarm_r"].tail - pb["upperarm_r"].head


def slash_pose(skeleton, t):
    """Sword cut: the sword is raised back over the right shoulder (0..0.35), cuts down and across to the
    left with a step (0.38..0.58), follows through, then comes back to the guard."""
    wind = smooth(span(t, 0.0, 0.35)) * (1 - ease_in(span(t, 0.36, 0.46)))
    cut = ease_out(span(t, 0.38, 0.58)) * (1 - smooth(span(t, 0.7, 1.0)))
    guard = guard_wrist(skeleton)
    stance(skeleton, sword=True, crouch=0.3 * wind + 0.45 * cut)
    bend_leg(skeleton, "l", 4 + 20 * cut, 8 + 20 * cut)
    bend_leg(skeleton, "r", 4 - 10 * cut, 6 + 6 * cut)
    turn(skeleton, "pelvis", UP, -14 * wind + 14 * cut)
    turn(skeleton, "spine_02", UP, -20 * wind + 22 * cut)
    turn(skeleton, "spine_02", RIGHT, -8 * cut)
    bpy.context.view_layer.update()
    shoulder = skeleton.pose.bones["upperarm_r"].head.copy()
    raised = Vector((-0.12, 0.08, 0.3))
    struck = Vector((0.4, -0.4, -0.38))
    wrist = shoulder + guard.lerp(raised, wind).lerp(struck, cut)
    reach(skeleton, "r", wrist, pole=(-1, 0.3, -0.7))
    bpy.context.view_layer.update()
    fore = Vector(skeleton.pose.bones["lowerarm_r"].matrix.col[1][:3])
    aim(skeleton, "hand_r", fore)
    blade = SWORD_GUARD.lerp(Vector((0.25, 0.75, 0.55)).normalized(), wind).lerp(Vector((0.8, -0.4, -0.45)).normalized(), cut)
    point_spear(skeleton, blade.normalized())
    skeleton.pose.bones["Root"].location.y += -0.1 * cut


# Where the sheathed sword's grip and the scabbard's axis are, in the rest pose (set in infantry()).
SHEATH = {"grip": None, "up": None}


def draw_pose(skeleton, t):
    """Drawing the sword: the shield arm swings out of the way while the right hand crosses to the hilt at
    the left hip (0..0.36), grips it and draws the blade up and forward out of the scabbard (0.38..0.62); the
    blade turns to point ahead as soon as it is clear (0.5..0.78) and comes up to the guard while the
    shield comes back in front (0.7..1)."""
    to_hilt = smooth(span(t, 0.0, 0.36))
    pull = smooth(span(t, 0.38, 0.62))
    ready = smooth(span(t, 0.62, 1.0))
    turn_ahead = smooth(span(t, 0.5, 0.78))
    turn_up = smooth(span(t, 0.78, 1.0))
    guard = guard_wrist(skeleton)
    stance(skeleton)
    in_hand = t >= 0.38
    show(skeleton, spear=False, sword=in_hand, sheathed=not in_hand)
    turn(skeleton, "spine_02", UP, 14 * to_hilt * (1 - pull) - 6 * pull * (1 - ready))
    # The shield arm opens out to the left to make room, and returns as the sword comes to the guard.
    out = to_hilt * (1 - ready)
    aim(skeleton, "upperarm_l", Vector((0.42, -0.62, -1)).lerp(Vector((0.9, -0.35, -0.55)), out))
    aim(skeleton, "lowerarm_l", Vector((-1, -0.3, 0.14)).lerp(Vector((-0.3, -1, 0.1)), out))
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    pelvis = pb["pelvis"].matrix @ skeleton.data.bones["pelvis"].matrix_local.inverted()
    grip = pelvis @ SHEATH["grip"]
    up = (pelvis.to_3x3() @ SHEATH["up"]).normalized()
    shoulder = pb["upperarm_r"].head.copy()
    rest = pb["lowerarm_r"].tail.copy()
    at_hilt = grip + Vector((-0.03, -0.06, 0.02))   # the hand closes on the grip from in front
    drawn = at_hilt + up * 0.62 + Vector((-0.05, -0.2, 0.04))
    front = pelvis @ SHEATH["front"]
    s_ = to_hilt
    across = rest * (1 - s_) ** 2 + front * (2 * s_ * (1 - s_)) + at_hilt * s_ ** 2
    wrist = across.lerp(drawn, pull).lerp(shoulder + guard, ready)
    reach(skeleton, "r", wrist, pole=(-1, -0.4, -0.3))
    bpy.context.view_layer.update()
    aim(skeleton, "hand_r", Vector(pb["lowerarm_r"].matrix.col[1][:3]))
    if in_hand:
        # Down (leaving the scabbard), then ahead, then up to the guard: going through "ahead" keeps the
        # turn well defined, since down and up are nearly opposite.
        ahead = Vector((0.1, -1, 0.1)).normalized()
        blade = (-up).lerp(ahead, turn_ahead).normalized().lerp(SWORD_GUARD, turn_up)
        point_spear(skeleton, blade.normalized())


def block_pose(skeleton, t, sword=False):
    """Shield snaps up to the face with a little overshoot, knees bend and the head ducks behind it."""
    k = span(t, 0.0, 0.3)
    up = ease_out(k) + 0.08 * math.sin(math.pi * k) * (1 - k)
    stance(skeleton, crouch=0.5 * smooth(k), sword=sword)
    aim(skeleton, "upperarm_l", (0.42 - 0.2 * up, -0.62 - 0.4 * up, -1 + 0.85 * up))
    aim(skeleton, "lowerarm_l", (-1, -0.3, 0.14 + 0.4 * up))
    turn(skeleton, "spine_02", RIGHT, -8 * up)
    turn(skeleton, "head", RIGHT, 8 * up)


SHIELD_ROLL = -90


def death_pose(skeleton, t, sword=False):
    """Struck (0..0.15): the body jerks back. Knees buckle (0.1..0.45). Gravity takes him backwards
    (0.35..0.8), he hits the ground with a small rebound (0.8..0.95) and lies still, head rolled aside."""
    hit = ease_out(span(t, 0.0, 0.15)) * (1 - 0.6 * smooth(span(t, 0.15, 0.4)))
    buckle = smooth(span(t, 0.1, 0.42))
    fall = ease_in(span(t, 0.4, 0.82))
    rebound = math.sin(math.pi * span(t, 0.8, 0.95)) * 0.06
    settle = smooth(span(t, 0.8, 1.0))
    stance(skeleton, spear_up=False, sword=sword)
    for side, sign in (("l", 1), ("r", -1)):
        # Knees fold as he sinks, then the legs straighten out along the ground as he lands.
        bend_leg(skeleton, side, (26 + 8 * sign) * buckle * (1 - fall) + 4 * fall, 70 * buckle * (1 - fall) + 12 * fall,
                 20 * buckle * (1 - fall))
    turn(skeleton, "spine_02", RIGHT, 14 * hit - 6 * buckle * (1 - fall))
    turn(skeleton, "head", RIGHT, 20 * hit + 10 * fall)
    turn(skeleton, "head", UP, 25 * settle)
    # The arms are flung out by the blow, then trail behind the fall and come to rest on the ground.
    fling = max(0.5 * hit, fall)
    # The shield arm opens out with the blow, before the fall, so the shield never swings across his body;
    # it rolls as he falls, so the shield ends up lying flat on the ground, not standing on its edge.
    open_l = max(smooth(span(t, 0.05, 0.35)), fall)
    aim(skeleton, "upperarm_l", (0.42 + 0.6 * open_l, -0.62 + 0.8 * fall, -1 + 0.6 * open_l))
    aim(skeleton, "lowerarm_l", (-1 + 1.6 * open_l, -0.3 + 0.5 * fall, 0.14 - 0.12 * fall), roll=math.radians(SHIELD_ROLL) * fall)
    aim(skeleton, "upperarm_r", (-0.22 - 0.9 * fling, 0.5 * fall, -1 + 0.7 * fling))
    aim(skeleton, "lowerarm_r", (-0.05 - 0.9 * fling, -1 + 1.3 * fall, 0.1))
    # The spear goes over with him. Directions here are before the whole body is tipped back (below), so
    # "up along the body" ends up lying on the ground beside him, towards his head.
    point_spear(skeleton, Vector((0, -0.05, 1)).lerp(Vector((-0.35, 0.05, 1)), smooth(span(t, 0.2, 0.85))).normalized())
    root = skeleton.pose.bones["Root"]
    bpy.context.view_layer.update()
    m = root.matrix.copy()
    angle = 86 * fall - 86 * rebound
    tip = Quaternion(RIGHT, math.radians(angle)).to_matrix().to_4x4()
    # He drops onto bent knees first (the hips fall straight down), and only then tips over backwards.
    sink = 0.32 * buckle * (1 - smooth(span(t, 0.55, 0.85)))
    # Lying on his back, the back of the mail and surcoat rest on the ground, not in it.
    root.matrix = Matrix.Translation((0, 0.1 * fall + 0.04 * hit + 0.1 * buckle * (1 - fall), 0.17 * fall - sink)) @ tip @ m


# ---------------------------------------------------------------------------------------------------------
# Gear, placed in the stance and bound rigidly to one bone.

def bind(obj, skeleton, bone, stance_fn):
    """obj was modelled where it should sit in the stance; move it back to the rest pose of `bone`, give it
    that bone's full weight and the skeleton."""
    stance_fn(skeleton)
    for name in PROP_BONES:
        skeleton.pose.bones[name].scale = (1, 1, 1)
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


def kite_shield(f, mat_rim):
    """A kite shield 0.95 m tall, curved across, with the faction cross painted on and a leather rim."""
    pts = []
    w, h = 0.27, 0.95
    for i in range(13):
        a = math.pi * i / 12
        pts.append((math.cos(a) * w, h * 0.3 + math.sin(a) * w * 0.55))
    pts += [(-w * 0.92, -h * 0.02), (-w * 0.55, -h * 0.4), (0, -h * 0.7), (w * 0.55, -h * 0.4), (w * 0.92, -h * 0.02)]

    def inside(x, z, outline):
        hit = False
        for (x1, z1), (x2, z2) in zip(outline, outline[1:] + outline[:1]):
            if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
                hit = not hit
        return hit

    def nearest_on(x, z, outline):
        best, point = math.inf, (x, z)
        for (x1, z1), (x2, z2) in zip(outline, outline[1:] + outline[:1]):
            dx, dz = x2 - x1, z2 - z1
            k = max(0.0, min(1.0, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)))
            px, pz = x1 + dx * k, z1 + dz * k
            d = (px - x) ** 2 + (pz - z) ** 2
            if d < best:
                best, point = d, (px, pz)
        return point

    def plate(outline, thick, inset, mat, name, cells=(12, 24)):
        """A solid plate filling the outline, curved back towards the sides. It is a grid with points inside
        the outline as well (grid points outside are pulled onto the outline), so the curve holds across the
        whole face, not only along its edge."""
        xs = [x for x, _ in outline]
        zs = [z for _, z in outline]
        nx, nz = cells
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        grid = []
        for j in range(nz + 1):
            row = []
            for i in range(nx + 1):
                x = min(xs) + (max(xs) - min(xs)) * i / nx
                z = min(zs) + (max(zs) - min(zs)) * j / nz
                if not inside(x, z, outline):
                    x, z = nearest_on(x, z, outline)
                row.append(bm.verts.new((x, (x / w) ** 2 * 0.1 - inset, z)))
            grid.append(row)
        for j in range(nz):
            for i in range(nx):
                quad = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                if len({v.index for v in quad} | set()) and len({tuple(round(c, 5) for c in v.co) for v in quad}) >= 3:
                    try:
                        bm.faces.new(quad)
                    except ValueError:
                        pass
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-8], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        # Thickness: a copy of the surface `thick` behind it, joined to it along the outline.
        bm.verts.ensure_lookup_table()
        rim_edges = [e for e in bm.edges if e.is_boundary]
        front_faces = list(bm.faces)
        back = {v: bm.verts.new(v.co + Vector((0, thick, 0))) for v in list(bm.verts)}
        for f in front_faces:
            bm.faces.new([back[v] for v in reversed(f.verts)])
        for e in rim_edges:
            a, b = e.verts
            try:
                bm.faces.new((a, b, back[b], back[a]))
            except ValueError:
                pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for face in bm.faces:
            for loop in face.loops:
                c = loop.vert.co
                loop[uv].uv = ((c.x + w) / (2 * w), (c.z + h * 0.72) / (h * 1.2))
        return mesh_obj(name, bm, mat, smooth=True)

    size = 256
    bars = [(-0.035, 0.035, -0.5, 0.32), (-0.2, 0.2, 0.1, 0.17)]
    bars_uv = [((a + w) / (2 * w), (b + w) / (2 * w), (c + h * 0.72) / (h * 1.2), (d + h * 0.72) / (h * 1.2)) for a, b, c, d in bars]
    mask = cross_mask(size, 0, 1, 0, 1, bars_uv)
    paint = grain_texture(f["cloth"], size=size, seed=13, streak=3) * 1.12
    mark = grain_texture(f["mark"], size=size, seed=14, streak=3)
    face_mat = material("shield_paint", _image("shield_paint", paint * (1 - mask) + mark * mask), roughness=0.7)

    rim = plate([(x * 1.04, y * 1.03) for x, y in pts], 0.02, 0.0, mat_rim, "shield_rim")
    face = plate(pts, 0.025, 0.006, face_mat, "shield")
    boss = bmesh.new()
    bmesh.ops.create_uvsphere(boss, u_segments=12, v_segments=6, radius=0.05)
    for v in boss.verts:
        v.co.y = -abs(v.co.y) * 0.5 + 0.004
        v.co.z += 0.12
    boss_obj = mesh_obj("boss", boss, mat_rim)
    return [rim, face, boss_obj]


def sword(mats, name):
    """An arming sword, crossguard at the origin, blade along +Z (0.78 m), grip and pommel below."""
    parts = []
    blade = bmesh.new()
    pts = [(-0.024, 0.0), (0.024, 0.0), (0.016, 0.7), (0.0, 0.78), (-0.016, 0.7)]
    verts = [blade.verts.new((x, 0, z)) for x, z in pts]
    blade.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(blade, geom=blade.faces[:])
    for v in ext["geom"]:
        if isinstance(v, bmesh.types.BMVert):
            v.co.y += 0.006
    for v in blade.verts:
        v.co.y -= 0.003
    bmesh.ops.recalc_face_normals(blade, faces=blade.faces)
    parts.append(mesh_obj(f"{name}_blade", blade, mats["steel"], smooth=False))
    for size, z, mat in (((0.19, 0.018, 0.018), 0.0, mats["steel"]), ((0.026, 0.026, 0.1), -0.06, mats["leather"])):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2] + z))
        parts.append(mesh_obj(f"{name}_hilt", bm, mat, smooth=False))
    pommel = bmesh.new()
    bmesh.ops.create_uvsphere(pommel, u_segments=10, v_segments=6, radius=0.025)
    for v in pommel.verts:
        v.co.y *= 0.55
        v.co.z -= 0.125
    parts.append(mesh_obj(f"{name}_pommel", pommel, mats["steel"]))
    return parts


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

def paint_tabard(surcoat, f, chest_z, size=512):
    """Give the surcoat a front/back projection and a texture with the cross at the centre of the chest
    and of the back."""
    width, top, height = 0.56, chest_z + 0.3, 0.75  # metres covered by the texture
    # The cross stops above the belt (which crosses the surcoat about 0.17 m below the chest).
    bars = [(-0.025, 0.025, chest_z - 0.12, chest_z + 0.13), (-0.12, 0.12, chest_z + 0.005, chest_z + 0.055)]
    bars_uv = [((a + width / 2) / width, (b + width / 2) / width, (c - (top - height)) / height,
                (d - (top - height)) / height) for a, b, c, d in bars]
    mask = cross_mask(size, 0, 1, 0, 1, bars_uv)
    cloth = weave_texture(f["cloth"], size=size)
    mark = weave_texture(f["mark"], size=size, seed=5)
    image = _image("tabard", cloth * (1 - mask) + mark * mask)
    mat = material("tabard", image, roughness=0.9)
    bm = bmesh.new()
    bm.from_mesh(surcoat.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            c = loop.vert.co
            loop[uv].uv = ((c.x + width / 2) / width, (c.z - (top - height)) / height)
    bm.to_mesh(surcoat.data)
    bm.free()
    surcoat.data.materials.clear()
    surcoat.data.materials.append(mat)


def frame(z_axis, x_hint):
    z = Vector(z_axis).normalized()
    x = (Vector(x_hint) - z * Vector(x_hint).dot(z)).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    return m


def rigid(obj, skeleton, bone):
    """Bind an object, already in the rest pose, wholly to one bone."""
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = skeleton
    m = obj.modifiers.new("skeleton", "ARMATURE")
    m.object = skeleton
    return obj


def skirt(body, dom, skeleton, name, z_top, z_bottom, margin, mat, flare=0.0, segments=22, step=0.035):
    """A skirt hanging from the hips: at each height an ellipse around the body (both legs together below
    the crotch), pushed out by margin (and flare towards the hem). Near the waist it follows the pelvis;
    towards the hem it follows the thigh on its side, so it swings with the legs."""
    pts = [(v.co, b) for v, b in zip(body.data.vertices, dom) if b in TORSO_BONES or b in LEG_BONES]
    rings = []
    z = z_top
    while z > z_bottom - 1e-6:
        near = [c for c, _ in pts if abs(c.z - z) < 0.02]
        x0, x1 = min(c.x for c in near), max(c.x for c in near)
        y0, y1 = min(c.y for c in near), max(c.y for c in near)
        rings.append((z, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2))
        z -= step
    bm = bmesh.new()
    verts = []
    weights = []
    for k, (z, cx, cy, rx, ry) in enumerate(rings):
        t = k / max(1, len(rings) - 1)
        grow = margin + flare * t
        row = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            x = cx + (rx + grow) * math.cos(a)
            y = cy + (ry + grow * 0.9) * math.sin(a)
            row.append(bm.verts.new((x, y, z)))
            leg = smooth(t * 1.3) * 0.85
            left = clamp01(0.5 + (x - cx) / (2 * (rx + grow)) * 1.6)
            weights.append({"pelvis": 1 - leg, "thigh_l": leg * left, "thigh_r": leg * (1 - left)})
        verts.append(row)
    for a, b in zip(verts, verts[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    obj = mesh_obj(name, bm, mat)
    for bone in ("pelvis", "thigh_l", "thigh_r"):
        g = obj.vertex_groups.new(name=bone)
        for i, w in enumerate(weights):
            if w[bone] > 0.001:
                g.add([i], w[bone], "REPLACE")
    obj.parent = skeleton
    m = obj.modifiers.new("skeleton", "ARMATURE")
    m.object = skeleton
    return obj, rings


def infantry(zf, f):
    body, skeleton = bh.build(zf)
    add_prop_bones(skeleton)
    mats = make_materials(f)
    dom = dominant_bones(body)
    # Ears stand out from the head; under a mail coif and helmet they must not. Squash them in against the
    # side of the head, so the coif (made from the head's surface) closes smoothly over them.
    for v, b in zip(body.data.vertices, dom):
        if b == "head" and abs(v.co.x) > EAR_X:
            v.co.x = math.copysign(EAR_X + (abs(v.co.x) - EAR_X) * 0.15, v.co.x)
    body.data.update()
    zs = [v.co.z for v in body.data.vertices]
    knee_z = skeleton.data.bones["calf_l"].head_local.z
    hip_z = skeleton.data.bones["pelvis"].head_local.z
    waist_z = skeleton.data.bones["spine_02"].head_local.z
    head = skeleton.data.bones["head"]
    head_verts = [v.co for v, b in zip(body.data.vertices, dom) if b == "head"]
    head_top = max(c.z for c in head_verts)
    head_r = (max(c.x for c in head_verts) - min(c.x for c in head_verts)) / 2
    brow_z = head_top - 0.085

    head_cy = sum(c.y for c in head_verts) / len(head_verts)

    def is_face(i):
        # By position, not by which way the surface faces: the sides of the nose face sideways but are face.
        c = body.data.vertices[i].co
        return dom[i] == "head" and c.y < head_cy - 0.035 and c.z < brow_z + 0.005 and abs(c.x) < FACE_HALF_WIDTH

    face_z = [zs[i] for i in range(len(zs)) if is_face(i)]
    chin_z = min(face_z)

    def is_beard(i):
        c = body.data.vertices[i].co
        mouth = abs(c.x) < 0.022 and c.z > chin_z + 0.032  # leave the lips bare
        return is_face(i) and c.z < chin_z + 0.062 and not mouth

    # Mail: a hauberk over the torso and arms with a skirt to the knee, and a coif over head and neck.
    # It takes in the neck as well, so it overlaps the coif there: a face is kept only when all its corners
    # are kept, so where two layers meet edge to edge the row of faces between them belongs to neither, and
    # the inside of the man shows through.
    hauberk = surface_layer(body, "hauberk", lambda i: dom[i] in TORSO_BONES or dom[i] in ARM_BONES or dom[i] == "neck_01",
                            lambda co: 0.022, mats["mail"], decimate=0.28, smoothing=2)
    mail_skirt, _ = skirt(body, dom, skeleton, "mail_skirt", hip_z + 0.02, knee_z + 0.01, 0.03, mats["mail"], flare=0.03)
    def is_face_inner(i):
        c = body.data.vertices[i].co
        return is_face(i) and abs(c.x) < FACE_HALF_WIDTH - 0.016 and c.z < brow_z - 0.016 and c.z > chin_z + 0.012

    coif = surface_layer(body, "coif", lambda i: dom[i] == "neck_01" or (dom[i] == "head" and not is_face_inner(i)),
                         lambda co: 0.012, mats["mail"], decimate=0.32, smoothing=1)
    # The coif stands 12 mm off the head, so round the face opening there is a gap between it and the skin
    # (only the face is left of the body's skin). Seen from below, the inside of the head showed through it.
    # A plain skin lining under the coif closes the head.
    lining = surface_layer(body, "head_lining", lambda i: dom[i] in ("head", "neck_01") and not is_face_inner(i),
                           lambda co: -0.004, mats["skin"], decimate=0.1)
    # Surcoat over the mail: sleeveless body and a longer, fuller skirt to mid-calf.
    surcoat = surface_layer(body, "surcoat", lambda i: dom[i] in TORSO_BONES, lambda co: 0.036, mats["cloth"], decimate=0.32,
                            smoothing=3, edge_smoothing=12)
    coat_skirt, _ = skirt(body, dom, skeleton, "coat_skirt", hip_z + 0.06, knee_z - 0.12, 0.05, mats["cloth"], flare=0.1)
    hose = surface_layer(body, "hose", lambda i: dom[i] in LEG_BONES, lambda co: 0.006, mats["hose"], decimate=0.2)
    shoes = surface_layer(body, "shoes", lambda i: dom[i] in FOOT_BONES, lambda co: 0.014, mats["leather"], decimate=0.12)
    # Test-only shapes for check_soldier: the body's torso, head and forearms, shrunk a little inside the
    # skin, so anything that enters them is inside the man. Removed before export.
    cores = {
        "torso": surface_layer(body, "core_torso", lambda i: dom[i] in TORSO_BONES, lambda co: -0.015, mats["skin"], decimate=0.3),
        "head": surface_layer(body, "core_head", lambda i: dom[i] == "head", lambda co: -0.01, mats["skin"], decimate=0.3),
        "forearm_l": surface_layer(body, "core_forearm_l", lambda i: dom[i] == "lowerarm_l", lambda co: -0.005, mats["skin"], decimate=0.5),
        "forearm_r": surface_layer(body, "core_forearm_r", lambda i: dom[i] == "lowerarm_r", lambda co: -0.005, mats["skin"], decimate=0.5),
    }
    # Only the face of the body stays visible; the hands are in mail mittens (below).
    remove_faces(body, lambda i: not is_face(i))
    body.data.materials.clear()
    body.data.materials.append(mats["skin"])
    for part in (hauberk, mail_skirt, coif):
        box_uvs(part, 0.18)
    for part in (coat_skirt, hose, shoes):
        box_uvs(part, 0.3)

    # Belt where the surcoat's skirt starts (it also hides that seam). The cloth under it is measured as it is
    # drawn (after decimation), in every direction round the waist, and the belt sits 2.5 mm outside it there:
    # an ellipse fitted to the widest points cut into the cloth wherever the waist is not an ellipse.
    belt_z = hip_z + 0.06
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    # (tree, how far out to start the rays: the mail's sleeves hang beside the waist, the skirts flare wide)
    cloth = [(BVHTree.FromObject(o, depsgraph), start) for o, start in
             ((surcoat, 0.6), (coat_skirt, 0.6), (hauberk, 0.3), (mail_skirt, 0.6))]
    band = [o.matrix_world @ v.co for o in (surcoat,) for v in o.data.vertices if abs(v.co.z - belt_z) < 0.03]
    cy = (min(c.y for c in band) + max(c.y for c in band)) / 2

    def polar(c):
        return math.atan2(c.x, -(c.y - cy)), math.hypot(c.x, c.y - cy)

    def cloth_radius(a, z, half_angle, half_z):
        """How far out the cloth's surface reaches round the centre line, in the directions a +- half_angle
        (0 is the front, + the left) and at heights z +- half_z: rays shot in from outside. (Its vertices are
        not enough: a long triangle from the wider chest or hips crosses the waist further out than any.)"""
        best = 0.0
        for da in (-1, -0.5, 0, 0.5, 1):
            for dz in (-1, 0, 1):
                b = a + da * half_angle
                inward = Vector((-math.sin(b), math.cos(b), 0))
                for tree, far in cloth:
                    start = Vector((far * math.sin(b), cy - far * math.cos(b), z + dz * half_z))
                    hit = tree.ray_cast(start, inward, far)
                    if hit[0] is not None:
                        best = max(best, far - hit[3])
        return best

    def round_waist(a, r, z):
        return Vector((r * math.sin(a), cy - r * math.cos(a), z))

    segments, rings = 36, [belt_z - 0.022, belt_z - 0.011, belt_z, belt_z + 0.011, belt_z + 0.022]
    step = 2 * math.pi / segments
    belt_bm = bmesh.new()
    belt_rings = []
    for z in rings:
        belt_rings.append([belt_bm.verts.new(round_waist(i * step, cloth_radius(i * step, z, step, 0.008) + 0.0025, z))
                           for i in range(segments)])
    for a, b in zip(belt_rings, belt_rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            belt_bm.faces.new((a[i], a[j], b[j], b[i]))
    belt = rigid(mesh_obj("belt", belt_bm, mats["leather"]), skeleton, "pelvis")
    front_r = max(polar(v.co)[1] for v in belt.data.vertices if abs(polar(v.co)[0]) < step)
    by0 = cy - front_r
    buckle_bm = bmesh.new()
    bmesh.ops.create_cube(buckle_bm, size=1.0)
    for v in buckle_bm.verts:
        v.co = Vector((v.co.x * 0.05, v.co.y * 0.01, v.co.z * 0.045)) + Vector((0, by0 - 0.004, belt_z))
    buckle = rigid(mesh_obj("buckle", buckle_bm, mats["steel"], smooth=False), skeleton, "pelvis")

    # Scabbard hanging from the front-left of the belt, hilt forward, angled back (as swords were worn), its
    # flat side along the body and outside the skirt all the way down: by its own half thickness plus 2 mm at
    # the belt, growing to 2 cm more at the tip (the hem swings with the legs).
    angle = math.radians(52)
    out = Vector((math.sin(angle), -math.cos(angle), 0))
    belt_tree = BVHTree.FromPolygons([v.co for v in belt.data.vertices], [p.vertices for p in belt.data.polygons])

    def belt_here(z):
        """The belt's outside in that direction, at height z."""
        z = min(max(z, belt_z - 0.018), belt_z + 0.018)
        return 0.3 - belt_tree.ray_cast(round_waist(angle, 0.3, z), -out, 0.3)[3]

    hip = round_waist(angle, belt_here(belt_z - 0.015) + 0.016, belt_z - 0.015)
    along = Vector((math.cos(angle), math.sin(angle), 0))   # round the waist, towards the back
    # Tilted out from hanging straight (down and a little back) only as far as it must be.
    hang = Vector((0.0, 0.3, -0.95)).normalized()

    def clear(tip):
        for k in (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
            point = hip.lerp(tip, k)
            a, r = polar(point)
            if cloth_radius(a, point.z, step / 2, 0.015) + 0.014 + 0.02 * k > r:
                return False
        return True

    low, high = 0.0, 1.5
    for _ in range(24):
        tilt = (low + high) / 2
        if clear(hip + (hang + out * tilt).normalized() * 0.84):
            high = tilt
        else:
            low = tilt
    tip = hip + (hang + out * high).normalized() * 0.84
    up = (hip - tip).normalized()
    scab = bmesh.new()
    bmesh.ops.create_cone(scab, cap_ends=True, segments=10, radius1=0.02, radius2=0.026, depth=(tip - hip).length)
    for v in scab.verts:
        v.co.y *= 0.45
    scabbard = mesh_obj("scabbard", scab, mats["leather"])
    # Flat side against the hip: thin out from the body, wide along it.
    scabbard.data.transform(Matrix.Translation((hip + tip) / 2) @ frame(up, along))
    add_scabbard_bone(skeleton, hip, up)
    rigid(scabbard, skeleton, "scabbard")
    # The strap it hangs by: down the outside of the belt and over the scabbard's mouth.
    strap_bm = bmesh.new()
    bmesh.ops.create_cube(strap_bm, size=1.0)
    for v in strap_bm.verts:
        z = belt_z + v.co.z * 0.052
        v.co = round_waist(angle, belt_here(z) + 0.003 + v.co.x * 0.008, z) + along * v.co.y * 0.022
    strap = rigid(mesh_obj("scabbard_strap", strap_bm, mats["leather"], smooth=False), skeleton, "pelvis")
    # The sword in it: crossguard at the scabbard's mouth, blade down inside. It rides on its own bone, so the
    # draw animation can hide it at the moment the hand takes it.
    sheathed = sword(mats, "sheathed")
    for part in sheathed:
        # Crossguard along the body, so it does not stick into the skirt or out from the hip.
        part.data.transform(Matrix.Translation(hip) @ frame(-up, along))
        rigid(part, skeleton, "prop_sheath")
    SHEATH["grip"] = hip + up * 0.06
    # A point in front of the belly that the right hand passes on its way to the hilt (draw_pose).
    SHEATH["front"] = Vector((0.04, by0 - 0.13, belt_z + 0.1))
    SHEATH["up"] = up.copy()

    # Eyes: a white ball with a dark iris looking ahead, in each eye socket.
    eyes = []
    for side in ("l", "r"):
        c = Vector(skeleton[f"eye_{side}"])
        # Eyeball, iris, and a dark socket behind them: the skin's eye opening is wider than the ball at its
        # inner corner, and without it the inside of the head shows there.
        for radius, offset, mat in ((0.0125, 0.0, mats["eye"]), (0.0062, -0.0095, mats["iris"]),
                                    (0.022, 0.012, mats["iris"])):
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=radius)
            o = mesh_obj("eye", bm, mat)
            o.data.transform(Matrix.Translation(c + Vector((0, offset, 0))))
            eyes.append(rigid(o, skeleton, "head"))

    # The faction cross is painted into the surcoat's own texture, front and back, so it moves with the cloth.
    chest = skeleton.data.bones["spine_03"].head_local
    paint_tabard(surcoat, f, chest.z)

    coif_band = [v.co for v in coif.data.vertices if abs(v.co.z - brow_z) < 0.03]
    coif_r = max(max(abs(c.x) for c in coif_band), (max(c.y for c in coif_band) - min(c.y for c in coif_band)) / 2 / 1.08)
    coif_cy = (max(c.y for c in coif_band) + min(c.y for c in coif_band)) / 2
    helm_parts = [rigid(p, skeleton, "head") for p in
                  italo_norman_helm(Vector((0, coif_cy, brow_z)), coif_r + 0.006, mats["steel"])]

    # Shield on the left forearm, facing forward in the stance; spear upright in the right fist.
    stance(skeleton)
    bpy.context.view_layer.update()
    fore = skeleton.pose.bones["lowerarm_l"]
    mid = (fore.head + fore.tail) / 2
    shield_parts = kite_shield(f, mats["dark_wood"])
    for part in shield_parts:
        part.data.transform(Matrix.Translation(mid + Vector((-0.04, -0.17, 0.02))) @ Matrix.Rotation(math.radians(-6), 4, "Z"))
    fists = {}
    for side in ("l", "r"):
        hand = skeleton.pose.bones[f"hand_{side}"]
        fists[side] = hand.head + Vector(hand.matrix.col[1][:3]) * 0.065
    spear_parts = spear(mats["wood"], mats["steel"])
    for part in spear_parts:
        part.data.transform(Matrix.Translation(fists["r"] + Vector((0, 0, 0.55))))
    # The sword for the hand, upright in the fist like the spear (grip centred on the fist).
    held = sword(mats, "held")
    for part in held:
        part.data.transform(Matrix.Translation(fists["r"] + Vector((0, 0, 0.06))))
    mittens = []
    for side in ("l", "r"):
        hand = skeleton.pose.bones[f"hand_{side}"]
        bone = skeleton.data.bones[f"lowerarm_{side}"]
        elbow, wrist = bone.head_local, bone.tail_local
        axis = (wrist - elbow).normalized()
        length = (wrist - elbow).length
        along = [(v.co - elbow).dot(axis) for v in hauberk.data.vertices
                 if ((v.co - elbow) - axis * (v.co - elbow).dot(axis)).length < 0.07 and length * 0.5 < (v.co - elbow).dot(axis) < length + 0.06]
        sleeve_short = length - max(along)          # how far before the wrist the sleeve ends
        half = 0.065
        centre = half - sleeve_short - 0.035        # from the wrist, along the hand: 3.5 cm inside the sleeve
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.05, v.co.y * half, v.co.z * 0.054))
        mitten = mesh_obj(f"mitten_{side}", bm, mats["mail"])
        direction = Vector(hand.matrix.col[1][:3])
        mitten.data.transform(Matrix.Translation(hand.head + direction * centre) @ Vector((0, 1, 0)).rotation_difference(direction).to_matrix().to_4x4())
        mittens.append((mitten, f"hand_{side}"))
    # The shield stands clear (8 mm) in front of the hand that holds it: its edges curve back, so a hand
    # towards an edge needs the shield further forward.
    shield_at = Matrix.Translation(mid + Vector((-0.04, -0.17, 0.02))) @ Matrix.Rotation(math.radians(-6), 4, "Z")
    to_local = shield_at.inverted()
    push = 0.0
    for v in mittens[0][0].data.vertices:
        q = to_local @ v.co
        if abs(q.x) < 0.29 and -0.67 < q.z < 0.45:
            back = 0.07 * (q.x / 0.27) ** 2 + 0.02 + 0.008
            push = max(push, back - q.y)
    for part in shield_parts:
        part.data.transform(Matrix.Translation(shield_at @ Vector((0, -push, 0)) - shield_at @ Vector((0, 0, 0))))
    reset_pose(skeleton)
    for part in shield_parts:
        bind(part, skeleton, "lowerarm_l", stance)
    for part in spear_parts:
        bind(part, skeleton, "prop_spear", stance)
    for part in held:
        bind(part, skeleton, "prop_sword", stance)
    for mitten, bone in mittens:
        # The shield hand grips the shield's strap: it moves with the forearm, as the shield does.
        bind(mitten, skeleton, "lowerarm_l" if bone == "hand_l" else bone, stance)
    # Remember the spear's axis in the right hand's frame, for point_spear().
    stance(skeleton)
    bpy.context.view_layer.update()
    SPEAR_AXIS["local"] = (skeleton.pose.bones["hand_r"].matrix.to_3x3().inverted() @ Vector((0, 0, 1))).normalized()
    reset_pose(skeleton)
    for part in spear_parts + held + sheathed + helm_parts + [m for m, _ in mittens] + [belt, buckle, scabbard, strap] + shield_parts[:1] + shield_parts[2:]:
        box_uvs(part, 0.3)
    mitten = {bone[-1]: m for m, bone in mittens}
    CHECK_PARTS.clear()
    CHECK_PARTS.update({
        "torso": [cores["torso"]], "head": [cores["head"]],
        "forearm_l": [cores["forearm_l"]], "forearm_r": [cores["forearm_r"]],
        "forearm_sleeve_l": [hauberk], "forearm_sleeve_r": [hauberk],
        "mitten_l": [mitten["l"]], "mitten_r": [mitten["r"]],
        "spear": spear_parts, "sword": held, "sheathed": sheathed,
        "shield": shield_parts, "shield_face": [shield_parts[1]], "boss": [shield_parts[2]],
        "scabbard": [scabbard, strap], "belt": [belt], "surcoat": [surcoat], "coat_skirt": [coat_skirt],
        "surcoat_or_skirt": [surcoat, coat_skirt],
    })
    return body, skeleton


# Parts handed to check_soldier (name -> objects), filled by infantry().
CHECK_PARTS = {}


# ---------------------------------------------------------------------------------------------------------

def material_color(mat):
    """The average colour of a material: its texture's mean, or its base colour."""
    nodes = mat.node_tree.nodes
    for node in nodes:
        if node.type == "TEX_IMAGE" and node.image is not None:
            px = np.empty(len(node.image.pixels), dtype=np.float32)
            node.image.pixels.foreach_get(px)
            return tuple(px.reshape(-1, 4)[:, :3].mean(axis=0))
    return tuple(nodes.get("Principled BSDF").inputs["Base Color"].default_value[:3])


def single_material(obj):
    """Far away the textures cannot be seen: give each face its material's average colour as a vertex colour
    and draw the whole soldier with one material (one draw call instead of one per material)."""
    colors = [material_color(m) for m in obj.data.materials]
    attr = obj.data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for poly in obj.data.polygons:
        rgba = (*colors[poly.material_index], 1.0)
        for li in poly.loop_indices:
            attr.data[li].color = rgba
        poly.material_index = 0
    mat = bpy.data.materials.new("far")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    node = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    node.layer_name = "Color"
    mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.75
    obj.data.materials.clear()
    obj.data.materials.append(mat)


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
        swing_scabbard(skeleton)
        bpy.context.view_layer.update()
        for pb in skeleton.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame + 1)
            if pb.name == "Root":
                pb.keyframe_insert("location", frame=frame + 1)
            if pb.name in PROP_BONES:
                pb.keyframe_insert("scale", frame=frame + 1)
    skeleton.animation_data.action = None
    return action


def animate(skeleton):
    # A key on every frame (30 a second): the motions are curves, not straight lines between few keys.
    actions = [
        bake_action(skeleton, "idle", 4.0, idle_pose, loop=True, step=1),
        bake_action(skeleton, "walk", 1.0, walk_pose, loop=True, step=1),
        bake_action(skeleton, "attack", 0.8, attack_pose, step=1),
        bake_action(skeleton, "block", 0.35, block_pose, step=1),
        bake_action(skeleton, "death", 1.4, death_pose, step=1),
        # The same man with sword and shield.
        bake_action(skeleton, "s_idle", 4.0, lambda s, t: idle_pose(s, t, sword=True), loop=True, step=1),
        bake_action(skeleton, "s_walk", 1.0, lambda s, t: walk_pose(s, t, sword=True), loop=True, step=1),
        bake_action(skeleton, "s_attack", 0.9, slash_pose, step=1),
        bake_action(skeleton, "s_block", 0.35, lambda s, t: block_pose(s, t, sword=True), step=1),
        bake_action(skeleton, "s_death", 1.4, lambda s, t: death_pose(s, t, sword=True), step=1),
        bake_action(skeleton, "draw", 1.3, draw_pose, step=1),
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
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    allow = "--allow-problems" in sys.argv
    failed = False
    for side in (args or ["ally", "enemy"]):
        body, skeleton = infantry(zf, FACTIONS[side])
        # Apply the decimation now, before skinning is exported.
        for obj in list(bpy.data.objects):
            if obj.type == "MESH":
                bpy.context.view_layer.objects.active = obj
                for mod in list(obj.modifiers):
                    if mod.type == "DECIMATE":
                        bpy.ops.object.modifier_apply(modifier=mod.name)
        animate(skeleton)
        report = os.path.join(mh.CACHE, f"check_{side}.json")
        problems = check_soldier.check(skeleton, CHECK_PARTS, [t.strips[0].action for t in skeleton.animation_data.nla_tracks],
                                       report, SPEAR_AXIS["local"], side)
        for p in problems:
            print(f"CHECK {side}: {p}")
        print(f"CHECK {side}: {len(problems)} problem(s), report {report}")
        failed = failed or bool(problems)
        # The test-only shapes are not part of the soldier.
        for name in ("core_torso", "core_head", "core_forearm_l", "core_forearm_r"):
            bpy.data.objects.remove(bpy.data.objects[name])
        # One mesh per soldier: fewer objects to draw (one draw call per material).
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        soldier = bpy.context.view_layer.objects.active
        soldier.name = soldier.data.name = "soldier"
        # A simpler copy for soldiers far from the camera (about a fifth of the triangles), on the same
        # skeleton, so the renderer can switch between them by distance.
        far = soldier.copy()
        far.data = soldier.data.copy()
        far.name = far.data.name = "soldier_far"
        bpy.context.collection.objects.link(far)
        bpy.context.view_layer.objects.active = far
        mod = far.modifiers.new("decimate", "DECIMATE")
        mod.ratio = 0.13
        far.modifiers.move(len(far.modifiers) - 1, 0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        single_material(far)
        tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH"}
        path = os.path.join(OUT, f"infantry_{side}.glb")
        export(path)
        print(f"{os.path.basename(path)}: {tris} triangles, {os.path.getsize(path)} bytes, {len(bpy.data.actions)} actions")
    if failed and not allow:
        sys.exit("check_soldier found problems (see the CHECK lines); rebuild with --allow-problems to export anyway")


if __name__ == "__main__":
    main()
