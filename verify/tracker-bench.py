"""
Tracker bench: our NCC tracker against OpenCV's alternatives, on a degraded
synthetic snatch, with ground truth.

The P2 plan measured the tracker on clean synthetic footage and said so:
motion blur through the second pull, hands crossing the plate, low resolution
and a hard codec were untested. This script builds exactly that footage —
384×288 like a phone clip downscaled, 50 fps, a rotating branded plate, blur
proportional to bar speed, an occluder sweeping across the plate, sensor
noise, VP8 through a real encoder — and scores every approach against the
trajectory it was drawn from.

  1. python3 verify/tracker-bench.py make      → verify/fixtures/synth-degraded.webm + truth.json
  2. npm run dev; OUT=/tmp/t QUERY='clip=/verify/fixtures/synth-degraded.webm&anchor=0,X,Y&plate=X,Y,R,R,0,45' node verify/shoot-track.mjs
     (X, Y, R are printed by step 1)
  3. python3 verify/tracker-bench.py score /tmp/t/result.json   → table

Needs opencv-python-headless and numpy (pip; not project dependencies).
"""
import json
import math
import os
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
CLIP = os.path.join(FIX, 'synth-degraded.webm')
TRUTH = os.path.join(FIX, 'synth-degraded.truth.json')

W, H, FPS, FRAMES = 384, 288, 50, 175
PLATE_R = 22          # 45 cm plate ≈ 44 px across at this scale (~1 cm/px)
ANCHOR_FRAME = 10     # the coach anchors on a still frame before lift-off


def truth_at(i):
    """A snatch bar path: still, first pull, transition dip, second pull, catch."""
    t = i / FPS
    # vertical: cumulative velocity profile in px/s (positive = up)
    knots = [(0.0, 0), (0.3, 0), (0.7, 120), (0.85, 90), (1.15, 220), (1.35, 0), (1.55, -70), (1.75, 0), (3.5, 0)]
    def v_at(tt):
        for a, b in zip(knots, knots[1:]):
            if tt <= b[0]:
                u = (tt - a[0]) / (b[0] - a[0])
                u = u * u * (3 - 2 * u)
                return a[1] + (b[1] - a[1]) * u
        return 0
    y = 0.0
    n = int(t * 1000)
    for k in range(n):
        y += v_at(k / 1000) / 1000
    x = 8 * math.sin(min(1.0, t / 1.6) * math.pi * 2) if t < 1.6 else 0
    return 150.37 + x, 236.61 - y, v_at(t)


def make():
    os.makedirs(FIX, exist_ok=True)
    rng = np.random.default_rng(3)
    # A gym: mottled wall, floor band, a rack upright, a horizontal line at plate height.
    wall = np.full((H, W), 92, np.float32)
    wall += cv2.GaussianBlur(rng.normal(0, 18, (H, W)).astype(np.float32), (0, 0), 9)
    wall[H - 40:, :] = 70
    wall[:, 300:316] = 175
    wall[120:124, :] = 130
    truth = []
    fourcc = cv2.VideoWriter_fourcc(*'VP80')
    writer = cv2.VideoWriter(CLIP, fourcc, FPS, (W, H))
    assert writer.isOpened()
    for i in range(FRAMES):
        x, y, vy = truth_at(i)
        truth.append([x, y])
        img = wall.copy()
        # bar sleeve
        cv2.rectangle(img, (int(x - 60), int(y - 4)), (int(x + 60), int(y + 4)), 120, -1)
        # plate: disc, bright rim, rotating branding bar
        cv2.circle(img, (int(round(x)), int(round(y))), PLATE_R, 105, -1, lineType=cv2.LINE_AA)
        cv2.circle(img, (int(round(x)), int(round(y))), PLATE_R, 210, 3, lineType=cv2.LINE_AA)
        ang = (i / FRAMES) * 2 * math.pi * 1.5
        rect = ((x, y), (PLATE_R * 1.4, PLATE_R * 0.45), math.degrees(ang))
        box = cv2.boxPoints(rect).astype(np.int32)
        cv2.fillPoly(img, [box], 45, lineType=cv2.LINE_AA)
        # occluder: a "hand" sweeping across the plate during the second pull
        if 52 <= i <= 66:
            ox = x - 30 + (i - 52) * 4
            cv2.circle(img, (int(ox), int(y + 6)), 12, 60, -1, lineType=cv2.LINE_AA)
        # motion blur along the direction of travel, proportional to speed
        blur = int(min(9, abs(vy) / 40))
        if blur >= 2:
            k = np.zeros((blur, blur), np.float32)
            k[:, blur // 2] = 1.0 / blur
            img = cv2.filter2D(img, -1, k)
        # sensor noise + slight camera shake
        img += rng.normal(0, 4, img.shape).astype(np.float32)
        shake = rng.normal(0, 0.4, 2)
        M = np.float32([[1, 0, shake[0]], [0, 1, shake[1]]])
        img = cv2.warpAffine(img, M, (W, H), borderMode=cv2.BORDER_REFLECT)
        truth[-1] = [truth[-1][0] + float(shake[0]), truth[-1][1] + float(shake[1])]
        frame = np.clip(img, 0, 255).astype(np.uint8)
        writer.write(cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR))
    writer.release()
    ax, ay = truth[ANCHOR_FRAME]
    json.dump({'fps': FPS, 'frames': FRAMES, 'anchorFrame': ANCHOR_FRAME, 'plateR': PLATE_R, 'truth': truth}, open(TRUTH, 'w'))
    print(f'wrote {CLIP} ({os.path.getsize(CLIP)} bytes) and truth')
    print(f'QUERY=clip=/verify/fixtures/synth-degraded.webm&anchor={ANCHOR_FRAME},{ax:.2f},{ay:.2f}&plate={ax:.2f},{ay:.2f},{PLATE_R},{PLATE_R},0,45')


def load_frames():
    cap = cv2.VideoCapture(CLIP)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
    return frames


def score(points, truth, name, ms):
    errs = []
    lost = 0
    for idx, x, y in points:
        tx, ty = truth[idx]
        e = math.hypot(x - tx, y - ty)
        if e > 6:
            lost += 1
        errs.append(e)
    errs = np.array(errs)
    covered = len(points)
    rms = math.sqrt(np.mean(errs ** 2)) if len(errs) else float('nan')
    p95 = np.percentile(errs, 95) if len(errs) else float('nan')
    print(f'{name:<34} {covered:>4}/{FRAMES}  rms {rms:6.2f}  p95 {p95:6.2f}  worst {errs.max() if len(errs) else float("nan"):6.2f}  off>6px {lost:>3}  {ms:5.1f} ms/f')


def subpixel(resp, px, py):
    """Parabolic refinement of an integer peak, as the TS tracker does."""
    def off(a, b, c):
        d = a - 2 * b + c
        return 0.0 if abs(d) < 1e-9 else max(-0.5, min(0.5, 0.5 * (a - c) / d))
    h, w = resp.shape
    dx = off(resp[py, px - 1], resp[py, px], resp[py, px + 1]) if 0 < px < w - 1 else 0
    dy = off(resp[py - 1, px], resp[py, px], resp[py + 1, px]) if 0 < py < h - 1 else 0
    return px + dx, py + dy


def track_template(frames, truth, adaptive, masked, search=14):
    """matchTemplate around a predicted position. Fixed template from the anchor
    frame (our approach) or updated every frame (the classic drift trap)."""
    R = PLATE_R
    ax, ay = truth[ANCHOR_FRAME]
    def crop(img, cx, cy):
        x0, y0 = int(round(cx)) - R, int(round(cy)) - R
        return img[y0:y0 + 2 * R + 1, x0:x0 + 2 * R + 1].astype(np.float32), x0, y0
    tpl, _, _ = crop(frames[ANCHOR_FRAME], ax, ay)
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
    mask = ((xx ** 2 + yy ** 2) <= R * R).astype(np.uint8) if masked else None
    out = []
    t0 = time.perf_counter()
    for direction in (1, -1):
        cx, cy = ax, ay
        vx = vy = 0.0
        cur = tpl.copy()
        rng_ = range(ANCHOR_FRAME + direction, FRAMES if direction == 1 else -1, direction)
        for i in rng_:
            px, py = cx + vx, cy + vy
            x0 = int(round(px)) - R - search
            y0 = int(round(py)) - R - search
            x1 = x0 + 2 * (R + search) + 1
            y1 = y0 + 2 * (R + search) + 1
            x0c, y0c = max(0, x0), max(0, y0)
            win = frames[i][y0c:min(H, y1), x0c:min(W, x1)].astype(np.float32)
            if win.shape[0] <= cur.shape[0] or win.shape[1] <= cur.shape[1]:
                break
            resp = cv2.matchTemplate(win, cur, cv2.TM_CCOEFF_NORMED, mask=mask) if masked else cv2.matchTemplate(win, cur, cv2.TM_CCOEFF_NORMED)
            _, _, _, loc = cv2.minMaxLoc(resp)
            sx, sy = subpixel(resp, loc[0], loc[1])
            nx, ny = x0c + sx + R, y0c + sy + R
            vx, vy = nx - cx, ny - cy
            cx, cy = nx, ny
            out.append((i, cx, cy))
            if adaptive:
                cur, _, _ = crop(frames[i], cx, cy)
                if cur.shape != tpl.shape:
                    break
    out.append((ANCHOR_FRAME, ax, ay))
    out.sort()
    return out, (time.perf_counter() - t0) * 1000 / max(1, len(out))


def track_lk(frames, truth):
    """Pyramidal Lucas–Kanade on the plate centre plus rim points, centre = mean flow."""
    ax, ay = truth[ANCHOR_FRAME]
    pts = [[ax, ay]] + [[ax + PLATE_R * 0.8 * math.cos(a), ay + PLATE_R * 0.8 * math.sin(a)] for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
    out = []
    t0 = time.perf_counter()
    for direction in (1, -1):
        p = np.array(pts, np.float32).reshape(-1, 1, 2)
        prev = frames[ANCHOR_FRAME]
        cx, cy = ax, ay
        for i in range(ANCHOR_FRAME + direction, FRAMES if direction == 1 else -1, direction):
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, frames[i], p, None, winSize=(21, 21), maxLevel=3)
            good = st.reshape(-1) == 1
            if good.sum() == 0:
                break
            d = (nxt - p).reshape(-1, 2)[good].mean(axis=0)
            cx, cy = cx + float(d[0]), cy + float(d[1])
            out.append((i, cx, cy))
            p = nxt
            prev = frames[i]
    out.append((ANCHOR_FRAME, ax, ay))
    out.sort()
    return out, (time.perf_counter() - t0) * 1000 / max(1, len(out))


def track_hough(frames, truth):
    """Per-frame circle detection near the prediction: no template at all."""
    ax, ay = truth[ANCHOR_FRAME]
    out = []
    t0 = time.perf_counter()
    for direction in (1, -1):
        cx, cy = ax, ay
        vx = vy = 0.0
        for i in range(ANCHOR_FRAME + direction, FRAMES if direction == 1 else -1, direction):
            px, py = cx + vx, cy + vy
            blurred = cv2.GaussianBlur(frames[i], (5, 5), 1.2)
            circles = cv2.HoughCircles(blurred, cv2.HOUGH_GRADIENT, dp=1, minDist=10, param1=90, param2=18,
                                       minRadius=PLATE_R - 4, maxRadius=PLATE_R + 4)
            if circles is None:
                continue
            c = min(circles[0], key=lambda c: math.hypot(c[0] - px, c[1] - py))
            if math.hypot(c[0] - px, c[1] - py) > 20:
                continue
            nx, ny = float(c[0]), float(c[1])
            vx, vy = nx - cx, ny - cy
            cx, cy = nx, ny
            out.append((i, cx, cy))
    out.append((ANCHOR_FRAME, ax, ay))
    out.sort()
    return out, (time.perf_counter() - t0) * 1000 / max(1, len(out))


def track_mil(frames, truth):
    """OpenCV's TrackerMIL on a bounding box round the plate (the one built-in
    tracker that needs no model file)."""
    ax, ay = truth[ANCHOR_FRAME]
    out = []
    t0 = time.perf_counter()
    for direction in (1, -1):
        tr = cv2.TrackerMIL_create()
        bgr = cv2.cvtColor(frames[ANCHOR_FRAME], cv2.COLOR_GRAY2BGR)
        tr.init(bgr, (int(ax - PLATE_R), int(ay - PLATE_R), 2 * PLATE_R, 2 * PLATE_R))
        for i in range(ANCHOR_FRAME + direction, FRAMES if direction == 1 else -1, direction):
            ok, box = tr.update(cv2.cvtColor(frames[i], cv2.COLOR_GRAY2BGR))
            if not ok:
                break
            out.append((i, box[0] + box[2] / 2, box[1] + box[3] / 2))
    out.append((ANCHOR_FRAME, ax, ay))
    out.sort()
    return out, (time.perf_counter() - t0) * 1000 / max(1, len(out))


def run_score(result_path):
    meta = json.load(open(TRUTH))
    truth = meta['truth']
    frames = load_frames()
    assert len(frames) == FRAMES, len(frames)
    print(f'{"tracker":<34} {"frames":>8}  {"rms px":>7} {"p95":>7} {"worst":>8}  lost   speed')
    if result_path and os.path.exists(result_path):
        res = json.load(open(result_path))
        pts = [(p[0], p[2], p[3]) for p in res['points']]
        score(pts, truth, 'KinEMOS NCC (TS, real path)', 0.0)
    for name, fn in [
        ('cv2.matchTemplate fixed, masked', lambda: track_template(frames, truth, False, True)),
        ('cv2.matchTemplate fixed, square', lambda: track_template(frames, truth, False, False)),
        ('cv2.matchTemplate ADAPTIVE', lambda: track_template(frames, truth, True, True)),
        ('cv2 LK optical flow (centre+rim)', lambda: track_lk(frames, truth)),
        ('cv2.HoughCircles per frame', lambda: track_hough(frames, truth)),
        ('cv2.TrackerMIL', lambda: track_mil(frames, truth)),
    ]:
        try:
            pts, ms = fn()
            score(pts, truth, name, ms)
        except Exception as e:  # noqa: BLE001 — a bench prints and moves on
            print(f'{name:<34} failed: {e}')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'make'
    if cmd == 'make':
        make()
    else:
        run_score(sys.argv[2] if len(sys.argv) > 2 else None)
