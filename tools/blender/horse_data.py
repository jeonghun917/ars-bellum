"""The source horse for the cavalry: "Animated Rigged Horse With Saddle" by Ayan (@ayanahmadbutt), Sketchfab,
CC BY 4.0 (the game credits the author). The download is kept on a branch of this repository (HORSE_BRANCH,
see its README.md) and checked against a pinned SHA-256; the .blend in it is opened with scripts disabled.
"""
import hashlib
import os
import subprocess
import zipfile

HORSE_BRANCH = "ccr-3692cb93-6pjzuu-horse-src"
HORSE_ZIP = "animated-rigged-horse-with-saddle.zip"
HORSE_SHA256 = "5033d538838ca3f6e2cfa94c7ccbca9fbd22283fdd246ef74e6348aeb2390e9e"
CREDIT = ('"Animated Rigged Horse With Saddle" by Ayan (@ayanahmadbutt), '
          "https://sketchfab.com/3d-models/animated-rigged-horse-with-saddle-b08743c2c4734fb98a4e0a2f5767c318, "
          "CC BY 4.0")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")


def blend_path():
    """The source .blend, fetched (once) and checked."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, HORSE_ZIP)
    if not os.path.exists(path):
        repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        subprocess.run(["git", "-C", repo, "fetch", "--depth", "1", "origin", HORSE_BRANCH], check=True)
        with open(path + ".part", "wb") as fh:
            subprocess.run(["git", "-C", repo, "show", f"FETCH_HEAD:{HORSE_ZIP}"], check=True, stdout=fh)
        os.replace(path + ".part", path)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if digest != HORSE_SHA256:
        raise RuntimeError(f"horse source digest {digest} is not the pinned {HORSE_SHA256}")
    out = os.path.join(CACHE, "horse_with_saddle.blend")
    if not os.path.exists(out):
        with zipfile.ZipFile(path) as z, open(out, "wb") as fh:
            fh.write(z.read("source/Horse With Saddle.blend"))
    return out
