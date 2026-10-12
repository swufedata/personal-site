#!/usr/bin/env python3
"""Build the welcome-page hero assets from the source clip.

Pipeline
--------
1. Decode every frame of the source video to PNG (lossless, audio dropped).
2. Build a temporal-median "clean plate". The burning-in watermark drifts from
   the bottom-right to the top-left and fades in and out, so it occupies any
   given pixel for well under half the clip; the median erases it. The
   character stands in the same place for the whole clip, so it survives.
3. Detect the watermark zones from temporal statistics (never hard-coded
   coordinates), and patch those zones in every frame with the clean plate.
4. Detect and inpaint the static burned-in HUD (the loading caption and the
   old progress bar) so the page can draw its own.
5. Pick two frame sets: a monotonic "sweep" for pointer tracking and a full
   "loop" for idle playback.
6. Export sprite sheets, a mobile-size sheet, the clean plate and a manifest.

Usage
-----
    python tools/extract.py --video "<path to mp4>" --out assets/hero

Everything is parameterised; rerun after the source clip changes.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

DEFAULT_FFMPEG = (
    r"C:\Users\24861\AppData\Local\Microsoft\WinGet\Packages"
    r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
)

# Corners where the translucent "豆包AI生成" stamp settles, as fractions of the
# frame. The stamp only ever rests in these two spots; the character and the
# drifting white orb live in the middle, so neither zone can clip them.
WATERMARK_ZONES = (
    (0.02, 0.02, 0.24, 0.16),  # x0, y0, x1, y1 -> top-left
    (0.80, 0.80, 0.99, 0.99),  # bottom-right
)

# A pixel is "lifted" in a frame when it sits this far above its own temporal
# median. The stamp is translucent, so this has to clear paper grain and
# compression noise.
HIT_LIFT = 20
# How many frames a pixel must stay lifted for it to read as a stamp rather
# than hatching that flickers for a frame or two.
HIT_MIN_FRAMES = 10

# Search band for the static burned-in loading caption + progress bar.
HUD_SEARCH = (0.35, 0.83, 0.66, 0.96)  # x0, y0, x1, y1 as fractions

# Kernel for the normalized-convolution fill of the HUD zone. It is stretched
# hard along x and nearly flat along y, so every filled pixel is sampled from
# its OWN row. The caption sits on the desk surface, whose real signal is a
# gentle vertical gradient; an isotropic kernel would instead average the dark
# table edge below the bar into the fill and leave a grey cloud.
FILL_SIGMA_X = 80.0
FILL_SIGMA_Y = 0.6

@dataclass
class Args:
    video: str
    out: str
    work: str
    ffmpeg: str
    sweep_start: float
    sweep_end: float
    sweep_count: int
    loop_count: int
    desktop_width: int
    mobile_width: int
    loop_width: int
    sheet_cols: int
    quality: int
    mobile_quality: int
    loop_quality: int
    skip_decode: bool


def log(msg: str) -> None:
    print(f"[extract] {msg}", flush=True)


def json_default(value):
    """Coerce numpy scalars so a stray int32 can never break the manifest."""
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"not JSON serialisable: {type(value)!r}")


def write_json(path: str, obj) -> None:
    """Write JSON atomically: an interrupted run leaves the old file intact
    instead of a half-written stub."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, default=json_default)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# step 1 - decode
# --------------------------------------------------------------------------


def probe(args: Args) -> dict:
    ffprobe = os.path.join(os.path.dirname(args.ffmpeg), "ffprobe.exe")
    cmd = [
        ffprobe, "-hide_banner", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
        "-show_entries", "format=duration",
        "-of", "json",
        args.video,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def decode(args: Args) -> tuple[str, int, int, int]:
    info = probe(args)
    stream = info["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    num, den = (int(p) for p in stream["r_frame_rate"].split("/"))
    fps = num / den

    frames_dir = os.path.join(args.work, "source_frames")
    if args.skip_decode and os.path.isdir(frames_dir):
        count = len([n for n in os.listdir(frames_dir) if n.endswith(".png")])
        log(f"reusing {count} decoded frames from {frames_dir}")
        return frames_dir, width, height, count

    if os.path.isdir(frames_dir):
        # Batch deletion is forbidden in this workspace, so never wipe the
        # scratch directory ourselves. Refuse instead and let the operator
        # clear it by hand or rerun with --skip-decode.
        existing = [n for n in os.listdir(frames_dir) if n.endswith(".png")]
        if existing:
            raise SystemExit(
                f"{frames_dir} already holds {len(existing)} frames; "
                "remove them manually or pass --skip-decode to reuse"
            )
    os.makedirs(frames_dir, exist_ok=True)
    log(f"decoding {args.video} -> {frames_dir} ({width}x{height} @ {fps:g}fps)")
    subprocess.run(
        [
            args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", args.video, "-an", "-fps_mode", "passthrough",
            os.path.join(frames_dir, "%04d.png"),
        ],
        check=True,
    )
    count = len([n for n in os.listdir(frames_dir) if n.endswith(".png")])
    log(f"decoded {count} frames")
    return frames_dir, width, height, count


# --------------------------------------------------------------------------
# step 2/3 - temporal statistics, watermark removal
# --------------------------------------------------------------------------


def _blocks(total: int, size: int):
    for start in range(0, total, size):
        yield start, min(start + size, total)


def build_stats(frames_dir: str, count: int, height: int, width: int, work: str):
    """Return (median, peak, std, hits).

    ``median`` is the clean plate, ``hits`` counts how many frames each pixel
    spent well above that median, which is what singles the watermark out.
    """
    paths = [os.path.join(frames_dir, f"{i:04d}.png") for i in range(1, count + 1)]
    for p in paths:
        if not os.path.isfile(p):
            raise SystemExit(f"missing frame: {p}")

    # Decoding every PNG once into a memmap beats re-opening all of them for
    # each row block, which is what makes this pass slow on long clips.
    shape = (count, height, width, 3)
    cache = os.path.join(work, "frames.dat")
    expected = count * height * width * 3
    if not (os.path.isfile(cache) and os.path.getsize(cache) == expected):
        log(f"caching {count} frames to {cache} ({expected / 1e6:.0f} MB)")
        mm = np.memmap(cache, dtype=np.uint8, mode="w+", shape=shape)
        for i, p in enumerate(paths):
            with Image.open(p) as im:
                mm[i] = np.asarray(im.convert("RGB"))
        mm.flush()
        del mm

    frames = np.memmap(cache, dtype=np.uint8, mode="r", shape=shape)

    median = np.zeros((height, width, 3), np.uint8)
    peak = np.zeros((height, width, 3), np.uint8)
    std = np.zeros((height, width), np.uint8)
    hits = np.zeros((height, width), np.uint8)

    block_rows = max(1, int(30_000_000 / (count * width * 3)))
    log(f"temporal statistics, {block_rows} rows per block")
    for y0, y1 in _blocks(height, block_rows):
        block = np.asarray(frames[:, y0:y1])
        lum = block.max(axis=3).astype(np.int16)
        med_lum = np.partition(lum, count // 2, axis=0)[count // 2]
        median[y0:y1] = np.partition(block, count // 2, axis=0)[count // 2]
        peak[y0:y1] = block.max(axis=0)
        std[y0:y1] = block.std(axis=0).mean(axis=2)
        lifted = (lum - med_lum[None]) > HIT_LIFT
        hits[y0:y1] = lifted.sum(axis=0).clip(0, 255).astype(np.uint8)
        del block, lum, med_lum, lifted

    Image.fromarray(median).save(os.path.join(work, "plate_raw.png"))
    Image.fromarray(peak).save(os.path.join(work, "peak.png"))
    Image.fromarray(hits).save(os.path.join(work, "hits.png"))
    return median, peak, std, hits, frames


def _bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def detect_watermark(hits: np.ndarray, height: int, width: int):
    """Locate the two settled watermark stamps from the temporal hit map.

    Noise and hand-drawn hatching flicker for a frame or two, so they never
    reach HIT_MIN_FRAMES; the stamps linger for dozens of frames and survive as
    large, solid blobs.
    """
    pad = max(12, int(0.012 * width))
    regions = []
    for x0f, y0f, x1f, y1f in WATERMARK_ZONES:
        x0, y0 = int(x0f * width), int(y0f * height)
        x1, y1 = int(x1f * width), int(y1f * height)
        mask = (hits[y0:y1, x0:x1] >= HIT_MIN_FRAMES).astype(np.uint8)
        if not mask.any():
            continue
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        if n <= 1:
            continue
        areas = stats[1:, 4]
        floor = max(250, int(areas.max() * 0.15))
        keep = [i for i in range(1, n) if stats[i, 4] >= floor]
        bx0 = min(stats[i, 0] for i in keep)
        by0 = min(stats[i, 1] for i in keep)
        bx1 = max(stats[i, 0] + stats[i, 2] for i in keep)
        by1 = max(stats[i, 1] + stats[i, 3] for i in keep)
        regions.append((
            int(max(0, x0 + bx0 - pad)),
            int(max(0, y0 + by0 - pad)),
            int(min(width, x0 + bx1 + pad)),
            int(min(height, y0 + by1 + pad)),
        ))
    return regions


def detect_hud(plate: np.ndarray):
    """Mask the burned-in loading caption + progress bar in the clean plate.

    The caption glyphs and the old bar are far darker than the paper, so an ink
    projection inside HUD_SEARCH bounds them without any hard-coded pixels. The
    returned mask is a solid rectangle over that projection box; the feathered
    fill in ``clean_plate`` then erases the whole zone with no residue.
    """
    height, width = plate.shape[:2]
    x0f, y0f, x1f, y1f = HUD_SEARCH
    x0, y0 = int(x0f * width), int(y0f * height)
    x1, y1 = int(x1f * width), int(y1f * height)
    band = cv2.cvtColor(plate[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
    ink = (band < 120).astype(np.uint8)
    if not ink.any():
        return None

    rows = ink.sum(axis=1)
    cols = ink.sum(axis=0)
    # 0.2 of the peak drops the faint desk-edge line that clips the band bottom
    # while every caption and bar row clears it by a wide margin.
    row_keep = np.nonzero(rows >= max(3, int(rows.max() * 0.2)))[0]
    col_keep = np.nonzero(cols >= max(2, int(cols.max() * 0.2)))[0]
    if row_keep.size == 0 or col_keep.size == 0:
        return None

    # Margin must exceed ~3*sigma of the feather in ``clean_plate`` (4.0), so
    # the mask saturates to 1 over every glyph stroke instead of letting a thin
    # ghost of the caption survive the blend.
    pad = 14
    bx0 = max(0, x0 + int(col_keep.min()) - pad)
    by0 = max(0, y0 + int(row_keep.min()) - pad)
    bx1 = min(width, x0 + int(col_keep.max()) + 1 + pad)
    by1 = min(height, y0 + int(row_keep.max()) + 1 + pad)

    full = np.zeros((height, width), np.uint8)
    full[by0:by1, bx0:bx1] = 1
    return full


def mask_box(mask: np.ndarray, pad: int = 0):
    """Padded bounding box of a mask, or None when it is empty."""
    box = _bbox(mask > 0)
    if box is None:
        return None
    height, width = mask.shape[:2]
    x0, y0, x1, y1 = box
    return (
        max(0, x0 - pad),
        max(0, y0 - pad),
        min(width, x1 + pad),
        min(height, y1 + pad),
    )


def refine_plate(frames, plate: np.ndarray, regions) -> np.ndarray:
    """Rebuild the patched zones from a low percentile of the clip.

    The stamp is always brighter than the paper, so the 35th percentile is
    clean even where the stamp lingered for more than half the clip and
    contaminated the median.
    """
    out = plate.copy()
    for x0, y0, x1, y1 in regions:
        block = np.asarray(frames[:, y0:y1, x0:x1])
        out[y0:y1, x0:x1] = np.percentile(block, 35, axis=0).astype(np.uint8)
    return out


def clean_plate(plate: np.ndarray, hud_mask) -> np.ndarray:
    """Erase the burned-in loading caption and progress bar.

    ``cv2.inpaint`` propagates the desk hatching and the bar strokes into the
    fill, which leaves a dotted ghost of the caption behind. A normalized
    convolution instead replaces the zone with flat paper averaged from its own
    surroundings, so no structure survives and the feathered edge leaves no
    seam. The kernel is anisotropic (see ``FILL_SIGMA_X``/``FILL_SIGMA_Y``) so
    the fill follows the band's vertical gradient instead of bleeding the dark
    table edge below it upward into the zone.
    """
    if hud_mask is None or not hud_mask.any():
        return plate.copy()

    src = plate.astype(np.float32)
    m = cv2.GaussianBlur(hud_mask.astype(np.float32), (0, 0), 4.0)
    valid = 1.0 - m
    num = cv2.GaussianBlur(src * valid[..., None], (0, 0), sigmaX=FILL_SIGMA_X, sigmaY=FILL_SIGMA_Y)
    den = cv2.GaussianBlur(valid, (0, 0), sigmaX=FILL_SIGMA_X, sigmaY=FILL_SIGMA_Y)[..., None]
    bg = num / np.maximum(den, 1e-6)
    out = src * (1.0 - m[..., None]) + bg * m[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def patch_frames(frames_dir: str, count: int, plate: np.ndarray, regions, out_dir: str):
    """Paste clean-plate pixels over the burned-in zones in every frame.

    ``regions`` covers both the drifting watermark stamps and the static
    loading caption / progress bar, so the exported frames carry neither.
    """
    os.makedirs(out_dir, exist_ok=True)
    # Feather weights so the patch edge blends into the untouched frame.
    height, width = plate.shape[:2]
    weights = np.zeros((height, width), np.float32)
    for x0, y0, x1, y1 in regions:
        tile = np.ones((y1 - y0, x1 - x0), np.float32)
        feather = 10
        fy = min(feather, (y1 - y0) // 2)
        fx = min(feather, (x1 - x0) // 2)
        if fy > 0:
            ramp = np.linspace(0, 1, fy, dtype=np.float32)
            tile[:fy] *= ramp[:, None]
            tile[-fy:] *= ramp[::-1][:, None]
        if fx > 0:
            ramp = np.linspace(0, 1, fx, dtype=np.float32)
            tile[:, :fx] *= ramp[None, :]
            tile[:, -fx:] *= ramp[::-1][None, :]
        weights[y0:y1, x0:x1] = np.maximum(weights[y0:y1, x0:x1], tile)

    for i in range(1, count + 1):
        src = os.path.join(frames_dir, f"{i:04d}.png")
        with Image.open(src) as im:
            frame = np.asarray(im.convert("RGB"), np.float32)
        w = weights[..., None]
        blended = frame * (1.0 - w) + plate.astype(np.float32) * w
        Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8)).save(
            os.path.join(out_dir, f"{i:04d}.png")
        )


# --------------------------------------------------------------------------
# step 5/6 - selection and export
# --------------------------------------------------------------------------


def pick_indices(count: int, start_s: float, end_s: float, n: int, fps: float) -> list[int]:
    lo = max(0, int(round(start_s * fps)))
    hi = min(count - 1, int(round(end_s * fps)))
    if hi <= lo:
        raise SystemExit("sweep window is empty")
    return [int(round(v)) for v in np.linspace(lo, hi, n)]


def sheet_grid(n: int, cols: int) -> tuple[int, int]:
    cols = max(1, min(cols, n))
    return cols, math.ceil(n / cols)


def build_sheet(frames, cols: int, rows: int, cell_w: int, cell_h: int) -> Image.Image:
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (255, 255, 255))
    for i, im in enumerate(frames):
        r, c = divmod(i, cols)
        if im.size != (cell_w, cell_h):
            im = im.resize((cell_w, cell_h), Image.LANCZOS)
        sheet.paste(im, (c * cell_w, r * cell_h))
    return sheet


def export(args: Args, cleaned_dir: str, count: int, fps: float, work: str):
    hero_dir = args.out
    os.makedirs(hero_dir, exist_ok=True)

    def load(idx: int) -> Image.Image:
        with Image.open(os.path.join(cleaned_dir, f"{idx + 1:04d}.png")) as im:
            return im.convert("RGB").copy()

    sweep_idx = pick_indices(count, args.sweep_start, args.sweep_end, args.sweep_count, fps)
    loop_idx = pick_indices(count, 0.0, (count - 1) / fps, args.loop_count, fps)
    log(f"sweep frames {sweep_idx[0]}..{sweep_idx[-1]} ({len(sweep_idx)})")
    log(f"loop  frames {loop_idx[0]}..{loop_idx[-1]} ({len(loop_idx)})")

    manifest = {
        "source": {
            "width": Image.open(os.path.join(cleaned_dir, "0001.png")).size[0],
            "height": Image.open(os.path.join(cleaned_dir, "0001.png")).size[1],
            "fps": round(fps, 6),
            "frames": count,
            "span": round((count - 1) / fps, 6),
        },
        "sheets": {},
    }

    def times(idx):
        return round(idx[0] / fps, 6), round(idx[-1] / fps, 6)

    for name, idx, width, quality, cell_h_ratio in (
        ("desktop", sweep_idx, args.desktop_width, args.quality, None),
        ("mobile", sweep_idx, args.mobile_width, args.mobile_quality, None),
    ):
        src_w, src_h = load(idx[0]).size
        cell_h = int(round(width * src_h / src_w))
        frames = [load(i) for i in idx]
        cols, rows = sheet_grid(len(frames), args.sheet_cols)
        sheet = build_sheet(frames, cols, rows, width, cell_h)
        path = os.path.join(hero_dir, f"hero-sheet-{name}.webp")
        sheet.save(path, "WEBP", quality=quality, method=6)
        manifest["sheets"][name] = {
            "file": os.path.basename(path),
            "cols": cols,
            "rows": rows,
            "frameWidth": width,
            "frameHeight": cell_h,
            "frames": len(frames),
            "t0": times(idx)[0],
            "t1": times(idx)[1],
            "bytes": os.path.getsize(path),
        }
        log(f"{name} sheet {cols}x{rows} cell {width}x{cell_h} -> {os.path.getsize(path) / 1024:.0f} KB")

    # Idle loop sheet (used when the pointer is inactive). It gets its own
    # width and quality: the loop is the heaviest sheet, and 800px still reads
    # as sharp behind the breathing/parallax layers.
    src_w, src_h = load(loop_idx[0]).size
    loop_w = args.loop_width
    loop_h = int(round(loop_w * src_h / src_w))
    loop_frames = [load(i) for i in loop_idx]
    cols, rows = sheet_grid(len(loop_frames), args.sheet_cols)
    loop_sheet = build_sheet(loop_frames, cols, rows, loop_w, loop_h)
    loop_path = os.path.join(hero_dir, "hero-loop.webp")
    loop_sheet.save(loop_path, "WEBP", quality=args.loop_quality, method=6)
    manifest["sheets"]["loop"] = {
        "file": os.path.basename(loop_path),
        "cols": cols,
        "rows": rows,
        "frameWidth": loop_w,
        "frameHeight": loop_h,
        "frames": len(loop_frames),
        "t0": times(loop_idx)[0],
        "t1": times(loop_idx)[1],
        "bytes": os.path.getsize(loop_path),
    }
    log(f"loop sheet {cols}x{rows} -> {os.path.getsize(loop_path) / 1024:.0f} KB")

    manifest["sweep"] = {"from": 0, "to": len(sweep_idx) - 1}
    manifest["loop"] = {"from": 0, "to": len(loop_idx) - 1}
    write_json(os.path.join(hero_dir, "manifest.json"), manifest)
    return manifest, sweep_idx, loop_idx


def contact_sheet(args, cleaned_dir, indices, path, cols=7, cell_w=320):
    with Image.open(os.path.join(cleaned_dir, f"{indices[0] + 1:04d}.png")) as im:
        w, h = im.size
    cell_h = int(round(cell_w * h / w))
    rows = math.ceil(len(indices) / cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (255, 255, 255))
    for i, idx in enumerate(indices):
        with Image.open(os.path.join(cleaned_dir, f"{idx + 1:04d}.png")) as im:
            frame = im.convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
        r, c = divmod(i, cols)
        sheet.paste(frame, (c * cell_w, r * cell_h))
    sheet.save(path, "JPEG", quality=88)
    log(f"contact sheet -> {path}")


def region_sheet(cleaned_dir, indices, regions, path, scale=2):
    """Tile the patched watermark zones across the clip so residue is obvious."""
    crops = []
    for x0, y0, x1, y1 in regions:
        rows = []
        for idx in indices:
            with Image.open(os.path.join(cleaned_dir, f"{idx + 1:04d}.png")) as im:
                crop = im.convert("RGB").crop((x0, y0, x1, y1))
            crop = crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST)
            rows.append(crop)
        w = max(r.width for r in rows)
        h = max(r.height for r in rows)
        sheet = Image.new("RGB", (w, (h + 8) * len(rows)), (255, 0, 0))
        for i, r in enumerate(rows):
            sheet.paste(r, (0, i * (h + 8)))
        crops.append(sheet)

    total_h = sum(c.height for c in crops) + 24 * (len(crops) - 1)
    total_w = max(c.width for c in crops)
    out = Image.new("RGB", (total_w, total_h), (0, 0, 0))
    y = 0
    for c in crops:
        out.paste(c, (0, y))
        y += c.height + 24
    out.save(path, "JPEG", quality=90)
    log(f"watermark QA sheet -> {path}")


# --------------------------------------------------------------------------


def parse_args(argv) -> Args:
    p = argparse.ArgumentParser(description="Build welcome page hero assets")
    p.add_argument("--video", required=True)
    p.add_argument("--out", default="assets/hero")
    p.add_argument("--work", default=".work")
    p.add_argument("--ffmpeg", default=DEFAULT_FFMPEG)
    p.add_argument("--sweep-start", type=float, default=1.05)
    p.add_argument("--sweep-end", type=float, default=4.55)
    p.add_argument("--sweep-count", type=int, default=26)
    p.add_argument("--loop-count", type=int, default=34)
    p.add_argument("--desktop-width", type=int, default=1280)
    p.add_argument("--mobile-width", type=int, default=960)
    p.add_argument("--loop-width", type=int, default=800)
    p.add_argument("--sheet-cols", type=int, default=6)
    p.add_argument("--quality", type=int, default=78)
    p.add_argument("--mobile-quality", type=int, default=78)
    p.add_argument("--loop-quality", type=int, default=76)
    p.add_argument("--skip-decode", action="store_true")
    return Args(**vars(p.parse_args(argv)))


def main(argv) -> int:
    args = parse_args(argv)
    if not os.path.isfile(args.video):
        raise SystemExit(f"video not found: {args.video}")
    os.makedirs(args.work, exist_ok=True)

    frames_dir, width, height, count = decode(args)
    num, den = None, None
    info = probe(args)
    num, den = (int(x) for x in info["streams"][0]["r_frame_rate"].split("/"))
    fps = num / den

    median, peak, std, hits, frames = build_stats(frames_dir, count, height, width, args.work)
    wm_regions = detect_watermark(hits, height, width)
    log(f"watermark regions: {wm_regions}")

    hud_mask = detect_hud(median)
    # detect_hud already returns the ink box grown by the feather margin, so the
    # patch region is exactly the area clean_plate repainted.
    hud_box = mask_box(hud_mask, pad=0) if hud_mask is not None else None
    log(f"burned-in HUD box: {hud_box}")

    plate = clean_plate(median, hud_mask)
    plate = refine_plate(frames, plate, wm_regions)
    Image.fromarray(plate).save(os.path.join(args.work, "plate_clean.png"))

    cleaned_dir = os.path.join(args.work, "cleaned")
    # The frames must lose the burned-in loading caption and progress bar too,
    # otherwise the page's own HUD would sit on top of ghost text.
    patch_regions = list(wm_regions)
    if hud_box:
        patch_regions.append(tuple(int(v) for v in hud_box))
    patch_frames(frames_dir, count, plate, patch_regions, cleaned_dir)
    log(f"patched {count} frames -> {cleaned_dir}")

    os.makedirs(args.out, exist_ok=True)
    Image.fromarray(plate).save(os.path.join(args.out, "plate.png"), "PNG", optimize=True)

    manifest, sweep_idx, loop_idx = export(args, cleaned_dir, count, fps, args.work)
    contact_sheet(args, cleaned_dir, sweep_idx, os.path.join(args.work, "sweep_contact.jpg"))
    contact_sheet(args, cleaned_dir, loop_idx, os.path.join(args.work, "loop_contact.jpg"))
    manifest["plate"] = os.path.basename(os.path.join(args.out, "plate.png"))
    manifest["watermarkRegions"] = [
        {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0} for x0, y0, x1, y1 in wm_regions
    ]
    if wm_regions:
        qa = sorted({int(round(v * (count - 1))) for v in np.linspace(0, 1, 9)})
        region_sheet(cleaned_dir, qa, wm_regions, os.path.join(args.work, "watermark_qa.jpg"))
    write_json(os.path.join(args.out, "manifest.json"), manifest)

    total = sum(s["bytes"] for s in manifest["sheets"].values())
    log(f"total sheet payload: {total / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
