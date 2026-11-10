"""Builds the grass cards of the battlefield's meadow from photographed grass (the owner, 2026-11-10: the
painted grass looked stiff; use existing assets). Source: Poly Haven's "Grass Medium 02" and "Grass Bermuda 01"
(CC0, https://polyhaven.com), their colour and alpha maps at 2k. Each real blade and tuft is cut out of the
photographs and many are stood side by side on a card, so a card is a strip of real meadow.

    python3 tools/scenery/build_grass_cards.py

Writes assets/scenery/grass_card_{0,1,2}.webp (RGBA). Downloads go to tools/scenery/.cache (not committed).
The same cards every run (fixed seeds).
"""
import io
import math
import random
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / ".cache"
OUT = ROOT / "assets" / "scenery"
BASE = "https://dl.polyhaven.org/file/ph-assets/Models/png/2k"
SOURCES = {
    "medium": ("grass_medium_02", "grass_medium_02_diff_2k.png", "grass_medium_02_alpha_2k.png"),
    "bermuda": ("grass_bermuda_01", "grass_bermuda_01_diff_2k.png", "grass_bermuda_01_alpha_2k.png"),
}
CARD_W, CARD_H = 1024, 512


def fetch(asset, name):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{BASE}/{asset}/{name}", timeout=300) as r:
            path.write_bytes(r.read())
    return Image.open(path)


def pieces(asset, diff_name, alpha_name):
    """The separate blades and tufts of a photograph: each an RGBA image cropped to itself."""
    colour = fetch(asset, diff_name).convert("RGB")
    alpha = fetch(asset, alpha_name).convert("L")
    mask = alpha.point(lambda v: 255 if v > 24 else 0)
    # Label the parts by flood-filling each with its own value (on a mask grown a little, so a blade broken
    # by a thin gap stays one piece).
    grown = np.array(mask.filter(ImageFilter.MaxFilter(5))) > 0
    labels = Image.fromarray(np.where(grown, 1, 0).astype(np.int32), "I")
    found = []
    next_label = 2
    arr = np.array(labels)
    while True:
        ys, xs = np.nonzero(arr == 1)
        if len(ys) == 0:
            break
        ImageDraw.floodfill(labels, (int(xs[0]), int(ys[0])), next_label)
        arr = np.array(labels)
        ys, xs = np.nonzero(arr == next_label)
        if len(ys) > 400:
            box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
            part_mask = Image.fromarray(((arr == next_label) * np.array(alpha)).astype(np.uint8), "L").crop(box)
            part = colour.crop(box).convert("RGBA")
            part.putalpha(part_mask)
            found.append(part)
        next_label += 1
    return found


def bleed(card):
    """Fills the transparent parts with the colour of the nearest grass, so no black creeps in at the edges
    when the card is drawn small (mipmaps)."""
    rgba = np.array(card).astype(np.float32) / 255.0
    a = rgba[..., 3:4]
    rgb = rgba[..., :3]
    filled = rgb * (a > 0.85)
    weight = (a > 0.85).astype(np.float32)
    acc_rgb = filled.copy()
    acc_w = weight.copy()
    for radius in (2, 4, 8, 16, 32, 64):
        img_rgb = Image.fromarray((acc_rgb * 255).clip(0, 255).astype(np.uint8), "RGB").filter(ImageFilter.BoxBlur(radius))
        img_w = Image.fromarray((acc_w[..., 0] * 255).clip(0, 255).astype(np.uint8), "L").filter(ImageFilter.BoxBlur(radius))
        blur_rgb = np.array(img_rgb).astype(np.float32) / 255.0
        blur_w = np.array(img_w).astype(np.float32)[..., None] / 255.0
        guess = blur_rgb / np.maximum(blur_w, 1e-3)
        empty = acc_w < 0.5
        acc_rgb = np.where(empty & (blur_w > 0.01), guess * 1.0, acc_rgb)
        acc_w = np.where(empty & (blur_w > 0.01), 1.0, acc_w)
    out = np.where(a > 0.85, rgb, acc_rgb)
    result = np.concatenate([out, a], axis=-1)
    return Image.fromarray((result * 255).clip(0, 255).astype(np.uint8), "RGBA")


def card(seed, blades, tufts, dry_share):
    rnd = random.Random(seed)
    canvas = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    upright = [b for b in blades if b.height > b.width * 3]
    dry = [b for b in upright if np.array(b)[..., 0].mean() > np.array(b)[..., 1].mean() * 0.95]
    green = [b for b in upright if b not in dry] or upright

    def stand(piece, x, height, lean, thin=1.0):
        scale = height / piece.height
        p = piece.resize((max(1, int(piece.width * scale * thin)), max(1, int(piece.height * scale))), Image.LANCZOS)
        p = p.rotate(lean, resample=Image.BICUBIC, expand=True)
        canvas.alpha_composite(p, (int(x - p.width / 2), CARD_H - p.height))

    # Tufts low down first, then long blades over them, densest towards the middle of the card's height.
    # (A meadow's blades are slender: the photographed ones are drawn at a third or less of their width.)
    for _ in range(110):
        stand(rnd.choice(tufts), rnd.uniform(0, CARD_W), CARD_H * rnd.uniform(0.18, 0.42), rnd.uniform(-15, 15), rnd.uniform(0.5, 0.8))
    for _ in range(380):
        piece = rnd.choice(dry if dry and rnd.random() < dry_share else green)
        stand(piece, rnd.uniform(0, CARD_W), CARD_H * rnd.uniform(0.4, 1.0), rnd.uniform(-16, 16), rnd.uniform(0.18, 0.34))
    # Shade deeper into the grass (light gets in from above).
    rgba = np.array(canvas).astype(np.float32)
    depth = np.clip(np.linspace(1.0, 0.0, CARD_H), 0, 1)[:, None]  # 1 at the bottom
    rgba[..., :3] *= (1.0 - 0.12 * depth ** 1.5)[..., None]
    return bleed(Image.fromarray(rgba.clip(0, 255).astype(np.uint8), "RGBA"))


def main():
    blades = pieces(*SOURCES["medium"])
    tufts = pieces(*SOURCES["bermuda"])
    print(f"{len(blades)} blades, {len(tufts)} tufts", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    for i, dry in enumerate((0.15, 0.3, 0.08)):
        image = card(20261110 + i, blades, tufts, dry)
        path = OUT / f"grass_card_{i}.webp"
        image.save(path, quality=88, method=6)
        print(path, path.stat().st_size, file=sys.stderr)


if __name__ == "__main__":
    main()
