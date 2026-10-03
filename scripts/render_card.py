#!/usr/bin/env python3
"""
Render a coach program (and optionally a diff vs HEAD) to a PNG card for chat.

Usage:
    python3 scripts/render_card.py <programId> [--diff] [--out path.png]

--diff  include a "Proposed change" card comparing the working-tree program
        against git HEAD.

Requires Pillow and the two vendored variable fonts in assets/fonts/.
No browser, no system fonts.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
INTER = os.path.join(FONTS, "Inter.ttf")
MONO = os.path.join(FONTS, "JBM.ttf")

BG, CARD, LINE = "#0f1115", "#171a21", "#262b35"
TXT, DIM, UP, DOWN, ACCENT = "#e8eaed", "#9aa3b2", "#3ddc97", "#ff6b6b", "#7aa2f7"
SOFT = "#1e222b"
W, PAD = 900, 24
L, R = 16 + PAD, W - 16 - PAD

# lift-name column, then scheme column, then right-aligned weight column
NAME_X = L + 66
SCHEME_X = L + 268
WT_X = R

_fc = {}


def font(px, weight=400, mono=False):
    key = (px, weight, mono)
    if key not in _fc:
        f = ImageFont.truetype(MONO if mono else INTER, px)
        if not mono:
            f.set_variation_by_axes([20, weight])
        _fc[key] = f
    return _fc[key]


def tw(d, t, f):
    b = d.textbbox((0, 0), t, font=f)
    return b[2] - b[0]


def git(*args):
    return subprocess.run(["git", "-C", os.path.join(ROOT, "data"), *args],
                          capture_output=True, text=True, check=True).stdout


def load(pid):
    return json.load(open(os.path.join(ROOT, "data", "programs", f"{pid}.json")))


def flat(doc):
    """(date, exercise name) -> 'sets x reps   weight  (backoff)'"""
    out = {}
    for s in doc["sessions"]:
        for e in s["exercises"]:
            v = f"{e['sets']}x{e['reps']}  {e.get('intensity', '')}".rstrip()
            if e.get("backoff"):
                v += f"  +{e['backoff']}"
            out[(s["date"], e["name"])] = v
    return out


# ---------- measurement ----------

def sess_h(rows):
    """rows: list of (day, date, lifts)"""
    h = 60 + 14
    for _, _, lifts in rows:
        h += sum(22 + (19 if l["backoff"] else 0) for l in lifts) + SEP
    return h + 6


SEP = 20


def draw_session(d, y, day, date, lifts):
    d.text((L, y + 2), day, font=font(11, 600), fill=DIM)
    d.text((L, y + 18), date, font=font(14, 600), fill=TXT)
    ly = y
    for e in lifts:
        f = font(13, 400)
        d.text((NAME_X, ly + 4), e["name"], font=f, fill=TXT)
        if e.get("scheme"):
            d.text((SCHEME_X, ly + 5), e["scheme"], font=font(12, 400), fill=DIM)
        if e.get("weight"):
            d.text((WT_X, ly + 4), e["weight"], font=font(13, 600), fill=TXT, anchor="ra")
        ly += 22
        if e.get("backoff"):
            d.text((NAME_X, ly - 3), "└", font=font(11, 500), fill="#39404f")
            d.text((NAME_X + 14, ly - 3), e["backoff"], font=font(11, 500), fill=DIM)
            ly += 19
    return ly


def program_card(img, d, doc, top, tag):
    sessions = []
    for s in doc["sessions"]:
        lifts = []
        for e in s["exercises"]:
            sch = f"{e['sets']}x{e['reps']}"
            if e.get("backoff"):
                sch = f"{e['sets']}x{e['reps']} + {e['backoff'].split()[0]}"
            lifts.append({"name": e["name"], "scheme": sch,
                          "weight": e.get("intensity", ""), "backoff": e.get("backoff")})
        sessions.append((s["date"], lifts))
    return sessions


def render(pid, doc, old_doc, out_path, tag=None, only=None):
    import datetime
    want_prog = only != "diff"
    want_diff = only != "program"

    dates = [s["date"] for s in doc["sessions"]]
    sub = f"{len(dates)} sessions  \u00b7  {dates[0]} \u2013 {dates[-1]}" if dates else "no sessions"
    wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    rows = []
    for s in doc["sessions"]:
        lifts = []
        for e in s["exercises"]:
            sch = f"{e['sets']}x{e['reps']}"
            if e.get("backoff"):
                sch += " + " + e["backoff"].split()[0]
            lifts.append({"name": e["name"], "scheme": sch,
                          "weight": e.get("intensity", ""), "backoff": e.get("backoff")})
        dt = datetime.date.fromisoformat(s["date"])
        rows.append((wd[dt.weekday()].upper(), s["date"][5:].replace("-", "/"), lifts))

    diff_rows = []
    if old_doc:
        o, n = flat(old_doc), flat(doc)
        for k in o:
            if k not in n:
                diff_rows.append(("del", k, o[k], ""))
            elif o[k] != n[k]:
                diff_rows.append(("chg", k, o[k], n[k]))
        for k in n:
            if k not in o:
                diff_rows.append(("add", k, "", n[k]))

    h1 = sess_h(rows) if want_prog else 0
    h2 = (34 + 30 + len(diff_rows) * 26 + 52) if (diff_rows and want_diff) else 0
    H = 28 + h1 + (22 if h1 else 0) + h2 + 6

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 28

    if want_prog:
        d.rounded_rectangle([16, y, W - 16, y + h1], 18, fill=CARD, outline=LINE, width=1)
        t = y + PAD
        d.text((L, t), doc["name"], font=font(22, 600), fill=TXT)
        d.text((L, t + 33), sub, font=font(12, 400), fill=DIM)
        if tag:
            pw = tw(d, tag, font(11, 500)) + 20
            d.rounded_rectangle([R - pw, t - 2, R, t + 22], 11, fill="#161c2b",
                                outline="#2c3550", width=1)
            d.text((R - pw / 2, t + 10), tag, font=font(11, 500), fill=ACCENT, anchor="mm")
        ty = t + 60
        d.line([L, ty, R, ty], fill=LINE, width=1)
        ty += 14
        for i, (day, date, lifts) in enumerate(rows):
            ly = draw_session(d, ty, day, date, lifts)
            if i < len(rows) - 1:
                d.line([L, ly + 8, R, ly + 8], fill=SOFT, width=1)
            ty = ly + SEP
        y += h1 + 22

    if h2:
        d.rounded_rectangle([16, y, W - 16, y + h2], 18, fill=CARD, outline=LINE, width=1)
        t = y + PAD
        d.text((L, t), "Proposed change", font=font(15, 600), fill=TXT)
        rel = f"data/programs/{pid}.json"
        d.text((L + tw(d, "Proposed change", font(15, 600)) + 9, t + 3), rel,
               font=font(12, 400), fill=DIM)
        xs = [L + 16, L + 118, L + 292, L + 470, L + 636]
        cols = ["SESSION", "EXERCISE", "SCHEME / WEIGHT", "", "NEW"]
        ry = t + 32
        d.rounded_rectangle([L, ry, R, ry + 28], 8, fill="#1c2029")
        for x, c in zip(xs, cols):
            if c:
                d.text((x, ry + 14), c, font=font(11, 500), fill=DIM, anchor="lm")
        ry += 28
        for kind, (date, name), ov, nv in diff_rows:
            bg = {"add": "#12261d", "del": "#2a1618", "chg": "#1e1c14"}.get(kind)
            if bg:
                d.rectangle([L, ry, R, ry + 26], fill=bg)
            sg = {"add": "+", "del": "\u2212", "chg": "~"}[kind]
            col = {"add": UP, "del": DOWN, "chg": "#e0b341"}[kind]
            d.text((L + 2, ry + 13), sg, font=font(12, 600), fill=col, anchor="lm")
            d.text((xs[0], ry + 13), date, font=font(12, 400, mono=True),
                   fill=DOWN if kind == "del" else TXT, anchor="lm")
            d.text((xs[1], ry + 13), name, font=font(12, 400), fill=TXT, anchor="lm")
            d.text((xs[2], ry + 13), ov, font=font(12, 400, mono=True),
                   fill=DIM if kind == "add" else DOWN, anchor="lm")
            d.text((xs[4], ry + 13), nv, font=font(12, 400, mono=True),
                   fill=DIM if kind == "del" else UP, anchor="lm")
            ry += 26
        ry += 16
        na = sum(1 for r in diff_rows if r[0] == "add")
        nd = sum(1 for r in diff_rows if r[0] == "del")
        nc = sum(1 for r in diff_rows if r[0] == "chg")
        d.text((L, ry), f"{len(diff_rows)} lifts  \u00b7  {nc} changed  \u00b7  {na} added  \u00b7  {nd} removed",
               font=font(12, 400), fill=DIM)
        d.text((R, ry), f"+{na}  ~{nc}  \u2212{nd}", font=font(12, 500), fill=DIM, anchor="ra")

    img.save(out_path, "PNG", optimize=True)
    return out_path, img.size


def main():
    args = [a for a in sys.argv[1:]]
    if not args:
        print(__doc__)
        sys.exit(2)
    pid = args[0]
    want_diff = "--diff" in args
    out = None
    if "--out" in args:
        out = args[args.index("--out") + 1]
    if out is None:
        os.makedirs(os.path.join(ROOT, ".cache"), exist_ok=True)
        out = os.path.join(ROOT, ".cache", f"{pid}.png")

    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1]  # 'program' | 'diff'

    pf = load(pid)
    doc = pf["doc"]
    old = None
    if want_diff:
        try:
            raw = git("show", f"HEAD:programs/{pid}.json")
            old = json.loads(raw)["doc"]
        except subprocess.CalledProcessError:
            print("(no HEAD version to diff against)", file=sys.stderr)
    path_, size = render(pid, doc, old, out, only=only)
    print(path_, size[0], "x", size[1], os.path.getsize(path_), "bytes")


if __name__ == "__main__":
    main()