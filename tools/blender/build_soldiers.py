"""Builds the 3D battle's soldier models in Blender and writes them to assets/models/*.glb.

Run with Blender's Python module (pip install bpy, Blender 5.x):
    python tools/blender/build_soldiers.py

Every model is made from simple shapes in code, so it can be rebuilt and changed by editing this file.
Units are metres, the model stands on z = 0 and faces Blender's -Y (glTF exports that as +Z, the way the
battle's units face). Colours are stored per vertex and the whole model uses one material, so each part is
one draw call. Each foot soldier is split into five parts with their pivots at the joints, so the renderer
can swing arms and legs: body, arm_l, arm_r, leg_l, leg_r.

Factions: "ally" wears the Teutonic Order's white with a black cross, "enemy" a dark red with gold.
"""
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models")

# Shared colours (linear-ish sRGB values, 0..1).
SKIN = (0.80, 0.62, 0.50)
STEEL = (0.62, 0.64, 0.67)
DARK_STEEL = (0.36, 0.38, 0.41)
MAIL = (0.50, 0.52, 0.55)
BRASS = (0.78, 0.62, 0.30)
LEATHER = (0.35, 0.22, 0.13)
DARK_LEATHER = (0.20, 0.13, 0.08)
WOOD = (0.48, 0.32, 0.18)
HOSE = (0.26, 0.24, 0.22)
GAMBESON = (0.74, 0.65, 0.46)
SLIT = (0.05, 0.05, 0.06)
HORSE_COAT = (0.36, 0.25, 0.17)
HORSE_DARK = (0.15, 0.11, 0.08)

FACTIONS = {
    "ally": {"cloth": (0.90, 0.89, 0.84), "mark": (0.07, 0.07, 0.08), "trim": (0.07, 0.07, 0.08)},
    "enemy": {"cloth": (0.48, 0.09, 0.08), "mark": (0.86, 0.68, 0.22), "trim": (0.86, 0.68, 0.22)},
}


# ---------------------------------------------------------------------------------------------------------
# Building blocks. Each returns a new object whose vertices are already in place (transforms applied) and
# whose faces carry one colour.

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _finish(obj, color):
    mesh = obj.data
    attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    rgba = (*color, 1.0)
    for item in attr.data:
        item.color = rgba
    for poly in mesh.polygons:
        poly.use_smooth = False
    return obj


def _object_from_bmesh(bm, name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def _place(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    matrix = Matrix.LocRotScale(Vector(loc), _euler(rot), Vector(scale))
    obj.data.transform(matrix)
    obj.data.update()
    return obj


def _euler(rot):
    from mathutils import Euler
    return Euler(tuple(math.radians(a) for a in rot), "XYZ")


def box(size, loc, color, rot=(0, 0, 0), name="box"):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    obj = _object_from_bmesh(bm, name)
    _place(obj, loc, rot, size)
    return _finish(obj, color)


def cyl(r1, r2, depth, loc, color, rot=(0, 0, 0), seg=10, scale_xy=(1, 1), name="cyl", cap=True):
    """A cylinder or cone along its local Z, centred at loc. r1 is the bottom radius, r2 the top."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    obj = _object_from_bmesh(bm, name)
    _place(obj, loc, rot, (scale_xy[0], scale_xy[1], 1))
    return _finish(obj, color)


def between(p1, p2, r1, r2, color, seg=8, name="limb"):
    """A tapered cylinder from point p1 (radius r1) to point p2 (radius r2)."""
    a, b = Vector(p1), Vector(p2)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=d.length)
    obj = _object_from_bmesh(bm, name)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    obj.data.transform(Matrix.Translation((a + b) / 2) @ rot)
    obj.data.update()
    return _finish(obj, color)


def ball(r, loc, color, scale=(1, 1, 1), subdiv=2, name="ball"):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    obj = _object_from_bmesh(bm, name)
    _place(obj, loc, (0, 0, 0), scale)
    return _finish(obj, color)


def slab(outline, thickness, color, matrix, name="slab"):
    """A flat plate from a 2D outline (x, y) extruded along z by thickness, then moved by matrix."""
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, -thickness / 2)) for x, y in outline]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    for v in ext["geom"]:
        if isinstance(v, bmesh.types.BMVert):
            v.co.z += thickness
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _object_from_bmesh(bm, name)
    obj.data.transform(matrix)
    obj.data.update()
    return _finish(obj, color)


def join(objs, name, pivot=(0, 0, 0)):
    """Joins objects into one, with its origin moved to pivot (the joint the part turns around)."""
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    obj.data.transform(Matrix.Translation(-Vector(pivot)))
    obj.location = Vector(pivot)
    return obj


# ---------------------------------------------------------------------------------------------------------
# Shapes used by several soldiers.

def kite_outline(width, height, steps=10):
    """A kite shield: round top, long point at the bottom. Origin at its centre."""
    pts = []
    top = height * 0.22
    for i in range(steps + 1):
        a = math.pi * i / steps
        pts.append((math.cos(a) * width / 2, top + math.sin(a) * width * 0.32))
    pts.append((-width * 0.46, -height * 0.05))
    pts.append((0, -height * 0.78))
    pts.append((width * 0.46, -height * 0.05))
    return [(x, y) for x, y in pts]


def heater_outline(width, height, steps=8):
    """A heater shield: flat top, curved sides meeting at a point."""
    pts = [(-width / 2, height / 2), (width / 2, height / 2)]
    for i in range(1, steps + 1):
        t = i / steps
        pts.append((width / 2 * math.cos(t * math.pi / 2), height / 2 - height * math.sin(t * math.pi / 2)))
    for i in range(steps - 1, 0, -1):
        t = i / steps
        pts.append((-width / 2 * math.cos(t * math.pi / 2), height / 2 - height * math.sin(t * math.pi / 2)))
    return pts


def shield_matrix(loc, yaw=0, tilt=0):
    """Stands a shield upright facing -Y (its outline's x→x, y→z), turned by yaw and leaned by tilt."""
    upright = Matrix.Rotation(math.radians(90), 4, "X")
    turn = Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(tilt), 4, "X")
    return Matrix.Translation(Vector(loc)) @ turn @ upright


def cross_on(center, size, bar, color, normal_y, depth=0.01):
    """A cross (two bars) on a surface that faces -Y (normal_y < 0) or +Y."""
    x, y, z = center
    return [
        box((bar, depth, size), (x, y + normal_y * depth, z), color),
        box((size * 0.8, depth, bar), (x, y + normal_y * depth, z + size * 0.12), color),
    ]


def legs(color_upper, color_lower, boot, hip_z=0.92, spread=0.1):
    parts = {}
    for side, sx in (("l", 1), ("r", -1)):
        x = spread * sx
        objs = [
            between((x, 0, hip_z), (x, 0.0, 0.5), 0.085, 0.065, color_upper, name="thigh"),
            between((x, 0, 0.5), (x, 0.01, 0.1), 0.062, 0.05, color_lower, name="shin"),
            box((0.11, 0.24, 0.09), (x, -0.05, 0.045), boot, name="foot"),
        ]
        parts[side] = join(objs, f"leg_{side}", pivot=(x, 0, hip_z))
    return parts


def arm(side, sleeve, hand=SKIN, shoulder_z=1.4, length=0.58, glove=None, reach=(0, -0.06)):
    sx = 1 if side == "l" else -1
    shoulder = Vector((0.24 * sx, 0, shoulder_z))
    elbow = shoulder + Vector((0.03 * sx, reach[1] * 0.5, -length * 0.5))
    wrist = elbow + Vector((0.0, reach[1], -length * 0.48))
    objs = [
        ball(0.075, shoulder, sleeve, name="shoulder"),
        between(shoulder, elbow, 0.068, 0.058, sleeve, name="upper"),
        between(elbow, wrist, 0.056, 0.045, sleeve, name="fore"),
        ball(0.05, wrist + Vector((0, 0, -0.04)), glove or hand, name="hand"),
    ]
    return objs, shoulder, wrist + Vector((0, 0, -0.04))


def torso(chest, skirt, belt, skirt_len=0.45, skirt_flare=0.3, waist_z=0.98):
    return [
        cyl(0.17, 0.2, 0.46, (0, 0, waist_z + 0.22), chest, seg=12, scale_xy=(1, 0.72), name="chest"),
        cyl(0.2, 0.15, 0.08, (0, 0, waist_z + 0.47), chest, seg=12, scale_xy=(1, 0.75), name="shoulders"),
        cyl(skirt_flare, 0.18, skirt_len, (0, 0, waist_z - skirt_len / 2 + 0.02), skirt, seg=12,
            scale_xy=(1, 0.8), name="skirt", cap=False),
        cyl(0.185, 0.185, 0.05, (0, 0, waist_z + 0.02), belt, seg=12, scale_xy=(1, 0.74), name="belt"),
    ]


def head_and_neck(neck_color=SKIN):
    return [
        cyl(0.055, 0.055, 0.1, (0, 0, 1.52), neck_color, seg=8, name="neck"),
        ball(0.11, (0, -0.005, 1.63), SKIN, scale=(0.95, 1.0, 1.08), name="head"),
    ]


# ---------------------------------------------------------------------------------------------------------
# Helmets.

def great_helm(trim):
    """A flat-topped great helm with an eye slit, breaths and a cross of brass bands at the front."""
    z = 1.64
    objs = [
        cyl(0.142, 0.132, 0.3, (0, 0, z), STEEL, seg=14, scale_xy=(1, 1.03), name="helm"),
        cyl(0.132, 0.12, 0.03, (0, 0, z + 0.165), DARK_STEEL, seg=14, name="crown"),
        box((0.22, 0.02, 0.018), (0, -0.138, z + 0.04), SLIT, name="slit"),
        box((0.024, 0.02, 0.24), (0, -0.142, z - 0.01), trim, name="band_v"),
        box((0.25, 0.02, 0.022), (0, -0.14, z + 0.075), trim, name="band_h"),
    ]
    for i in range(3):
        objs.append(box((0.012, 0.02, 0.012), (0.05, -0.139, z - 0.05 - i * 0.03), SLIT, name="breath"))
    return objs


def nasal_helm():
    """A Norman conical helm with a nose guard, worn over a mail coif."""
    z = 1.68
    return [
        cyl(0.13, 0.13, 0.2, (0, 0.005, 1.6), MAIL, seg=12, scale_xy=(1, 1.02), name="coif"),
        cyl(0.122, 0.01, 0.2, (0, 0, z + 0.1), STEEL, seg=12, name="cone"),
        cyl(0.124, 0.124, 0.03, (0, 0, z), DARK_STEEL, seg=12, name="rim"),
        box((0.026, 0.02, 0.11), (0, -0.124, z - 0.06), STEEL, name="nasal"),
    ]


def italo_norman_helm():
    """The Italo-Norman helm: a tall cone whose tip leans forward, with a broad nasal and a brow band."""
    z = 1.69
    cone = cyl(0.125, 0.012, 0.25, (0, 0, 0), STEEL, seg=12, name="cone")
    # Lean the upper part forward: move each vertex towards -Y in proportion to its height.
    for v in cone.data.vertices:
        h = v.co.z + 0.125
        v.co.y -= (h / 0.25) ** 2 * 0.07
        v.co.z += z + 0.11
    cone.data.update()
    return [
        cyl(0.13, 0.13, 0.2, (0, 0.005, 1.6), MAIL, seg=12, scale_xy=(1, 1.02), name="coif"),
        cone,
        cyl(0.127, 0.127, 0.035, (0, 0, z), BRASS, seg=12, name="brow"),
        box((0.034, 0.02, 0.12), (0, -0.126, z - 0.065), STEEL, name="nasal"),
    ]


# ---------------------------------------------------------------------------------------------------------
# Weapons.

def spear(hand, length=2.5):
    x, y, z = hand
    return [
        cyl(0.017, 0.017, length, (x, y, z + length * 0.28), WOOD, seg=6, name="shaft"),
        cyl(0.035, 0.0, 0.22, (x, y, z + length * 0.78 + 0.11), STEEL, seg=4, scale_xy=(1, 0.35), name="head"),
    ]


def lance(hand, color, length=3.4):
    x, y, z = hand
    return [
        # Couched under the right arm and angled outwards, so it clears the horse's head.
        between((x, y + 1.2, z - 0.08), (x - 0.55, y - length + 1.2, z + 0.25), 0.03, 0.014, color, seg=6, name="lance"),
        cyl(0.06, 0.035, 0.18, (x, y + 0.1, z), DARK_STEEL, rot=(-85, 0, 0), seg=8, name="vamplate"),
    ]


def sword_at_hip(side=1):
    x = 0.2 * side
    return [
        between((x, 0.03, 1.0), (x + 0.05 * side, 0.15, 0.32), 0.022, 0.016, DARK_LEATHER, seg=6, name="scabbard"),
        box((0.14, 0.03, 0.025), (x, 0.02, 1.02), STEEL, rot=(0, 0, 0), name="quillons"),
        cyl(0.02, 0.02, 0.1, (x, 0.0, 1.08), LEATHER, seg=6, name="grip"),
    ]


def crossbow(hand):
    """A crossbow held across the body, pointing forward and slightly down."""
    x, y, z = hand
    stock_from = Vector((x + 0.02, y + 0.15, z + 0.05))
    stock_to = Vector((x - 0.05, y - 0.55, z + 0.02))
    prod_c = stock_to + Vector((0, 0.05, 0.01))
    return [
        between(stock_from, stock_to, 0.03, 0.025, WOOD, seg=6, name="stock"),
        between(prod_c + Vector((-0.33, 0.04, 0)), prod_c + Vector((0.33, 0.04, 0)), 0.014, 0.014, DARK_STEEL, seg=6,
                name="prod"),
        between(prod_c + Vector((-0.32, 0.05, 0)), stock_from + Vector((0, -0.25, 0.01)), 0.003, 0.003, SLIT, seg=4,
                name="string_l"),
        between(prod_c + Vector((0.32, 0.05, 0)), stock_from + Vector((0, -0.25, 0.01)), 0.003, 0.003, SLIT, seg=4,
                name="string_r"),
        cyl(0.025, 0.025, 0.08, tuple(stock_to + Vector((0, -0.04, 0))), DARK_STEEL, rot=(90, 0, 0), seg=6,
            name="stirrup"),
    ]


# ---------------------------------------------------------------------------------------------------------
# Soldiers.

def infantry(f):
    """Infantry: Italo-Norman helm, mail hauberk, faction surcoat-less kite shield and a spear."""
    body = torso(MAIL, MAIL, LEATHER, skirt_len=0.48, skirt_flare=0.29)
    body += head_and_neck(MAIL)
    body += italo_norman_helm()
    body += sword_at_hip(-1)
    body.append(cyl(0.205, 0.215, 0.5, (0, 0, 1.1), f["cloth"], seg=12, scale_xy=(1, 0.76), name="tabard", cap=False))
    body += cross_on((0, -0.165, 1.18), 0.3, 0.06, f["mark"], -1)
    body += cross_on((0, 0.165, 1.18), 0.3, 0.06, f["mark"], 1)
    legs_ = legs(MAIL, HOSE, LEATHER)
    l_objs, _, l_hand = arm("l", MAIL, glove=LEATHER, reach=(0, -0.12))
    shield = slab(kite_outline(0.48, 0.9), 0.03, f["cloth"],
                  shield_matrix((l_hand.x + 0.06, l_hand.y - 0.1, l_hand.z + 0.12), yaw=-12, tilt=-6), "kite")
    rim = slab(kite_outline(0.5, 0.93), 0.018, DARK_LEATHER,
               shield_matrix((l_hand.x + 0.06, l_hand.y - 0.085, l_hand.z + 0.12), yaw=-12, tilt=-6), "rim")
    boss = ball(0.04, (l_hand.x + 0.05, l_hand.y - 0.13, l_hand.z + 0.18), BRASS, scale=(1, 0.5, 1))
    mark = cross_on((l_hand.x + 0.06, l_hand.y - 0.125, l_hand.z + 0.1), 0.42, 0.07, f["mark"], -1, depth=0.012)
    for m in mark:
        m.data.transform(Matrix.Translation(Vector((l_hand.x + 0.06, 0, 0))) @ Matrix.Rotation(math.radians(-12), 4, "Z")
                         @ Matrix.Translation(Vector((-(l_hand.x + 0.06), 0, 0))))
    r_objs, _, r_hand = arm("r", MAIL, glove=LEATHER, reach=(0, -0.08))
    return {
        "body": join(body, "body"),
        "arm_l": join(l_objs + [rim, shield, boss] + mark, "arm_l", pivot=(0.24, 0, 1.4)),
        "arm_r": join(r_objs + spear(tuple(r_hand)), "arm_r", pivot=(-0.24, 0, 1.4)),
        "leg_l": legs_["l"],
        "leg_r": legs_["r"],
    }


def crossbowman(f):
    """Crossbowman: nasal helm, padded gambeson in faction colour, crossbow, bolt quiver and a pavise on the back."""
    body = torso(f["cloth"], f["cloth"], LEATHER, skirt_len=0.4, skirt_flare=0.27)
    # Quilting lines on the gambeson.
    for i in range(5):
        body.append(cyl(0.2, 0.2, 0.012, (0, 0, 1.05 + i * 0.085), tuple(c * 0.78 for c in f["cloth"]),
                        seg=12, scale_xy=(1, 0.74), name="quilt", cap=False))
    body += head_and_neck()
    body += nasal_helm()
    body.append(between((0.17, 0.06, 1.0), (0.2, 0.08, 0.6), 0.05, 0.05, LEATHER, seg=8, name="quiver"))
    for k in range(3):
        body.append(cyl(0.008, 0.008, 0.08, (0.18 + k * 0.012, 0.07, 1.04), WOOD, seg=4, name="bolt"))
    pavise = [(-0.28, 0.5), (0.28, 0.5), (0.3, -0.5), (-0.3, -0.5)]
    body.append(slab(pavise, 0.04, f["cloth"], shield_matrix((0, 0.2, 1.05), yaw=180, tilt=-8), "pavise"))
    body += [m for m in cross_on((0, 0.225, 1.05), 0.5, 0.08, f["mark"], 1, depth=0.02)]
    legs_ = legs(HOSE, HOSE, LEATHER)
    l_objs, _, l_hand = arm("l", f["cloth"], reach=(0, -0.3))
    r_objs, _, r_hand = arm("r", f["cloth"], reach=(0, -0.24))
    # Both hands hold the stock at waist height, the bow pointing ahead.
    bow = crossbow(((r_hand.x + l_hand.x) / 2 + 0.03, r_hand.y + 0.12, r_hand.z + 0.03))
    return {
        "body": join(body, "body"),
        "arm_l": join(l_objs, "arm_l", pivot=(0.24, 0, 1.4)),
        "arm_r": join(r_objs + bow, "arm_r", pivot=(-0.24, 0, 1.4)),
        "leg_l": legs_["l"],
        "leg_r": legs_["r"],
    }


def horse(f):
    """A destrier in a faction caparison. One piece for now: the legs are not split for animation yet."""
    objs = [
        ball(0.36, (0, 0, 1.25), HORSE_COAT, scale=(0.95, 2.35, 1.0), subdiv=2, name="barrel"),
        between((0, -0.7, 1.4), (0, -1.08, 1.9), 0.2, 0.14, HORSE_COAT, seg=10, name="neck"),
        between((0, -1.08, 1.92), (0, -1.48, 1.7), 0.12, 0.075, HORSE_COAT, seg=8, name="head"),
        box((0.05, 0.1, 0.12), (0.07, -1.06, 2.05), HORSE_COAT, name="ear_l"),
        box((0.05, 0.1, 0.12), (-0.07, -1.06, 2.05), HORSE_COAT, name="ear_r"),
        between((0, -0.75, 1.6), (0, -1.1, 2.0), 0.05, 0.04, HORSE_DARK, seg=6, name="mane"),
        between((0, 0.8, 1.35), (0, 1.0, 0.7), 0.07, 0.03, HORSE_DARK, seg=6, name="tail"),
    ]
    for x in (0.2, -0.2):
        for y in (-0.6, 0.6):
            objs.append(between((x, y, 1.05), (x, y + 0.02, 0.3), 0.075, 0.05, HORSE_COAT, seg=8, name="leg"))
            objs.append(cyl(0.06, 0.07, 0.3, (x, y + 0.02, 0.15), HORSE_DARK, seg=8, name="hoof"))
    # Caparison: cloth hanging over the body, with the faction cross on each flank.
    objs.append(cyl(0.5, 0.42, 0.62, (0, 0, 1.04), f["cloth"], seg=16, scale_xy=(0.92, 2.15), name="caparison", cap=False))
    objs.append(ball(0.37, (0, 0, 1.3), f["cloth"], scale=(1.0, 2.38, 0.86), subdiv=2, name="caparison_top"))
    for sx in (1, -1):
        bar_v = box((0.012, 0.08, 0.42), (0.47 * sx, 0.15, 1.05), f["mark"], name="mark_v")
        bar_h = box((0.012, 0.42, 0.08), (0.47 * sx, 0.15, 1.12), f["mark"], name="mark_h")
        objs += [bar_v, bar_h]
    objs.append(between((0, -0.75, 1.62), (0, -1.15, 2.02), 0.21, 0.15, f["cloth"], seg=10, name="crinet"))
    objs.append(cyl(0.2, 0.2, 0.1, (0, -0.1, 1.68), LEATHER, seg=10, scale_xy=(1.1, 1.6), name="saddle"))
    objs.append(box((0.32, 0.06, 0.18), (0, 0.18, 1.78), LEATHER, name="cantle"))
    return join(objs, "horse")


def knight(f):
    """A mounted knight: great helm, mail, faction surcoat with the cross, heater shield and a couched lance."""
    seat = 1.72
    body = [
        cyl(0.17, 0.2, 0.46, (0, 0, seat + 0.32), f["cloth"], seg=12, scale_xy=(1, 0.72), name="surcoat"),
        cyl(0.2, 0.15, 0.08, (0, 0, seat + 0.57), MAIL, seg=12, scale_xy=(1, 0.75), name="shoulders"),
        cyl(0.185, 0.185, 0.05, (0, 0, seat + 0.12), LEATHER, seg=12, scale_xy=(1, 0.74), name="belt"),
        cyl(0.055, 0.055, 0.1, (0, 0, seat + 0.62), MAIL, seg=8, name="neck"),
    ]
    body += cross_on((0, -0.145, seat + 0.33), 0.36, 0.07, f["mark"], -1)
    # The helm is built for a standing man (head at 1.63 m); lift it onto the seated rider's head.
    head_lift = seat + 0.73 - 1.63
    for part in great_helm(f["trim"] if f is FACTIONS["enemy"] else BRASS):
        part.data.transform(Matrix.Translation(Vector((0, 0, head_lift))))
        body.append(part)
    # Legs astride the horse: thighs forward and out, shins down along the flanks.
    for sx in (1, -1):
        hip = Vector((0.12 * sx, 0.02, seat + 0.05))
        knee = Vector((0.34 * sx, -0.3, seat - 0.12))
        foot = Vector((0.36 * sx, -0.22, seat - 0.6))
        body.append(between(hip, knee, 0.085, 0.07, MAIL, name="thigh"))
        body.append(between(knee, foot, 0.065, 0.05, MAIL, name="shin"))
        body.append(box((0.1, 0.24, 0.08), tuple(foot + Vector((0, -0.06, -0.03))), DARK_STEEL, name="sabaton"))
        body.append(cyl(0.18, 0.2, 0.32, (0.24 * sx, -0.05, seat - 0.05), f["cloth"], seg=8,
                        scale_xy=(0.6, 1.1), name="surcoat_skirt", cap=False))
    l_objs, _, l_hand = arm("l", MAIL, shoulder_z=seat + 0.5, glove=MAIL, reach=(0, -0.18))
    shield = slab(heater_outline(0.5, 0.62), 0.03, f["cloth"],
                  shield_matrix((l_hand.x + 0.1, l_hand.y - 0.05, l_hand.z + 0.15), yaw=-25, tilt=-10), "heater")
    mark = cross_on((0, 0, 0), 0.42, 0.075, f["mark"], -1, depth=0.012)
    for m in mark:
        m.data.transform(shield_matrix((l_hand.x + 0.1, l_hand.y - 0.05, l_hand.z + 0.15), yaw=-25, tilt=-10)
                         @ Matrix.Rotation(math.radians(-90), 4, "X") @ Matrix.Translation(Vector((0, 0.02, -0.06))))
    r_objs, _, r_hand = arm("r", MAIL, shoulder_z=seat + 0.5, glove=MAIL, reach=(0, -0.12))
    rider = join(body + l_objs + [shield] + mark + r_objs + lance(tuple(r_hand), f["cloth"]), "rider")
    return {"horse": horse(f), "rider": rider}


# ---------------------------------------------------------------------------------------------------------

def vertex_color_material():
    mat = bpy.data.materials.new("soldier")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.78
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def export(parts, filename):
    mat = vertex_color_material()
    root = bpy.data.objects.new(os.path.splitext(filename)[0], None)
    bpy.context.collection.objects.link(root)
    triangles = 0
    for name, obj in parts.items():
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        obj.parent = root
        triangles += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in parts.values():
        obj.select_set(True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_vertex_color="MATERIAL", export_normals=True,
                              export_texcoords=False, export_materials="EXPORT")
    return path, triangles


def main():
    os.makedirs(OUT, exist_ok=True)
    report = []
    for kind, build in (("infantry", infantry), ("crossbowman", crossbowman), ("knight", knight)):
        for side, faction in FACTIONS.items():
            reset_scene()
            parts = build(faction)
            path, tris = export(parts, f"{kind}_{side}.glb")
            report.append(f"{os.path.basename(path)}: {tris} triangles, {os.path.getsize(path)} bytes")
    print("\n".join(report))


if __name__ == "__main__":
    sys.exit(main())
