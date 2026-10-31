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
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_human as bh  # noqa: E402
import check_soldier  # noqa: E402
import slim_glb  # noqa: E402
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


def pin_band(obj, z, half, fade, bone, only=TORSO_BONES | LEG_BONES):
    """Move the skin weights of obj's vertices within half of height z (fading out over fade beyond) onto
    bone, so that band moves with that bone alone. Only vertices of the body itself (moved by the bones in
    only): a sleeve's end hangs at the same height, and pinned to the hips it was drawn out into a spike
    when the arm moved."""
    pin = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
    names = {g.index: g.name for g in obj.vertex_groups}
    for v in obj.data.vertices:
        k = 1 - smooth(clamp01((abs((obj.matrix_world @ v.co).z - z) - half) / fade))
        if k <= 0 or any(ge.weight > 1e-3 and names[ge.group] not in only for ge in v.groups):
            continue
        weights = [(ge.group, ge.weight) for ge in v.groups]
        total = sum(w for _, w in weights)
        kept = 0.0
        for group, w in weights:
            if group != pin.index:
                obj.vertex_groups[group].add([v.index], w * (1 - k), "REPLACE")
            else:
                kept = w
        pin.add([v.index], kept * (1 - k) + k * total, "REPLACE")


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


def point_spear(skeleton, direction, edge=None, edge_weight=0.0, slack=None):
    """Point the weapon in the right fist along direction (armature space), by turning the forearm and the
    wrist only as far as a man's can (see grip()); a sword's edge leading towards edge, if given."""
    grip(skeleton, "r", direction, edge=edge, edge_weight=edge_weight, slack=slack)


# Arms. An elbow is a hinge, a forearm turns about its own length (palm up, palm down) and a wrist bends
# but does not twist: posed any other way (turning each bone the shortest way to a direction, as aim()
# does), elbows bent sideways and wrists twisted further than a man's go. The arm is set from the shoulder,
# elbow and wrist points: the upper arm turns so that the elbow bends about its hinge, the forearm turns
# about itself by `twist`, and the hand bends at the wrist by `flex` (palm-ward +) and `dev` (sideways).
TWIST_LIMIT, FLEX_LIMIT, DEV_LIMIT = 85, 65, 30
_ARM = {}


def _frame(x, y, z, at):
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = at
    return m


def arm_rest(skeleton, side):
    """What the rest pose says about one arm: which way its elbow bends, how its forearm and hand sit."""
    if side not in _ARM:
        bones = skeleton.data.bones
        upper, lower, hand = (bones[f"{b}_{side}"].matrix_local.to_3x3() for b in ("upperarm", "lowerarm", "hand"))
        yu, yf = upper.col[1].normalized(), lower.col[1].normalized()
        hinge = yu.cross(yf).normalized()
        sign = 1 if hinge.dot(upper.col[0]) > 0 else -1
        hinge *= sign
        # How far the forearm sits turned from the hinge at rest, about its own length.
        x0 = (lower.col[0] - yf * lower.col[0].dot(yf)).normalized()
        twist0 = math.degrees(hinge.angle(x0)) * (1 if hinge.cross(x0).dot(yf) > 0 else -1)
        knuckles = (hand.inverted() @ (bones[f"index_01_{side}"].head_local - bones[f"pinky_01_{side}"].head_local)).normalized()
        palm = knuckles.cross(Vector((0, 1, 0))).normalized()
        _ARM[side] = dict(sign=sign, twist0=twist0, fore_hand=lower.inverted() @ hand, knuckles=knuckles, palm=palm,
                          upper=bones[f"upperarm_{side}"].length, lower=bones[f"lowerarm_{side}"].length)
    return _ARM[side]


def _wrist(r, flex, dev):
    return (Matrix.Rotation(math.radians(flex), 3, r["knuckles"]) @ Matrix.Rotation(math.radians(dev), 3, r["palm"]))


def _forearm(r, hinge, fore, twist):
    x = Quaternion(fore, math.radians(r["twist0"] + twist)) @ hinge
    x = (x - fore * x.dot(fore)).normalized()
    return Matrix((x, fore, x.cross(fore))).transposed()


def set_arm(skeleton, side, elbow, wrist, twist=0.0, flex=0.0, dev=0.0):
    """Pose one arm through the elbow and wrist points (armature space), as a man's arm bends."""
    r = arm_rest(skeleton, side)
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    upper, lower, hand = (pb[f"{b}_{side}"] for b in ("upperarm", "lowerarm", "hand"))
    shoulder = upper.head.copy()
    yu = (Vector(elbow) - shoulder).normalized()
    fore = (Vector(wrist) - Vector(elbow)).normalized()
    hinge = yu.cross(fore)
    if hinge.length < 0.05:   # (nearly) straight: keep the hinge it had
        hinge = Vector(upper.matrix.col[0][:3])
        hinge = (hinge - yu * hinge.dot(yu)).normalized()
    else:
        hinge = hinge.normalized() * r["sign"]
    upper.matrix = _frame(hinge, yu, hinge.cross(yu), shoulder)
    bpy.context.view_layer.update()
    fore_frame = _forearm(r, hinge, fore, twist)
    lower.matrix = _frame(fore_frame.col[0], fore_frame.col[1], fore_frame.col[2], lower.head.copy())
    bpy.context.view_layer.update()
    h = fore_frame @ r["fore_hand"] @ _wrist(r, flex, dev)
    hand.matrix = _frame(h.col[0], h.col[1], h.col[2], hand.head.copy())
    bpy.context.view_layer.update()
    return hinge


def arm(skeleton, side, upper_dir, fore_dir, twist=0.0, flex=0.0, dev=0.0):
    """Pose one arm by the directions of the upper arm and the forearm."""
    r = arm_rest(skeleton, side)
    bpy.context.view_layer.update()
    shoulder = skeleton.pose.bones[f"upperarm_{side}"].head.copy()
    elbow = shoulder + Vector(upper_dir).normalized() * r["upper"]
    set_arm(skeleton, side, elbow, elbow + Vector(fore_dir).normalized() * r["lower"], twist, flex, dev)


def arm_points(skeleton, side):
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    return pb[f"lowerarm_{side}"].head.copy(), pb[f"lowerarm_{side}"].tail.copy()


GRIP_AXIS = {}   # side -> the weapon's axis in that hand's frame (set when the weapons are bound)


def _grid(r, axis, edge_axis=None):
    """The weapon's direction (and its edge's, if given) in the untwisted forearm's frame for each wrist
    bend in reach, leaving out bends that would twist the wrist itself (a bend both palm-ward and sideways
    turns it a little)."""
    key = (id(r), tuple(round(c, 6) for c in axis), edge_axis is not None and tuple(round(c, 6) for c in edge_axis))
    if key not in _GRIDS:
        out = []
        for flex in range(-FLEX_LIMIT, FLEX_LIMIT + 1, 5):
            for dev in range(-DEV_LIMIT, DEV_LIMIT + 1, 5):
                w = _wrist(r, flex, dev).to_quaternion()
                if abs(math.degrees(2 * math.atan2(w.y, w.w))) > WRIST_TWIST_LIMIT:
                    continue
                m = r["fore_hand"] @ _wrist(r, flex, dev)
                out.append((flex, dev, m @ axis, m @ edge_axis if edge_axis is not None else None))
        _GRIDS[key] = out
    return _GRIDS[key]


_GRIDS = {}
WRIST_TWIST_LIMIT = 10
# The sword's edge (its width) in the right hand's frame, measured when the swords are bound (see infantry()).
EDGE_AXIS = {"local": None, "world": None}
EDGE_WEIGHT = 1.0   # in a cut, how many degrees of the blade's aim one degree of its edge's is worth
EDGE_AIM_SLACK = 8   # degrees: how much worse than its best aim a sword may point to bring its edge round


def _grid_arrays(r, axis, edge_axis):
    key = ("np", id(r), tuple(round(c, 6) for c in axis), edge_axis is not None and tuple(round(c, 6) for c in edge_axis))
    if key not in _GRIDS:
        g = _grid(r, axis, edge_axis)
        _GRIDS[key] = (np.array([[f, d] for f, d, _, _ in g], dtype=float), np.array([tuple(v) for _, _, v, _ in g]),
                       np.array([tuple(e) for _, _, _, e in g]) if edge_axis is not None else None)
    return _GRIDS[key]


def _best_grip(r, hinge, fore, axis, direction, edge=None, edge_weight=0.0, edge_axis=None, slack=EDGE_AIM_SLACK,
               signed=False):
    """edge: the way the blade moves (armature space): either edge should lead into it, the more so the
    larger edge_weight (degrees of the weapon's aim one degree of the edge's is worth)."""
    to_fore = _forearm(r, hinge, fore, 0.0).inverted()
    want = np.array(tuple(to_fore @ direction))
    use_edge = edge is not None and edge_weight > 0
    bends, v, ev = _grid_arrays(r, axis, edge_axis if use_edge else None)
    # The forearm's turn about its own length (its Y) that brings each v nearest want.
    tw = np.degrees(np.arctan2(v[:, 2] * want[0] - v[:, 0] * want[2], v[:, 0] * want[0] + v[:, 2] * want[2]))
    tw = np.clip(tw, -TWIST_LIMIT, TWIST_LIMIT)
    c, s_ = np.cos(np.radians(tw)), np.sin(np.radians(tw))

    def spin(a):
        return np.stack((a[:, 0] * c + a[:, 2] * s_, a[:, 1], -a[:, 0] * s_ + a[:, 2] * c), axis=1)

    got = spin(v)
    got /= np.linalg.norm(got, axis=1)[:, None]
    off = np.degrees(np.arccos(np.clip(got @ want / np.linalg.norm(want), -1, 1)))
    score = off + 0.03 * (np.abs(bends[:, 0]) + 2 * np.abs(bends[:, 1]) + 0.5 * np.abs(tw))
    lead = np.zeros(len(tw))
    if use_edge:
        want_e = np.array(tuple(to_fore @ edge))
        e = spin(ev)
        e -= got * np.sum(e * got, axis=1)[:, None]
        m = want_e[None, :] - got * (got @ want_e)[:, None]
        ne, nm = np.linalg.norm(e, axis=1), np.linalg.norm(m, axis=1)
        ok = (ne > 1e-6) & (nm > 1e-6)
        cos = np.sum(e * m, axis=1) / np.where(ok, ne * nm, 1.0)
        cos = cos if signed else np.abs(cos)   # (a sword has two edges; a crossbow one top)
        lead = np.where(ok, np.degrees(np.arccos(np.clip(cos, -1, 1))), 0.0)
        score = score + edge_weight * lead
    if use_edge:
        # The edge may only cost the aim a few degrees more than the best aim there is.
        score = np.where(off <= off.min() + slack, score, np.inf)
    i = int(np.argmin(score))
    return (float(score[i]), float(off[i]), float(tw[i]), float(bends[i, 0]), float(bends[i, 1]), float(lead[i]))


def grip(skeleton, side, direction, swivel=60, edge=None, edge_weight=0.0, slack=None, edge_axis=None, signed=False,
         axis=None):
    """Turn the forearm about itself and bend the wrist, within a man's reach, so the weapon in that hand
    points as nearly along direction as it can; if that is not near enough, also swing the elbow round
    (up to swivel degrees, the wrist staying where it is). With edge (a sword in the right hand: the way
    the blade is moving), also turn it so its edge, not its flat, goes first. Returns how far off it stays
    (degrees)."""
    r = arm_rest(skeleton, side)
    axis = axis if axis is not None else GRIP_AXIS.get(side)
    if axis is None:
        return 0.0
    if edge_axis is None:
        edge_axis = EDGE_AXIS["local"] if side == "r" else None
    slack = EDGE_AIM_SLACK if slack is None else slack
    if edge is None or edge_axis is None or Vector(edge).length < 1e-6:
        edge, edge_weight = None, 0.0
    else:
        edge = Vector(edge).normalized()
    elbow, wrist = arm_points(skeleton, side)
    shoulder = skeleton.pose.bones[f"upperarm_{side}"].head.copy()
    direction = Vector(direction).normalized()
    along = (wrist - shoulder).normalized()
    tried = []
    for turn_by in sorted(range(-swivel, swivel + 1, 10), key=abs):
        e = shoulder + Quaternion(along, math.radians(turn_by)) @ (elbow - shoulder)
        fore = (wrist - e).normalized()
        hinge = (e - shoulder).normalized().cross(fore)
        if hinge.length < 0.05:
            continue
        hinge = hinge.normalized() * r["sign"]
        found = _best_grip(r, hinge, fore, axis, direction, edge, edge_weight, edge_axis, slack, signed)
        tried.append((found[0] + 0.15 * abs(turn_by), e, found))
        if found[1] < 4 and found[5] < 10:
            break
    # (with an edge to bring round, only among the elbows that aim the blade nearly as well as the best)
    least = min(found[1] for _, _, found in tried)
    best = min((x for x in tried if x[2][1] <= least + (slack if edge is not None else 1e9)), key=lambda x: x[0])
    _, e, (_, off, tw, flex, dev, _) = best
    set_arm(skeleton, side, e, wrist, tw, flex, dev)
    return off


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
PROP_BONES = {"prop_spear": "hand_r", "prop_sword": "hand_r", "prop_sheath": "pelvis", "prop_shield": "lowerarm_l",
              "prop_great": "hand_r", "prop_xbow": "Root", "prop_bolt": "prop_xbow", "prop_quiver": "pelvis",
              "prop_bolt_hand": "hand_r"}
HIDDEN = 1e-4
# The crossbow is not on a hand's bone: in the reload it stands in its stirrup on the ground while both hands
# pull the string. Its bone hangs from Root and is set where the right hand holds it every frame
# (carry_crossbow()), except while a pose has let go of it (CARRY["free"]); it is keyed by position too.
CARRY = {"free": False}
KEYED_LOCATION = {"Root", "prop_xbow"}
NOCK = "xbow_nock"   # the middle of the string: scaled along the stock from the prod (loose) to the nut (spanned)


def add_prop_bones(skeleton):
    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    bones = skeleton.data.edit_bones
    for name, parent in PROP_BONES.items():
        b = bones.new(name)
        like = bones["hand_r"] if name in ("prop_xbow", "prop_bolt") else bones[parent]
        b.head, b.tail, b.roll = like.head.copy(), like.tail.copy(), like.roll
        b.parent = bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(skeleton)


def show(skeleton, spear=True, sword=False, sheathed=True, shield=True, great=False, crossbow=False, loaded=True):
    for name, on in (("prop_spear", spear), ("prop_sword", sword), ("prop_sheath", sheathed), ("prop_shield", shield),
                     ("prop_great", great), ("prop_xbow", crossbow), ("prop_bolt", loaded), ("prop_quiver", crossbow),
                     ("prop_bolt_hand", False)):
        k = 1.0 if on else HIDDEN
        skeleton.pose.bones[name].scale = (k, k, k)
    if NOCK in skeleton.pose.bones:
        span_string(skeleton, 1.0 if loaded else 0.0)


def span_string(skeleton, k):
    """The string's middle from loose at the prod (0) to caught on the nut (1)."""
    s = STRING_LOOSE + (1 - STRING_LOOSE) * k
    skeleton.pose.bones[NOCK].scale = (1, s, 1)


STRING_LOOSE = 0.04


def carry_crossbow(skeleton):
    """The crossbow where the right fist holds it (as bound), unless a pose has let go of it."""
    if CARRY["free"] or "prop_xbow" not in skeleton.pose.bones:
        return
    bpy.context.view_layer.update()
    pb, bones = skeleton.pose.bones, skeleton.data.bones
    held = bones["hand_r"].matrix_local.inverted() @ bones["prop_xbow"].matrix_local
    scale = pb["prop_xbow"].scale.copy()
    pb["prop_xbow"].matrix = pb["hand_r"].matrix @ held
    pb["prop_xbow"].scale = scale
    bpy.context.view_layer.update()


def add_hanger_bone(skeleton, name, top, up, prop):
    """A bone at the top of something hung from the belt (child of the pelvis: the scabbard, the bolt case);
    the prop's bone hangs from it. It swings, with its weight (WEIGHT[name]), on the skirt panel it hangs over
    (see push_skirts()): a knee that pushes the skirt out pushes it too."""
    coat = SKIRTS["skirt"]
    centre = Vector((coat["rings"][0][1], coat["rings"][0][2], 0))
    out = Vector((top.x, top.y, 0)) - centre
    coat.setdefault("hangers", {})[name] = max(range(PANELS), key=lambda j: out.normalized().dot(_panel_dir(j)))
    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    bones = skeleton.data.edit_bones
    b = bones.new(name)
    b.head, b.tail = top, top - up * 0.2
    b.parent = bones["pelvis"]
    bones[prop].parent = b
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(skeleton)


# Skirts. The coat's skirt, with the mail skirt lined under it, hangs from twelve panels round the hips,
# each in two parts (to the middle, and on to the hem), each part on its own bone. Frame by frame
# (push_skirts()), a panel is pushed out as far as the legs under it need, stopped or pressed in where
# something outside it touches it (the shield, the spear's butt, a hand), and between those it swings with
# its own weight: the body's movement throws it, it falls back and settles; the upper part, mail under
# wool, slowly and heavily, the lower part, wool alone, quickly and with a flutter. Nothing goes through a
# skirt; it gives way.
PANELS = 16
SKIRT_MARGIN = 0.02   # the cloth keeps this far (m) outside a leg
# How each one swings: its own frequency (Hz), how quickly a swing dies away (damping ratio), how strongly
# the body's movement throws it, and how stiffly a panel holds to its neighbours.
WEIGHT = {
    "lined": dict(hz=1.25, damping=0.55, throw=0.6, bind=9.0),     # the upper panels, mail under the wool: heavy,
                                                                   # slow, little bounce
    "cloth": dict(hz=1.9, damping=0.22, throw=1.0, bind=6.0),      # below the mail's hem, wool alone: light,
                                                                   # flutters, settles quickly
    "scabbard": dict(hz=1.4, damping=0.6, throw=0.6),              # a sword's weight hanging from the belt: it
                                                                   # swings slowly and does not bounce
    "quiver": dict(hz=1.7, damping=0.5, throw=0.7),                # a case of bolts: lighter, swings a little more
}
SKIRTS = {}   # bone prefix ("skirt" for the coat, "mail") -> rings, heights, what pushes it, ...


FOLDS = 14   # soft vertical folds round a skirt


def _panel_angle(j):
    return 2 * math.pi * (j + 0.5) / PANELS


def _panel_dir(j):
    a = _panel_angle(j)
    return Vector((math.cos(a), math.sin(a), 0))


def panel_half(j):
    """Which half of a slit skirt a panel is in: "right" (from the seam behind, at 90 degrees, round his right
    side to the seam in front, at 270) or "left"."""
    a = _panel_angle(j)
    return "right" if math.pi / 2 <= a <= 3 * math.pi / 2 else "left"


def _prop_hidden(skeleton, obj):
    for g in obj.vertex_groups:
        if g.name.startswith("prop_") and skeleton.pose.bones[g.name].scale.x < 0.01:
            return True
    return False


def add_skirt_bones(skeleton, prefix, rings):
    """Two bones per panel, hanging from the pelvis: from the skirt's top ring to its middle, and from there
    to the hem, so a knee can push the lower part out without throwing the whole panel."""
    mid = len(rings) // 2
    SKIRTS[prefix] = dict(rings=rings, top=rings[0][0], bottom=rings[-1][0], mid=rings[mid][0], inside=[], outside=[],
                          layers=[], slit=-1.0)
    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    bones = skeleton.data.edit_bones
    for j in range(PANELS):
        a = _panel_angle(j)
        points = [Vector((cx + ax * math.cos(a), cy + ay * math.sin(a), z)) for z, cx, cy, ax, ay in (rings[0], rings[mid], rings[-1])]
        upper = bones.new(f"{prefix}_{j:02d}")
        upper.head, upper.tail = points[0], points[1]
        upper.parent = bones["pelvis"]
        lower = bones.new(f"{prefix}_{j:02d}_lo")
        lower.head, lower.tail = points[1], points[2]
        lower.parent = upper
        lower.use_connect = True
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(skeleton)


def _ring_at(rings, z):
    for (z0, *r0), (z1, *r1) in zip(rings, rings[1:]):
        if z1 <= z <= z0:
            k = (z0 - z) / max(1e-6, z0 - z1)
            return [a + (b - a) * k for a, b in zip(r0, r1)]
    return rings[0][1:] if z > rings[0][0] else rings[-1][1:]


class Swing:
    """The state of the swinging parts through one clip: each panel part's and the scabbard's angle and
    speed, and where their ends were in the last frames (to feel the body's movement)."""

    def __init__(self):
        self.angle, self.speed, self.trail, self.bound = {}, {}, {}, {}

    def save(self):
        return ({**self.angle}, {**self.speed}, {k: [v.copy() for v in t] for k, t in self.trail.items()}, {**self.bound})

    def restore(self, saved):
        self.angle, self.speed, self.trail, self.bound = ({**saved[0]}, {**saved[1]},
                                                          {k: [v.copy() for v in t] for k, t in saved[2].items()},
                                                          {**saved[3]})

    def step(self, key, weight, low, high, rest, end, outward, length, dt):
        """Move one swinging part on by dt: drawn back to rest, thrown by how its end is being moved, held
        between low (pushed out by what is inside it) and high (pressed in from outside). Returns its angle."""
        w = 2 * math.pi * weight["hz"]
        trail = self.trail.setdefault(key, [])
        trail.append(end.copy())
        del trail[:-3]
        push = 0.0
        if len(trail) == 3:
            # The end being jerked one way leaves the part behind: it swings the other way.
            accel = (trail[2] - 2 * trail[1] + trail[0]) / (dt * dt)
            push = -weight["throw"] * accel.dot(outward) / max(0.1, length)
        angle = self.angle.get(key, max(low, min(high, rest)))
        speed = self.speed.get(key, 0.0)
        last_low = self.bound.get(key, low)
        for _ in range(4):
            h = dt / 4
            speed += (-w * w * (angle - rest) - 2 * weight["damping"] * w * speed + push) * h
            angle += speed * h
        angle = max(-0.6, min(1.25, angle))   # a hanging panel swings only so far
        if angle < low:
            # Pushed out: it moves with what pushes it (and keeps some of that speed when let go).
            speed = max(speed, 0.7 * (low - last_low) / dt, 0.0)
            angle = low
        if angle > high:
            speed = min(speed, 0.0)
            angle = high
        self.angle[key], self.speed[key], self.bound[key] = angle, speed, low
        return angle


def panel_share(down):
    """How much of a skirt point at `down` (0 at the panels' top, 1 at their hem) its panel moves; the rest
    is on the body."""
    return smooth(clamp01((down - 0.06) * 6))


def push_skirts(skeleton, swing=None, dt=1.0 / 30):
    """Pose the skirts for this frame."""
    for prefix in SKIRTS:
        push_skirt(skeleton, prefix, swing, dt)


# What a hand carries beside the skirt, by side: a knee may push the skirt out into it.
BESIDE_SKIRT = {"l": [], "r": []}


def _skirt_touches(skeleton, side):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    coat = BVHTree.FromObject(SKIRTS["skirt"]["layers"][0][0], depsgraph)
    return any(coat.overlap(BVHTree.FromObject(o, depsgraph))
               for o in BESIDE_SKIRT[side] if not _prop_hidden(skeleton, o))


def dress(skeleton, swing, dt, free_arms=True):
    """Pose the skirts for this frame; where a leg pushes the skirt out into what a hand holds beside it
    (the shield, the spear's butt, a hand itself), that arm comes out from his side, a little at a time,
    until they no longer meet (the skirt's swing is worked out again each time from the same state)."""
    saved = swing.save() if swing else None
    push_skirts(skeleton, swing, dt)
    if not free_arms or "skirt" not in SKIRTS:
        return
    for _ in range(8):
        bpy.context.view_layer.update()
        touching = [side for side in ("l", "r") if _skirt_touches(skeleton, side)]
        if not touching:
            return
        for side in touching:
            turn(skeleton, f"upperarm_{side}", FRONT, 4 if side == "l" else -4)
        if swing:
            swing.restore(saved)
        push_skirts(skeleton, swing, dt)


def push_skirt(skeleton, prefix, swing, dt):
    sk = SKIRTS[prefix]
    pb, rest = skeleton.pose.bones, skeleton.data.bones
    n = PANELS
    for j in range(n):
        for name in (f"{prefix}_{j:02d}", f"{prefix}_{j:02d}_lo"):
            pb[name].rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    moved = pb["pelvis"].matrix @ rest["pelvis"].matrix_local.inverted()
    back = moved.inverted()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    spacing = 2 * math.pi / n
    rings, top, mid, bottom = sk["rings"], sk["top"], sk["mid"], sk["bottom"]
    # Where each layer of cloth (the coat, the mail under it) is this frame before the panels turn: its
    # distance from the skirt's middle at each ring and each step round it.
    layers = []
    for obj, layer_rings, segments in sk["layers"]:
        ev = obj.evaluated_get(depsgraph)
        mesh = ev.to_mesh()
        grid = [[0.0] * segments for _ in layer_rings]
        for idx, v in enumerate(mesh.vertices[:len(layer_rings) * segments]):
            k, i = divmod(idx, segments)
            q = back @ (obj.matrix_world @ v.co)
            grid[k][i] = math.hypot(q.x - layer_rings[k][1], q.y - layer_rings[k][2])
        ev.to_mesh_clear()
        layers.append((layer_rings, grid, segments))

    def gaps(q):
        """How far (m) a point is outside each layer of cloth at its height (negative: inside)."""
        out = []
        for layer_rings, grid, segments in layers:
            if not layer_rings[-1][0] - 0.03 < q.z < layer_rings[0][0]:
                continue
            cx, cy, ax, ay = _ring_at(layer_rings, q.z)
            a = math.atan2((q.y - cy) / ay, (q.x - cx) / ax)
            f = (a % (2 * math.pi)) / (2 * math.pi) * segments
            i0, frac = int(f) % segments, f - int(f)
            i1 = (i0 + 1) % segments
            for k in range(len(layer_rings) - 1):
                if layer_rings[k + 1][0] <= q.z <= layer_rings[k][0]:
                    kz = (layer_rings[k][0] - q.z) / max(1e-6, layer_rings[k][0] - layer_rings[k + 1][0])
                    break
            else:
                k, kz = len(layer_rings) - 2, 1.0
            at = [grid[kk][i0] * (1 - frac) + grid[kk][i1] * frac for kk in (k, k + 1)]
            out.append(math.hypot(q.x - cx, q.y - cy) - (at[0] * (1 - kz) + at[1] * kz))
        return out

    # Every point of what is inside (legs; for the coat, the mail too) and of the things beside him, at the
    # skirt's height, with how far (m) it needs the cloth to move out (+) or lets it move in (-) where it is.
    points = []
    visible = [o for o in sk["outside"] if not _prop_hidden(skeleton, o)]
    for inside, objs in ((True, sk["inside"]), (False, visible)):
        for obj in objs:
            ev = obj.evaluated_get(depsgraph)
            mesh = ev.to_mesh()
            for v in mesh.vertices:
                q = back @ (obj.matrix_world @ v.co)
                if not bottom - 0.03 < q.z < top - 0.01:
                    continue
                cx, cy, ax, ay = _ring_at(rings, q.z)
                a = math.atan2((q.y - cy) / ay, (q.x - cx) / ax)
                found = gaps(q)
                if not found:
                    continue
                # A leg must be inside every layer; a thing outside, outside the outer one (the coat).
                gap = max(found) if inside else found[0]
                f = (a % (2 * math.pi)) / spacing - 0.5
                j0 = int(math.floor(f)) % n
                js = (j0, (j0 + 1) % n)
                if q.z < sk["slit"]:
                    # Below the slit a point touches only the half of the skirt on its side.
                    half = "right" if math.pi / 2 <= a % (2 * math.pi) <= 3 * math.pi / 2 else "left"
                    js = tuple(j for j in js if panel_half(j) == half) or js
                # Near the top the cloth hangs partly from the body (see skirt()): it moves only that much
                # of what the panel does.
                hang = panel_share((top - q.z) / (top - bottom))
                if hang < 0.3:
                    continue   # (too near the top for a panel to move the cloth there: it is on the body)
                if inside:
                    points.append((q.z, js, True, (gap + SKIRT_MARGIN) / hang))
                elif -0.12 < gap < 0.35:
                    # A thing outside stops the cloth swinging out into it (+: how far out it may come), or
                    # presses it in where it already touches (-). Deeper in than that it is through it.
                    points.append((q.z, js, False, (gap - SKIRT_MARGIN) / hang))
            ev.to_mesh_clear()

    def beside(j, step):
        """The neighbouring panel, or the panel itself across a slit (the halves hang apart)."""
        other = (j + step) % n
        return j if panel_half(other) != panel_half(j) else other

    def bounds(legs, things):
        """legs: the least turn each panel needs for what is inside (negative: how far in it lets it
        come); things: the most it may turn for what presses from outside. Cloth: each panel goes at least
        a third as far as a neighbour; a leg holding a panel out wins over something pressing it in."""
        out = [max(0.0, x) for x in legs]
        press = [min(0.0, x) for x in things]
        for _ in range(2):
            out = [max(out[j], 0.35 * out[beside(j, -1)], 0.35 * out[beside(j, 1)]) for j in range(n)]
            press = [min(press[j], 0.35 * press[beside(j, -1)], 0.35 * press[beside(j, 1)]) for j in range(n)]
        low = [max(legs[j], out[j]) for j in range(n)]
        high = [max(low[j], min(things[j], press[j] if press[j] < 0 else 9.0)) for j in range(n)]
        return low, high

    def axis_of(name, j):
        bone = pb[name]
        down = (bone.tail - bone.head).normalized()
        return down.cross(moved.to_3x3() @ _panel_dir(j)).normalized(), (bone.tail - bone.head).length

    def settle(level, low, high, rest_at):
        """The angle of each panel part this frame: with no swing (a still pose), as near rest as the bounds
        allow; swinging, by its weight, then held within the bounds; a panel then pulled a little towards
        its neighbours, as cloth is."""
        names = [f"{prefix}_{j:02d}{level}" for j in range(n)]
        weight = WEIGHT["lined" if level == "" else "cloth"]
        if swing is None:
            return [max(low[j], min(high[j], rest_at[j])) for j in range(n)]
        angles = []
        for j, name in enumerate(names):
            axis, length = axis_of(name, j)
            outward = moved.to_3x3() @ _panel_dir(j)
            end = pb[name].tail.copy()
            angles.append(swing.step(name, weight, low[j], high[j], rest_at[j], end, outward, length, dt))
        mean = [(angles[beside(j, -1)] + angles[beside(j, 1)]) / 2 for j in range(n)]
        pull = min(0.5, weight["bind"] * dt)
        angles = [max(low[j], min(high[j], a + (m - a) * pull)) for j, (a, m) in enumerate(zip(angles, mean))]
        for j, name in enumerate(names):
            swing.angle[name] = angles[j]
        return angles

    def apply(level, angles):
        for j in range(n):
            if angles[j]:
                name = f"{prefix}_{j:02d}{level}"
                axis, _ = axis_of(name, j)
                turn(skeleton, name, axis, math.degrees(angles[j]))

    def angle_for(need, lever, limit):
        return math.copysign(math.asin(min(limit, abs(need) / lever)), need)

    # Upper halves: what touches above the middle, and a little of what touches below it.
    legs, things = [-9.0] * n, [9.0] * n
    for z, js, inside, need in points:
        angle = angle_for(need, max(0.04, top - z), 0.94 if z >= mid else 0.3)
        for j in js:
            if inside:
                legs[j] = max(legs[j], angle)
            else:
                things[j] = min(things[j], angle)
    low, high = bounds(legs, things)
    upper = settle("", low, high, [0.0] * n)
    apply("", upper)
    for name, j in (sk.get("hangers", {}) if prefix == "skirt" else {}).items():
        # The scabbard (the bolt case) lies on its panel and swings out from it with its weight.
        pb[name].rotation_quaternion = (1, 0, 0, 0)
        bpy.context.view_layer.update()
        down = (rest[f"skirt_{j:02d}"].tail_local - rest[f"skirt_{j:02d}"].head_local).normalized()
        axis = moved.to_3x3() @ down.cross(_panel_dir(j)).normalized()
        on_skirt = upper[j]
        angle = on_skirt
        if swing is not None:
            end = pb[name].tail.copy()
            angle = swing.step(name, WEIGHT[name], on_skirt, 9.0, on_skirt, end,
                               moved.to_3x3() @ _panel_dir(j), 0.8, dt)
        if angle:
            turn(skeleton, name, axis, math.degrees(angle))
    bpy.context.view_layer.update()
    # Lower halves: what is left below the middle, after the upper half has moved. At rest the lower half
    # hangs back down from a panel the knee has pushed out (it drapes over the knee instead of flying out
    # level with it).
    legs, things = [-9.0] * n, [9.0] * n
    for z, js, inside, need in points:
        if z >= mid:
            continue
        for j in js:
            left = need - (top - z) * math.sin(upper[j])
            angle = angle_for(left, max(0.04, mid - z), 0.8)
            if inside:
                legs[j] = max(legs[j], angle)
            else:
                things[j] = min(things[j], angle)
    low, high = bounds(legs, things)
    lower = settle("_lo", low, high, [-0.6 * max(0.0, u) for u in upper])
    apply("_lo", lower)
    bpy.context.view_layer.update()


def reach(skeleton, side, wrist, pole):
    """Two-bone arm: put the wrist at `wrist` (armature space), the elbow bending towards `pole`."""
    elbow = two_bone(skeleton, f"upperarm_{side}", f"lowerarm_{side}", wrist, pole, place=False)
    set_arm(skeleton, side, elbow, wrist_on_reach(skeleton, side, elbow, wrist))


def wrist_on_reach(skeleton, side, elbow, wrist):
    """Where the wrist ends up reaching for `wrist` from that elbow (short of it if it is too far)."""
    r = arm_rest(skeleton, side)
    return elbow + (Vector(wrist) - elbow).normalized() * r["lower"]


def two_bone(skeleton, upper, lower, target, pole, place=True):
    """Put the end of lower at target (armature space), the middle joint bending towards pole. Returns the
    middle joint's point; with place=False only works it out."""
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    shoulder = pb[upper].head.copy()
    l1 = (pb[upper].tail - pb[upper].head).length
    l2 = (pb[lower].tail - pb[lower].head).length
    to = Vector(target) - shoulder
    d = max(1e-4, min(to.length, (l1 + l2) * 0.999))
    to.normalize()
    # Distance from the shoulder, along the reach, to the point under the elbow, and the elbow's offset.
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    bend = Vector(pole) - to * Vector(pole).dot(to)
    bend = bend.normalized() if bend.length > 1e-6 else Vector((0, 0, -1))
    elbow = shoulder + to * a + bend * h
    if place:
        aim(skeleton, upper, elbow - shoulder)
        bpy.context.view_layer.update()
        aim(skeleton, lower, shoulder + to * d - pb[lower].head)
    return elbow


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

def stance(skeleton, spear_up=True, breathe=0.0, shift=0.0, look=0.0, crouch=0.0, sword=False, shield="guard",
           great=False, high=False, crossbow=False):
    """The guard: shield across the body on the left forearm; in the right fist the spear upright, or with
    sword=True the sword held ready, point up and a little forward.
    breathe -1..1 lifts the chest, shift -1..1 moves the weight onto the left or right leg, look turns the
    head (degrees), crouch 0..1 bends the knees.
    shield: "guard" (in front of him), "low" (carried at his left side, out of a fight) or "none" (no shield:
    the left arm hangs free, and takes the spear in two-handed motions).
    great=True: a longsword in both hands, held in front of him point up and forward (no shield); high=True
    carries it higher and more upright, clear of the knees and the skirt when he moves."""
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
    if shield == "guard":
        # Shield arm: the upper arm forward and away from the body, the forearm across the front of the
        # belly, clear of the torso, so the shield stands in front of him.
        arm(skeleton, "l", (0.42, -0.72, -1), (-1, -0.3, 0.14))
    elif shield == "low":
        # Carried: the arm hangs, the forearm points ahead, and the shield hangs from it along his left side,
        # its face turned outwards.
        arm(skeleton, "l", SHIELD_LOW["upperarm"], SHIELD_LOW["lowerarm"])
        face_shield(skeleton, SHIELD_LOW["face"])
    else:
        arm(skeleton, "l", (0.7, 0.0, -1), (0.4, -0.3, -1))
    if crossbow:
        # Carried in both hands at the right hip, the nose forward and down, the prod level.
        xbow_hold(skeleton, XBOW_PORT[0], XBOW_PORT[1], along=XBOW_PORT[2])
        show(skeleton, spear=False, sword=False, sheathed=True, shield=False, crossbow=True)
    elif great:
        bpy.context.view_layer.update()
        shoulder = skeleton.pose.bones["upperarm_r"].head.copy()
        wrist, blade = GREAT_GUARD_WRIST, GREAT_GUARD
        if high:
            wrist, blade = wrist + Vector((0, 0.04, 0.16)), Vector((0.05, -0.45, 0.89)).normalized()
        two_handed(skeleton, wrist, blade, pole=(-1, 0.1, -0.6))
        show(skeleton, spear=False, sword=False, sheathed=True, shield=False, great=True)
    elif sword:
        arm(skeleton, "r", (-0.35, -0.45, -1), (-0.12, -1, 0.55))
        point_spear(skeleton, SWORD_GUARD)
        show(skeleton, spear=False, sword=True, sheathed=False, shield=shield != "none")
    else:
        # The fist round the upright shaft with the wrist straight: this is the grip every weapon motion
        # starts from (the weapons are bound to the hand in this pose).
        arm(skeleton, "r", (-0.22, -0.18, -1), (-0.05, -1, 0.3) if spear_up else (-0.05, -1, 0.1))
        show(skeleton, spear=True, sword=False, sheathed=True, shield=shield != "none")
    turn(skeleton, "head", UP, look)
    # The whole body sinks with the knees.
    root.location = (0, 0, -0.03 * crouch)


SWORD_GUARD = Vector((0.12, -0.5, 1)).normalized()
# The longsword's guard: hands in front of the belly, the point up and forward; the wrist (right) relative
# to the right shoulder.
GREAT_GUARD = Vector((0.08, -0.75, 0.66)).normalized()
GREAT_GUARD_WRIST = Vector((0.16, -0.42, -0.26))


def two_handed(skeleton, at, blade, pole, pole_l=(0.8, -0.5, -1), edge=None, edge_weight=0.0, slack=None):
    """Both hands on the longsword: the right wrist at `at` (relative to the right shoulder) pointing the
    blade along `blade`, and the left hand on the grip below it. Where the left arm cannot reach that far
    (the cuts end far to either side), both hands come back towards it until it can."""
    pb = skeleton.pose.bones
    r = arm_rest(skeleton, "l")
    at = Vector(at)
    for _ in range(4):
        bpy.context.view_layer.update()
        shoulder = pb["upperarm_r"].head.copy()
        posed = at
        reach(skeleton, "r", shoulder + at, pole=pole)
        point_spear(skeleton, blade)
        bpy.context.view_layer.update()
        hand = pb["hand_r"]
        fist = hand.head + Vector(hand.matrix.col[1][:3]) * 0.065
        grip_at = fist - (hand.matrix.to_3x3() @ SPEAR_AXIS["local"]).normalized() * 0.1
        to_grip = grip_at - pb["upperarm_l"].head
        over = to_grip.length - (r["upper"] + r["lower"]) * 0.95
        if over <= 0:
            break
        at = at - to_grip.normalized() * (over + 0.01)
    if edge is not None and edge_weight > 0:
        # (where the hands are settled by the aim alone; then the edge is brought round there)
        bpy.context.view_layer.update()
        reach(skeleton, "r", pb["upperarm_r"].head + posed, pole=pole)
        point_spear(skeleton, blade, edge, edge_weight, slack)
    both_hands(skeleton, blade, pole=pole_l)


def both_hands(skeleton, direction, amount=1.0, pole=(0.8, -0.5, -1)):
    """The left hand on a longsword's grip below the right, both pointing it along direction; pole: where
    the left elbow points."""
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    hand = pb["hand_r"]
    fist = hand.head + Vector(hand.matrix.col[1][:3]) * 0.065
    point = (hand.matrix.to_3x3() @ SPEAR_AXIS["local"]).normalized()
    hang = pb["lowerarm_l"].tail.copy()
    reach(skeleton, "l", hang.lerp(fist - point * 0.1, amount), pole=pole)
    if "l" in GRIP_AXIS:
        grip(skeleton, "l", point, swivel=20)   # (the elbow mostly where pole puts it)

# The crossbow in both hands: the right fist round the stock's wrist at `at` (relative to the right shoulder)
# pointing it along `direction`, its top turned up so the prod is level; the left hand under the fore-stock
# `along` metres ahead of the right. PORT is how it is carried, AIM at the shoulder, the cheek on the stock.
# (found by trying the wrist's place, the elbow and the stock's lean in the fist (XBOW_TILT) against how far
# off the aim, the level and the left hand stay and what the arms and the crossbow go through: held across
# the fist like a shaft, the forearm had to cross the chest and went through the coat)
XBOW_PORT = (Vector((0.34, -0.4, -0.1)), Vector((0.0, -0.9, -0.45)), 0.1)
XBOW_AIM = (Vector((0.32, -0.36, 0.04)), Vector((0.0, -1.0, 0.03)), 0.1)
XBOW_LEFT_BELOW = 0.09   # how far (m) under the stock's middle the left wrist is


def xbow_hold(skeleton, at, direction, along=0.1, pole=(-0.8, 0.2, -0.6), pole_l=(0.7, -0.6, -0.8), left=1.0):
    pb = skeleton.pose.bones
    bpy.context.view_layer.update()
    direction = Vector(direction).normalized()
    reach(skeleton, "r", pb["upperarm_r"].head + Vector(at), pole=pole)
    xbow_level(skeleton, direction)
    left_on_stock(skeleton, along, pole_l, left)


def xbow_level(skeleton, direction):
    """Point the crossbow in the right fist along direction, its top as near up as the wrist allows."""
    level = UP - direction * UP.dot(direction)
    grip(skeleton, "r", direction, edge=level, edge_weight=1.5, slack=6, edge_axis=XBOW_AXES["top"], signed=True,
         axis=XBOW_AXES["stock"])


def xbow_frame(skeleton):
    """Where the crossbow in the right fist is: (the fist, the way the stock points, its top)."""
    bpy.context.view_layer.update()
    hand = skeleton.pose.bones["hand_r"]
    m = hand.matrix.to_3x3()
    return (hand.head + Vector(hand.matrix.col[1][:3]) * 0.065, (m @ XBOW_AXES["stock"]).normalized(),
            (m @ XBOW_AXES["top"]).normalized())


def left_on_stock(skeleton, along, pole=(0.7, -0.6, -0.8), amount=1.0):
    """The left hand from where it hangs onto the fore-stock, under it, `along` metres ahead of the right fist."""
    pb = skeleton.pose.bones
    fist, point, top = xbow_frame(skeleton)
    hang = pb["lowerarm_l"].tail.copy()
    reach(skeleton, "l", hang.lerp(fist + point * along - top * XBOW_LEFT_BELOW, amount), pole=pole)
    if amount > 0 and "l" in GRIP_AXIS:
        bpy.context.view_layer.update()
        loose = (pb["hand_l"].matrix.to_3x3() @ GRIP_AXIS["l"]).normalized()
        grip(skeleton, "l", loose.lerp(point, amount))


def xbow_shoot(skeleton, t):
    """Up to the shoulder (0..0.3), the cheek down on the stock and a steady aim (0.3..0.55), the loose: the
    string snaps forward, the bolt is gone, the crossbow kicks up (0.55..0.66); held a moment, then down to
    the carry (0.75..1)."""
    up = smooth(span(t, 0.0, 0.3))
    loose = t >= 0.55
    kick = math.sin(math.pi * span(t, 0.55, 0.68)) * (1 - span(t, 0.55, 0.68)) * 2.2
    down = smooth(span(t, 0.75, 1.0))
    raised = up * (1 - down)
    stance(skeleton, crossbow=True, look=0)
    # Side on, the left foot forward a little; the head down to the stock.
    feet = fight_footwork(skeleton, 0.35 * raised, 0.2 * raised)
    turn(skeleton, "pelvis", UP, -14 * raised)
    turn(skeleton, "spine_02", UP, 6 * raised)
    turn(skeleton, "head", UP, 8 * raised)
    turn(skeleton, "head", RIGHT, 10 * raised)
    turn(skeleton, "head", FRONT, 8 * raised)
    plant_feet(skeleton, feet)
    port_at, port_dir, port_along = XBOW_PORT
    aim_at, aim_dir, aim_along = XBOW_AIM
    at = port_at.lerp(aim_at, raised) + Vector((0, 0.02, 0.015)) * kick
    direction = port_dir.lerp(aim_dir, raised).normalized()
    direction = (direction + UP * 0.07 * kick).normalized()
    xbow_hold(skeleton, at, direction, along=port_along + (aim_along - port_along) * raised)
    show(skeleton, spear=False, sword=False, sheathed=True, shield=False, crossbow=True, loaded=not loose)


# The reload with the stirrup: the crossbow nose down, its stirrup on the ground in front of him and his right
# foot in it; he bends, takes the string in both hands either side of the stock and draws it up onto the
# nut; takes a bolt from the case at his hip and lays it in the groove; and lifts the crossbow back to the
# carry. While the crossbow stands in the stirrup no hand carries it (CARRY["free"]).
XBOW_STAND = dict(stirrup=Vector((-0.06, -0.46, 0.02)), lean=Vector((0.0, 0.3, 1.0)).normalized())


def xbow_stand_matrix(skeleton):
    """Where the crossbow's bone is as it stands in its stirrup: as if a fist held it with the stock leaning
    back up towards him, the prod level, the stirrup on the ground."""
    pb, bones = skeleton.pose.bones, skeleton.data.bones
    rest_hand = bones["hand_r"].matrix_local
    # In the bone's own (rest = hand) frame: the stock's axis and its top; the fist's place on the stock.
    axis, top = XBOW_AXES["stock"], XBOW_AXES["top"]
    point = -XBOW_STAND["lean"]   # the stock from the fist down to the stirrup
    want_top = (Vector((0, -1, 0)) - point * Vector((0, -1, 0)).dot(point)).normalized()   # the top towards the front
    # A rotation taking (axis, top) onto (point, want_top).
    a = Matrix((axis, top, axis.cross(top))).transposed()
    b = Matrix((point, want_top, point.cross(want_top))).transposed()
    rot = b @ a.inverted()
    fist_in_hand = Vector((0, 0.065, 0))   # the fist is 6.5 cm along the hand from its head
    stirrup_end = XBOW["prod"] + XBOW["stirrup"] * 0.9
    fist_at = XBOW_STAND["stirrup"] - point * stirrup_end
    m = rot.to_4x4()
    m.translation = fist_at - rot @ fist_in_hand
    return m @ (rest_hand.inverted() @ bones["prop_xbow"].matrix_local)


def xbow_block(skeleton, t):
    """No shield: the crossbow comes up across in front of the face in both hands, held there."""
    k = span(t, 0.0, 0.3)
    up = ease_out(k) + 0.08 * math.sin(math.pi * k) * (1 - k)
    stance(skeleton, crouch=0.5 * smooth(k), crossbow=True)
    turn(skeleton, "spine_02", RIGHT, -6 * up)
    port_at, port_dir, _ = XBOW_PORT
    xbow_hold(skeleton, port_at.lerp(Vector((0.12, -0.32, 0.1)), up), port_dir.lerp(Vector((1, -0.3, 0.3)), up).normalized(),
              along=0.3 + 0.05 * up, pole_l=(0.6, -0.8, -0.5))


def xbow_reload(skeleton, t):
    lower = smooth(span(t, 0.0, 0.16))            # nose down into the stirrup
    step_in = smooth(span(t, 0.1, 0.24))          # the right foot into it
    bend = smooth(span(t, 0.18, 0.34)) * (1 - smooth(span(t, 0.62, 0.8)))
    draw = smooth(span(t, 0.36, 0.58))            # the string from the prod up onto the nut
    fetch = span(t, 0.6, 0.76)                    # the right hand to the case and back with a bolt
    lift = smooth(span(t, 0.82, 0.98))            # back up to the carry
    stance(skeleton, crossbow=True)
    pb = skeleton.pose.bones
    feet = fight_footwork(skeleton, 0.0, 0.6 * bend)
    turn(skeleton, "spine_01", RIGHT, -22 * bend)
    turn(skeleton, "spine_02", RIGHT, -30 * bend)
    turn(skeleton, "head", RIGHT, 20 * bend)
    ankle0 = skeleton.data.bones["foot_r"].head_local
    stirrup = XBOW_STAND["stirrup"]
    in_stirrup = Vector((stirrup.x, stirrup.y + 0.1, ankle0.z))
    foot_in = step_in * (1 - lift)
    raise_foot = 0.08 * (math.sin(math.pi * step_in) + math.sin(math.pi * lift))
    feet["r"] = (feet["r"][0].lerp(in_stirrup, foot_in) + Vector((0, 0, raise_foot)), -25 * (1 - foot_in))
    plant_feet(skeleton, feet)
    bpy.context.view_layer.update()

    stand = xbow_stand_matrix(skeleton)
    rot = stand.to_3x3()
    point, top = -XBOW_STAND["lean"], (rot @ XBOW_AXES["top"]).normalized()
    side = point.cross(top).normalized()
    fist = stand.translation + rot @ Vector((0, 0.065, 0))
    loose_at = fist + point * (XBOW["prod"] - XBOW["sweep"]) + top * 0.03
    string_at = loose_at.lerp(fist + point * XBOW["nut"] + top * 0.03, draw)
    mouth = pb["pelvis"].matrix @ (skeleton.data.bones["pelvis"].matrix_local.inverted() @ QUIVER["mouth"])
    groove = fist + point * (XBOW["nut"] + 0.1) + top * 0.08
    shoulder = pb["upperarm_r"].head.copy()

    # The right hand: on the stock's wrist going down and coming up; on the string; to the case and back.
    port_at, port_dir, _ = XBOW_PORT
    down = lower * (1 - lift)
    on_string = smooth(span(t, 0.26, 0.36))
    if t < 0.26 or t >= 0.82:
        reach(skeleton, "r", (shoulder + port_at).lerp(stand.translation, down), pole=(-1, 0.2, -0.8))
        direction = port_dir.normalized().lerp(point, down).normalized()
        want_top = (UP - direction * UP.dot(direction)).lerp(top, down)
        grip(skeleton, "r", direction, edge=want_top, edge_weight=1.5, slack=6, edge_axis=XBOW_AXES["top"], signed=True,
             axis=XBOW_AXES["stock"])
    elif t < 0.6:
        reach(skeleton, "r", stand.translation.lerp(string_at - side * 0.07 + top * 0.04, on_string), pole=(-0.7, -0.6, -0.8))
    elif t < 0.76:
        to_case = smooth(min(1.0, fetch * 2))
        back = smooth(max(0.0, fetch * 2 - 1))
        reach(skeleton, "r", string_at.lerp(mouth + UP * 0.12, to_case).lerp(groove, back), pole=(-1, 0.3, -0.6))
    else:
        reach(skeleton, "r", groove.lerp(stand.translation, smooth(span(t, 0.76, 0.82))), pole=(-1, 0.2, -0.8))
        grip(skeleton, "r", point, edge=top, edge_weight=1.5, slack=6, edge_axis=XBOW_AXES["top"], signed=True,
             axis=XBOW_AXES["stock"])

    # The crossbow: carried in the fist, or standing in its stirrup (slipping from one to the other in the
    # fist as it comes to rest on the ground and as it is lifted).
    CARRY["free"] = True
    bpy.context.view_layer.update()
    bones = skeleton.data.bones
    carried = pb["hand_r"].matrix @ (bones["hand_r"].matrix_local.inverted() @ bones["prop_xbow"].matrix_local)
    w = smooth(span(t, 0.1, 0.18)) * (1 - smooth(span(t, 0.8, 0.88)))
    m = carried.to_quaternion().slerp(stand.to_quaternion(), w).to_matrix().to_4x4()
    m.translation = carried.translation.lerp(stand.translation, w)
    scale = pb["prop_xbow"].scale.copy()
    pb["prop_xbow"].matrix = m
    pb["prop_xbow"].scale = scale
    bpy.context.view_layer.update()

    # The left hand: under the fore-stock of the crossbow where it is, or on the string beside the right.
    held = pb["prop_xbow"].matrix.to_3x3()
    x_fist = pb["prop_xbow"].matrix.translation + held @ Vector((0, 0.065, 0))
    x_point, x_top = (held @ XBOW_AXES["stock"]).normalized(), (held @ XBOW_AXES["top"]).normalized()
    on_l = on_string * (1 - smooth(span(t, 0.58, 0.68)))
    stock_l = x_fist + x_point * XBOW_PORT[2] - x_top * XBOW_LEFT_BELOW
    reach(skeleton, "l", stock_l.lerp(string_at + side * 0.07 + top * 0.04, on_l), pole=(0.7, -0.6, -0.8))
    if "l" in GRIP_AXIS:
        grip(skeleton, "l", x_point.lerp(side, on_l).normalized())

    show(skeleton, spear=False, sword=False, sheathed=True, shield=False, crossbow=True, loaded=t >= 0.78)
    span_string(skeleton, draw if t < 0.82 else 1.0)
    k = 1.0 if 0.66 <= t < 0.78 else HIDDEN
    pb["prop_bolt_hand"].scale = (k, k, k)


# The carried shield: arm directions, and where its face turns. SHIELD_FACE["local"] is the face's outward
# normal in the left forearm's frame, measured when the shield is bound (see infantry()).
SHIELD_LOW = {"upperarm": Vector((0.55, 0.06, -1)), "lowerarm": Vector((0.14, -0.85, -0.2)),
              "face": Vector((1, -0.15, 0)).normalized()}
SHIELD_READY = {"upperarm": Vector((0.62, 0.0, -1)), "lowerarm": Vector((0.15, -1, 0.0)),
                "face": Vector((0.75, -0.65, 0)).normalized()}
SHIELD_RUN = {"upperarm": Vector((0.8, -0.05, -0.6)), "lowerarm": Vector((0.3, -1, 0.35)),
              "face": Vector((0.95, -0.25, 0.2)).normalized()}
SHIELD_FACE = {"local": None}


def face_shield(skeleton, outward):
    """Turn the left forearm about its own length (within a man's reach) so the shield's face looks as
    nearly along outward as it can."""
    if SHIELD_FACE["local"] is None:
        return
    r = arm_rest(skeleton, "l")
    elbow, wrist = arm_points(skeleton, "l")
    pb = skeleton.pose.bones
    fore = (wrist - elbow).normalized()
    hinge = Vector(pb["upperarm_l"].matrix.col[0][:3])
    hinge = (hinge - fore * hinge.dot(fore)).normalized()
    want = Vector(outward).normalized()
    best = max(range(-TWIST_LIMIT, TWIST_LIMIT + 1, 5),
               key=lambda tw: (_forearm(r, hinge, fore, tw) @ SHIELD_FACE["local"]).dot(want))
    set_arm(skeleton, "l", elbow, wrist, best)


def wrap(x):
    return (x + math.pi) % (2 * math.pi) - math.pi


def bell(x, centre, width):
    return math.exp(-wrap(x - centre) ** 2 / (2 * width * width))


def idle_pose(skeleton, t, sword=False, shield="guard", great=False, crossbow=False):
    """Four seconds of standing: two breaths, a slow weight shift and a glance aside. Loops cleanly."""
    a = 2 * math.pi * t
    stance(skeleton, breathe=math.sin(2 * a), shift=0.8 * math.sin(a), look=7 * math.sin(a + 1.3) + 2 * math.sin(3 * a),
           sword=sword, shield=shield, great=great, crossbow=crossbow)
    if not great and not crossbow:
        turn(skeleton, "upperarm_r", RIGHT, 1.5 * math.sin(a + 0.6))


# Walking and running. Each foot is placed on the ground and the leg reaches it (two-bone IK), so a planted
# foot stays planted: it slides back under the body at exactly the gait's speed, as the ground does under a
# man moving at that speed, and the renderer plays the clip at (actual speed / this speed) so the feet keep
# to the ground in the battle. (Swinging the thighs by angle instead let the body lean carry the legs behind
# it and the feet skate: the body went ahead and the legs dragged.)
#   speed m/s, cycle s (two steps), stance: share of the cycle each foot is on the ground (under a half:
#   both feet off the ground between steps), lift: how high the foot rises in the swing, lean degrees,
#   sink: how much lower the hips ride, bounce: hips rise and fall per step, sway m side to side, twist
#   degrees of the hips, arm: degrees of arm swing.
GAITS = {
    "walk": dict(speed=1.3, cycle=1.0, stance=0.6, lift=0.07, lean=4, sink=0.015, bounce=0.0, sway=0.022,
                 twist=6, arm=7, heel_strike=True),
    "run": dict(speed=3.2, cycle=0.64, stance=0.34, lift=0.14, lean=10, sink=0.06, bounce=0.03, sway=0.012,
                twist=9, arm=14, heel_strike=False),
}


def rot_x(degrees):
    return Matrix.Rotation(math.radians(degrees), 3, "X")


def foot_placement(skeleton, side, u, g, centre_y):
    """Where the ankle and the ball of one foot are at phase u (0: the foot lands), in armature space."""
    bones = skeleton.data.bones
    ankle0 = bones[f"foot_{side}"].head_local
    ball_rel = bones[f"ball_{side}"].head_local - ankle0
    heel_rel = Vector((0, 0.045, -ankle0.z))
    x = math.copysign(0.115, ankle0.x)
    reach_ = g["speed"] * g["cycle"] * g["stance"]          # ground the foot covers while planted
    flat_from, flat_to = (0.12, 0.62) if g["heel_strike"] else (0.0, 0.45)
    land_pitch = -14.0 if g["heel_strike"] else -4.0          # toes up as the heel lands
    off_pitch = 28.0 if g["heel_strike"] else 34.0             # heel up as the toes push off

    def planted(q):
        flat = Vector((x, centre_y - reach_ / 2 + reach_ * q, ankle0.z))   # it moves back, +Y
        if q < flat_from:       # rolling onto the foot about the heel
            pitch = land_pitch * (1 - smooth(q / flat_from))
            heel = flat + heel_rel
            return heel + rot_x(pitch) @ -heel_rel, pitch
        if q > flat_to:         # heel rising about the ball
            pitch = off_pitch * smooth((q - flat_to) / (1 - flat_to))
            ball = flat + ball_rel
            return ball + rot_x(pitch) @ -ball_rel, pitch
        return flat, 0.0

    if u < g["stance"]:
        ankle, pitch = planted(u / g["stance"])
    else:
        # The swing: leaving the ground and landing on it at the ground's speed (no jerk at either end),
        # lifted most at mid-swing.
        w = (u - g["stance"]) / (1 - g["stance"])
        (a0, p0), (a1, p1) = planted(1.0), planted(0.0)
        back = g["speed"] * g["cycle"] * (1 - g["stance"])     # ground moved during the swing, per unit of w
        h00, h10, h01, h11 = 2 * w**3 - 3 * w**2 + 1, w**3 - 2 * w**2 + w, -2 * w**3 + 3 * w**2, w**3 - w**2
        ankle = a0.lerp(a1, smooth(w))
        # (landing a little slower than the ground: matched exactly, the foot overshoots ahead and paws back)
        ankle.y = h00 * a0.y + h10 * back + h01 * a1.y + h11 * back * 0.75
        # Up at once as the toes leave and down steeply onto the heel: a foot that rises or lands slowly
        # skims the ground at the wrong speed.
        ankle.z = a0.z + (a1.z - a0.z) * smooth(w) + g["lift"] * math.sin(math.pi * w)
        # The toes leave the ground before the foot starts to level out, so they lift off without sliding.
        pitch = p0 + (p1 - p0) * smooth(max(0.0, (w - 0.15) / 0.85))
    return ankle, ankle + rot_x(pitch) @ ball_rel


_HIP_HEIGHTS = {}


def hip_height(skeleton, g, t, centre_y):
    """How far the hips ride below standing at time t: lower by sink, rising and falling with each step, and
    never so high that a leg on the ground (or about to land) cannot reach its foot without locking straight.
    Worked out round the whole cycle and smoothed, so the body does not jolt as a foot lands or leaves."""
    key = (skeleton.name, tuple(sorted(g.items())))
    if key not in _HIP_HEIGHTS:
        bones = skeleton.data.bones
        n = 120
        flight_mid = (g["stance"] + 0.5) / 2
        raw = []
        for i in range(n):
            ti = i / n
            height = -g["sink"] + g["bounce"] * math.cos(2 * math.pi * 2 * (ti - flight_mid))
            sway = g["sway"] * math.sin(2 * math.pi * ti - 0.4)
            for side, phase in (("l", 0.0), ("r", 0.5)):
                u = (ti + phase) % 1.0
                if g["stance"] <= u < g["stance"] + 0.6 * (1 - g["stance"]):
                    continue    # early in the swing the knee bends; that foot does not hold the hips
                hip = bones[f"thigh_{side}"].head_local + Vector((sway, 0, 0))
                legs = (bones[f"thigh_{side}"].length + bones[f"calf_{side}"].length) * 0.97
                ankle = foot_placement(skeleton, side, u, g, centre_y)[0]
                flat = (ankle - hip).to_2d().length
                height = min(height, ankle.z + math.sqrt(max(0.0, legs * legs - flat * flat)) - hip.z)
            raw.append(height)
        width = 4   # samples: 1/30 of a cycle
        weights = [math.exp(-k * k / (2 * width * width)) for k in range(-3 * width, 3 * width + 1)]
        _HIP_HEIGHTS[key] = [sum(w * raw[(i + k - 3 * width) % n] for k, w in enumerate(weights)) / sum(weights)
                             for i in range(n)]
    curve = _HIP_HEIGHTS[key]
    x = (t % 1.0) * len(curve)
    i = int(x)
    return curve[i % len(curve)] + (curve[(i + 1) % len(curve)] - curve[i % len(curve)]) * (x - i)


def gait_pose(skeleton, t, g, sword=False, shield="guard", great=False, crossbow=False):
    """One cycle of a gait (see GAITS): the left foot lands at t = 0, the right at t = 0.5."""
    a = 2 * math.pi * t
    stance(skeleton, sword=sword, shield=shield, great=great, high=great, crossbow=crossbow)
    if shield == "guard" or (shield == "low" and g is GAITS["run"]):
        # Moving, the shield is held ready at his left side, its face turned out and forward, not square in
        # front: the knees come up into a shield held there, and push the skirt into it at the front-left.
        # Running it is carried higher still, out of the way of the knee and the flying skirt.
        carry = SHIELD_RUN if g is GAITS["run"] else SHIELD_READY
        arm(skeleton, "l", carry["upperarm"], carry["lowerarm"])
        face_shield(skeleton, carry["face"])
    pb, bones = skeleton.pose.bones, skeleton.data.bones
    for bone in ("thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"):
        pb[bone].rotation_quaternion = (1, 0, 0, 0)
    turn(skeleton, "pelvis", RIGHT, -0.3 * g["lean"])
    turn(skeleton, "pelvis", UP, -g["twist"] * math.cos(a))
    turn(skeleton, "spine_01", RIGHT, -0.4 * g["lean"])
    turn(skeleton, "spine_02", RIGHT, -0.3 * g["lean"])
    turn(skeleton, "spine_02", UP, 1.3 * g["twist"] * math.cos(a))
    turn(skeleton, "head", RIGHT, 0.7 * g["lean"])
    turn(skeleton, "head", UP, -0.4 * g["twist"] * math.cos(a))
    # Arms swing against the legs: the weapon arm more, the shield arm a little (a free arm fully). Both
    # hands on a longsword keep it still in front of him.
    if not great and not crossbow:
        turn(skeleton, "upperarm_r", RIGHT, (1.0 if sword else 0.5) * g["arm"] * math.cos(a))
        turn(skeleton, "upperarm_l", RIGHT, -{"guard": 0.35, "low": 0.5, "none": 0.6}[shield] * g["arm"] * math.cos(a))
    if not sword and not great and not crossbow:
        # The spear leans a little: its butt out to his right and behind, clear of the skirt where the right
        # knee pushes it out in front.
        point_spear(skeleton, Vector((0.45 if g is GAITS["run"] else 0.3, -0.25, 1)).normalized())
    centre_y = bones["thigh_l"].head_local.y + 0.02
    feet = {side: foot_placement(skeleton, side, (t + phase) % 1.0, g, centre_y)
            for side, phase in (("l", 0.0), ("r", 0.5))}
    sway = g["sway"] * math.sin(a - 0.4)
    pb["Root"].location = (sway, 0, hip_height(skeleton, g, t, centre_y))
    for side in ("l", "r"):
        ankle, ball = feet[side]
        two_bone(skeleton, f"thigh_{side}", f"calf_{side}", ankle, pole=(0, -1, 0.1))
        bpy.context.view_layer.update()
        aim(skeleton, f"foot_{side}", ball - ankle)
        # The toes stay level: flat on the ground as the heel rises over them.
        aim(skeleton, f"ball_{side}", bones[f"ball_{side}"].tail_local - bones[f"ball_{side}"].head_local)


def walk_pose(skeleton, t, sword=False, shield="guard", great=False, crossbow=False):
    gait_pose(skeleton, t, GAITS["walk"], sword, shield, great, crossbow)


def run_pose(skeleton, t, sword=False, shield="guard", great=False, crossbow=False):
    gait_pose(skeleton, t, GAITS["run"], sword, shield, great, crossbow)


# Footwork for the attacks: the feet stand on the ground and the legs reach them (as in walking), the left
# foot steps forward into the blow and back again, the right stays planted, turned out; the hips go with
# the step and down. (Bending the legs by angle while the body moved on let the feet slide.)
STEP_LENGTH = 0.3


def fight_footwork(skeleton, step, crouch, rise=0.0):
    """step 0..1: how far the left foot has stepped forward (it lifts while it moves); crouch 0..1 lowers
    the hips; rise lifts them (winding up). Moves the hips now; returns where the feet go, for
    plant_feet() once the hips have turned (turning them after would swing the planted feet)."""
    pb, bones = skeleton.pose.bones, skeleton.data.bones
    ankle0 = bones["foot_l"].head_local
    lift = 0.07 * 4 * step * (1 - step) * (1 if 0 < step < 1 else 0)
    pb["Root"].location = (0.02 * step, -0.45 * STEP_LENGTH * step, -0.06 * crouch + 0.02 * rise)
    bpy.context.view_layer.update()
    return {"l": (Vector((0.115, ankle0.y - 0.03 - STEP_LENGTH * step, ankle0.z + lift)), 8.0),
            "r": (Vector((-0.12, ankle0.y + 0.06, ankle0.z)), -25.0)}


def plant_feet(skeleton, spots):
    """The legs reach the feet where fight_footwork() put them, the soles flat on the ground (however the
    hips have turned). Where a leg would have to stretch past straight to reach, the hips come down until
    it need not (a straightened leg cannot hold its foot still)."""
    pb, bones = skeleton.pose.bones, skeleton.data.bones
    for bone in ("thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"):
        pb[bone].rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    drop = 0.0
    for side, (ankle, _) in spots.items():
        hip = pb[f"thigh_{side}"].head
        most = 0.985 * (bones[f"thigh_{side}"].length + bones[f"calf_{side}"].length)
        flat = Vector((hip.x - ankle.x, hip.y - ankle.y, 0)).length
        if (hip - ankle).length > most and flat < most:
            drop = max(drop, (hip.z - ankle.z) - math.sqrt(most * most - flat * flat))
    if drop > 0:
        pb["Root"].location.z -= drop
        bpy.context.view_layer.update()
    for side, (ankle, toe_out) in spots.items():
        two_bone(skeleton, f"thigh_{side}", f"calf_{side}", ankle, pole=(0, -1, 0.1))
        bpy.context.view_layer.update()
        # The foot as it rests (flat), turned about the vertical to toe out by toe_out from straight ahead.
        rest = bones[f"foot_{side}"].matrix_local.to_3x3()
        ball_rel = bones[f"ball_{side}"].head_local - bones[f"foot_{side}"].head_local
        yaw = math.degrees(math.atan2(ball_rel.x, -ball_rel.y))
        m = Matrix.Rotation(math.radians(toe_out - yaw), 3, "Z") @ rest
        foot = pb[f"foot_{side}"]
        foot.matrix = _frame(m.col[0], m.col[1], m.col[2], foot.head.copy())
        bpy.context.view_layer.update()
        pb[f"ball_{side}"].rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()


def look_ahead(skeleton, body_turn):
    """The head turns back against the body's turn, keeping his eyes on his man."""
    turn(skeleton, "head", UP, -0.6 * body_turn)


SPEAR_ARM_OUT = 0.45   # how far out to his right the upper arm is in the underarm thrust (with the shield)


def attack_pose(skeleton, t):
    """Spear thrust: gather and draw back (0..0.35), drive forward hard with a step (0.36..0.47), hold the
    reach a moment, then recover to the guard."""
    draw = smooth(span(t, 0.0, 0.35)) * (1 - ease_in(span(t, 0.36, 0.44)))
    reach_ = ease_in(span(t, 0.36, 0.47)) * (1 - smooth(span(t, 0.62, 1.0)))
    step = smooth(span(t, 0.3, 0.46)) * (1 - smooth(span(t, 0.64, 1.0)))
    stance(skeleton, spear_up=False)
    feet = fight_footwork(skeleton, step, 0.35 * draw + 0.6 * reach_, rise=0.5 * draw)
    # The shield comes up and forward with the lunge, clear of the leading knee.
    turn(skeleton, "upperarm_l", RIGHT, 18 * reach_)
    # The hips turn first, the shoulders after them.
    hips = -10 * draw + 12 * smooth(span(t, 0.32, 0.46)) * (1 - smooth(span(t, 0.62, 1.0)))
    shoulders = -16 * draw + 16 * reach_
    turn(skeleton, "pelvis", UP, hips)
    turn(skeleton, "spine_02", UP, shoulders)
    turn(skeleton, "spine_02", RIGHT, -8 * reach_)
    look_ahead(skeleton, hips + shoulders)
    plant_feet(skeleton, feet)
    # Underarm thrust: the spear comes down from upright to level as he gathers, then the arm drives it
    # straight ahead, point first.
    level = smooth(span(t, 0.0, 0.3)) * (1 - smooth(span(t, 0.7, 1.0)))
    arm(skeleton, "r", (-SPEAR_ARM_OUT - 0.15 * draw, -0.15 + 0.85 * draw - 0.75 * reach_, -1 + 0.25 * draw + 0.75 * reach_),
        (-0.08 + 0.03 * reach_, -1 + 0.3 * draw, 0.15 - 0.35 * reach_))
    upright = Vector((0, -0.05, 1))
    forward = Vector((0.12, -1, 0.06))   # the butt out to his right, clear of the skirt
    point_spear(skeleton, upright.lerp(forward, level).normalized())


def guard_wrist(skeleton, style="shield"):
    """Where the sword hand's wrist is in the guard (armature space), relative to the right shoulder."""
    stance(skeleton, sword=style != "great", great=style == "great", shield="guard" if style == "shield" else "none")
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    return pb["lowerarm_r"].tail - pb["upperarm_r"].head


# Sword cuts: the wrist (relative to the right shoulder) and the blade's direction where the cut is wound
# up, halfway through it and where it ends. The cut winds up (t 0..0.35), strikes through the middle
# (0.36..0.6) with a step, holds a moment and comes back to the guard (0.7..1). twist: degrees the body
# turns (wound, struck; + turns the right shoulder forward), lean: forward bend (wound, struck), pole: where
# the elbow points, open: how far the shield arm swings out to the left, out of the blade's way; edge=False
# for a thrust (no edge to lead with); aim_slack: degrees the blade may point off its line to bring the edge
# round (EDGE_AIM_SLACK if not given).
SWORD_CUTS = {
    # Forehand: from his right, flat across to his left.
    "s_swing_l": dict(wind=((-0.38, 0.12, 0.08), (-0.55, 0.65, 0.35)), mid=((-0.02, -0.52, 0.02), (0.05, -1, 0.05)),
                      end=((0.12, -0.52, 0.02), (0.45, -0.88, -0.05)), twist=(-28, 30), lean=(0, 6),
                      pole=(-1, 0.4, -0.5), open=1.0, length=0.9),
    # Backhand: from his left, across to his right.
    "s_swing_r": dict(wind=((0.24, -0.42, 0.2), (0.55, 0.45, 0.6)), mid=((0.0, -0.52, 0.02), (-0.05, -1, 0.05)),
                      end=((-0.4, -0.3, -0.06), (-0.85, -0.45, -0.05)), twist=(26, -30), lean=(0, 6),
                      pole=(-0.6, 0.2, -1), open=1.0, length=0.9),
    # Overhead: raised above the head, brought straight down in front.
    "s_overhead": dict(wind=((0.06, 0.04, 0.4), (0.1, 0.55, 0.83)), mid=((0.06, -0.38, 0.22), (0.05, -0.85, 0.5)),
                       end=((-0.02, -0.5, -0.18), (0.05, -0.75, -0.65)), twist=(-10, 8), lean=(-4, 14),
                       pole=(-1, 0.2, -0.3), open=0.6, length=1.0),
    # Thrust: drawn back at the hip, driven straight ahead.
    "s_thrust": dict(wind=((-0.24, 0.1, -0.04), (0.03, -1, 0.08)), mid=((-0.14, -0.25, -0.04), (0.03, -1, 0.04)),
                     end=((-0.1, -0.46, 0.0), (0.06, -1, -0.06)), twist=(-22, 18), lean=(0, 8),
                     pole=(-1, 0.3, -0.6), open=0.5, length=0.8, edge=False),
}


def sword_cut(skeleton, t, cut, style="shield"):
    """style: "shield" (sword and shield), "free" (the sword alone, the left arm free) or "great" (a longsword
    in both hands)."""
    guard = guard_wrist(skeleton, style)
    rest_blade = GREAT_GUARD if style == "great" else SWORD_GUARD
    # Wound up (0..0.32), then the blow: slow to start and fastest as it lands (0.34..0.56), carried on
    # past where it was aimed (follow-through, back by 0.72), and back to the guard (0.72..1).
    wind = smooth(span(t, 0.0, 0.32))
    s_ = span(t, 0.34, 0.56)
    strike = s_ * s_
    follow = 0.12 * math.sin(math.pi * span(t, 0.56, 0.72))
    back = smooth(span(t, 0.72, 1.0))
    held = strike * (1 - back)
    stance(skeleton, sword=style != "great", great=style == "great", shield="guard" if style == "shield" else "none")
    feet = fight_footwork(skeleton, smooth(span(t, 0.28, 0.5)) * (1 - back), 0.25 * wind * (1 - strike) + 0.5 * held,
                          rise=wind * (1 - strike) * (1 if cut["wind"][0][2] > 0.2 else 0))
    # Turning the body about the vertical (a positive turn brings the right shoulder forward): the hips lead,
    # the shoulders follow, the arm comes last.
    hips, shoulders = _cut_turns(cut, t)
    turn(skeleton, "pelvis", UP, hips)
    turn(skeleton, "spine_02", UP, shoulders)
    turn(skeleton, "spine_02", RIGHT, -(cut["lean"][0] * wind * (1 - strike) + cut["lean"][1] * held))
    look_ahead(skeleton, hips + shoulders)
    plant_feet(skeleton, feet)
    if style == "free":
        # The free arm goes out behind for balance as he strikes.
        out = max(wind, strike) * (1 - back)
        arm(skeleton, "l", Vector((0.42, 0.0, -1)).lerp(Vector((0.7, 0.35, -0.7)), out),
            Vector((0.35, -0.3, -1)).lerp(Vector((0.5, 0.1, -0.8)), out))
    elif style == "shield" and cut["open"]:
        out = cut["open"] * smooth(span(t, 0.0, 0.22)) * (1 - back)
        arm(skeleton, "l", Vector((0.42, -0.62, -1)).lerp(Vector((0.9, -0.35, -0.55)), out),
            Vector((-1, -0.3, 0.14)).lerp(Vector((-0.3, -1, 0.1)), out))
    bpy.context.view_layer.update()
    at, blade = _cut_path(cut, t, guard, rest_blade)
    # Which way the blade is moving, for its edge to go first: through the blow, and on the way to it (the
    # sword is turned in the hand while it is wound up); after the blow it eases back to how it is held.
    edge, edge_weight = None, 0.0
    if cut.get("edge", True):
        reach_out = 0.6 if style == "great" else 0.5
        e_t = min(max(t, 0.38), 0.55)
        a0, b0 = _cut_path(cut, e_t - 0.01, guard, rest_blade)
        a1, b1 = _cut_path(cut, e_t + 0.01, guard, rest_blade)
        edge = (a1 + b1.normalized() * reach_out) - (a0 + b0.normalized() * reach_out)
        # (and as the hips and the shoulders turn, they carry the arm round with them)
        pb = skeleton.pose.bones
        point = pb["upperarm_r"].head + (a0 + a1) / 2 + (b0 + b1).normalized() * reach_out
        (h0, s0), (h1, s1) = _cut_turns(cut, e_t - 0.01), _cut_turns(cut, e_t + 0.01)
        for pivot, degrees in ((pb["pelvis"].head, h1 - h0), (pb["spine_02"].head, s1 - s0)):
            edge += UP.cross(point - pivot) * math.radians(degrees)
        edge_weight = EDGE_WEIGHT * smooth(span(t, 0.05, 0.3)) * (1 - back)
    if style == "great":
        # (to his left at the end of a cut that way, the left elbow goes forward, off his chest)
        two_handed(skeleton, at, blade.normalized(), cut["pole"],
                   pole_l=Vector((0.8, -0.5, -1)).lerp(Vector(cut.get("pole_l", (0.8, -0.5, -1))), held),
                   edge=edge, edge_weight=edge_weight, slack=cut.get("aim_slack"))
    else:
        shoulder = skeleton.pose.bones["upperarm_r"].head.copy()
        reach(skeleton, "r", shoulder + at, pole=cut["pole"])
        point_spear(skeleton, blade.normalized(), edge, edge_weight, cut.get("aim_slack"))


def _cut_turns(cut, t):
    """How far (degrees) a cut has the hips and the shoulders turned at time t: the hips lead, the
    shoulders follow."""
    wind = smooth(span(t, 0.0, 0.32))
    back = smooth(span(t, 0.72, 1.0))
    hips_s = smooth(span(t, 0.3, 0.5))
    shoulders_s = smooth(span(t, 0.32, 0.54))
    hips = 0.4 * (cut["twist"][0] * wind * (1 - hips_s) + cut["twist"][1] * hips_s * (1 - back))
    shoulders = 0.6 * (cut["twist"][0] * wind * (1 - shoulders_s) + cut["twist"][1] * shoulders_s * (1 - back))
    return hips, shoulders


def _cut_path(cut, t, guard, rest_blade):
    """Where a cut has the right wrist (relative to the right shoulder) and the blade pointing at time t."""
    wind = smooth(span(t, 0.0, 0.32))
    s_ = span(t, 0.34, 0.56)
    strike = s_ * s_
    follow = 0.12 * math.sin(math.pi * span(t, 0.56, 0.72))
    back = smooth(span(t, 0.72, 1.0))
    (w_at, w_dir), (m_at, m_dir), (e_at, e_dir) = ((Vector(a), Vector(d).normalized()) for a, d in
                                                   (cut["wind"], cut["mid"], cut["end"]))
    if back > 0:
        return e_at.lerp(guard, back), e_dir.lerp(rest_blade, back)
    if t >= 0.34:
        # Through the middle point: a curve whose control point puts it there halfway (and on along it
        # for the follow-through).
        c = strike + follow
        control = 2 * m_at - (w_at + e_at) / 2
        at = w_at * (1 - c) ** 2 + control * (2 * c * (1 - c)) + e_at * c ** 2
        blade = w_dir.lerp(m_dir, c * 2) if c < 0.5 else m_dir.lerp(e_dir, c * 2 - 1)
        return at, blade
    if "via" in cut:
        via = Vector(cut["via"]).normalized()
        at = guard.lerp(w_at, wind) + Vector((0, -0.35, 0)) * math.sin(math.pi * wind)   # up in front of him
        blade = rest_blade.lerp(via, min(1.0, wind * 2)) if wind < 0.5 else via.lerp(w_dir, wind * 2 - 1)
        return at, blade
    return guard.lerp(w_at, wind), rest_blade.lerp(w_dir, wind)


# The same four attacks with a longsword in both hands: the hands work nearer the middle of the body and
# the body turns further.
GREAT_CUTS = {
    "t_swing_l": dict(wind=((-0.16, -0.38, 0.14), (-0.6, 0.55, 0.55)), mid=((0.06, -0.52, 0.02), (0.1, -1, 0.05)),
                      end=((0.18, -0.57, -0.02), (0.6, -0.8, -0.08)), twist=(-40, 40), lean=(0, 6),
                      pole=(-1, 0.3, -0.6), pole_l=(0.6, -1, -0.2), open=0.0, length=1.0, aim_slack=3),
    "t_swing_r": dict(wind=((0.24, -0.5, 0.18), (0.6, 0.45, 0.65)), mid=((0.06, -0.52, 0.02), (-0.1, -1, 0.05)),
                      end=((-0.16, -0.54, -0.04), (-0.75, -0.65, -0.1)), twist=(25, -40), lean=(0, 6),
                      pole=(-0.8, 0.2, -1), open=0.0, length=1.0, aim_slack=15),
    # (wound up through point-up: the blade goes up before it goes back, over his head rather than through it)
    "t_overhead": dict(wind=((0.12, 0.08, 0.45), (0.05, 0.5, 0.86)), mid=((0.12, -0.35, 0.2), (0.05, -0.85, 0.5)),
                       end=((0.12, -0.45, -0.22), (0.05, -0.75, -0.65)), twist=(-8, 8), lean=(-4, 14),
                       pole=(-1, 0.2, -0.4), open=0.0, length=1.1, via=(0.0, -0.1, 1.0)),
    # (the grip and pommel reach 30 cm back from the hands: the hands stay well out in front, the point up
    # while drawn back so the pommel is low, and the thrust comes as much from the step as from the arms)
    "t_thrust": dict(wind=((0.16, -0.5, -0.14), (0.05, -0.85, 0.5)), mid=((0.16, -0.55, -0.13), (0.05, -1, 0.15)),
                     end=((0.16, -0.58, -0.1), (0.05, -1, 0.02)), twist=(-15, 10), lean=(0, 8),
                     pole=(-1, 0.2, -0.6), open=0.0, length=0.9, edge=False),
}


def sword_parry(skeleton, t, style):
    """Without a shield: the blade comes up across in front of the face, edge out, held there."""
    k = span(t, 0.0, 0.3)
    up = ease_out(k) + 0.08 * math.sin(math.pi * k) * (1 - k)
    stance(skeleton, crouch=0.5 * smooth(k), sword=style != "great", great=style == "great", shield="none")
    turn(skeleton, "spine_02", RIGHT, -6 * up)
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    shoulder = pb["upperarm_r"].head.copy()
    start = pb["lowerarm_r"].tail - shoulder
    goal = Vector((0.12, -0.34, 0.18)) if style == "great" else Vector((0.06, -0.36, 0.2))
    rest_blade = GREAT_GUARD if style == "great" else SWORD_GUARD
    blade = rest_blade.lerp(Vector((0.95, -0.1, 0.35)).normalized(), up).normalized()
    if style == "great":
        two_handed(skeleton, start.lerp(goal, up), blade, pole=(-1, 0.1, -0.5), edge=FRONT, edge_weight=0.5 * up)
    else:
        reach(skeleton, "r", shoulder + start.lerp(goal, up), pole=(-1, 0.1, -0.5))
        point_spear(skeleton, blade, FRONT, 0.5 * up)


# Spear thrusts other than the underarm one with the shield (attack_pose): (grip, shield) -> where the
# wrist is (relative to the right shoulder) and where the point goes, drawn back and at full reach; pole
# for the elbow; twist (degrees, + turns the left shoulder forward). Without a shield the left hand takes
# the shaft 55 cm ahead of the right.
SPEAR_THRUSTS = {
    ("under", "none"): dict(wind=((-0.13, 0.2, -0.33), (0.2, -1, 0.15)), hit=((-0.07, -0.32, -0.25), (0.18, -1, 0.06)),
                            pole=(-1, 0.3, -0.7), twist=28),
    ("over", "guard"): dict(wind=((-0.1, 0.1, 0.28), (0.04, -0.9, -0.42)), hit=((0.0, -0.42, 0.2), (0.03, -0.92, -0.38)),
                            pole=(-1, 0.5, 0.3), twist=8),
    ("over", "none"): dict(wind=((-0.1, 0.12, 0.28), (0.06, -0.9, -0.42)), hit=((0.0, -0.4, 0.18), (0.04, -0.92, -0.38)),
                           pole=(-1, 0.5, 0.3), twist=22),
}


def left_hand_on_shaft(skeleton, amount, along=0.55):
    """Bring the left hand from where it hangs onto the spear shaft, `along` metres ahead of the right fist."""
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    hang = pb["lowerarm_l"].tail.copy()
    hand = pb["hand_r"]
    fist = hand.head + Vector(hand.matrix.col[1][:3]) * 0.065
    point = (hand.matrix.to_3x3() @ SPEAR_AXIS["local"]).normalized()
    # Forward round the belly on the way, not across it.
    target = hang.lerp(fist + point * along, amount) + Vector((0, -0.2, 0.04)) * math.sin(math.pi * amount)
    reach(skeleton, "l", target, pole=(0.6, -1, -0.4))
    if amount > 0 and "l" in GRIP_AXIS:
        bpy.context.view_layer.update()
        loose = (pb["hand_l"].matrix.to_3x3() @ GRIP_AXIS["l"]).normalized()
        grip(skeleton, "l", loose.lerp(point, amount))


def spear_thrust(skeleton, t, grip, shield):
    move = SPEAR_THRUSTS[(grip, shield)]
    draw = smooth(span(t, 0.0, 0.35))
    hit = ease_in(span(t, 0.36, 0.47))   # fastest as it lands
    back = smooth(span(t, 0.62, 1.0))
    held = hit * (1 - back)
    stance(skeleton, shield=shield)
    feet = fight_footwork(skeleton, smooth(span(t, 0.3, 0.46)) * (1 - smooth(span(t, 0.64, 1.0))),
                          0.3 * draw * (1 - hit) + 0.55 * held, rise=0.5 * draw * (1 - hit) * (grip == "over"))
    if shield == "guard":
        turn(skeleton, "upperarm_l", RIGHT, 18 * held)
    set_to = max(draw, hit) * (1 - back)
    hips = -0.4 * move["twist"] * set_to
    shoulders = -0.6 * move["twist"] * set_to - 8 * draw * (1 - hit) + 8 * held
    turn(skeleton, "pelvis", UP, hips)
    turn(skeleton, "spine_02", UP, shoulders)
    turn(skeleton, "spine_02", RIGHT, -8 * held)
    look_ahead(skeleton, hips + shoulders)
    plant_feet(skeleton, feet)
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    shoulder = pb["upperarm_r"].head.copy()
    start, upright = pb["lowerarm_r"].tail - shoulder, Vector((0, -0.05, 1)).normalized()
    (w_at, w_dir), (h_at, h_dir) = ((Vector(a), Vector(d).normalized()) for a, d in (move["wind"], move["hit"]))
    if back > 0:
        # (out to the right on the way back too, the butt clear of the skirt)
        at, point = h_at.lerp(start, back) + Vector((-0.1, 0, 0)) * math.sin(math.pi * back), h_dir.lerp(upright, back)
    elif hit > 0:
        at, point = w_at.lerp(h_at, hit), w_dir.lerp(h_dir, hit)
    else:
        # Out to the right on the way, so the shaft and its butt swing clear of the shield and the head.
        at, point = start.lerp(w_at, draw) + Vector((-0.12, 0, 0)) * math.sin(math.pi * draw), upright.lerp(w_dir, draw)
    reach(skeleton, "r", shoulder + at, pole=move["pole"])
    point_spear(skeleton, point.normalized())
    if shield == "none":
        left_hand_on_shaft(skeleton, smooth(span(t, 0.0, 0.3)) * (1 - smooth(span(t, 0.75, 1.0))))


def spear_block_pose(skeleton, t):
    """Without a shield: the spear comes up across the body in both hands, shaft level with the chin."""
    k = span(t, 0.0, 0.3)
    up = ease_out(k) + 0.08 * math.sin(math.pi * k) * (1 - k)
    stance(skeleton, crouch=0.5 * smooth(k), shield="none")
    turn(skeleton, "spine_02", RIGHT, -6 * up)
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    shoulder = pb["upperarm_r"].head.copy()
    start = pb["lowerarm_r"].tail - shoulder
    reach(skeleton, "r", shoulder + start.lerp(Vector((0.04, -0.32, 0.08)), up), pole=(-1, 0.2, -0.6))
    point_spear(skeleton, Vector((0, -0.05, 1)).lerp(Vector((1, -0.15, 0.3)), up).normalized())
    left_hand_on_shaft(skeleton, smooth(k), along=0.5)


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
    # He turns to the left as the hand crosses to the hilt: the right shoulder comes forward, the hand
    # reaches the hilt without the forearm dragging across his belly.
    turn(skeleton, "pelvis", UP, 10 * to_hilt * (1 - pull))
    turn(skeleton, "spine_02", UP, 22 * to_hilt * (1 - pull) - 6 * pull * (1 - ready))
    # The shield arm opens out to the left to make room, and returns as the sword comes to the guard.
    out = smooth(span(t, 0.0, 0.2)) * (1 - ready)
    arm(skeleton, "l", Vector((0.42, -0.62, -1)).lerp(Vector((0.9, -0.35, -0.55)), out),
        Vector((-1, -0.3, 0.14)).lerp(Vector((-0.3, -1, 0.1)), out))
    bpy.context.view_layer.update()
    pb = skeleton.pose.bones
    pelvis = pb["pelvis"].matrix @ skeleton.data.bones["pelvis"].matrix_local.inverted()
    hilt = pelvis @ SHEATH["grip"]
    up = (pelvis.to_3x3() @ SHEATH["up"]).normalized()
    shoulder = pb["upperarm_r"].head.copy()
    rest = pb["lowerarm_r"].tail.copy()
    at_hilt = hilt + Vector((-0.02, -0.08, 0.05))   # the hand closes on the grip from in front and above
    drawn = at_hilt + up * 0.62 + Vector((-0.05, -0.3, 0.1))   # (out in front, the blade clear of the skirt)
    front = pelvis @ SHEATH["front"]
    s_ = to_hilt
    across = rest * (1 - s_) ** 2 + front * (2 * s_ * (1 - s_)) + at_hilt * s_ ** 2
    wrist = across.lerp(drawn, pull).lerp(shoulder + guard, ready)
    reach(skeleton, "r", wrist, pole=(-0.6, -1, 0.1))   # the elbow forward, so the forearm clears the belly
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
    arm(skeleton, "l", (0.42 - 0.2 * up, -0.62 - 0.4 * up, -1 + 0.85 * up), (-1, -0.3, 0.14 + 0.4 * up))
    turn(skeleton, "spine_02", RIGHT, -8 * up)
    turn(skeleton, "head", RIGHT, 8 * up)


SHIELD_ROLL = -90


def death_pose(skeleton, t, sword=False, shield="guard", great=False, crossbow=False):
    """Struck (0..0.15): the body jerks back. Knees buckle (0.1..0.45). Gravity takes him backwards
    (0.35..0.8), he hits the ground with a small rebound (0.8..0.95) and lies still, head rolled aside."""
    hit = ease_out(span(t, 0.0, 0.15)) * (1 - 0.6 * smooth(span(t, 0.15, 0.4)))
    buckle = smooth(span(t, 0.1, 0.42))
    fall = ease_in(span(t, 0.4, 0.82))
    rebound = math.sin(math.pi * span(t, 0.8, 0.95)) * 0.06
    settle = smooth(span(t, 0.8, 1.0))
    stance(skeleton, spear_up=False, sword=sword, shield=shield, great=great, crossbow=crossbow)
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
    open_l = max(smooth(span(t, 0.0, 0.25)), fall)
    # (forward first, so the shield and its arm do not cross his chest)
    arm(skeleton, "l", (0.42 + 0.6 * open_l, -0.72 - 0.8 * math.sin(math.pi * open_l) * (1 - fall) + 0.9 * fall, -1 + 0.9 * open_l),
        (-1 + 1.6 * open_l, -0.3 + 0.5 * fall, 0.14 - 0.12 * fall), twist=SHIELD_ROLL * fall)
    arm(skeleton, "r", (-0.22 - 0.9 * fling, 0.5 * fall, -1 + 0.7 * fling), (-0.05 - 0.9 * fling, -1 + 1.3 * fall, 0.1))
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
    CARRY["free"] = False
    stance_fn(skeleton)
    carry_crossbow(skeleton)
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


def sword(mats, name, blade_length=0.78, grip_length=0.1, guard_width=0.19):
    """A sword, crossguard at the origin, blade along +Z, grip and pommel below: an arming sword by
    default, a longsword (a grip for two hands) with longer measures."""
    parts = []
    blade = bmesh.new()
    pts = [(-0.024, 0.0), (0.024, 0.0), (0.016, blade_length - 0.08), (0.0, blade_length), (-0.016, blade_length - 0.08)]
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
    for size, z, mat in (((guard_width, 0.018, 0.018), 0.0, mats["steel"]),
                         ((0.026, 0.026, grip_length), -0.01 - grip_length / 2, mats["leather"])):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2] + z))
        parts.append(mesh_obj(f"{name}_hilt", bm, mat, smooth=False))
    pommel = bmesh.new()
    bmesh.ops.create_uvsphere(pommel, u_segments=10, v_segments=6, radius=0.025)
    for v in pommel.verts:
        v.co.y *= 0.55
        v.co.z -= 0.025 + grip_length
    parts.append(mesh_obj(f"{name}_pommel", pommel, mats["steel"]))
    return parts


# The crossbow, as held in the stance: the fist round the stock's wrist at the origin, the stock along +Z
# (forward when aimed), its top (the groove the bolt lies in) towards XBOW_TOP, the steel prod across X at the
# front with the stirrup beyond it, the string spanned back to the nut.
XBOW = dict(butt=-0.06, nut=0.3, prod=0.6, half_prod=0.36, sweep=0.07, stirrup=0.14, bolt=0.34)
XBOW_ROLL = 90   # degrees the crossbow is turned about its stock in the fist (0: its top towards -Y in the stance)
XBOW_TILT = -50  # degrees its stock leans over from upright in the fist (- away from the way the fingers point:
                 # held like a pistol's grip, the stock runs on ahead of the forearm)
XBOW_TOP = Vector((0, -1, 0))   # (in crossbow()'s own frame)


def _box(center, size, axes=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    x, y, z = axes or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    for v in bm.verts:
        v.co = Vector(center) + x * v.co.x * size[0] + y * v.co.y * size[1] + z * v.co.z * size[2]
    return bm


def _rod(a, b, radius, segments=6):
    """A thin round rod from a to b."""
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=(b - a).length)
    m = Matrix.Translation((a + b) / 2) @ (b - a).to_track_quat("Z", "Y").to_matrix().to_4x4()
    for v in bm.verts:
        v.co = m @ v.co
    return bm


def prod_tip(sign):
    return Vector((sign * XBOW["half_prod"], 0, XBOW["prod"] - XBOW["sweep"]))


def crossbow(mats):
    """(rigid parts, the string, the bolt in the groove, a bolt for the hand). The string's middle vertices
    are the ones nearest the nut (see infantry(), which ties them to the nock's bone)."""
    top = XBOW_TOP
    parts = []
    # The stock, a little deeper at the butt, and the trigger lever under it.
    parts.append(mesh_obj("xbow_stock", _box((0, 0, (XBOW["butt"] + XBOW["prod"] + 0.02) / 2),
                                             (0.04, 0.045, XBOW["prod"] + 0.02 - XBOW["butt"])), mats["dark_wood"], smooth=False))
    parts.append(mesh_obj("xbow_butt", _box((0, 0.008, XBOW["butt"] + 0.06), (0.046, 0.07, 0.12)), mats["dark_wood"], smooth=False))
    parts.append(mesh_obj("xbow_lever", _rod((0, 0.03, 0.05), (0, 0.07, -0.16), 0.006), mats["steel"]))
    parts.append(mesh_obj("xbow_nut", _rod((-0.015, -0.026, XBOW["nut"]), (0.015, -0.026, XBOW["nut"]), 0.011, 8), mats["steel"]))
    # The prod: a steel bow across the front, its ends swept back.
    prod = bmesh.new()
    n = 9
    for i in range(n):
        x0, x1 = (-1 + 2 * i / n), (-1 + 2 * (i + 1) / n)
        a = Vector((x0 * XBOW["half_prod"], 0, XBOW["prod"] - XBOW["sweep"] * x0 * x0))
        b = Vector((x1 * XBOW["half_prod"], 0, XBOW["prod"] - XBOW["sweep"] * x1 * x1))
        thick = 0.016 - 0.006 * max(abs(x0), abs(x1))
        piece = _rod(a, b, thick, 6)
        piece.to_mesh(tmp := bpy.data.meshes.new("tmp"))
        prod.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    parts.append(mesh_obj("xbow_prod", prod, mats["steel"]))
    # The stirrup, an iron loop in front of the prod.
    st = bmesh.new()
    front = XBOW["prod"] + 0.01
    corners = [(-0.05, front), (-0.06, front + XBOW["stirrup"]), (0.06, front + XBOW["stirrup"]), (0.05, front)]
    for (xa, za), (xb, zb) in zip(corners, corners[1:]):
        _rod((xa, 0, za), (xb, 0, zb), 0.006).to_mesh(tmp := bpy.data.meshes.new("tmp"))
        st.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    parts.append(mesh_obj("xbow_stirrup", st, mats["steel"]))
    # The string: two straight lengths from the prod's tips to its middle (on the nut when spanned).
    middle = Vector((0, top.y * 0.02, XBOW["nut"]))
    string = bmesh.new()
    for sign in (-1, 1):
        _rod(prod_tip(sign), middle, 0.003, 4).to_mesh(tmp := bpy.data.meshes.new("tmp"))
        string.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    string_obj = mesh_obj("xbow_string", string, mats["leather"])

    def bolt(name):
        bm = _rod((0, 0, 0), (0, 0, XBOW["bolt"]), 0.006, 6)
        head = bmesh.new()
        bmesh.ops.create_cone(head, cap_ends=True, segments=4, radius1=0.012, radius2=0.0, depth=0.04)
        for v in head.verts:
            v.co.z += XBOW["bolt"] + 0.02
        head.to_mesh(tmp := bpy.data.meshes.new("tmp"))
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        for sign in (-1, 1):   # two leather vanes at the back
            _box((sign * 0.012, 0, 0.04), (0.018, 0.002, 0.06)).to_mesh(tmp := bpy.data.meshes.new("tmp"))
            bm.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        return mesh_obj(name, bm, mats["steel"], smooth=False)

    in_groove = bolt("xbow_bolt")
    in_groove.data.transform(Matrix.Translation((0, top.y * 0.03, XBOW["nut"] + 0.005)))
    return parts, string_obj, in_groove, bolt("hand_bolt")


XBOW_AXES = {"top": None, "stock": None}   # the crossbow's top in the right hand's frame (measured when it is bound)
QUIVER = {"mouth": None}     # where the bolts are taken from, in the rest pose


def tie_string(skeleton, string, fist, roll):
    """Bind the string: its ends to the crossbow, its middle to the nock's bone, which runs from where the
    loose string lies (by the prod) to the nut, so scaling it along its length moves the middle between the
    two (span_string())."""
    CARRY["free"] = False
    stance(skeleton)
    carry_crossbow(skeleton)
    pb, bones = skeleton.pose.bones, skeleton.data.bones
    for name in PROP_BONES:
        pb[name].scale = (1, 1, 1)
    bpy.context.view_layer.update()
    to_rest = bones["prop_xbow"].matrix_local @ pb["prop_xbow"].matrix.inverted()
    loose = to_rest @ (fist + roll @ Vector((0, XBOW_TOP.y * 0.02, XBOW["prod"] - XBOW["sweep"])))
    spanned = to_rest @ (fist + roll @ Vector((0, XBOW_TOP.y * 0.02, XBOW["nut"])))
    reset_pose(skeleton)
    bpy.context.view_layer.objects.active = skeleton
    bpy.ops.object.mode_set(mode="EDIT")
    b = skeleton.data.edit_bones.new(NOCK)
    b.head, b.tail = loose, spanned
    b.parent = skeleton.data.edit_bones["prop_xbow"]
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(skeleton)
    string.data.transform(to_rest)
    ends, middle = string.vertex_groups.new(name="prop_xbow"), string.vertex_groups.new(name=NOCK)
    for v in string.data.vertices:
        (middle if (v.co - spanned).length < 0.02 else ends).add([v.index], 1.0, "REPLACE")
    string.parent = skeleton
    mod = string.modifiers.new("skeleton", "ARMATURE")
    mod.object = skeleton
    return string


def quiver(mats, length=0.4):
    """A bolt case: open at the top (the origin), hanging down along -Z, the bolts' vanes showing."""
    bm = _box((0, 0, -length / 2), (0.1, 0.06, length))
    for i, (x, y) in enumerate(((-0.03, -0.012), (0.0, 0.01), (0.028, -0.008), (-0.012, 0.014), (0.02, 0.016))):
        _box((x, y, 0.03), (0.014, 0.003, 0.06)).to_mesh(tmp := bpy.data.meshes.new("tmp"))
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return mesh_obj("quiver", bm, mats["leather"], smooth=False)


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


def skirt(body, dom, skeleton, name, z_top, z_bottom, margin, mat, flare=0.0, segments=48, step=0.035, bones="skirt",
          frame=None, slit_z=-1.0):
    """A skirt hanging from the hips: at each height an ellipse around the body (both legs together below
    the crotch), pushed out by margin (and flare towards the hem). Near the waist it follows the pelvis;
    below that its panels' bones (named bones_NN, see push_skirts()), by height against the panels' top,
    middle and hem (frame: those of the skirt whose panels these are; by default its own). Below slit_z it is
    slit in front and behind. Returns the object and its rings (z, centre x, centre y, half widths x and y)."""
    pts = [(v.co, b) for v, b in zip(body.data.vertices, dom) if b in TORSO_BONES or b in LEG_BONES]
    rings = []
    z = z_top
    while z > z_bottom - 1e-6:
        near = [c for c, _ in pts if abs(c.z - z) < 0.02]
        x0, x1 = min(c.x for c in near), max(c.x for c in near)
        y0, y1 = min(c.y for c in near), max(c.y for c in near)
        rings.append((z, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2))
        z -= step
    # Near the waist the cloth moves as the body under it does: as the nearest point of the hips and thighs
    # (the hose under it has the same weights, so the two move together and a lifted thigh does not come
    # out through the cloth over it).
    under = [(i, v.co.copy()) for i, (v, b) in enumerate(zip(body.data.vertices, dom)) if b == "pelvis" or b in LEG_BONES]
    tree = KDTree(len(under))
    for k, (_, co) in enumerate(under):
        tree.insert(co, k)
    tree.balance()
    names = {g.index: g.name for g in body.vertex_groups}

    def skin_weights(co):
        _, k, _ = tree.find(co)
        # (pelvis and thighs only: the belt over the top is on the pelvis, and must not be gone through when
        # the spine bends)
        w = {names[g.group]: g.weight for g in body.data.vertices[under[k][0]].groups
             if g.weight > 0.01 and names[g.group] in ("pelvis", "thigh_l", "thigh_r")}
        if not w:
            return {"pelvis": 1.0}
        total = sum(w.values()) or 1.0
        return {b: x / total for b, x in w.items()}

    n = PANELS
    if frame is None:
        frame = dict(top=rings[0][0], bottom=rings[-1][0], mid=rings[len(rings) // 2][0])
    # Slit in front and behind from the crotch down (as surcoats and hauberks were, to walk and ride in):
    # below slit_z each half hangs over its own leg. The seams are at 90 degrees (behind) and 270 (in front),
    # between panels (panel centres are half a step off them).
    front_seam, back_seam = segments * 3 // 4, segments // 4

    def half_of(a):
        return "right" if math.pi / 2 <= a % (2 * math.pi) <= 3 * math.pi / 2 else "left"

    def panels_at(a, half):
        """The two panels a point at angle a hangs from, and its share of the first; within its own half
        below the slit."""
        f = (a % (2 * math.pi)) / (2 * math.pi) * n - 0.5
        j0 = int(math.floor(f)) % n
        frac = f - math.floor(f)
        j1 = (j0 + 1) % n
        if half:
            if panel_half(j1) != half:
                return j0, j0, 1.0
            if panel_half(j0) != half:
                return j1, j1, 1.0
        return j0, j1, 1 - frac

    bm = bmesh.new()
    verts = []
    weights = []
    shaped = []
    seam_copies = []
    for k, (z, cx, cy, rx, ry) in enumerate(rings):
        t = k / max(1, len(rings) - 1)
        grow = margin + flare * t
        shaped.append((z, cx, cy, rx + grow, ry + grow * 0.9))
        split = z < slit_z
        # Folds: the cloth falls in soft vertical folds, deeper towards the hem.
        fold = 0.003 + 0.035 * t * t   # (barely any under the belt)

        def place(a):
            bulge = fold * (0.5 + 0.5 * math.cos(FOLDS * a))
            return (cx + (rx + grow + bulge) * math.cos(a), cy + (ry + grow * 0.9 + bulge) * math.sin(a), z)

        def weigh(x, y, a, half):
            # From the body at the top to the panels below (the upper part of a panel above its middle, the
            # lower part below, bending over a wide band rather than at a hinge).
            down = (frame["top"] - z) / (frame["top"] - frame["bottom"])
            panel = panel_share(down)
            low = smooth(clamp01((frame["mid"] + 0.1 - z) / 0.2))
            # (the band under the belt stays on the pelvis with the belt)
            under_belt = 1 - smooth(clamp01((down - 0.1) / 0.1))
            skin = skin_weights(Vector((x, y, z)))
            skin = {b: v * (1 - under_belt) for b, v in skin.items()}
            skin["pelvis"] = skin.get("pelvis", 0) + under_belt
            w = {b: v * (1 - panel) for b, v in skin.items()}
            j0, j1, share0 = panels_at(a, half)
            for j, share in ((j0, share0), (j1, 1 - share0)):
                for part_name, part in (("", 1 - low), ("_lo", low)):
                    if part > 0 and share > 0:
                        key = f"{bones}_{j:02d}{part_name}"
                        w[key] = w.get(key, 0) + panel * share * part
            return w

        row = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            x, y, _ = place(a)
            row.append(bm.verts.new((x, y, z)))
            # On a seam, the vertex itself is the half before it (by angle); a copy, made below, the half after.
            if split and i in (front_seam, back_seam):
                half = "right" if i == front_seam else "left"
            else:
                half = half_of(a) if split else None
            weights.append(weigh(x, y, a, half))
        verts.append(row)
        seam_copies.append({})
        if split:
            for i, half in ((front_seam, "left"), (back_seam, "right")):
                a = 2 * math.pi * i / segments
                x, y, _ = place(a)
                seam_copies[k][i] = (x, y, z, weigh(x, y, a, half))
    # The seam copies go after the regular rings, so a vertex's place in the rings stays ring * segments + step.
    copies = {}
    for k, found in enumerate(seam_copies):
        for i, (x, y, z, w) in found.items():
            copies[(k, i)] = bm.verts.new((x, y, z))
            weights.append(w)
    for k, (a_row, b_row) in enumerate(zip(verts, verts[1:])):
        for i in range(segments):
            j = (i + 1) % segments
            corners = [a_row[i], a_row[j], b_row[j], b_row[i]]
            # The face just after a seam takes the copies of the seam's vertices where the slit is open.
            if i in (front_seam, back_seam):
                if (k, i) in copies:
                    corners[0] = copies[(k, i)]
                if (k + 1, i) in copies:
                    corners[3] = copies[(k + 1, i)]
            bm.faces.new(corners)
    obj = mesh_obj(name, bm, mat)
    for bone in sorted({b for w in weights for b in w}):
        g = obj.vertex_groups.new(name=bone)
        for i, w in enumerate(weights):
            if w.get(bone, 0) > 0.001:
                g.add([i], w[bone], "REPLACE")
    obj.parent = skeleton
    m = obj.modifiers.new("skeleton", "ARMATURE")
    m.object = skeleton
    return obj, shaped


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
    # The coat's skirt reaches mid-calf, slit in front and behind from the crotch down.
    slit_z = hip_z - 0.1   # the crotch
    coat_skirt, coat_rings = skirt(body, dom, skeleton, "coat_skirt", hip_z + 0.06, knee_z - 0.12, 0.05, mats["cloth"],
                                   flare=0.1, slit_z=slit_z)
    add_skirt_bones(skeleton, "skirt", coat_rings)
    SKIRTS["skirt"]["slit"] = slit_z
    # The hauberk's skirt, to the knee under the coat and slit the same way, lined into the same panels: the
    # two hang together as one (a point of the mail moves as the point of the coat outside it), so neither
    # goes through the other.
    mail_skirt, mail_rings = skirt(body, dom, skeleton, "mail_skirt", hip_z + 0.06, knee_z + 0.03, 0.028, mats["mail"],
                                   flare=0.03, frame=SKIRTS["skirt"], slit_z=slit_z)
    # Hose up to mid-thigh: above that the mail skirt always covers the leg, and the top of the thigh, which
    # swells forward through the groin as a knee comes up, came out through the front of the coat's skirt.
    hose = surface_layer(body, "hose", lambda i: dom[i] in LEG_BONES and body.data.vertices[i].co.z < hip_z - 0.2,
                         lambda co: 0.006, mats["hose"], decimate=0.2)
    # Leather 14 mm out round the foot, but a thin sole: the skin's sole is on the ground (z = 0), and a thick
    # one sank the shoes into it.
    shoes = surface_layer(body, "shoes", lambda i: dom[i] in FOOT_BONES, lambda co: 0.003 + 0.011 * min(1.0, co.z / 0.03),
                          mats["leather"], decimate=0.12)
    SKIRTS["skirt"]["inside"] = [hose, shoes]
    SKIRTS["skirt"]["layers"] = [(coat_skirt, coat_rings, 48), (mail_skirt, mail_rings, 48)]
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
    # The belt holds the cloth under it to the hips: left to bend with the spine there, the coat (and the
    # mail under it) turned with the shoulders in a cut and went out through the belt on one side.
    for part in (surcoat, hauberk):
        pin_band(part, belt_z, 0.03, 0.07, "pelvis")
    front_r = max(polar(v.co)[1] for v in belt.data.vertices if abs(polar(v.co)[0]) < step)
    by0 = cy - front_r
    buckle_bm = bmesh.new()
    bmesh.ops.create_cube(buckle_bm, size=1.0)
    for v in buckle_bm.verts:
        v.co = Vector((v.co.x * 0.05, v.co.y * 0.01, v.co.z * 0.045)) + Vector((0, by0 - 0.004, belt_z))
    buckle = rigid(mesh_obj("buckle", buckle_bm, mats["steel"], smooth=False), skeleton, "pelvis")

    belt_tree = BVHTree.FromPolygons([v.co for v in belt.data.vertices], [p.vertices for p in belt.data.polygons])

    def hang_from_belt(angle, length, bulk):
        """Something hung from the belt at angle (0 the front, + to his left): its top just outside the belt,
        tilted out from hanging straight (down and a little back) only as far as it must be to stay outside
        the cloth all the way down, by bulk at the belt growing to 3 cm more at its foot (the hem swings with
        the legs). Returns its top, its foot, the way round the waist towards the back, the way out from the
        body, and the belt's outside there at a height (a function)."""
        out = Vector((math.sin(angle), -math.cos(angle), 0))

        def belt_here(z):
            z = min(max(z, belt_z - 0.018), belt_z + 0.018)
            return 0.3 - belt_tree.ray_cast(round_waist(angle, 0.3, z), -out, 0.3)[3]

        top = round_waist(angle, belt_here(belt_z - 0.015) + 0.026, belt_z - 0.015)
        along = Vector((math.cos(angle), math.sin(angle), 0)) * (1 if angle > 0 else -1)
        hang = Vector((0.0, 0.3, -0.95)).normalized()

        def clear(foot):
            for k in (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
                point = top.lerp(foot, k)
                a, r = polar(point)
                if cloth_radius(a, point.z, step / 2, 0.015) + bulk + 0.03 * k > r:
                    return False
            return True

        low, high = 0.0, 1.5
        for _ in range(24):
            tilt = (low + high) / 2
            if clear(top + (hang + out * tilt).normalized() * length):
                high = tilt
            else:
                low = tilt
        return top, top + (hang + out * high).normalized() * length, along, out, belt_here

    # Scabbard hanging from the front-left of the belt, hilt forward, angled back (as swords were worn), its
    # flat side along the body and outside the skirt all the way down: by its own half thickness plus 6 mm at
    # the belt.
    angle = math.radians(62)
    hip, tip, along, out, belt_here = hang_from_belt(angle, 0.84, 0.018)
    up = (hip - tip).normalized()
    scab = bmesh.new()
    bmesh.ops.create_cone(scab, cap_ends=True, segments=10, radius1=0.02, radius2=0.026, depth=(tip - hip).length)
    for v in scab.verts:
        v.co.y *= 0.45
    scabbard = mesh_obj("scabbard", scab, mats["leather"])
    # Flat side against the hip: thin out from the body, wide along it.
    scabbard.data.transform(Matrix.Translation((hip + tip) / 2) @ frame(up, along))
    add_hanger_bone(skeleton, "scabbard", hip + up * 0.1, up, "prop_sheath")   # pivot at the hilt: it stays put as it swings
    rigid(scabbard, skeleton, "scabbard")
    # The strap it hangs by: down the outside of the belt and over the scabbard's mouth.
    strap_bm = bmesh.new()
    bmesh.ops.create_cube(strap_bm, size=1.0)
    for v in strap_bm.verts:
        z = belt_z + v.co.z * 0.044   # over the belt only: below it the skirt moves with the legs
        v.co = round_waist(angle, belt_here(z) + 0.008 + v.co.x * 0.018, z) + along * v.co.y * 0.022
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
    SHEATH["front"] = Vector((0.0, by0 - 0.36, belt_z + 0.1))
    SHEATH["up"] = up.copy()
    # The bolt case, on the right of the belt and a little behind (out of the way of the crossbow's butt
    # carried at the right hip), hung like the scabbard.
    q_top, q_foot, q_along, _, _ = hang_from_belt(math.radians(-118), 0.4, 0.036)
    q_up = (q_top - q_foot).normalized()
    bolt_case = quiver(mats)
    bolt_case.data.transform(Matrix.Translation(q_top) @ frame(q_up, q_along))
    add_hanger_bone(skeleton, "quiver", q_top, q_up, "prop_quiver")
    rigid(bolt_case, skeleton, "prop_quiver")
    QUIVER["mouth"] = q_top + q_up * 0.04

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
        # Held well above its middle: the butt hangs 50 cm below the fist, clear of the skirt's hem.
        part.data.transform(Matrix.Translation(fists["r"] + Vector((0, 0, 0.8))))
    # The sword for the hand, upright in the fist like the spear (grip centred on the fist), its edge in line
    # with the knuckles (the way from the wrist to them), as a sword is held: a blow from the wrist and the
    # forearm then lands with the edge, not the flat. (Its edge is its X: turned about the blade to there.)
    hand_y = Vector(skeleton.pose.bones["hand_r"].matrix.col[1][:3])
    roll = Matrix.Rotation(math.atan2(hand_y.y, hand_y.x), 4, "Z")
    held = sword(mats, "held")
    for part in held:
        part.data.transform(Matrix.Translation(fists["r"] + Vector((0, 0, 0.06))) @ roll)
    # The longsword: the right hand just below the guard, room for the left below it.
    great = sword(mats, "great", blade_length=0.95, grip_length=0.24, guard_width=0.25)
    for part in great:
        part.data.transform(Matrix.Translation(fists["r"] + Vector((0, 0, 0.05))) @ roll)
    # The crossbow, its stock upright in the fist as the spear's shaft is (see crossbow()), and a bolt held
    # in the fist the same way (taken from the case in the reload).
    xbow_parts, xbow_string, xbow_bolt, hand_bolt = crossbow(mats)
    hand_x = Vector(skeleton.pose.bones["hand_r"].matrix.col[0][:3])
    xbow_roll = Matrix.Rotation(math.radians(XBOW_TILT), 4, hand_x) @ Matrix.Rotation(math.radians(XBOW_ROLL), 4, "Z")
    for part in xbow_parts + [xbow_string, xbow_bolt]:
        part.data.transform(Matrix.Translation(fists["r"]) @ xbow_roll)
    hand_bolt.data.transform(Matrix.Translation(fists["r"] - Vector((0, 0, XBOW["bolt"] / 2))))
    EDGE_AXIS["world"] = (roll.to_3x3() @ Vector((1, 0, 0))).normalized()
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
        centre = half - sleeve_short - 0.04         # from the wrist, along the hand: 4 cm inside the sleeve
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
        bind(part, skeleton, "prop_shield", stance)
    for part in spear_parts:
        bind(part, skeleton, "prop_spear", stance)
    for part in held:
        bind(part, skeleton, "prop_sword", stance)
    for part in great:
        bind(part, skeleton, "prop_great", stance)
    for part in xbow_parts:
        bind(part, skeleton, "prop_xbow", stance)
    bind(xbow_bolt, skeleton, "prop_bolt", stance)
    bind(hand_bolt, skeleton, "prop_bolt_hand", stance)
    tie_string(skeleton, xbow_string, fists["r"], xbow_roll.to_3x3())
    for mitten, bone in mittens:
        # The shield hand grips the shield's strap: it moves with the forearm, as the shield does.
        bind(mitten, skeleton, "lowerarm_l" if bone == "hand_l" else bone, stance)
    # Remember the spear's axis in the right hand's frame, for point_spear().
    stance(skeleton)
    bpy.context.view_layer.update()
    SPEAR_AXIS["local"] = (skeleton.pose.bones["hand_r"].matrix.to_3x3().inverted() @ Vector((0, 0, 1))).normalized()
    GRIP_AXIS["r"] = SPEAR_AXIS["local"].copy()
    EDGE_AXIS["local"] = (skeleton.pose.bones["hand_r"].matrix.to_3x3().inverted() @ EDGE_AXIS["world"]).normalized()
    to_hand = skeleton.pose.bones["hand_r"].matrix.to_3x3().inverted() @ xbow_roll.to_3x3()
    XBOW_AXES["top"] = (to_hand @ XBOW_TOP).normalized()
    XBOW_AXES["stock"] = (to_hand @ Vector((0, 0, 1))).normalized()
    # The left fist holds a shaft the same way, mirrored: the same mix of its knuckle line, its length and
    # the back of the hand (the back of the hand is the other way round in a mirrored hand).
    bases = {}
    for side, flip in (("r", 1), ("l", -1)):
        k = arm_rest(skeleton, side)["knuckles"]
        y = Vector((0, 1, 0))
        k = (k - y * k.dot(y)).normalized()
        bases[side] = (k, y, flip * k.cross(y))
    mix = [GRIP_AXIS["r"].dot(v) for v in bases["r"]]
    GRIP_AXIS["l"] = sum((c * v for c, v in zip(mix, bases["l"])), Vector()).normalized()
    # And the shield's face (forward, turned as it was placed above) in the left forearm's frame, for face_shield().
    face = Matrix.Rotation(math.radians(-6), 3, "Z") @ Vector((0, -1, 0))
    SHIELD_FACE["local"] = (skeleton.pose.bones["lowerarm_l"].matrix.to_3x3().inverted() @ face).normalized()
    reset_pose(skeleton)
    for part in (spear_parts + held + great + sheathed + helm_parts + [m for m, _ in mittens] + [belt, buckle, scabbard, strap]
                 + shield_parts[:1] + shield_parts[2:] + xbow_parts + [xbow_string, xbow_bolt, hand_bolt, bolt_case]):
        box_uvs(part, 0.3)
    mitten = {bone[-1]: m for m, bone in mittens}
    SKIRTS["skirt"]["outside"] = shield_parts + spear_parts + held + great + xbow_parts + [m for m, _ in mittens]
    BESIDE_SKIRT["l"] = shield_parts + [mitten["l"]]
    BESIDE_SKIRT["r"] = spear_parts + held + [mitten["r"]]
    CHECK_PARTS.clear()
    CHECK_PARTS.update({
        "torso": [cores["torso"]], "head": [cores["head"]],
        "forearm_l": [cores["forearm_l"]], "forearm_r": [cores["forearm_r"]],
        "forearm_sleeve_l": [hauberk], "forearm_sleeve_r": [hauberk],
        "mitten_l": [mitten["l"]], "mitten_r": [mitten["r"]],
        "spear": spear_parts, "sword": held, "great": great, "sheathed": sheathed,
        "shield": shield_parts, "shield_face": [shield_parts[1]], "boss": [shield_parts[2]],
        "scabbard": [scabbard, strap], "belt": [belt], "surcoat": [surcoat], "coat_skirt": [coat_skirt],
        "xbow": xbow_parts + [xbow_bolt], "quiver": [bolt_case],
        "surcoat_or_skirt": [surcoat, coat_skirt], "shoes": [shoes], "legs": [hose], "mail_skirt": [mail_skirt],
        # (what the bones bend: none of it may be drawn out far past its own size)
        "stretch": [hauberk, surcoat, coif, coat_skirt, mail_skirt, hose, shoes],
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


def posed(skeleton, pose_fn, t):
    """pose_fn at t, the crossbow carried in the right fist unless the pose let go of it."""
    CARRY["free"] = False
    pose_fn(skeleton, t)
    carry_crossbow(skeleton)


def bake_action(skeleton, name, length_s, pose_fn, loop=False, step=2, free_arms=True):
    """Record pose_fn(t in 0..1) as an action with a key every `step` frames."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    skeleton.animation_data_create()
    skeleton.animation_data.action = action
    frames = max(2, round(length_s * FPS))
    # The skirts and the scabbard swing with their weight from frame to frame (Swing); a looping clip is
    # played through once first, so it starts as it ends, already swinging.
    swing = Swing()
    if loop:
        for frame in range(0, frames, step):
            posed(skeleton, pose_fn, frame / frames)
            dress(skeleton, swing, step / FPS, free_arms)
    for frame in list(range(0, frames, step)) + [frames]:
        t = frame / frames
        posed(skeleton, pose_fn, 0.0 if (loop and frame == frames) else t)
        dress(skeleton, swing, step / FPS, free_arms)
        carry_crossbow(skeleton)
        bpy.context.view_layer.update()
        for pb in skeleton.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame + 1)
            if pb.name in KEYED_LOCATION:
                pb.keyframe_insert("location", frame=frame + 1)
            if pb.name in PROP_BONES or pb.name == NOCK:
                pb.keyframe_insert("scale", frame=frame + 1)
    skeleton.animation_data.action = None
    return action


def attack_aims():
    """Where each attack's weapon must point (armature space) at a moment of it: (t, direction, least cosine)."""
    aims = {"attack": (0.5, Vector((0, -1, 0)), 0.85)}
    for (grip, shield), move in SPEAR_THRUSTS.items():
        name = {"none": "n_", "guard": ""}[shield] + ("attack" if grip == "under" else "attack_over")
        aims[name] = (0.5, Vector(move["hit"][1]).normalized(), 0.85)
    for name, cut in SWORD_CUTS.items():
        aims[name] = (0.57, Vector(cut["end"][1]).normalized(), 0.8)
        aims["f_" + name[2:]] = (0.57, Vector(cut["end"][1]).normalized(), 0.8)
    for name, cut in GREAT_CUTS.items():
        aims[name] = (0.57, Vector(cut["end"][1]).normalized(), 0.8)
    # The crossbow straight at its mark as it looses.
    aims["x_shoot"] = (0.5, XBOW_AIM[1].normalized(), 0.95, XBOW_AXES["stock"])
    return aims


def edge_cuts():
    """The sword clips that cut (with the edge): every one but the thrusts."""
    names = []
    for name, cut in SWORD_CUTS.items():
        if cut.get("edge", True):
            names += [name, "f_" + name[2:]]
    names += [name for name, cut in GREAT_CUTS.items() if cut.get("edge", True)]
    return names


def animate(skeleton):
    # The clips are keyed at FPS frames a second, and the glTF export turns frames into seconds at the scene's
    # rate: left at Blender's 24, every motion played a quarter slower than it was made.
    bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = FPS, 1.0
    # A key on every frame (30 a second): the motions are curves, not straight lines between few keys.
    walk, run = GAITS["walk"]["cycle"], GAITS["run"]["cycle"]

    def clip(name, length, fn, loop=False):
        # (with both hands on one weapon, an arm moved out alone would let go of it)
        two_hands = name.startswith(("t_", "x_")) or name in ("n_attack", "n_attack_over", "n_block")
        return bake_action(skeleton, name, length, fn, loop=loop, step=1, free_arms=not two_hands)

    actions = [
        # Spear and shield.
        clip("idle", 4.0, idle_pose, loop=True),
        clip("walk", walk, walk_pose, loop=True),
        clip("run", run, run_pose, loop=True),
        clip("attack", 0.8, attack_pose),
        clip("attack_over", 0.8, lambda s, t: spear_thrust(s, t, "over", "guard")),
        clip("block", 0.35, block_pose),
        clip("death", 1.4, death_pose),
        # The shield carried low at his side, out of a fight.
        clip("low_idle", 4.0, lambda s, t: idle_pose(s, t, shield="low"), loop=True),
        clip("low_walk", walk, lambda s, t: walk_pose(s, t, shield="low"), loop=True),
        clip("low_run", run, lambda s, t: run_pose(s, t, shield="low"), loop=True),
        # Sword and shield.
        clip("s_idle", 4.0, lambda s, t: idle_pose(s, t, sword=True), loop=True),
        clip("s_walk", walk, lambda s, t: walk_pose(s, t, sword=True), loop=True),
        clip("s_run", run, lambda s, t: run_pose(s, t, sword=True), loop=True),
        *(clip(name, cut["length"], lambda s, t, cut=cut: sword_cut(s, t, cut)) for name, cut in SWORD_CUTS.items()),
        clip("s_block", 0.35, lambda s, t: block_pose(s, t, sword=True)),
        clip("s_death", 1.4, lambda s, t: death_pose(s, t, sword=True)),
        clip("s_low_idle", 4.0, lambda s, t: idle_pose(s, t, sword=True, shield="low"), loop=True),
        clip("s_low_walk", walk, lambda s, t: walk_pose(s, t, sword=True, shield="low"), loop=True),
        clip("s_low_run", run, lambda s, t: run_pose(s, t, sword=True, shield="low"), loop=True),
        clip("draw", 1.3, draw_pose),
        # The sword alone, the left arm free.
        clip("f_idle", 4.0, lambda s, t: idle_pose(s, t, sword=True, shield="none"), loop=True),
        clip("f_walk", walk, lambda s, t: walk_pose(s, t, sword=True, shield="none"), loop=True),
        clip("f_run", run, lambda s, t: run_pose(s, t, sword=True, shield="none"), loop=True),
        *(clip("f_" + name[2:], cut["length"], lambda s, t, cut=cut: sword_cut(s, t, cut, "free"))
          for name, cut in SWORD_CUTS.items()),
        clip("f_block", 0.35, lambda s, t: sword_parry(s, t, "free")),
        clip("f_death", 1.4, lambda s, t: death_pose(s, t, sword=True, shield="none")),
        # A longsword in both hands.
        clip("t_idle", 4.0, lambda s, t: idle_pose(s, t, great=True, shield="none"), loop=True),
        clip("t_walk", walk, lambda s, t: walk_pose(s, t, great=True, shield="none"), loop=True),
        clip("t_run", run, lambda s, t: run_pose(s, t, great=True, shield="none"), loop=True),
        *(clip(name, cut["length"], lambda s, t, cut=cut: sword_cut(s, t, cut, "great")) for name, cut in GREAT_CUTS.items()),
        clip("t_block", 0.35, lambda s, t: sword_parry(s, t, "great")),
        clip("t_death", 1.4, lambda s, t: death_pose(s, t, great=True, shield="none")),
        # A spearman without a shield: two hands on the spear to fight.
        clip("n_idle", 4.0, lambda s, t: idle_pose(s, t, shield="none"), loop=True),
        clip("n_walk", walk, lambda s, t: walk_pose(s, t, shield="none"), loop=True),
        clip("n_run", run, lambda s, t: run_pose(s, t, shield="none"), loop=True),
        clip("n_attack", 0.8, lambda s, t: spear_thrust(s, t, "under", "none")),
        clip("n_attack_over", 0.8, lambda s, t: spear_thrust(s, t, "over", "none")),
        clip("n_block", 0.35, spear_block_pose),
        clip("n_death", 1.4, lambda s, t: death_pose(s, t, shield="none")),
        # A crossbowman: no shield, the crossbow in both hands, bolts in a case at his right hip.
        clip("x_idle", 4.0, lambda s, t: idle_pose(s, t, shield="none", crossbow=True), loop=True),
        clip("x_walk", walk, lambda s, t: walk_pose(s, t, shield="none", crossbow=True), loop=True),
        clip("x_run", run, lambda s, t: run_pose(s, t, shield="none", crossbow=True), loop=True),
        clip("x_shoot", 1.2, xbow_shoot),
        clip("x_reload", 3.2, xbow_reload),
        clip("x_block", 0.35, xbow_block),
        clip("x_death", 1.4, lambda s, t: death_pose(s, t, shield="none", crossbow=True)),
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
                              export_normals=True, export_rest_position_armature=True, export_def_bones=False,
                              export_extras=True, export_anim_slide_to_zero=True)


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
        # The speed (m/s) each gait clip moves the feet at, for the renderer to match the soldier's speed.
        # Written into the model (glTF "extras" of the skeleton node).
        for name, g in GAITS.items():
            skeleton[f"{name}_speed"] = g["speed"]
        report = os.path.join(mh.CACHE, f"check_{side}.json")
        gaits = {name: g["speed"] for base, g in GAITS.items() for name in (base, "s_" + base, "low_" + base,
                                                                              "s_low_" + base, "n_" + base, "f_" + base,
                                                                              "t_" + base, "x_" + base)}
        problems = check_soldier.check(skeleton, CHECK_PARTS, [t.strips[0].action for t in skeleton.animation_data.nla_tracks],
                                       report, SPEAR_AXIS["local"], side, gaits, attack_aims(),
                                       (EDGE_AXIS["local"], edge_cuts()))
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
        # Leave out what the animations repeat (bones held still), checked to move exactly as before.
        before, after, worst = slim_glb.slim_file(path)
        print(f"{os.path.basename(path)}: {tris} triangles, {before} -> {after} bytes (animations slimmed, "
              f"largest difference {worst:.1e}), {len(bpy.data.actions)} actions")
    if failed and not allow:
        sys.exit("check_soldier found problems (see the CHECK lines); rebuild with --allow-problems to export anyway")


if __name__ == "__main__":
    main()
