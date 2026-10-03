#!/usr/bin/env python3
"""
Render a coach program to a PNG card for WhatsApp.

Usage:
    python3 scripts/render_card.py <programId> [--diff] [--out path.png]

Default output is the PROGRAM ONLY: what the block will look like once the
pending change is applied. That is what Ben wants by default.
--diff additionally writes .cache/<programId>-diff.png with a change table.
Do NOT put the diff table on the program card -- Ben rejected that.

Default layout (Ben's chosen format): PORTRAIT week-rows. Each week is a
horizontal band; its sessions sit side by side inside it, Mon/Wed/Sat left to
right. Every lift gets a tinted strip; a backoff renders as a dimmer nested
sub-strip beneath its top set. ~700px wide, ~1000px tall for a 4-week block.

`--diff` writes a SECOND image, .cache/<programId>-diff.png, comparing the
        working tree against HEAD in the nested data/ repo. Run it BEFORE
        committing or there is nothing to diff against. Optional -- Ben
        usually just wants the program card.

Self-contained: Pillow + the vendored variable fonts in assets/fonts/. No
browser, no system fonts. Chromium on this box is broken (missing libatk), so
do not try to screenshot HTML instead.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
INTER = os.path.join(FONTS, "Inter.ttf")
MONO = os.path.join(FONTS, "JBM.ttf")
CACHE = os.path.join(ROOT, ".cache")

W, H = 880, 4000
# W is sized so the widest lift name still fits at full size in all three
# session columns. It was 700, which forced `fit()` to shrink
# "High Bar Back Squat (light)" to 7.5px — the self-check now catches that.
# Still portrait (880 x ~1020). If you change LIFT sizes or add a longer
# exercise name, re-run and let the checker tell you.
PAD = 18
L, R = 14, W - 14

BG = "#0B0D10"
CARD = "#12161C"
STRIP = "#1A2029"
SUB = "#151A22"
LINE = "#222831"
HDRBG = "#1C2029"
TXT = "#E9ECF1"
DIM = "#79818F"
FAINT = "#5E6875"
SCHEME = "#98A2B0"      # sets x reps — must stay light enough to read
UP = "#3DDC97"
DOWN = "#FF6B6B"
WARN = "#E0B341"
ACC = {"Mon": "#7AA2F7", "Tue": "#9B87F5", "Wed": "#E8836F", "Thu": "#F2A93B",
       "Fri": "#4ECDC4", "Sat": "#3DDC97", "Sun": "#C792EA"}
# Every weekday must have a colour: clients train on other days than Ben does,
# and a missing key used to crash the render.

LIFT_H = 42
BACK_H = 26
HDR_H = 34

_fc = {}


def font(px, weight=400, mono=False):
    """Cached font. Inter is a variable font, so weight comes from its axes."""
    k = (px, weight, mono)
    if k not in _fc:
        f = ImageFont.truetype(MONO if mono else INTER, px)
        if not mono:
            f.set_variation_by_axes([20, weight])
        _fc[k] = f
    return _fc[k]


def tw(d, t, f):
    b = d.textbbox((0, 0), t, font=f)
    return b[2] - b[0]


def fit(d, txt, maxw, px, weight=400):
    """Shrink until txt fits maxw. Long lift names use this instead of clipping."""
    while px > 7:
        f = font(px, weight)
        if tw(d, txt, f) <= maxw:
            return f
        px -= 1
    return font(7, weight)


def finish(img, bg, pad=18):
    """Crop the oversized canvas down to what was actually drawn."""
    diff = ImageChops.difference(img, Image.new("RGB", img.size, bg))
    bbox = diff.getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(img.size[0], x1 + pad), min(img.size[1], y1 + pad)
    return img.crop((x0, y0, x1, y1))


def wval(s):
    try:
        return float(str(s).replace("lb", "").strip())
    except ValueError:
        return None


def git(*args):
    return subprocess.run(["git", "-C", os.path.join(ROOT, "data"), *args],
                          capture_output=True, text=True, check=True).stdout


WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ------------------------------------------------------- self-verification
# Every text draw goes through `t()`. Each one must declare how much room it
# has (`room`), and the checker fails the render if the string is wider than
# that. This turns the clipping/overflow bugs that kept happening during
# layout iteration into loud errors instead of silently-wrong PNGs, so the
# card can be trusted without a visual check.

VIOLATIONS = []


class LayoutError(RuntimeError):
    """Raised when the card's self-check finds a problem. Never ship a card
    that failed this — the whole point is that it can be trusted blind."""


def t(d, xy, txt, font, fill, anchor="la", room=None, min_px=9):
    """Draw text and record whether it overflowed its declared room."""
    w = tw(d, txt, font)
    if room is not None and w > room:
        VIOLATIONS.append(
            f"overflow {w:.0f}px > {room:.0f}px at {xy}: {txt!r}")
    px = font.size if hasattr(font, "size") else 0
    if min_px and px and px < min_px:
        VIOLATIONS.append(f"text too small ({px}px): {txt!r}")
    d.text(xy, txt, font=font, fill=fill, anchor=anchor)


def check_bounds(d, boxes):
    """Assert every drawn box lies inside the canvas."""
    for name, b in boxes:
        x0, y0, x1, y1 = b
        if not (0 <= x0 and x1 <= W and 0 <= y0 and y1 <= H):
            VIOLATIONS.append(f"{name} out of canvas: {b}")
        if x1 <= x0 or y1 <= y0:
            VIOLATIONS.append(f"{name} inverted/empty box: {b}")


def verify():
    """Return a report string; empty means the render is sound."""
    if VIOLATIONS:
        return "\n".join(f"  ! {v}" for v in VIOLATIONS)
    return ""


def rows_of(doc):
    """Flatten a program into render-ready session rows."""
    import datetime
    out = []
    for s in doc["sessions"]:
        dt = datetime.date.fromisoformat(s["date"])
        lifts = [{
            "name": e["name"],
            "scheme": f"{e['sets']}x{e['reps']}",
            "weight": e.get("intensity", ""),
            "backoff": e.get("backoff"),
            "w": wval(e.get("intensity", "")),
        } for e in s["exercises"]]
        out.append({"date": s["date"], "wd": WD[dt.weekday()], "d": dt,
                    "lifts": lifts, "week": s["week"]})
    return out


# ------------------------------------------------------------------ geometry

def weight_col(d, rows):
    """Width to reserve for the weight column, measured from the data.

    Hardcoding this (74px) starved the name column and squeezed long lift
    names down to 7.5px. Measure the widest weight string instead.
    """
    widest = 0
    for r in rows:
        for l in r["lifts"]:
            widest = max(widest, tw(d, l["weight"], font(14, 700)))
    return int(widest) + 16


def sess_h(r):
    return HDR_H + sum(LIFT_H + (BACK_H if l["backoff"] else 0)
                       for l in r["lifts"]) + 12


def draw_session(d, x0, x1, y, r, wcol=74):
    h = sess_h(r)
    d.rounded_rectangle([x0, y, x1, y + h], 12, fill=CARD)
    check_bounds(d, [(f"session {r['date']}", (x0, y, x1, y + h))])
    t(d, (x0 + 12, y + 11), r["wd"].upper(), font(10, 600), ACC[r["wd"]],
      room=x1 - x0 - 46)
    t(d, (x0 + 46, y + 11), r["d"].strftime("%m/%d"), font(10), DIM,
      room=x1 - x0 - 52)
    ly = y + HDR_H
    sx0, sx1 = x0 + 8, x1 - 8
    inner = (sx1 - sx0) - 20
    for l in r["lifts"]:
        d.rounded_rectangle([sx0, ly, sx1, ly + LIFT_H - 6], 7, fill=STRIP)
        check_bounds(d, [("strip", (sx0, ly, sx1, ly + LIFT_H - 6))])
        name_room = inner - wcol
        nf = fit(d, l["name"], name_room, 11.5)
        t(d, (sx0 + 10, ly + 4), l["name"], nf, TXT, room=name_room, min_px=9)
        wf = font(14, 700)
        t(d, (sx1 - 10, ly + 3), l["weight"], wf, UP, anchor="ra", room=wcol - 8)
        t(d, (sx0 + 10, ly + 22), l["scheme"], font(11, 500), SCHEME, room=60)
        ly += LIFT_H
        if l["backoff"]:
            d.rounded_rectangle([sx0 + 8, ly, sx1, ly + BACK_H - 6], 5, fill=SUB)
            check_bounds(d, [("backoff", (sx0 + 8, ly, sx1, ly + BACK_H - 6))])
            t(d, (sx0 + 18, ly + 5), l["backoff"], font(10.5, 500), SCHEME,
              room=(sx1 - sx0) - 36)
            ly += BACK_H
    if ly - 12 > y + h:
        VIOLATIONS.append(
            f"session {r['date']} content {ly - 12:.0f}px exceeds card {h}px")
    return h


def draw_week_row(d, x0, x1, y, wr, cw, gap, wcol=74):
    t(d, (x0, y), f"WEEK {wr[0]['week']}", font(10, 600), ACC["Mon"], room=52)
    d.line([x0 + 52, y + 8, x1, y + 8], fill=LINE)
    for i, r in enumerate(wr):
        cx = x0 + i * (cw + gap)
        if cx + cw > x1:
            VIOLATIONS.append(
                f"week {wr[0]['week']} session {i} overflows row: "
                f"{cx + cw:.0f} > {x1}")
        draw_session(d, cx, cx + cw, y + 18, r, wcol)


def diff_rows_of(old_doc, doc):
    """(kind, (date, name), old, new) for every changed lift."""
    def flat(d):
        m = {}
        for s in d["sessions"]:
            for e in s["exercises"]:
                v = f"{e['sets']}x{e['reps']}  {e.get('intensity', '')}".rstrip()
                if e.get("backoff"):
                    v += f"  +{e['backoff']}"
                m[(s["date"], e["name"])] = v
        return m
    o, n = flat(old_doc), flat(doc)
    rows = []
    for k in o:
        if k not in n:
            rows.append(("del", k, o[k], ""))
        elif o[k] != n[k]:
            rows.append(("chg", k, o[k], n[k]))
    for k in n:
        if k not in o:
            rows.append(("add", k, "", n[k]))
    return rows


def draw_diff(d, pid, rows, y, x0, x1):
    h = 34 + 30 + len(rows) * 26 + 46
    d.rounded_rectangle([L, y, R, y + h], 16, fill=CARD, outline=LINE)
    check_bounds(d, [("diff card", (L, y, R, y + h))])
    ty = y + PAD
    t(d, (x0, ty), "Proposed change", font(14, 600), TXT, room=200)
    t(d, (x1, ty + 2), f"data/programs/{pid}.json", font(10), DIM,
      anchor="ra", room=260)
    xs = [x0 + 14, x0 + 100, x0 + 268, x0 + 452]
    ry = ty + 26
    d.rounded_rectangle([x0, ry, x1, ry + 26], 8, fill=HDRBG)
    for x, c in zip(xs, ["DATE", "EXERCISE", "WAS", "NOW"]):
        t(d, (x, ry + 13), c, font(9.5, 600), DIM, anchor="lm", room=140)
    ry += 26
    for kind, (date, name), ov, nv in rows:
        bg = {"add": "#12261D", "del": "#2A1618", "chg": "#1E1C14"}.get(kind)
        if bg:
            d.rectangle([x0, ry, x1, ry + 26], fill=bg)
        sg = {"add": "+", "del": "\u2212", "chg": "~"}[kind]
        col = {"add": UP, "del": DOWN, "chg": WARN}[kind]
        t(d, (x0 + 2, ry + 13), sg, font(11, 700), col, anchor="lm", room=12)
        t(d, (xs[0], ry + 13), date[5:], font(10.5, 400, mono=True),
          DOWN if kind == "del" else TXT, anchor="lm", room=84)
        nf = fit(d, name, 160, 10.5)
        t(d, (xs[1], ry + 13), name, nf, TXT, anchor="lm", room=160, min_px=8)
        t(d, (xs[2], ry + 13), ov, font(10, 400, mono=True),
          DIM if kind == "add" else DOWN, anchor="lm", room=180)
        t(d, (xs[3], ry + 13), nv, font(10, 400, mono=True),
          DIM if kind == "del" else UP, anchor="lm", room=x1 - xs[3] - 8)
        ry += 26
    ry += 14
    na = sum(1 for r in rows if r[0] == "add")
    nd = sum(1 for r in rows if r[0] == "del")
    nc = sum(1 for r in rows if r[0] == "chg")
    t(d, (x0, ry), f"{nc} changed \u00b7 {na} added \u00b7 {nd} removed",
      font(10.5), DIM, room=340)
    t(d, (x1, ry), f"+{na}  ~{nc}  \u2212{nd}", font(10.5, 500), DIM,
      anchor="ra", room=120)
    if ry + 14 > y + h:
        VIOLATIONS.append(f"diff content {ry + 14:.0f}px exceeds card {h}px")
    return h


# -------------------------------------------------------------------- render

def render(pid, doc, old_doc, out_path):
    rows = rows_of(doc)
    weeks = sorted({r["week"] for r in rows})
    gap = 10
    ncols = max(len([r for r in rows if r["week"] == w]) for w in weeks)
    x0, x1 = L + PAD, R - PAD
    cw = (x1 - x0 - gap * (ncols - 1)) // ncols
    heights = {w: max(sess_h(r) for r in rows if r["week"] == w) for w in weeks}

    drows = diff_rows_of(old_doc, doc) if old_doc else []

    if not rows:
        VIOLATIONS.append("program has no sessions")
    ncols_actual = {w: len([r for r in rows if r["week"] == w]) for w in weeks}
    if len(set(ncols_actual.values())) != 1:
        VIOLATIONS.append(f"ragged week rows: {ncols_actual}")

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    wcol = weight_col(d, rows)

    t(d, (x0, 30), doc["name"], font(20, 600), TXT, room=x1 - x0, min_px=12)
    ds = [r["date"] for r in rows]
    t(d, (x0, 58), f"{ds[0]} \u2013 {ds[-1]}", font(11), DIM, room=300)
    t(d, (x1, 58), f"{len(rows)} sessions", font(11), DIM, anchor="ra", room=160)
    d.line([x0, 82, x1, 82], fill=LINE, width=2)

    y = 92
    for w in weeks:
        wr = sorted([r for r in rows if r["week"] == w], key=lambda r: r["d"])
        draw_week_row(d, x0, x1, y, wr, cw, gap, wcol)
        y += 28 + heights[w] + gap

    if drows:
        draw_diff(d, pid, drows, y + 4, x0, x1)

    if VIOLATIONS:
        raise LayoutError(
            f"card layout self-check failed ({len(VIOLATIONS)} problems):\n{verify()}")

    # compress_level=1, not optimize=True: optimize costs ~104ms vs ~9ms
    # for ~13KB more on a 76KB file. Irrelevant over WhatsApp.
    finish(img, BG).save(out_path, "PNG", compress_level=1)
    return out_path


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    pid = args[0]
    out = args[args.index("--out") + 1] if "--out" in args else None
    if out is None:
        os.makedirs(CACHE, exist_ok=True)
        out = os.path.join(CACHE, f"{pid}.png")

    doc = json.load(open(os.path.join(ROOT, "data", "programs", f"{pid}.json")))["doc"]
    p = render(pid, doc, None, out)
    print(p, Image.open(p).size, os.path.getsize(p), "bytes")
    print("self-check: OK")

    if "--diff" in args:
        try:
            old = json.loads(git("show", f"HEAD:programs/{pid}.json"))["doc"]
        except subprocess.CalledProcessError:
            print("(no HEAD version to diff against -- skipping diff image)",
                  file=sys.stderr)
            return
        dp = render(pid, doc, old,
                    os.path.join(CACHE, f"{pid}-diff.png"))
        print(dp, Image.open(dp).size, os.path.getsize(dp), "bytes")


if __name__ == "__main__":
    main()