#!/usr/bin/env python3
"""
Render one program in several visual styles so Ben can pick a format.

Usage:
    python3 scripts/render_styles.py [programId]

Writes .cache/style-<n>-<name>.png for each style. Every style draws on an
oversized canvas which is then auto-cropped to the drawn content, so a style
can never clip itself -- layout bugs in hand-computed heights just get cropped
away.
"""
import datetime
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
INTER = os.path.join(FONTS, "Inter.ttf")
MONO = os.path.join(FONTS, "JBM.ttf")
CACHE = os.path.join(ROOT, ".cache")
W, H = 900, 3400

_fc = {}


def font(px, weight=400, mono=False):
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


def fit(d, txt, maxw, px, weight=400, mono=False):
    while px > 7:
        f = font(px, weight, mono)
        if tw(d, txt, f) <= maxw:
            return f
        px -= 1
    return font(7, weight, mono)


CODE = {
    "High Bar Back Squat": "S",
    "High Bar Back Squat (light)": "s",
    "Overhead Press": "P",
    "Deadlift": "D",
    "Incline Bench Press": "B",
    "Clean": "C",
    "Clean & Jerk": "J",
}
WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def rows_of(doc):
    out = []
    for s in doc["sessions"]:
        dt = datetime.date.fromisoformat(s["date"])
        lifts = []
        for e in s["exercises"]:
            lifts.append({
                "name": e["name"],
                "scheme": f"{e['sets']}x{e['reps']}",
                "weight": e.get("intensity", ""),
                "backoff": e.get("backoff"),
                "w": wval(e.get("intensity", "")),
                "code": CODE.get(e["name"], "?"),
            })
        out.append({"date": s["date"], "wd": WD[dt.weekday()], "d": dt, "lifts": lifts,
                    "week": s["week"]})
    return out


def wval(s):
    try:
        return float(str(s).replace("lb", "").strip())
    except ValueError:
        return None


def finish(img, bg, pad=28):
    diff = ImageChops.difference(img, Image.new("RGB", img.size, bg))
    bbox = diff.getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(img.size[0], x1 + pad), min(img.size[1], y1 + pad)
    return img.crop((x0, y0, x1, y1))


def sheet(bg):
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    return img, d


def save(img, bg, n, name, doc):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, f"style-{n}-{name}.png")
    finish(img, bg).save(p, "PNG", optimize=True)
    print(p, os.path.getsize(p))


# ---------------------------------------------------------------- 1 whatsapp
def s1(doc, rows):
    BG, CARD, FG, DIM = "#ECE5DD", "#FFFFFF", "#111B21", "#667781"
    GRN, TINT = "#00A884", "#DCF8C6"
    img, d = sheet(BG)
    L, R = 26, W - 26
    y = 30
    d.text((L, y), doc["name"], font=font(24, 600), fill=FG)
    y += 36
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{len(rows)} sessions  ·  {ds[0]} – {ds[-1]}", font=font(13), fill=DIM)
    y += 34
    for r in rows:
        h = 46 + sum(30 + (20 if l["backoff"] else 0) for l in r["lifts"])
        d.rounded_rectangle([L, y, R, y + h], 14, fill=CARD)
        d.rounded_rectangle([L + 14, y + 14, L + 56, y + 44], 15, fill=GRN)
        d.text((L + 35, y + 29), r["wd"], font=font(12, 600), fill="#FFFFFF", anchor="mm")
        d.text((L + 66, y + 29), f"{r['d'].strftime('%b %d')}", font=font(15, 600),
               fill=FG, anchor="lm")
        ly = y + 50
        for l in r["lifts"]:
            d.text((L + 20, ly), l["name"], font=font(13, 400), fill=FG)
            d.text((R - 16, ly), l["weight"], font=font(13, 600), fill=GRN, anchor="ra")
            f = font(11)
            d.text((R - 16 - tw(d, l["weight"], font(13, 600)) - 10, ly + 3), l["scheme"],
                   font=f, fill=DIM, anchor="ra")
            ly += 26
            if l["backoff"]:
                d.rounded_rectangle([L + 20, ly, L + 20 + tw(d, l["backoff"], f) + 16,
                                     ly + 18], 6, fill=TINT)
                d.text((L + 28, ly + 3), l["backoff"], font=f, fill="#017561")
                ly += 24
        y += h + 12
    return img, BG, "1whatsapp"


# ------------------------------------------------------------------- 2 paper
def s2(doc, rows):
    BG, FG, DIM, RULE, ACC = "#FFFFFF", "#14181F", "#8A9099", "#DFE3E8", "#B4232A"
    img, d = sheet(BG)
    L, R = 56, W - 56
    y = 56
    d.text((L, y), doc["name"].upper(), font=font(13, 600), fill=ACC)
    y += 26
    d.text((L, y), "Training block", font=font(34, 600), fill=FG)
    y += 46
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]}  —  {ds[-1]}", font=font(14), fill=DIM)
    y += 18
    d.line([L, y, R, y], fill=FG, width=2)
    y += 6
    d.line([L, y, R, y], fill=RULE, width=1)
    y += 30
    for r in rows:
        d.text((L, y), r["wd"].upper(), font=font(11, 600), fill=ACC)
        d.text((L + 46, y - 2), r["d"].strftime("%d %B %Y"), font=font(13, 600), fill=FG)
        d.text((R, y - 2), f"WEEK {r['week']}", font=font(11, 500), fill=DIM, anchor="ra")
        y += 24
        d.line([L, y, R, y], fill=RULE, width=1)
        y += 10
        for l in r["lifts"]:
            d.text((L + 46, y), l["name"], font=font(13), fill=FG)
            d.text((L + 380, y), l["scheme"], font=font(13), fill=DIM)
            bo = ("  + " + l["backoff"]) if l["backoff"] else ""
            d.text((L + 440, y), f"{l['weight']}{bo}", font=font(13, 500), fill=FG)
            y += 22
        y += 16
    return img, BG, "2paper"


# ---------------------------------------------------------------- 3 timeline
def s3(doc, rows):
    BG, CARD, LINE, TXT, DIM = "#0B0D10", "#14171C", "#23272F", "#E9ECF1", "#79818F"
    ACC, UP = "#7AA2F7", "#3DDC97"
    img, d = sheet(BG)
    L, R = 26, W - 26
    y = 34
    d.text((L, y), doc["name"], font=font(23, 600), fill=TXT)
    y += 34
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{len(rows)} sessions  ·  {ds[0]} – {ds[-1]}", font=font(12), fill=DIM)
    y += 40
    weeks = sorted({r["week"] for r in rows})
    gap = 14
    cw = (R - L - gap * (len(weeks) - 1)) // len(weeks)

    def week_h(wr):
        h = 52
        for r in wr:
            h += 22
            for l in r["lifts"]:
                h += 19 + (15 if l["backoff"] else 0)
            h += 14
        return h + 6

    ch = max(week_h([r for r in rows if r["week"] == w]) for w in weeks)
    for wi, wknum in enumerate(weeks):
        cx = L + wi * (cw + gap)
        wr = [r for r in rows if r["week"] == wknum]
        d.rounded_rectangle([cx, y, cx + cw, y + ch], 16, fill=CARD, outline=LINE)
        d.text((cx + 18, y + 20), f"WEEK {wknum}", font=font(11, 600), fill=ACC)
        d.text((cx + cw - 18, y + 20), f"{len(wr)} sess", font=font(10), fill=DIM, anchor="ra")
        d.line([cx + 16, y + 40, cx + cw - 16, y + 40], fill=LINE)
        cy = y + 52
        for r in wr:
            d.text((cx + 18, cy), f"{r['wd'].upper()}  {r['d'].strftime('%m/%d')}",
                   font=font(11, 600), fill=TXT)
            cy += 20
            for l in r["lifts"]:
                nf = fit(d, l["name"], cw - 74, 12)
                d.text((cx + 18, cy), l["name"], font=nf, fill=DIM)
                wf = fit(d, l["weight"], 58, 12, 600)
                d.text((cx + cw - 18, cy), l["weight"], font=wf, fill=UP, anchor="ra")
                cy += 18
                if l["backoff"]:
                    d.text((cx + 18, cy), l["backoff"], font=font(10), fill="#5A6270")
                    cy += 15
            cy += 12
    return img, BG, "3timeline"


# ---------------------------------------------------------------- 4 calendar
def s4(doc, rows):
    BG, CARD, LINE, TXT, DIM = "#101317", "#171B21", "#262B34", "#E9ECF1", "#79818F"
    img, d = sheet(BG)
    by = {r["date"]: r for r in rows}
    L, R = 26, W - 26
    y = 34
    d.text((L, y), doc["name"], font=font(23, 600), fill=TXT)
    y += 34
    d.text((L, y), "Two months, every session on its day", font=font(12), fill=DIM)
    y += 38
    months = sorted({(r["d"].year, r["d"].month) for r in rows})
    gap = 18
    mw = (R - L - gap) // len(months)
    cell = (mw - 12) // 7
    gridhs = []
    for mi, (yr, mo) in enumerate(months):
        mx = L + mi * (mw + gap)
        first = datetime.date(yr, mo, 1)
        ndays = (datetime.date(yr + (mo == 12), mo % 12 + 1, 1) - first).days
        lead = first.weekday()
        gridh = 60 + (ndays + lead + 6) // 7 * (cell + 8) + 14
        gridhs.append(gridh)
        d.rounded_rectangle([mx, y, mx + mw, y + gridh], 16, fill=CARD, outline=LINE)
        d.text((mx + 16, y + 17), first.strftime("%B %Y"), font=font(14, 600), fill=TXT)
        for i, w in enumerate(WD):
            d.text((mx + 6 + i * cell + cell / 2, y + 44), w[0], font=font(10, 600),
                   fill=DIM, anchor="mm")
        for day in range(ndays):
            r_i, c_i = divmod(lead + day, 7)
            cx = mx + 6 + c_i * cell
            cy = y + 60 + r_i * (cell + 8)
            dt = datetime.date(yr, mo, day + 1)
            iso = dt.isoformat()
            hit = by.get(iso)
            if hit:
                d.rounded_rectangle([cx, cy, cx + cell - 4, cy + cell - 4], 8, fill="#1E2A3A")
                d.text((cx + 6, cy + 7), str(day + 1), font=font(10, 600),
                       fill="#7AA2F7")
                codes = "".join(l["code"] for l in hit["lifts"])
                f = fit(d, codes, cell - 16, 11, 600)
                d.text((cx + (cell - 4) / 2, cy + cell / 2 + 3), codes, font=f,
                       fill="#3DDC97", anchor="mm")
            else:
                d.text((cx + 6, cy + 7), str(day + 1), font=font(10), fill="#4A515C")
    ly = y + max(gridhs) + 26
    d.text((L, ly), "S squat   s light squat   P press   D deadlift   B incline   C clean   J clean & jerk",
           font=font(11), fill=DIM)
    return img, BG, "4calendar"


# -------------------------------------------------------------------- 5 mono
def s5(doc, rows):
    BG, CARD, LINE, TXT, DIM = "#0E1116", "#141920", "#232A34", "#DCE3EC", "#7C8794"
    UP, DN = "#3DDC97", "#FF6B6B"
    img, d = sheet(BG)
    L, R = 26, W - 26
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 40
    xs = [L + 14, L + 108, L + 300, L + 392, L + 500]
    hdr = ["DATE", "EXERCISE", "SETS", "WEIGHT", "BACKOFF"]
    d.rounded_rectangle([L, y, R, y + 30], 8, fill=CARD)
    for x, h in zip(xs, hdr):
        d.text((x, y + 15), h, font=font(10, 600), fill=DIM, anchor="lm")
    y += 30
    for r in rows:
        first = True
        for l in r["lifts"]:
            h = 26
            if first:
                d.rectangle([L, y, R, y + h], fill="#101720")
            d.text((xs[0], y + 13), r["date"][5:], font=font(11, 400, mono=True),
                   fill=DIM, anchor="lm")
            d.text((xs[1], y + 13), l["name"], font=font(12), fill=TXT, anchor="lm")
            d.text((xs[2], y + 13), l["scheme"], font=font(11, 400, mono=True),
                   fill=DIM, anchor="lm")
            d.text((xs[3], y + 13), l["weight"], font=font(11, 600, mono=True),
                   fill=UP, anchor="lm")
            d.text((xs[4], y + 13), l["backoff"] or "", font=font(11, 400, mono=True),
                   fill="#5F6A78", anchor="lm")
            y += h
            first = False
        d.line([L, y, R, y], fill=LINE)
        y += 1
    return img, BG, "5mono"


# ------------------------------------------------------------------- 6 grid
def s6(doc, rows):
    BG, CARD, TXT, DIM = "#F4F4F6", "#FFFFFF", "#14181F", "#6E7681"
    TINT = {"Mon": "#E7F0FF", "Wed": "#FDE9EC", "Sat": "#E8F7EE"}
    ACC = {"Mon": "#2C6FDB", "Wed": "#C2334D", "Sat": "#1E8A5A"}
    img, d = sheet(BG)
    L, R = 24, W - 24
    y = 30
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 44
    gap = 14
    cols = 2
    cw = (R - L - gap) // cols
    x0, x1 = L, L + cw + gap
    col_y = [y, y]
    heights = [0, 0]
    for r in rows:
        c = 0 if heights[0] <= heights[1] else 1
        h = 42 + sum(26 + (18 if l["backoff"] else 0) for l in r["lifts"]) + 10
        cx = x0 if c == 0 else x1
        cy = col_y[c]
        d.rounded_rectangle([cx, cy, cx + cw, cy + h], 14, fill=CARD)
        d.rounded_rectangle([cx, cy, cx + cw, cy + 6], 3, fill=ACC[r["wd"]])
        d.text((cx + 16, cy + 18), f"{r['wd'].upper()}  {r['d'].strftime('%b %d')}",
               font=font(11, 600), fill=ACC[r["wd"]])
        d.text((cx + cw - 16, cy + 18), f"W{r['week']}", font=font(10, 500), fill=DIM,
               anchor="ra")
        ly = cy + 40
        for l in r["lifts"]:
            nf = fit(d, l["name"], cw - 130, 12)
            d.text((cx + 16, ly), l["name"], font=nf, fill=TXT)
            d.text((cx + 16, ly + 15), l["scheme"], font=font(10), fill=DIM)
            d.text((cx + cw - 16, ly + 2), l["weight"], font=font(12, 600),
                   fill=ACC[r["wd"]], anchor="ra")
            ly += 26
            if l["backoff"]:
                d.text((cx + 16, ly), l["backoff"], font=font(10), fill="#9AA2AE")
                ly += 18
        col_y[c] = cy + h + gap
        heights[c] = col_y[c]
    return img, BG, "6grid"


# -------------------------------------------------------------------- 7 arcs
def s7(doc, rows):
    BG, CARD, LINE, TXT, DIM = "#0C0F13", "#151920", "#242A33", "#E9ECF1", "#79818F"
    UP, ACC = "#3DDC97", "#7AA2F7"
    img, d = sheet(BG)
    L, R = 30, W - 30
    y = 34
    d.text((L, y), doc["name"], font=font(23, 600), fill=TXT)
    y += 34
    ds = [r["date"] for r in rows]
    d.text((L, y), "Weight progression by lift", font=font(12), fill=DIM)
    y += 44
    seen = {}
    for r in rows:
        for l in r["lifts"]:
            if l["w"] is not None:
                seen.setdefault(l["name"], []).append((r["d"], l["w"], l["scheme"]))
    bar_x0, bar_x1 = L + 250, R - 40
    lo = min(v for s in seen.values() for _, v, _ in s)
    hi = max(v for s in seen.values() for _, v, _ in s)
    span = max(hi - lo, 1)

    def xpos(v):
        return bar_x0 + (v - lo) / span * (bar_x1 - bar_x0)

    for name, series in seen.items():
        d.text((L, y), name, font=fit(d, name, 240, 14, 500), fill=TXT)
        d.text((L, y + 19), f"{series[0][2]}  ·  {len(series)} sessions", font=font(10), fill=DIM)
        d.line([bar_x0, y + 22, bar_x1, y + 22], fill=LINE, width=2)
        pts = [(xpos(v), y + 22) for _, v, _ in series]
        if len(pts) > 1:
            d.line(pts, fill=ACC, width=2)
        for i, (px, py) in enumerate(pts):
            last = i == len(pts) - 1
            r = 6 if last else 4
            d.ellipse([px - r, py - r, px + r, py + r], fill=UP if last else BG,
                      outline=UP, width=2)
        d.text((bar_x1 + 8, y + 8), f"{series[-1][1]:g}", font=font(13, 600), fill=UP)
        d.text((bar_x1 + 8, y + 24), f"from {series[0][1]:g}", font=font(9), fill=DIM)
        y += 52
        d.line([L, y - 12, R, y - 12], fill=LINE)
    y += 20
    d.text((L, y), f"block {ds[0]} – {ds[-1]}", font=font(11), fill=DIM)
    return img, BG, "7arcs"


STYLES = [s1, s2, s3, s4, s5, s6, s7]


def main():
    pid = sys.argv[1] if len(sys.argv) > 1 else "ben-starting-strength"
    doc = json.load(open(os.path.join(ROOT, "data", "programs", f"{pid}.json")))["doc"]
    rows = rows_of(doc)
    for fn in STYLES:
        img, bg, name = fn(doc, rows)
        save(img, bg, name[0], name[1:], doc)


if __name__ == "__main__":
    main()