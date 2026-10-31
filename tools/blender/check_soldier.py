"""Automatic checks for a soldier built by build_men.py, run on every build before the parts are joined.

What used to be caught by eye (and mostly by the user) is measured here, in every frame of every animation:
- clipping: parts that must stay apart, tested triangle against triangle (a hand inside the torso, a blade
  through the body, the shield through the hand behind it, the scabbard through the surcoat skirt, ...);
- contact: parts that must touch, in the guard (the shield boss on the shield face, the belt on the
  surcoat, each mitten on its sleeve, the scabbard at the belt): the gap between them, in millimetres;
- feet: in a walk or run, a foot on the ground stays on it and moves back at the gait's speed (no skating),
  a swinging foot clears the ground (no dragging), and no foot sinks into it;
- holes: rays from inside the man (spine, neck, head) all meet some part on the way out;
- direction: the knee never folds forwards; the shield's face bulges outwards; the spear and the sword point
  where the attack sends them.

check(...) returns a list of problems (empty when all pass) and writes a report next to the build cache.
"""
import json
import math
import os

import bpy  # must come first
from mathutils import Vector
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


def _dir(skeleton, bone):
    pb = skeleton.pose.bones[bone]
    return Vector(pb.matrix.col[1][:3]).normalized()


def check(skeleton, parts, actions, report_path, spear_axis_local, label, gaits=None):
    """parts: name -> list of objects (see build_men.infantry, CHECK_PARTS). actions: the baked actions.
    gaits: walking and running action name -> the speed (m/s) its feet should keep to the ground at."""
    problems = []
    log = {"label": label, "clipping": [], "contact": [], "direction": []}
    scene = bpy.context.scene

    # Pairs that must never intersect, in any frame.
    keep_apart = [
        ("forearm_r", "torso"), ("forearm_l", "torso"),
        ("mitten_r", "torso"), ("mitten_l", "torso"),
        ("spear", "torso"), ("sword", "torso"), ("sword", "head"),
        ("shield", "torso"), ("shield", "head"), ("shield", "mitten_l"),
        ("scabbard", "coat_skirt"), ("sheathed", "coat_skirt"),
        ("belt", "surcoat"), ("belt", "coat_skirt"),
    ]
    for action in actions:
        skeleton.animation_data.action = action
        start, end = (int(x) for x in action.frame_range)
        worst = {}
        for frame in range(start, end + 1, FRAME_STEP):
            scene.frame_set(frame)
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
    for name, t, want, minimum in (("attack", 0.45, Vector((0, -1, 0)), 0.85), ("s_attack", 0.6, Vector((0.6, -0.6, -0.5)).normalized(), 0.7)):
        action = next((a for a in actions if a.name == name), None)
        if action is None:
            continue
        skeleton.animation_data.action = action
        f0, f1 = action.frame_range
        scene.frame_set(int(f0 + (f1 - f0) * t))
        hand = skeleton.pose.bones["hand_r"]
        tip = (hand.matrix.to_3x3() @ spear_axis_local).normalized()
        dot = tip.dot(want)
        log["direction"].append({"action": name, "what": "weapon direction vs intended", "value": round(dot, 3)})
        if dot < minimum:
            problems.append(f"direction: {name} weapon points off its target ({dot:.2f} < {minimum})")
    skeleton.animation_data.action = None

    for e in log["clipping"]:
        problems.append(f"clipping: {e['pair']} in {e['action']} frames {e['frames']} ({e['triangles']} triangle pairs)")
    knees = {(e["action"], e["what"]) for e in log["direction"] if "knee" in e["what"]}
    for action, what in sorted(knees):
        problems.append(f"direction: {what} in {action}")
    log["problems"] = problems
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf8") as fh:
        json.dump(log, fh, indent=1)
    return problems
