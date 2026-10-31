"""Reads the MakeHuman base body, its shape targets and the game skeleton from the MPFB package.

Only data files are read (a mesh, shape offsets and two JSON files); none of MPFB's code is run. The package
is fetched once from Blender's extension site, checked against a fixed SHA-256 and cached next to this file
(tools/blender/.cache, not committed).

Licences: the base mesh, the shape targets and the rig weights were released by the MakeHuman project as CC0
(see the header of 3dobjs/base.obj and the "license" field of the weights file). MPFB's code is GPL-3, but
it is not used or copied here.
"""
import gzip
import hashlib
import json
import os
import urllib.request
import zipfile

MPFB_URL = ("https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/"
            "add-on-mpfb-v2.0.18.zip")
MPFB_SHA256 = "c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")


def package():
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "mpfb-2.0.18.zip")
    if not os.path.exists(path):
        urllib.request.urlretrieve(MPFB_URL, path + ".part")
        os.replace(path + ".part", path)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if digest != MPFB_SHA256:
        raise RuntimeError(f"MPFB package digest {digest} is not the pinned {MPFB_SHA256}")
    return zipfile.ZipFile(path)


def _read(zf, name):
    return zf.read(f"data/{name}")


def base_mesh(zf):
    """The base body as lists: vertices (x, y, z) in decimetres, Y up, facing +Z; UVs; faces per group,
    each face a list of (vertex index, uv index)."""
    verts, uvs, groups = [], [], {}
    current = None
    for raw in _read(zf, "3dobjs/base.obj").decode("utf8").splitlines():
        if raw.startswith("v "):
            verts.append(tuple(float(a) for a in raw.split()[1:4]))
        elif raw.startswith("vt "):
            uvs.append(tuple(float(a) for a in raw.split()[1:3]))
        elif raw.startswith("g "):
            current = raw[2:].strip()
            groups.setdefault(current, [])
        elif raw.startswith("f "):
            face = []
            for item in raw.split()[1:]:
                parts = item.split("/")
                face.append((int(parts[0]) - 1, int(parts[1]) - 1 if len(parts) > 1 and parts[1] else None))
            groups[current].append(face)
    return verts, uvs, groups


def target(zf, name):
    """A shape target: {vertex index: (dx, dy, dz)}."""
    text = gzip.decompress(_read(zf, f"targets/{name}.target.gz")).decode("utf8")
    out = {}
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        i, dx, dy, dz = line.split()
        out[int(i)] = (float(dx), float(dy), float(dz))
    return out


def rig(zf, name="game_engine"):
    return json.loads(_read(zf, f"rigs/standard/rig.{name}.json"))


def weights(zf, name="game_engine"):
    data = json.loads(_read(zf, f"rigs/standard/weights.{name}.json"))
    if data.get("license") != "CC0":
        raise RuntimeError(f"weights licence is {data.get('license')!r}, expected CC0")
    return data["weights"]
