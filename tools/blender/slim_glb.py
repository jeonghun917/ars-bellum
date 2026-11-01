"""Make a soldier model file smaller without changing how it looks or moves.

Blender writes every bone's position, turn and size into every clip at every frame, still or not. That is
about half of the file (13,000 channels for 48 clips), most of it saying nothing. This keeps the meshes,
the skins, the pictures and the other data byte for byte and rewrites only the animations:

- a bone part no clip moves from where it rests is left out of every clip (three.js then never touches it,
  and it stays at its rest); a part some clip moves keeps a channel in every clip, so clips playing
  together mix just as before;
- a channel that holds a bone still elsewhere keeps only its first and last key (the clip lasts as long);
- inside a moving channel, a key the keys around it already give (interpolated as three.js does: straight
  lines, rotations along the sphere) to within TOLERANCE is left out;
- identical key lists are stored once, in one block.

check() then plays both files through every channel at every original key and halfway between keys, and
fails if anything moves further than TOLERANCE from where it was (rotations in radians, positions in
metres, sizes as a fraction), or if any clip got shorter or anything else in the file changed.

Run on its own: python slim_glb.py model.glb [out.glb]  (no Blender needed)
"""
import json
import struct
import sys

import numpy as np

TOLERANCE = 1e-6     # 0.001 mm, or 0.00006 degrees (measured: at most ~120 of 390,000 pixels change, on outlines)
REST = {"translation": (0.0, 0.0, 0.0), "rotation": (0.0, 0.0, 0.0, 1.0), "scale": (1.0, 1.0, 1.0)}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DTYPES = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}


# ------------------------------------------------------------------------------------------------ reading

def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67 and version == 2, f"{path}: not a glTF 2 binary"
    n = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + n])
    rest = data[20 + n:]
    blob = b""
    if rest:
        m = struct.unpack("<I", rest[:4])[0]
        blob = rest[8:8 + m]
    return doc, blob


def accessor(doc, blob, index):
    a = doc["accessors"][index]
    view = doc["bufferViews"][a["bufferView"]]
    width = COMPONENTS[a["type"]]
    dtype = np.dtype(DTYPES[a["componentType"]])
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = view.get("byteStride", 0)
    if stride and stride != width * dtype.itemsize:
        rows = [np.frombuffer(blob, dtype, width, start + i * stride) for i in range(a["count"])]
        return np.array(rows)
    return np.frombuffer(blob, dtype, a["count"] * width, start).reshape(a["count"], width)


# ------------------------------------------------------------------------------------ playing a channel

def _slerp(q0, q1, f):
    """Rotations between q0 and q1 (rows, x y z w) at fractions f, the way three.js does it (the shorter way)."""
    d = np.sum(q0 * q1, axis=1)
    q1 = np.where(d[:, None] < 0, -q1, q1)
    d = np.abs(d)
    theta = np.arccos(np.clip(d, -1, 1))
    s = np.sin(theta)
    small = s < 1e-6
    a = np.where(small, 1 - f, np.sin((1 - f) * theta) / np.where(small, 1, s))
    b = np.where(small, f, np.sin(f * theta) / np.where(small, 1, s))
    out = q0 * a[:, None] + q1 * b[:, None]
    return out / np.linalg.norm(out, axis=1)[:, None]


def play(times, values, interpolation, path, at):
    """A channel's values at the times `at` (clamped to its first and last key, as three.js plays it)."""
    at = np.asarray(at, dtype=np.float64)
    times = np.asarray(times, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    if len(times) == 1:
        return np.repeat(values[:1], len(at), axis=0)
    i = np.clip(np.searchsorted(times, at, side="right") - 1, 0, len(times) - 2)
    t0, t1 = times[i], times[i + 1]
    f = np.clip((at - t0) / np.where(t1 > t0, t1 - t0, 1), 0, 1)
    if interpolation == "STEP":
        return np.where((f >= 1)[:, None], values[i + 1], values[i])
    if path == "rotation":
        return _slerp(values[i], values[i + 1], f)
    return values[i] * (1 - f)[:, None] + values[i + 1] * f[:, None]


def difference(path, a, b):
    """How far apart two runs of values are: radians for rotations, otherwise the largest component."""
    if path == "rotation":
        d = np.abs(np.sum(a * b, axis=1)) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1))
        return float(np.max(2 * np.arccos(np.clip(d, -1, 1)))) if len(d) else 0.0
    return float(np.max(np.abs(a - b))) if len(a) else 0.0


# ------------------------------------------------------------------------------------------- slimming

def _keep_keys(times, values, interpolation, path):
    """The keys of one moving channel that are needed (indices), greedily: from each kept key, as far on as
    the line (or arc) to a later key still passes within TOLERANCE of every key in between."""
    n = len(times)
    keep = [0]
    a = 0
    while a < n - 1:
        b = a + 1
        while b + 1 < n:
            inner = np.arange(a + 1, b + 1)
            got = play(times[[a, b + 1]], values[[a, b + 1]], interpolation, path, times[inner])
            if difference(path, got, values[inner].astype(np.float64)) > TOLERANCE:
                break
            b += 1
        keep.append(b)
        a = b
    return keep


def slim_channel(times, values, interpolation, path, node_rest):
    """None to leave the channel out, else the (times, values) to keep."""
    values64 = values.astype(np.float64)
    still = difference(path, values64, np.repeat(values64[:1], len(values64), axis=0)) <= TOLERANCE
    if still:
        if difference(path, values64[:1], np.array([node_rest], dtype=np.float64)) <= TOLERANCE:
            return None
        return times[[0, -1]], values[[0, 0]]
    keep = _keep_keys(times, values, interpolation, path)
    return times[keep], values[keep]


def slim(doc, blob):
    """A new (doc, blob) with the animations rewritten; everything else as it was."""
    nodes = doc["nodes"]
    anim_accessors = set()
    for anim in doc.get("animations", []):
        for s in anim["samplers"]:
            anim_accessors.update((s["input"], s["output"]))
    other_accessors = set()
    for mesh in doc.get("meshes", []):
        for p in mesh["primitives"]:
            other_accessors.update(p["attributes"].values())
            if "indices" in p:
                other_accessors.add(p["indices"])
            for target in p.get("targets", []):
                other_accessors.update(target.values())
    for skin in doc.get("skins", []):
        if "inverseBindMatrices" in skin:
            other_accessors.add(skin["inverseBindMatrices"])
    assert not (anim_accessors & other_accessors), "an accessor is shared by an animation and a mesh"

    # The new animations, as arrays. A bone part (a node's translation, rotation or scale) is left out only
    # where no clip moves it from its rest: three.js mixes clips playing together (a blow over a walk, a
    # fade from one clip to the next) bone by bone, so a part one clip moves must stay in all of them.
    new_anims = []
    for anim in doc.get("animations", []):
        channels = []
        for ch in anim["channels"]:
            s = anim["samplers"][ch["sampler"]]
            path = ch["target"]["path"]
            times = accessor(doc, blob, s["input"])[:, 0]
            values = accessor(doc, blob, s["output"])
            interp = s.get("interpolation", "LINEAR")
            if path not in REST or interp not in ("LINEAR", "STEP"):
                channels.append((ch["target"], interp, times, values, (times, values)))   # (kept as it is)
                continue
            node = nodes[ch["target"]["node"]]
            kept = slim_channel(times, values, interp, path, node.get(path, REST[path]))
            channels.append((ch["target"], interp, times, values, kept))
        new_anims.append((anim, channels))
    moved = {(t["node"], t["path"]) for _, channels in new_anims for t, _, _, _, kept in channels if kept is not None}
    for i, (anim, channels) in enumerate(new_anims):
        out_channels = []
        for target, interp, times, values, kept in channels:
            if (target["node"], target["path"]) not in moved:
                continue
            if kept is None:   # at rest in this clip, moved in another: held at rest, two keys
                kept = times[[0, -1]], values[[0, 0]]
            out_channels.append((target, interp, kept[0], kept[1]))
        new_anims[i] = (anim, out_channels)

    # Keep the other accessors and buffer views as they are (renumbered), and the bytes they use.
    keep_acc = sorted(i for i in range(len(doc["accessors"])) if i not in anim_accessors)
    used_views = {doc["accessors"][i]["bufferView"] for i in keep_acc if "bufferView" in doc["accessors"][i]}
    used_views |= {img["bufferView"] for img in doc.get("images", []) if "bufferView" in img}
    keep_views = sorted(used_views)
    view_map = {old: new for new, old in enumerate(keep_views)}
    acc_map = {old: new for new, old in enumerate(keep_acc)}
    out = bytearray()
    views = []
    for old in keep_views:
        v = dict(doc["bufferViews"][old])
        start, length = v.get("byteOffset", 0), v["byteLength"]
        while len(out) % 4:
            out.append(0)
        v["byteOffset"] = len(out)
        out += blob[start:start + length]
        views.append(v)
    accessors = []
    for old in keep_acc:
        a = dict(doc["accessors"][old])
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
        accessors.append(a)

    # The animations' keys, each distinct list once, in one buffer view.
    while len(out) % 4:
        out.append(0)
    anim_start = len(out)
    stored = {}

    def store(array, kind, is_input):
        array = np.ascontiguousarray(array, dtype=np.float32)
        key = (kind, array.tobytes())
        if key not in stored:
            entry = {"bufferView": len(views), "byteOffset": len(out) - anim_start, "componentType": 5126,
                     "count": int(array.shape[0]), "type": kind}
            if is_input:
                entry["min"] = [float(array.min())]
                entry["max"] = [float(array.max())]
            out.extend(array.tobytes())
            stored[key] = len(accessors)
            accessors.append(entry)
        return stored[key]

    animations = []
    for anim, channels in new_anims:
        samplers, chans = [], []
        for target, interp, times, values in channels:
            kind = {1: "SCALAR", 3: "VEC3", 4: "VEC4"}[values.shape[1]]
            sampler = {"input": store(times.reshape(-1, 1), "SCALAR", True),
                       "output": store(values, kind, False)}
            if interp != "LINEAR":
                sampler["interpolation"] = interp
            chans.append({"sampler": len(samplers), "target": target})
            samplers.append(sampler)
        a = {k: v for k, v in anim.items() if k not in ("channels", "samplers")}
        a["channels"], a["samplers"] = chans, samplers
        animations.append(a)
    views.append({"buffer": 0, "byteOffset": anim_start, "byteLength": len(out) - anim_start})

    new = dict(doc)
    new["animations"] = animations
    new["accessors"] = accessors
    new["bufferViews"] = views
    new["buffers"] = [{"byteLength": len(out)}]
    for mesh in new.get("meshes", []):
        for p in mesh["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            if "targets" in p:
                p["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in p["targets"]]
    for skin in new.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = acc_map[skin["inverseBindMatrices"]]
    for img in new.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = view_map[img["bufferView"]]
    return new, bytes(out)


def write_glb(path, doc, blob):
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    text += b" " * (-len(text) % 4)
    blob += b"\0" * (-len(blob) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
        fh.write(struct.pack("<II", len(blob), 0x004E4942) + blob)


# --------------------------------------------------------------------------------------------- checking

def check(old_doc, old_blob, new_doc, new_blob):
    """Problems (empty when the new file looks and moves as the old one does)."""
    problems = []
    # Everything but the animations: the same, apart from renumbering.
    for key in ("nodes", "materials", "textures", "samplers", "scenes", "skins"):
        a = [{k: v for k, v in x.items() if k != "inverseBindMatrices"} for x in old_doc.get(key, [])]
        b = [{k: v for k, v in x.items() if k != "inverseBindMatrices"} for x in new_doc.get(key, [])]
        if a != b:
            problems.append(f"{key} changed")
    for old_skin, new_skin in zip(old_doc.get("skins", []), new_doc.get("skins", [])):
        if "inverseBindMatrices" in old_skin and not np.array_equal(
                accessor(old_doc, old_blob, old_skin["inverseBindMatrices"]),
                accessor(new_doc, new_blob, new_skin["inverseBindMatrices"])):
            problems.append(f"skin {old_skin.get('name')} bind matrices changed")
    for m, (om, nm) in enumerate(zip(old_doc.get("meshes", []), new_doc.get("meshes", []))):
        for op, np_ in zip(om["primitives"], nm["primitives"]):
            if {k: v for k, v in op.items() if k not in ("attributes", "indices")} != \
                    {k: v for k, v in np_.items() if k not in ("attributes", "indices")} or \
                    op["attributes"].keys() != np_["attributes"].keys():
                problems.append(f"mesh {om.get('name', m)} changed")
                continue
            pairs = [(op["attributes"][k], np_["attributes"][k]) for k in op["attributes"]]
            if "indices" in op:
                pairs.append((op["indices"], np_["indices"]))
            for a, b in pairs:
                if not np.array_equal(accessor(old_doc, old_blob, a), accessor(new_doc, new_blob, b)):
                    problems.append(f"mesh {om.get('name', m)} data changed")
                    break
    for i, (a, b) in enumerate(zip(old_doc.get("images", []), new_doc.get("images", []))):
        va, vb = old_doc["bufferViews"][a["bufferView"]], new_doc["bufferViews"][b["bufferView"]]
        if old_blob[va.get("byteOffset", 0):va.get("byteOffset", 0) + va["byteLength"]] != \
                new_blob[vb.get("byteOffset", 0):vb.get("byteOffset", 0) + vb["byteLength"]]:
            problems.append(f"image {i} changed")
    if len(old_doc.get("meshes", [])) != len(new_doc.get("meshes", [])) or \
            len(old_doc.get("images", [])) != len(new_doc.get("images", [])):
        problems.append("parts missing")

    # The animations: every channel played at every old key and halfway between them. And a bone part
    # any clip still moves has its channel in every clip that had one (so clips mix as before).
    new_anims = {a["name"]: a for a in new_doc.get("animations", [])}
    kept = {(c["target"]["node"], c["target"]["path"]) for a in new_anims.values() for c in a["channels"]}
    for anim in old_doc.get("animations", []):
        mine = new_anims.get(anim["name"], {"channels": []})
        have = {(c["target"]["node"], c["target"]["path"]) for c in mine["channels"]}
        lost = {(c["target"]["node"], c["target"]["path"]) for c in anim["channels"]} & kept - have
        if lost:
            problems.append(f"clip {anim['name']} lost {len(lost)} channels other clips keep")
    worst = 0.0
    for anim in old_doc.get("animations", []):
        mine = new_anims.get(anim["name"])
        if mine is None:
            problems.append(f"clip {anim['name']} missing")
            continue
        theirs = {(c["target"]["node"], c["target"]["path"]): mine["samplers"][c["sampler"]] for c in mine["channels"]}
        length_old, length_new = 0.0, 0.0
        for s in mine["samplers"]:
            length_new = max(length_new, float(accessor(new_doc, new_blob, s["input"])[-1, 0]))
        for ch in anim["channels"]:
            s = anim["samplers"][ch["sampler"]]
            path, node = ch["target"]["path"], ch["target"]["node"]
            times = accessor(old_doc, old_blob, s["input"])[:, 0].astype(np.float64)
            length_old = max(length_old, float(times[-1]))
            at = np.concatenate([times, (times[:-1] + times[1:]) / 2])
            want = play(times, accessor(old_doc, old_blob, s["output"]), s.get("interpolation", "LINEAR"), path, at)
            got_s = theirs.get((node, path))
            if got_s is None:
                rest = old_doc["nodes"][node].get(path, REST[path])
                got = np.repeat(np.array([rest], dtype=np.float64), len(at), axis=0)
            else:
                got = play(accessor(new_doc, new_blob, got_s["input"])[:, 0], accessor(new_doc, new_blob, got_s["output"]),
                           got_s.get("interpolation", "LINEAR"), path, at)
            off = difference(path, want, got)
            worst = max(worst, off)
            if off > max(TOLERANCE * 1.01, 2e-7):   # (2e-7: the rounding of 32-bit numbers)
                problems.append(f"clip {anim['name']}: {old_doc['nodes'][node].get('name')} {path} moves {off:.2e} off")
        if abs(length_old - length_new) > 1e-6:
            problems.append(f"clip {anim['name']} lasts {length_new:.3f} s, was {length_old:.3f} s")
    return problems, worst


def slim_file(path, out=None):
    """Slim path (into out, or in place) once check() finds no difference. Returns (old size, new size, worst
    difference); raises if there is any."""
    doc, blob = read_glb(path)
    new_doc, new_blob = slim(doc, blob)
    tmp = (out or path) + ".slim"
    write_glb(tmp, new_doc, new_blob)
    # Checked as read back from the file written, so what is checked is what is shipped.
    problems, worst = check(doc, blob, *read_glb(tmp))
    if problems:
        raise RuntimeError(f"slim_glb: {path}: " + "; ".join(problems[:8]))
    import os
    old_size = os.path.getsize(path)
    os.replace(tmp, out or path)
    return old_size, os.path.getsize(out or path), worst


if __name__ == "__main__":
    before, after, worst = slim_file(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(f"{sys.argv[1]}: {before} -> {after} bytes, largest difference {worst:.2e}")
