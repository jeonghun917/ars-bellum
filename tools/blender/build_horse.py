"""Builds the cavalry horse from the source horse (horse_data.py: Ayan's "Animated Rigged Horse With Saddle",
CC BY 4.0) and writes it to assets/models/horse_<side>.glb with its animations.

    python tools/blender/build_horse.py [ally|enemy]

The source's own textures were not in its download: the coat, mane, hooves and tack get small generated
textures like the soldiers' (build_men.py). The horse is turned to face -Y like the soldiers, scaled to a
war horse's size (WITHERS metres at the withers) and stood with its hooves on z = 0.

Coordinates: metres, Z up, the horse faces -Y (glTF +Z, the way the battle's units face).
"""
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_men as bm  # noqa: E402  (textures, materials, UVs)
import horse_data  # noqa: E402
import slim_glb  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "assets", "models")
FPS = 30
WITHERS = 1.55   # m: a medieval war horse (destrier, courser) stood about 15 hands

COATS = {
    "ally": {"coat": (0.36, 0.22, 0.12), "mane": (0.07, 0.05, 0.04)},     # bay
    "enemy": {"coat": (0.30, 0.28, 0.27), "mane": (0.10, 0.10, 0.10)},    # dark grey
}

# Which part of the source body each bone carries (by the bone that moves a vertex most).
MANE_BONES = {f"hair_{k}.0{i}" for k in ("base", "top") for i in range(1, 7)}
TAIL_BONES = {"spine", "spine.001", "spine.002", "spine.003", "spine.004"}
HOOF_BONES = {"f_toe.L", "f_toe.R", "r_toe.L", "r_toe.R"}


def open_source():
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.ops.wm.open_mainfile(filepath=horse_data.blend_path(), load_ui=False, use_scripts=False)
    for o in list(bpy.data.objects):
        if o.type not in ("MESH", "ARMATURE"):
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    return arm, meshes


def bake_modifiers(meshes):
    """Apply each mesh's mirror, and one level of subdivision on the body and the saddle (the source is a half
    body, smoothed); the bridle's rings and the eyes are dense already and keep their own shape. The armature
    modifier stays."""
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        smooth = not o.name.startswith(("Torus", "Sphere"))
        for mod in list(o.modifiers):
            if mod.type == "SUBSURF" and not smooth:
                o.modifiers.remove(mod)
                continue
            if mod.type == "SUBSURF":
                mod.levels = 1
            if mod.type in ("MIRROR", "SUBSURF"):
                bpy.ops.object.modifier_apply(modifier=mod.name)


def normalise(arm, meshes):
    """Bake the objects' transforms into their data, then turn the horse to face -Y, scale it to WITHERS at
    the withers and stand it on z = 0, centred between its hooves."""
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    arm.data.transform(arm.matrix_world)
    arm.matrix_world = Matrix.Identity(4)
    body = max(meshes, key=lambda o: len(o.data.vertices))
    co = [v.co for v in body.data.vertices]
    ground = min(c.z for c in co)
    bones = arm.data.bones
    # The withers: the top of the back above the front legs (where the shoulders meet the neck).
    wx = bones["shoulder.L"].head_local.x
    withers = max(c.z for c in co if abs(c.x - wx) < 0.25)
    scale = WITHERS / (withers - ground)
    front_x, hind_x = bones["f_toe.L"].head_local.x, bones["r_toe.L"].head_local.x
    centre = Vector(((front_x + hind_x) / 2, 0, ground))
    n = (Matrix.Rotation(math.radians(90), 4, "Z") @ Matrix.Scale(scale, 4) @ Matrix.Translation(-centre))
    for o in meshes:
        o.data.transform(n)
        o.parent = arm
    arm.data.transform(n)
    # Position keys are in the bones' own frames: they shrink with the horse.
    for action in bpy.data.actions:
        for fc in fcurves(action):
            if fc.data_path.endswith(".location"):
                for k in fc.keyframe_points:
                    k.co.y *= scale
                    k.handle_left.y *= scale
                    k.handle_right.y *= scale
    bpy.context.view_layer.update()
    return scale


def fcurves(action):
    """An action's F-curves (Blender 5 keeps them in layered channel bags)."""
    out = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out or list(getattr(action, "fcurves", []))


def dress(arm, meshes, side):  # (returns the materials, for the stirrups)
    """New materials: coat, mane and tail, hooves, eyes, and the tack in leather."""
    base = bm.make_materials(bm.FACTIONS[side])
    c = COATS[side]
    coat = bm.material("coat", bm._image("coat", bm.grain_texture(c["coat"], size=128, seed=21, streak=1)), roughness=0.7)
    mane = bm.material("mane", bm._image("mane", bm.hair_texture(c["mane"])), roughness=0.85)
    hoof = bm.material("hoof", bm._image("hoof", bm.grain_texture((0.13, 0.12, 0.11), size=64, seed=23, streak=1)),
                       roughness=0.6)
    eye = bm.material("horse_eye", bm._image("horse_eye", bm.grain_texture((0.04, 0.03, 0.03), size=32, seed=24)),
                      roughness=0.25)
    body = max(meshes, key=lambda o: len(o.data.vertices))
    for o in meshes:
        o.data.materials.clear()
        if o is body:
            for m in (coat, mane, hoof):
                o.data.materials.append(m)
            dom = bm.dominant_bones(o)
            for p in o.data.polygons:
                bones = [dom[i] for i in p.vertices]
                if any(b in MANE_BONES or b in TAIL_BONES for b in bones):
                    p.material_index = 1
                elif all(b in HOOF_BONES for b in bones):
                    p.material_index = 2
        elif o.name.startswith("Sphere"):
            o.data.materials.append(eye)
        else:
            o.data.materials.append(base["leather"])
        bm.box_uvs(o, 0.3)
    return base


# ---------------------------------------------------------------------------------------------------------
# Gaits. As with the soldiers' walk, each hoof is put on the ground and the leg reaches it, so a hoof on the
# ground stays put: it slides back under the body at exactly the gait's speed, and the battle plays the clip
# at (the horse's speed / this). The pastern and the hoof keep their standing angle on the ground and fold
# back in the swing; the two long bones above reach the fetlock (front) or the hock (hind).

ROOT = "spine.005"   # the source rig's root: the hips; everything hangs from it
LEGS = {   # name -> (long bones (2), cannon, pastern+hoof chain end bones, front?)
    "LF": ("upper_arm.L", "forearm.L", "hand.L", "f_toe.L", True),
    "RF": ("upper_arm.R", "forearm.R", "hand.R", "f_toe.R", True),
    "LH": ("thigh.L", "shin.L", "foot.L", "r_toe.L", False),
    "RH": ("thigh.R", "shin.R", "foot.R", "r_toe.R", False),
}
FRONT, UP, SIDE = Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))

# speed m/s; cycle s; stance: share of the cycle a hoof is down; phase: when each hoof lands (share of the
# cycle); lift m; bob m (the back rises and falls this much twice a cycle); nod degrees (the head and neck).
GAITS = {
    "walk": dict(speed=1.7, cycle=1.15, stance=0.62, phase={"LH": 0.0, "LF": 0.25, "RH": 0.5, "RF": 0.75},
                 lift=0.09, bob=0.018, nod=5.0, fold=55.0),
    "trot": dict(speed=3.6, cycle=0.72, stance=0.42, phase={"LH": 0.0, "RF": 0.0, "RH": 0.5, "LF": 0.5},
                 lift=0.15, bob=0.035, nod=2.0, fold=80.0),
}


def rest_legs(arm):
    """Each leg at rest: the hoof's tip, the pastern's and the cannon's directions, which way the middle joint
    of the long bones bends (its pole) and how far the long bones reach."""
    bones = arm.data.bones
    out = {}
    for name, (upper, lower, cannon, toe, front) in LEGS.items():
        b = {k: bones[k] for k in (upper, lower, cannon, toe)}
        tip = b[toe].tail_local.copy()
        mid = b[lower].head_local
        line = (b[lower].tail_local - b[upper].head_local).normalized()
        off = mid - b[upper].head_local
        pole = (off - line * off.dot(line))
        out[name] = dict(tip=tip, toe=(b[toe].tail_local - b[toe].head_local), cannon=(b[cannon].tail_local - b[cannon].head_local),
                         pole=pole.normalized() if pole.length > 1e-4 else FRONT.copy(), front=front)
    return out


def reset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def place_body(arm, lift=0.0, pitch=0.0, roll=0.0, forward=0.0, pivot=None):
    """Move the whole body (the root) up by lift, pitch it nose-down by pitch degrees and roll it onto its
    left side by roll degrees about a line along its length through pivot (default: the root's head)."""
    pb = arm.pose.bones[ROOT]
    p = Vector(pivot) if pivot is not None else pb.head.copy()
    turn = Matrix.Rotation(math.radians(pitch), 4, "X") @ Matrix.Rotation(math.radians(roll), 4, "Y")
    m = Matrix.Translation(Vector((0, -forward, lift))) @ Matrix.Translation(p) @ turn @ Matrix.Translation(-p)
    pb.matrix = m @ pb.matrix
    bpy.context.view_layer.update()


def put_leg(arm, name, legs, tip, fold=0.0):
    """Leg `name` with its hoof's tip at tip (armature space), the pastern and cannon turned back by fold
    degrees from how they stand (0 on the ground)."""
    upper, lower, cannon, toe, front = LEGS[name]
    r = legs[name]
    turn = Matrix.Rotation(math.radians(fold), 3, SIDE)
    toe_dir = turn @ r["toe"]
    if front:
        # The pastern and hoof fold back; the cannon (forearm bone here) is reached by the long bones.
        cannon_dir = Matrix.Rotation(math.radians(fold * 0.9), 3, SIDE) @ r["cannon"]
        fetlock = tip - toe_dir
        bm.two_bone(arm, upper, lower, fetlock - cannon_dir, r["pole"])
        bm.aim(arm, lower, fetlock - cannon_dir - arm.pose.bones[lower].head)
    else:
        cannon_dir = Matrix.Rotation(math.radians(-fold * 0.6), 3, SIDE) @ r["cannon"]
        fetlock = tip - toe_dir
        hock = fetlock - cannon_dir
        bm.two_bone(arm, upper, lower, hock, r["pole"])
    bpy.context.view_layer.update()
    bm.aim(arm, cannon, cannon_dir)
    bpy.context.view_layer.update()
    bm.aim(arm, toe, toe_dir)


def gait_pose(arm, legs, t, g):
    """One cycle of a gait at t (0..1)."""
    reset(arm)
    a = 2 * math.pi * t
    place_body(arm, lift=-g["bob"] * 0.5 + g["bob"] * 0.5 * math.cos(2 * a))
    for bone, k in (("spine.010", 0.4), ("spine.011", 0.35), ("spine.012", 0.25)):
        bm.turn(arm, bone, SIDE, -g["nod"] * k * math.cos(2 * a + 0.8))
    bm.turn(arm, "spine.004", SIDE, 4 * math.sin(a))   # the tail swings with the stride
    step = g["speed"] * g["cycle"] * g["stance"]
    for name, phase in g["phase"].items():
        u = (t - phase) % 1.0
        rest = legs[name]["tip"]
        if u < g["stance"]:
            k = u / g["stance"]
            tip = rest + Vector((0, -step / 2 + step * k, 0))
            fold = 0.0
        else:
            k = (u - g["stance"]) / (1 - g["stance"])
            s = bm.smooth(k)
            tip = rest + Vector((0, step / 2 - step * s, g["lift"] * math.sin(math.pi * k)))
            fold = g["fold"] * math.sin(math.pi * min(1.0, k * 1.15))
        put_leg(arm, name, legs, tip, fold)


def idle_pose(arm, legs, t):
    """Standing: slow breaths, the head lowered a little and raised, the tail swishing, an ear turning."""
    reset(arm)
    a = 2 * math.pi * t
    place_body(arm, lift=0.006 * math.sin(2 * a))
    bm.turn(arm, "spine.010", SIDE, -3 - 3 * math.sin(a))
    bm.turn(arm, "spine.012", UP, 6 * math.sin(a + 1.0))
    bm.turn(arm, "spine.004", UP, 10 * math.sin(3 * a))
    bm.turn(arm, "ear.L", UP, 20 * max(0.0, math.sin(2 * a + 2)))
    for name in LEGS:
        put_leg(arm, name, legs, legs[name]["tip"].copy())


DEATH_FLANK = 0.3   # m: how far out to its left the flank it falls onto is


def death_pose(arm, legs, t):
    """Struck: the front legs buckle and the horse goes down onto its chest and belly, the legs folding
    under it (0..0.55); it rolls over onto its left flank (0.35..0.8) and settles, the head dropping last.
    The hooves are placed (as in the gaits) where the folding legs put them, so none goes into the ground."""
    reset(arm)
    buckle = bm.smooth(bm.span(t, 0.0, 0.35))
    hind = bm.smooth(bm.span(t, 0.15, 0.5))
    roll = bm.ease_in(bm.span(t, 0.35, 0.8))
    settle = bm.smooth(bm.span(t, 0.8, 1.0))
    place_body(arm, pitch=10 * buckle * (1 - roll))
    over = Matrix.Translation(Vector((DEATH_FLANK, 0, 0))) @ Matrix.Rotation(math.radians(84 * roll), 4, "Y") @ \
        Matrix.Translation(Vector((-DEATH_FLANK, 0, 0)))
    place_body(arm, roll=84 * roll, pivot=(DEATH_FLANK, 0, 0))
    bm.turn(arm, "spine.010", SIDE, 15 * buckle - 25 * settle)
    bm.turn(arm, "spine.012", SIDE, 20 * settle)
    for name in LEGS:
        front = LEGS[name][4]
        k = buckle if front else hind
        # Folded under the body: the front hooves back under the chest, the hind ones forward under the belly,
        # lifted as the legs fold (and carried over with the body as it rolls).
        tuck = Vector((0, 0.22 if front else -0.18, (0.16 if front else 0.1) * k)) * k
        tip = legs[name]["tip"] + tuck
        put_leg(arm, name, legs, over @ tip, fold=(100 if front else 60) * k)
    # On the ground, not in it nor above it: its lowest point (measured on the posed body, not guessed from
    # its size) is put on the ground as the legs fold under it.
    place_body(arm, lift=-lowest_point(BODY["mesh"]))


BODY = {"mesh": None}   # the horse's body mesh (set in main())


def lowest_point(obj):
    bpy.context.view_layer.update()
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    low = min((obj.matrix_world @ v.co).z for v in mesh.vertices)
    ev.to_mesh_clear()
    return low


def bake(arm, name, length_s, pose_fn, loop=False):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    frames = max(2, round(length_s * FPS))
    for frame in range(frames + 1):
        pose_fn((frame / frames) % 1.0 if loop else frame / frames)
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame + 1)
            if pb.name == ROOT:
                pb.keyframe_insert("location", frame=frame + 1)
    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    track.mute = True
    return action


def resample(arm, source, name, length_s):
    """The source's clip, keyed again at FPS (it was made at 24 frames a second). Its poses are all read
    first, then keyed: switching the armature's action back and forth while keying sent the keys astray."""
    f0, f1 = source.frame_range
    scene = bpy.context.scene
    frames = max(2, round(length_s * FPS))
    arm.animation_data.action = source
    poses = []
    for frame in range(frames + 1):
        at = f0 + (f1 - f0) * ((frame / frames) % 1.0)
        scene.frame_set(int(at), subframe=at % 1.0)
        bpy.context.view_layer.update()
        poses.append({pb.name: (pb.location.copy(), pb.matrix_basis.to_quaternion()) for pb in arm.pose.bones})
    arm.animation_data.action = None
    bpy.data.actions.remove(source)

    def pose(t):
        reset(arm)
        for pb in arm.pose.bones:
            pb.location, pb.rotation_quaternion = poses[round(t * frames)][pb.name]
        bpy.context.view_layer.update()

    return bake(arm, name, length_s, pose)


def ground_speed(arm, action, length_s):
    """How fast (m/s) a hoof on the ground moves back in a clip: the speed to play it at."""
    arm.animation_data.action = action
    frames = round(length_s * FPS)
    speeds = []
    last = None
    for frame in range(1, frames + 2):
        bpy.context.scene.frame_set(frame)
        tips = {n: arm.pose.bones[LEGS[n][3]].tail.copy() for n in LEGS}
        if last:
            for n, tip in tips.items():
                if tip.z < 0.03 and last[n].z < 0.03:
                    speeds.append((tip.y - last[n].y) * FPS)
        last = tips
    arm.animation_data.action = None
    speeds.sort()
    return speeds[len(speeds) // 2] if speeds else 0.0


def check(arm, meshes, clips):
    """Problems: in the gaits a hoof on the ground keeps the gait's speed (within 10 %) and no hoof goes 1 cm
    under the ground; in every clip nothing of the horse goes 3 cm under the ground."""
    problems = []
    scene = bpy.context.scene
    body = max(meshes, key=lambda o: len(o.data.vertices))
    for action in clips:
        arm.animation_data.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        speed = GAITS.get(action.name, {}).get("speed")
        last, skates, lowest = None, [], 0.0
        for frame in range(f0, f1 + 1):
            scene.frame_set(frame)
            tips = {n: arm.pose.bones[LEGS[n][3]].tail.copy() for n in LEGS}
            lowest_hoof = min(t.z for t in tips.values())
            if speed and last:
                for n, tip in tips.items():
                    if tip.z < 0.02 and last[n].z < 0.02:
                        v = (tip.y - last[n].y) * FPS
                        if abs(v - speed) > 0.1 * speed:
                            skates.append(f"{n}@{frame}:{v:.2f}")
            last = tips
            if lowest_hoof < -0.01:
                problems.append(f"{action.name}: a hoof {-lowest_hoof * 100:.0f} cm under the ground at frame {frame}")
                break
            if frame % 3 == 0:
                ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
                mesh = ev.to_mesh()
                lowest = min(lowest, min((body.matrix_world @ v.co).z for v in mesh.vertices))
                ev.to_mesh_clear()
        if skates:
            problems.append(f"{action.name}: a hoof on the ground slides ({', '.join(skates[:4])}; should be {speed})")
        if lowest < -0.03:
            problems.append(f"{action.name}: the body goes {-lowest * 100:.0f} cm into the ground")
    arm.animation_data.action = None
    return problems


# ---------------------------------------------------------------------------------------------------------
# The seat. A rider (build_men.py, the "m_" clips) sits on the saddle and keeps his feet in the stirrups: the
# saddle's place and turn in every frame of every clip, the stirrups and the width of the barrel he
# straddles are written to SEAT_FILE for that build to read.

SEAT_BONE = "spine.008"   # the stretch of back the saddle sits on
SEAT_FILE = os.path.join(HERE, "horse_seat.json")
STIRRUP_DROP = 0.72       # m: from the seat down to a stirrup's tread (a rider's leg, the knee a little bent)


def seat_point(meshes):
    """Where the rider sits, at rest: the top of the saddle at its middle, measured on the saddle."""
    saddle = next(o for o in meshes if o.name == "Cube")
    vs = [v.co for v in saddle.data.vertices]
    y = (min(v.y for v in vs) + max(v.y for v in vs)) / 2 + 0.05   # (a little behind the middle: the seat dips)
    top = max(v.z for v in vs if abs(v.x) < 0.06 and abs(v.y - y) < 0.08)
    return Vector((0, y, top))


def barrel_half_width(meshes, y):
    body = max(meshes, key=lambda o: len(o.data.vertices))
    return max(abs(v.co.x) for v in body.data.vertices if abs(v.co.y - y) < 0.06)


def add_stirrups(arm, meshes, mats):
    """A leather strap down each side of the saddle and an iron at its foot, on the seat's bone. Returns the
    treads (where a foot stands, at rest)."""
    seat = seat_point(meshes)
    half = barrel_half_width(meshes, seat.y)
    treads = {}
    for side, sign in (("l", 1), ("r", -1)):
        top = Vector((sign * (half + 0.03), seat.y + 0.02, seat.z - 0.1))
        tread = Vector((sign * (half + 0.08), seat.y + 0.04, seat.z - STIRRUP_DROP))
        strap = bm._box((top + tread) / 2 + Vector((0, 0, 0.03)), (0.006, 0.035, (top - tread).length - 0.04))
        iron = bm.bmesh.new()
        for (a, b) in (((-0.055, 0.04), (0.055, 0.04)), ((-0.055, 0.04), (-0.05, -0.02)), ((0.055, 0.04), (0.05, -0.02)),
                       ((-0.05, -0.02), (0.0, -0.035)), ((0.05, -0.02), (0.0, -0.035))):
            bm._rod(tread + Vector((0, a[0], a[1])), tread + Vector((0, b[0], b[1])), 0.007).to_mesh(
                tmp := bpy.data.meshes.new("tmp"))
            iron.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        for obj in (bm.mesh_obj(f"stirrup_leather_{side}", strap, mats["leather"], smooth=False),
                    bm.mesh_obj(f"stirrup_{side}", iron, mats["steel"])):
            bm.rigid(obj, arm, SEAT_BONE)
            bm.box_uvs(obj, 0.3)
            meshes.append(obj)
        treads[side] = tread
    return seat, half, treads


def write_seat(arm, seat, half, treads, clips):
    """The seat's frame (place and turn) in every frame of every clip, in the horse's armature space."""
    import json
    bone = arm.data.bones[SEAT_BONE]
    out = {"seat": list(seat), "barrel_half_width": half, "treads": {k: list(v) for k, v in treads.items()},
           "fps": FPS, "clips": {}}
    for action in clips:
        arm.animation_data.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        frames = []
        for frame in range(f0, f1 + 1):
            bpy.context.scene.frame_set(frame)
            m = arm.pose.bones[SEAT_BONE].matrix @ bone.matrix_local.inverted()
            q = m.to_quaternion()
            frames.append([round(c, 5) for c in (*m.translation, q.w, q.x, q.y, q.z)])
        out["clips"][action.name] = frames
    arm.animation_data.action = None
    with open(SEAT_FILE, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_apply=False, export_image_format="AUTO", export_texcoords=True,
                              export_normals=True, export_rest_position_armature=True, export_def_bones=False,
                              export_extras=True, export_anim_slide_to_zero=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    os.makedirs(OUT, exist_ok=True)
    failed = False
    for side in (args or ["ally", "enemy"]):
        arm, meshes = open_source()
        bake_modifiers(meshes)
        scale = normalise(arm, meshes)
        mats = dress(arm, meshes, side)
        seat, half, treads = add_stirrups(arm, meshes, mats)
        bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = FPS, 1.0
        legs = rest_legs(arm)
        BODY["mesh"] = max(meshes, key=lambda o: len(o.data.vertices))
        source = arm.animation_data.action
        arm.animation_data.action = None
        reset(arm)
        f0, f1 = source.frame_range
        gallop_s = (f1 - f0) / 24
        resample(arm, source, "gallop", gallop_s)
        for name, g in GAITS.items():
            bake(arm, name, g["cycle"], lambda t, g=g: gait_pose(arm, legs, t, g), loop=True)
            arm[f"{name}_speed"] = g["speed"]
        arm["gallop_speed"] = round(ground_speed(arm, bpy.data.actions["gallop"], gallop_s), 3)
        arm["credit"] = horse_data.CREDIT   # (CC BY 4.0: the author is credited with the model itself too)
        bake(arm, "idle", 4.0, lambda t: idle_pose(arm, legs, t), loop=True)
        bake(arm, "death", 1.6, lambda t: death_pose(arm, legs, t))
        reset(arm)
        clips = [t.strips[0].action for t in arm.animation_data.nla_tracks]
        if side == "ally":   # (both sides' horses move alike)
            write_seat(arm, seat, half, treads, clips)
        problems = check(arm, meshes, clips)
        for p in problems:
            print(f"CHECK {side}: {p}")
        print(f"CHECK {side}: {len(problems)} problem(s)")
        failed = failed or bool(problems)
        path = os.path.join(OUT, f"horse_{side}.glb")
        export(path)
        tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
        before, after, worst = slim_glb.slim_file(path)
        print(f"{os.path.basename(path)}: scale {scale:.3f}, {tris} triangles, {before} -> {after} bytes, "
              f"gallop {arm['gallop_speed']} m/s")
    if failed and "--allow-problems" not in sys.argv:
        sys.exit("the horse has problems (see the CHECK lines)")


if __name__ == "__main__":
    main()
