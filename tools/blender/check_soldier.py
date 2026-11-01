"""Automatic checks for a soldier built by build_men.py, run on every build before the parts are joined.

What used to be caught by eye (and mostly by the user) is measured here, in every frame of every animation:
- clipping: parts that must stay apart, tested triangle against triangle (a hand inside the torso, a blade
  through the body, the shield through the hand behind it, the scabbard through the surcoat skirt, ...);
- contact: parts that must touch, in the guard (the shield boss on the shield face, the belt on the
  surcoat, each mitten on its sleeve, the scabbard at the belt): the gap between them, in millimetres;
- feet: in a walk or run, a foot on the ground stays on it and moves back at the gait's speed (no skating),
  a swinging foot clears the ground (no dragging), and no foot sinks into it; in an attack the back foot
  stays planted;
- holes: rays from inside the man (spine, neck, head) all meet some part on the way out;
- joints: elbows bend only as hinges, forearms and wrists turn only as far as a man's can; both hands stay on
  a longsword's grip;
- direction: the knee never folds forwards; the shield's face bulges outwards; the spear and the sword point
  where the attack sends them.

check(...) returns a list of problems (empty when all pass) and writes a report next to the build cache.
"""
import json
import math
import os

import bpy  # must come first
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

FRAME_STEP = 2          # test every other frame of each animation
TOUCH_MM = 4.0          # parts that must touch may be at most this far apart


def _tree(obj, depsgraph):
    return BVHTree.FromObject(obj, depsgraph)


def _hidden(skeleton, objs):
    """A prop is hidden in a frame when its bone is scaled to nothing."""
    for o in objs:
        for g in o.vertex_groups:
            pb = skeleton.pose.bones.get(g.name)
            if pb is not None and g.name.startswith("prop_") and pb.scale.x < 0.01:
                return True
    return False


def _overlap(a_objs, b_objs, depsgraph):
    count = 0
    trees_b = [_tree(o, depsgraph) for o in b_objs]
    for a in a_objs:
        ta = _tree(a, depsgraph)
        for tb in trees_b:
            count += len(ta.overlap(tb))
    return count


def _gap_mm(a_objs, b_objs, depsgraph, sample=400):
    """Smallest distance (mm) from a's surface to b's surface; 0 when they intersect."""
    if _overlap(a_objs, b_objs, depsgraph):
        return 0.0
    trees_b = [_tree(o, depsgraph) for o in b_objs]
    best = math.inf
    for a in a_objs:
        ev = a.evaluated_get(depsgraph)
        mesh = ev.to_mesh()
        step = max(1, len(mesh.vertices) // sample)
        for v in mesh.vertices[::step]:
            for tb in trees_b:
                hit = tb.find_nearest(v.co)
                if hit[0] is not None:
                    best = min(best, hit[3])
        ev.to_mesh_clear()
    return best * 1000


# How far each arm joint may turn from where it is in the rest pose (degrees), as a man's can.
ELBOW_SIDEWAYS = 15      # an elbow is a hinge: it does not bend sideways
ELBOW_TWIST = 95         # turning the forearm (palm up / palm down) from the rest pose
WRIST_TWIST = 15         # the wrist itself barely twists: the forearm does that
WRIST_BEND = 70          # palm-ward or back
WRIST_SIDEWAYS = 35      # towards the thumb or the little finger
TWO_HANDS_CM = 7         # a longsword's left hand: its wrist this near the grip (the hand reaches on from it)


def _swing_twist(q):
    """Split a bone's turn (pose quaternion, the bone's own axes) into its twist about the bone (Y) and the
    swing that follows. Returns (twist degrees, swing quaternion)."""
    twist = math.degrees(2 * math.atan2(q.y, q.w))
    twist = (twist + 180) % 360 - 180
    t = Quaternion((math.cos(math.radians(twist) / 2), 0, math.sin(math.radians(twist) / 2), 0))
    return twist, q @ t.inverted()


def _joints(skeleton):
    """Arm joints turned past what a man's can: [(joint, how, degrees)]."""
    out = []
    pb, rest = skeleton.pose.bones, skeleton.data.bones
    for side in ("l", "r"):
        # Elbow: a hinge about the upper arm's X; the forearm may also turn about its own length.
        twist, swing = _swing_twist(pb[f"lowerarm_{side}"].matrix_basis.to_quaternion())
        axis, angle = swing.to_axis_angle()
        sideways = math.degrees(angle * abs(axis.z))
        if sideways > ELBOW_SIDEWAYS:
            out.append((f"elbow_{side}", "bends sideways", round(sideways)))
        if abs(twist) > ELBOW_TWIST:
            out.append((f"elbow_{side}", "forearm twisted", round(twist)))
        # Wrist: bends palm-ward/back and sideways, but does not twist.
        hand = rest[f"hand_{side}"].matrix_local.to_3x3().inverted()
        across = (hand @ (rest[f"pinky_01_{side}"].head_local - rest[f"index_01_{side}"].head_local)).normalized()
        palm = across.cross(Vector((0, 1, 0))).normalized()
        twist, swing = _swing_twist(pb[f"hand_{side}"].matrix_basis.to_quaternion())
        axis, angle = swing.to_axis_angle()
        bend, sideways = math.degrees(angle * abs(axis.dot(across))), math.degrees(angle * abs(axis.dot(palm)))
        if abs(twist) > WRIST_TWIST:
            out.append((f"wrist_{side}", "twisted", round(twist)))
        if bend > WRIST_BEND:
            out.append((f"wrist_{side}", "bent", round(bend)))
        if sideways > WRIST_SIDEWAYS:
            out.append((f"wrist_{side}", "bent sideways", round(sideways)))
    return out


def _dir(skeleton, bone):
    pb = skeleton.pose.bones[bone]
    return Vector(pb.matrix.col[1][:3]).normalized()


SPIKE_CM = 5.5


def _bulges(obj, depsgraph):
    """How far (m) each vertex stands off the middle of the vertices joined to it."""
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    pairs = np.empty(len(mesh.edges) * 2, dtype=np.int64)
    mesh.edges.foreach_get("vertices", pairs)
    ev.to_mesh_clear()
    co, pairs = co.reshape(-1, 3), pairs.reshape(-1, 2)
    total, count = np.zeros_like(co), np.zeros(len(co))
    np.add.at(total, pairs[:, 0], co[pairs[:, 1]])
    np.add.at(total, pairs[:, 1], co[pairs[:, 0]])
    np.add.at(count, pairs[:, 0], 1)
    np.add.at(count, pairs[:, 1], 1)
    return np.linalg.norm(co - total / np.maximum(count, 1)[:, None], axis=1)


def spikes(skeleton, objs, actions):
    """action name -> (the most any vertex of objs stands further off its neighbours than at rest, cm; the
    frames it is more than SPIKE_CM; which part). A vertex the wrong bone carries is drawn out of the cloth
    into a spike; the cloth stretching evenly (an arm raised) moves its vertices along with their neighbours."""
    scene = bpy.context.scene
    skeleton.animation_data.action = None
    for pb in skeleton.pose.bones:
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    rest = {o.name: _bulges(o, depsgraph) for o in objs}
    out = {}
    for action in actions:
        skeleton.animation_data.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        worst, frames, part = 0.0, [], ""
        for frame in range(f0, f1 + 1, FRAME_STEP):
            scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for o in objs:
                now = _bulges(o, depsgraph)
                if len(now) != len(rest[o.name]):
                    continue
                grown = float(np.max(now - rest[o.name])) * 100
                if grown > worst:
                    worst, part = grown, o.name
                if grown > SPIKE_CM and (not frames or frames[-1] != frame):
                    frames.append(frame)
        out[action.name] = (round(worst, 1), ",".join(str(f) for f in frames[:6]), part)
    skeleton.animation_data.action = None
    return out


def check(skeleton, parts, actions, report_path, spear_axis_local, label, gaits=None, aims=None, edges=None, gear_shown=None):
    """parts: name -> list of objects (see build_men.infantry, CHECK_PARTS). actions: the baked actions.
    gaits: walking and running action name -> the speed (m/s) its feet should keep to the ground at.
    aims: attack action name -> (t 0..1, direction the weapon must point then, least cosine to it[, the weapon's
    axis in the right hand's frame, if not the spear's]).
    edges: (the sword's edge in the right hand's frame, the cuts): in each cut, wherever the blade moves fast,
    an edge, not the flat, must go first.
    gear_shown: part name -> (its prop bone, the clip name prefixes it is carried in): gear every clip hides and
    the renderer shows (the subtypes' weapons and helmets); in those clips it is shown here too, and checked."""
    problems = []
    log = {"label": label, "clipping": [], "contact": [], "direction": []}
    scene = bpy.context.scene

    # Pairs that must never intersect, in any frame.
    keep_apart = [
        ("forearm_r", "torso"), ("forearm_l", "torso"),
        ("mitten_r", "torso"), ("mitten_l", "torso"),
        ("spear", "torso"), ("spear", "head"), ("spear", "shield"), ("sword", "torso"), ("sword", "head"),
        ("sword", "shield"), ("mitten_r", "shield"), ("forearm_r", "shield"),
        ("shield", "torso"), ("shield", "head"), ("shield", "mitten_l"), ("shield", "coat_skirt"), ("shield", "legs"),
        ("scabbard", "coat_skirt"), ("sheathed", "coat_skirt"),
        ("belt", "surcoat"), ("belt", "coat_skirt"),
        # Nothing goes through the surcoat or its skirt: not the weapons, not the arms, not the knees.
        ("spear", "surcoat"), ("spear", "coat_skirt"), ("sword", "surcoat"), ("sword", "coat_skirt"),
        ("great", "torso"), ("great", "head"), ("great", "surcoat"), ("great", "coat_skirt"),
        ("forearm_r", "surcoat"), ("forearm_l", "surcoat"), ("mitten_r", "surcoat"), ("mitten_l", "surcoat"),
        ("mitten_r", "coat_skirt"), ("mitten_l", "coat_skirt"), ("legs", "coat_skirt"),
        ("legs", "mail_skirt"), ("shoes", "mail_skirt"), ("shoes", "coat_skirt"), ("mail_skirt", "coat_skirt"),
        # The crossbow and its bolt case.
        ("xbow", "torso"), ("xbow", "head"), ("xbow", "surcoat"), ("xbow", "coat_skirt"), ("xbow", "legs"),
        ("quiver", "coat_skirt"), ("quiver", "mitten_r"), ("quiver", "forearm_r"),
        # The subtypes' gear, where it is carried (gear_shown), and the other body armours.
        ("axe", "torso"), ("axe", "head"), ("axe", "surcoat"), ("axe", "coat_skirt"),
        ("glaive", "torso"), ("glaive", "head"), ("glaive", "surcoat"), ("glaive", "coat_skirt"),
        ("javelins", "head"), ("javelins", "torso"), ("javelins", "surcoat"), ("javelins", "coat_skirt"), ("javelins", "legs"),
        ("great_helm", "mitten_r"), ("great_helm", "mitten_l"), ("great_helm", "shield"), ("great_helm", "spear"),
        ("great_helm", "sword"), ("great_helm", "xbow"),
        ("leather_cap", "mitten_r"), ("leather_cap", "mitten_l"), ("leather_cap", "shield"), ("leather_cap", "xbow"),
        # (The leather and plate are the mail's own surface in another material: the mail and the surcoat, two
        # thinned layers 14 mm apart, already cross at rest wherever the thinning differs, unseen under the coat,
        # so they are not paired with it.)
        ("plate_legs", "coat_skirt"), ("plate_legs", "mail_skirt"), ("plate_legs", "shoes"),
        # The nasal helm with the same neighbours as the other helmets, to tell their own fit from the poses'.
        ("nasal_helm", "mitten_r"), ("nasal_helm", "mitten_l"), ("nasal_helm", "shield"), ("nasal_helm", "spear"),
        ("nasal_helm", "sword"), ("nasal_helm", "xbow"),
    ]
    for action in actions:
        skeleton.animation_data.action = action
        start, end = (int(x) for x in action.frame_range)
        worst = {}
        joints = {}
        for frame in range(start, end + 1, FRAME_STEP):
            scene.frame_set(frame)
            # Gear the renderer shows in this clip, shown as it would be.
            shown = False
            for part, (bone, prefixes) in (gear_shown or {}).items():
                if part in parts and any(action.name.startswith(p) for p in prefixes):
                    skeleton.pose.bones[bone].scale = (1, 1, 1)
                    shown = True
            if shown:
                bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for a, b in keep_apart:
                if a not in parts or b not in parts:
                    continue
                if _hidden(skeleton, parts[a]) or _hidden(skeleton, parts[b]):
                    continue
                n = _overlap(parts[a], parts[b], depsgraph)
                if n:
                    key = f"{a} x {b}"
                    first, last, most = worst.get(key, (frame, frame, 0))
                    worst[key] = (min(first, frame), max(last, frame), max(most, n))
            # Both hands on a longsword: the left wrist at the grip, below the right fist.
            if action.name.startswith("t_") and action.name != "t_death":   # (struck, he lets go)
                hand = skeleton.pose.bones["hand_r"]
                fist = hand.head + Vector(hand.matrix.col[1][:3]) * 0.065
                grip_at = fist - (hand.matrix.to_3x3() @ spear_axis_local).normalized() * 0.1
                off = (skeleton.pose.bones["lowerarm_l"].tail - grip_at).length * 100
                if off > TWO_HANDS_CM:
                    key = "left hand off the grip"
                    first, last, most = joints.get(key, (frame, frame, 0))
                    joints[key] = (min(first, frame), max(last, frame), max(most, round(off)))
            for joint, how, degrees in _joints(skeleton):
                key = f"{joint} {how}"
                first, last, most = joints.get(key, (frame, frame, 0))
                joints[key] = (min(first, frame), max(last, frame), max(most, abs(degrees)))
            # The knee: the shin never points further forward than the thigh.
            for side in ("l", "r"):
                # The pelvis bone's Z axis points to the body's front (-Y in the rest pose).
                body_front = Vector(skeleton.pose.bones["pelvis"].matrix.col[2][:3]).normalized()
                thigh, calf = _dir(skeleton, f"thigh_{side}"), _dir(skeleton, f"calf_{side}")
                ahead = (calf - thigh).dot(body_front)
                if ahead > 0.08:
                    log["direction"].append({"action": action.name, "frame": frame, "what": f"knee_{side} folds forwards",
                                             "value": round(ahead, 3)})
        for key, (first, last, most) in worst.items():
            entry = {"action": action.name, "pair": key, "frames": f"{first}-{last}", "triangles": most}
            log["clipping"].append(entry)
        for key, (first, last, most) in joints.items():
            log.setdefault("joints", []).append({"action": action.name, "joint": key, "frames": f"{first}-{last}",
                                                 "degrees": most})
    skeleton.animation_data.action = None

    # Feet in the gaits. Each frame the ball of each foot is on the ground (within 6 mm of where it stands)
    # or not. On the ground it must move straight back at the gait's speed (within 10 %); off it and moving
    # forward its toes must clear the ground by 5 mm; and the shoes never go 1 cm under it.
    rest = skeleton.data.bones
    for action in actions:
        speed = (gaits or {}).get(action.name)
        if speed is None:
            continue
        skeleton.animation_data.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        fps = scene.render.fps / scene.render.fps_base
        track = {"l": [], "r": []}
        lowest = 0.0
        for frame in range(f0, f1 + 1):
            scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for side in ("l", "r"):
                ball, toe = skeleton.pose.bones[f"ball_{side}"].head.copy(), skeleton.pose.bones[f"ball_{side}"].tail.copy()
                track[side].append((ball, toe))
            if "shoes" in parts:
                for o in parts["shoes"]:
                    ev = o.evaluated_get(depsgraph)
                    mesh = ev.to_mesh()
                    lowest = min(lowest, min((o.matrix_world @ v.co).z for v in mesh.vertices))
                    ev.to_mesh_clear()
        skates, drags = [], []
        for side in ("l", "r"):
            ground_z = rest[f"ball_{side}"].head_local.z
            toe_z = rest[f"ball_{side}"].tail_local.z
            points = track[side]
            for i in range(1, len(points)):
                (b0, _), (b1, t1) = points[i - 1], points[i]
                step = (b1 - b0) * fps
                if b0.z < ground_z + 0.006 and b1.z < ground_z + 0.006:
                    if abs(step.y - speed) > 0.1 * speed or abs(step.x) > 0.1 * speed:
                        skates.append(f"{side}{f0 + i}:{step.y:.2f}")
                elif step.y < -0.5 * speed and t1.z < toe_z + 0.005:
                    drags.append(f"{side}{f0 + i}")
        log["direction"].append({"action": action.name, "what": "feet (skating, dragging, lowest shoe mm)",
                                 "value": [skates, drags, round(lowest * 1000, 1)]})
        if skates:
            problems.append(f"feet: a planted foot skates in {action.name} (frame:speed m/s {', '.join(skates[:4])}; "
                            f"should be {speed})")
        if drags:
            problems.append(f"feet: a swinging foot drags its toes in {action.name} (frames {', '.join(drags[:4])})")
        if lowest < -0.01:
            problems.append(f"feet: a shoe sinks {-lowest * 1000:.0f} mm into the ground in {action.name}")
    skeleton.animation_data.action = None

    # Feet in the attacks: the back (right) foot stays planted, not sliding by more than 3 mm a frame, and
    # no shoe goes 1 cm under the ground.
    for name in (aims or {}):
        action = next((a for a in actions if a.name == name), None)
        if action is None or name.startswith(("m_", "ms_")):   # (mounted: his feet ride the horse)
            continue
        skeleton.animation_data.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        last, slides, lowest = None, [], 0.0
        for frame in range(f0, f1 + 1):
            scene.frame_set(frame)
            ball = skeleton.pose.bones["ball_r"].head.copy()
            if last is not None and (ball - last).length > 0.003:
                slides.append(f"{frame}:{(ball - last).length * 1000:.0f}mm")
            last = ball
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for o in parts.get("shoes", []):
                ev = o.evaluated_get(depsgraph)
                mesh = ev.to_mesh()
                lowest = min(lowest, min((o.matrix_world @ v.co).z for v in mesh.vertices))
                ev.to_mesh_clear()
        if slides:
            problems.append(f"feet: the back foot slides in {name} (frames {', '.join(slides[:4])})")
        if lowest < -0.01:
            problems.append(f"feet: a shoe sinks {-lowest * 1000:.0f} mm into the ground in {name}")
    skeleton.animation_data.action = None

    # Spikes: nothing the bones bend (the mail, the coat, the skirts, the hose and the shoes) may have a
    # vertex drawn out of its surface, in any frame: one left on the wrong bone (a sleeve's end held to the
    # hips) becomes a spike, which no other check sees.
    found = spikes(skeleton, parts.get("stretch", []), actions)
    log["spikes"] = found
    for name, (worst, frames, part) in found.items():
        if worst > SPIKE_CM:
            problems.append(f"spike: {part} has a point {worst:.0f} cm out of its surface in {name} (frames {frames})")

    # Holes: from points on the spine, neck and head, rays outwards in every direction must meet some part of
    # the soldier. One that gets out unmet has found a gap where the inside of the man shows (two layers that
    # meet edge to edge, an opening wider than what fills it). In the guard and halfway through each action.
    cores = {o for name in ("torso", "head", "forearm_l", "forearm_r") for o in parts.get(name, [])}
    visible = [o for o in scene.objects if o.type == "MESH" and o not in cores]
    for action in actions:
        skeleton.animation_data.action = action
        f0, f1 = action.frame_range
        frames = [int(f0)] if action.name == "idle" else [int(f0 + (f1 - f0) / 2)]
        for frame in frames:
            scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            trees = [_tree(o, depsgraph) for o in visible]
            pb = skeleton.pose.bones
            escaped = []
            for bone in ("spine_02", "spine_03", "neck_01", "head"):
                for k in (0.0, 0.5):
                    start = pb[bone].head.lerp(pb[bone].tail, k)
                    for el in range(-30, 90, 10):
                        for az in range(0, 360, 10):
                            e, a = math.radians(el), math.radians(az)
                            d = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))
                            if not any(t.ray_cast(start, d, 1.0)[0] is not None for t in trees):
                                escaped.append(f"{bone}+{k}:{el}/{az}")
            if escaped:
                log["holes"] = log.get("holes", []) + [{"action": action.name, "frame": frame, "rays": escaped}]
                problems.append(f"hole: {len(escaped)} rays from inside get out in {action.name} frame {frame} "
                                f"(first {escaped[0]}: bone+along, elevation/azimuth from the front)")
    skeleton.animation_data.action = None

    # Contact, in the guard pose (first frame of idle).
    idle = next(a for a in actions if a.name == "idle")
    skeleton.animation_data.action = idle
    scene.frame_set(int(idle.frame_range[0]))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    must_touch = [("boss", "shield_face"), ("belt", "surcoat_or_skirt"), ("mitten_r", "forearm_sleeve_r"),
                  ("mitten_l", "forearm_sleeve_l"), ("scabbard", "belt")]
    for a, b in must_touch:
        if a in parts and b in parts:
            gap = _gap_mm(parts[a], parts[b], depsgraph)
            log["contact"].append({"pair": f"{a} on {b}", "gap_mm": round(gap, 1)})
            if gap > TOUCH_MM:
                problems.append(f"contact: {a} is {gap:.1f} mm off {b}")

    # Shield face bulges outwards: rays shot at the face from in front find its surface further out at the
    # middle than towards the sides (the surface between points counts, not only the points).
    if "shield_face" in parts:
        face = parts["shield_face"][0]
        tree = _tree(face, depsgraph)
        ev = face.evaluated_get(depsgraph)
        mesh = ev.to_mesh()
        pts = [v.co.copy() for v in mesh.vertices]
        ev.to_mesh_clear()
        centre = sum(pts, Vector()) / len(pts)
        out = Vector(skeleton.pose.bones["pelvis"].matrix.col[2][:3]).normalized()  # the body's front, roughly the shield's
        across = out.cross(Vector((0, 0, 1))).normalized()
        half = max(abs((p - centre).dot(across)) for p in pts)

        def surface(offset):
            start_point = centre + across * offset + out * 1.0
            hit = tree.ray_cast(start_point, -out, 2.0)
            return None if hit[0] is None else hit[0].dot(out)

        mid = surface(0.0)
        sides = [h for h in (surface(-half * 0.75), surface(half * 0.75)) if h is not None]
        bulge = ((mid - max(sides)) * 1000) if (mid is not None and sides) else -999
        log["direction"].append({"action": "idle", "what": "shield bulge (mm, + is outwards)", "value": round(bulge, 1)})
        if bulge < 20:
            problems.append(f"direction: shield face is not convex (bulge {bulge:.1f} mm)")

    # Weapon points where the attack sends it, at the moment of reach.
    for name, (t, want, minimum, *axis) in (aims or {}).items():
        action = next((a for a in actions if a.name == name), None)
        if action is None:
            problems.append(f"direction: no action {name}")
            continue
        skeleton.animation_data.action = action
        f0, f1 = action.frame_range
        scene.frame_set(int(f0 + (f1 - f0) * t))
        hand = skeleton.pose.bones["hand_r"]
        tip = (hand.matrix.to_3x3() @ (axis[0] if axis else spear_axis_local)).normalized()
        dot = tip.dot(want)
        log["direction"].append({"action": name, "what": "weapon direction vs intended", "value": round(dot, 3)})
        if dot < minimum:
            problems.append(f"direction: {name} weapon points off its target ({dot:.2f} < {minimum})")
    skeleton.animation_data.action = None

    # Cuts land with the edge: through the blow (every frame where the middle of the blade moves across
    # itself at 60 % or more of its fastest), the edge (either one) is within 35 degrees of the way it moves.
    edge_local, cuts = edges or (None, ())
    log["edges"] = []
    for name in cuts:
        action = next((a for a in actions if a.name == name), None)
        if action is None:
            problems.append(f"edge: no action {name}")
            continue
        skeleton.animation_data.action = action
        f0, f1 = (int(x) for x in action.frame_range)
        seen = []
        for frame in range(f0, f1 + 1):
            scene.frame_set(frame)
            hand = skeleton.pose.bones["hand_r"]
            m = hand.matrix.to_3x3()
            fist = hand.head + Vector(m.col[1][:3]) * 0.065
            tip = (m @ spear_axis_local).normalized()
            seen.append((fist + tip * 0.5, tip, (m @ edge_local).normalized()))
        fps = scene.render.fps / scene.render.fps_base
        bad, worst, moves = [], 0.0, {}
        for k in range(1, len(seen) - 1):
            tip = seen[k][1]
            move = (seen[k + 1][0] - seen[k - 1][0]) * (fps / 2)
            moves[k] = move - tip * move.dot(tip)
        fastest = max((m.length for m in moves.values()), default=0.0)
        for k, move in moves.items():
            mid, tip, edge = seen[k]
            if move.length < 0.6 * fastest or move.length < 1.0:
                continue
            edge = edge - tip * edge.dot(tip)
            off = math.degrees(math.acos(min(1.0, abs(edge.normalized().dot(move.normalized())))))
            worst = max(worst, off)
            if off > 35:
                bad.append(f"{f0 + k}:{off:.0f}")
        log["edges"].append({"action": name, "worst degrees": round(worst, 1)})
        if bad:
            problems.append(f"edge: {name} strikes with the flat (frame:degrees {', '.join(bad[:5])})")
    skeleton.animation_data.action = None

    # Known, recorded for later (the owner, 2026-11-01: the poses' fault, not the helmets'): in an overhead
    # cut the hand passes the helmet, and in a block the shield comes up against it. The nasal helm, checked
    # since the subtypes' helmets came in, meets them there; another helmet meeting the same neighbour in the
    # same clip, by up to half as many triangle pairs again, is the same fault. Logged under "known", not counted.
    nasal = {(e["action"], e["pair"].split(" x ")[1]): e["triangles"] for e in log["clipping"] if e["pair"].startswith("nasal_helm x ")}
    log["known"] = []
    for e in log["clipping"]:
        first, second = e["pair"].split(" x ")
        base = nasal.get((e["action"], second))
        if first == "nasal_helm" or (first in ("great_helm", "leather_cap") and base is not None and e["triangles"] <= base * 1.5):
            log["known"].append(e)
            continue
        problems.append(f"clipping: {e['pair']} in {e['action']} frames {e['frames']} ({e['triangles']} triangle pairs)")
    for e in log.get("joints", []):
        unit = "cm" if "grip" in e["joint"] else "degrees"
        problems.append(f"joint: {e['joint']} in {e['action']} frames {e['frames']} (up to {e['degrees']} {unit})")
    knees = {(e["action"], e["what"]) for e in log["direction"] if "knee" in e["what"]}
    for action, what in sorted(knees):
        problems.append(f"direction: {what} in {action}")
    log["problems"] = problems
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf8") as fh:
        json.dump(log, fh, indent=1)
    return problems
