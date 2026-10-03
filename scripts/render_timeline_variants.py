#!/usr/bin/env python3
"""
Variants of the timeline layout (style 3) — 4 week columns side by side.

Usage:
    python3 scripts/render_timeline_variants.py [programId]

Writes .cache/tl-<letter>-<name>.png. Shared drawing helpers come from
render_styles.py; every variant draws on the oversized canvas there and is
auto-cropped, so a height mistake crops instead of clipping.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from render_styles import (  # noqa: E402
    CACHE, H, W, WD, fit, font, rows_of, save, sheet, tw, wval,
)

# day-type accent, used by several variants
ACC = {"Mon": "#7AA2F7", "Wed": "#E8836F", "Sat": "#3DDC97"}


def colw(L, R, n, gap):
    return (R - L - gap * (n - 1)) // n


# ------------------------------------------------------------------ A compact
def a(doc, rows):
    """Dense columns, no card chrome, everything on tighter leading."""
    BG, TXT, DIM, RULE, UP = "#0B0D10", "#E9ECF1", "#79818F", "#1E232B", "#3DDC97"
    img, d = sheet(BG)
    L, R, gap = 28, W - 28, 26
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 32
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]} – {ds[-1]}", font=font(11), fill=DIM)
    y += 34
    weeks = sorted({r["week"] for r in rows})
    cw = colw(L, R, len(weeks), gap)
    for wi, w in enumerate(weeks):
        cx = L + wi * (cw + gap)
        d.text((cx, y), f"WEEK {w}", font=font(10, 600), fill=DIM)
        d.line([cx, y + 18, cx + cw, y + 18], fill=RULE, width=2)
        cy = y + 30
        for r in [r for r in rows if r["week"] == w]:
            d.text((cx, cy), f"{r['wd'].upper()} {r['d'].strftime('%m/%d')}",
                   font=font(10, 600), fill=ACC[r["wd"]])
            cy += 17
            for l in r["lifts"]:
                nf = fit(d, l["name"], cw - 62, 11)
                d.text((cx, cy), l["name"], font=nf, fill=DIM)
                d.text((cx + cw, cy), l["weight"], font=font(11, 600), fill=UP, anchor="ra")
                cy += 15
                if l["backoff"]:
                    d.text((cx + 8, cy), l["backoff"], font=font(9), fill="#4E5663")
                    cy += 13
            cy += 8
        if wi < len(weeks) - 1:
            d.line([cx + cw + gap / 2, y, cx + cw + gap / 2, cy], fill=RULE)
    return img, BG, "tl-a-compact"


# --------------------------------------------------------------------- B rail
def b(doc, rows):
    """Horizontal: week bands, session rows on a vertical rail."""
    BG, CARD, TXT, DIM, RULE = "#0B0D10", "#12161C", "#E9ECF1", "#79818F", "#222831"
    img, d = sheet(BG)
    L, R = 28, W - 28
    rail = L + 26
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 32
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]} – {ds[-1]}", font=font(11), fill=DIM)
    y += 34
    for w in sorted({r["week"] for r in rows}):
        wr = [r for r in rows if r["week"] == w]
        h = 40 + sum(30 + sum(24 + (18 if l["backoff"] else 0) for l in r["lifts"])
                     for r in wr)
        d.rounded_rectangle([L, y, R, y + h], 14, fill=CARD)
        d.text((L + 16, y + 20), f"WEEK {w}", font=font(11, 600), fill="#7AA2F7")
        ry = y + 40
        d.line([rail, ry - 8, rail, y + h - 12], fill=RULE, width=2)
        for r in wr:
            d.ellipse([rail - 5, ry - 5, rail + 5, ry + 5], fill=ACC[r["wd"]])
            d.text((L + 52, ry - 8), f"{r['wd'].upper()}  {r['d'].strftime('%d %b')}",
                   font=font(11, 600), fill=TXT)
            ly = ry + 12
            for l in r["lifts"]:
                d.text((L + 52, ly), l["name"], font=font(12), fill=DIM)
                d.text((L + 52 + 300, ly), l["scheme"], font=font(11), fill="#5A6270")
                d.text((R - 18, ly), l["weight"], font=font(12, 600),
                       fill="#3DDC97", anchor="ra")
                ly += 20
                if l["backoff"]:
                    d.text((L + 64, ly), l["backoff"], font=font(10), fill="#4E5663")
                    ly += 18
            ry = ly + 14
        y += h + 12
    return img, BG, "tl-b-rail"


# ------------------------------------------------------------------ C numerals
def c(doc, rows):
    """Columns with oversized ghosted week numerals behind them."""
    BG, CARD, TXT, DIM, LINE = "#0B0D10", "#12161C", "#E9ECF1", "#79818F", "#222831"
    img, d = sheet(BG)
    L, R, gap = 28, W - 28, 18
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 32
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]} – {ds[-1]}  ·  {len(rows)} sessions", font=font(11), fill=DIM)
    y += 52
    weeks = sorted({r["week"] for r in rows})
    cw = colw(L, R, len(weeks), gap)

    def ch_for(wr):
        h = 56
        for r in wr:
            h += 24 + sum(20 + (15 if l["backoff"] else 0) for l in r["lifts"]) + 12
        return h + 8

    ch = max(ch_for([r for r in rows if r["week"] == w]) for w in weeks)
    for wi, w in enumerate(weeks):
        cx = L + wi * (cw + gap)
        wr = [r for r in rows if r["week"] == w]
        d.rounded_rectangle([cx, y, cx + cw, y + ch], 16, fill=CARD, outline=LINE)
        d.text((cx + cw / 2, y + 44), str(w), font=font(52, 600), fill="#1B2029",
               anchor="mm")
        d.text((cx + cw / 2, y + 18), "WEEK", font=font(9, 600), fill=DIM, anchor="mm")
        cy = y + 66
        for r in wr:
            pillw = 44
            d.rounded_rectangle([cx + 14, cy, cx + 14 + pillw, cy + 18], 9,
                                fill=ACC[r["wd"]] + "22")
            d.text((cx + 14 + pillw / 2, cy + 9), r["wd"].upper(), font=font(9, 600),
                   fill=ACC[r["wd"]], anchor="mm")
            d.text((cx + 14 + pillw + 8, cy + 4), r["d"].strftime("%m/%d"),
                   font=font(10), fill=DIM)
            cy += 26
            for l in r["lifts"]:
                d.text((cx + 14, cy), l["name"], font=fit(d, l["name"], cw - 100, 11),
                       fill=DIM)
                d.text((cx + 14, cy + 14), l["scheme"], font=font(9), fill="#4E5663")
                d.text((cx + cw - 14, cy), l["weight"], font=font(12, 600),
                       fill="#3DDC97", anchor="ra")
                cy += 20
                if l["backoff"]:
                    d.text((cx + 22, cy), l["backoff"], font=font(9), fill="#4A525F")
                    cy += 15
            cy += 12
    return img, BG, "tl-c-numerals"


# --------------------------------------------------------------------- D delta
def dd(doc, rows):
    """Columns where each lift shows this week's weight AND the change."""
    BG, CARD, TXT, DIM, LINE = "#0B0D10", "#12161C", "#E9ECF1", "#79818F", "#222831"
    UP, DOWN = "#3DDC97", "#FF6B6B"
    img, d = sheet(BG)
    L, R, gap = 28, W - 28, 18
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 32
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]} – {ds[-1]}", font=font(11), fill=DIM)
    y += 40
    weeks = sorted({r["week"] for r in rows})
    cw = colw(L, R, len(weeks), gap)
    prev = {}

    def ch_for(wr):
        h = 46
        for r in wr:
            h += 22 + sum(34 for _ in r["lifts"])
        return h + 10

    ch = max(ch_for([r for r in rows if r["week"] == w]) for w in weeks)
    for wi, w in enumerate(weeks):
        cx = L + wi * (cw + gap)
        wr = [r for r in rows if r["week"] == w]
        d.rounded_rectangle([cx, y, cx + cw, y + ch], 16, fill=CARD, outline=LINE)
        d.text((cx + 16, y + 18), f"WEEK {w}", font=font(11, 600), fill="#7AA2F7")
        d.line([cx + 14, y + 40, cx + cw - 14, y + 40], fill=LINE)
        cy = y + 52
        for r in wr:
            d.text((cx + 16, cy), f"{r['wd'].upper()}  {r['d'].strftime('%m/%d')}",
                   font=font(10, 600), fill=DIM)
            cy += 20
            for l in r["lifts"]:
                nm = l["name"]
                d.text((cx + 16, cy), nm, font=fit(d, nm, cw - 100, 11), fill=TXT)
                d.text((cx + 16, cy + 15), l["scheme"], font=font(9), fill="#4E5663")
                d.text((cx + cw - 16, cy - 2), l["weight"], font=font(13, 600),
                       fill=UP, anchor="ra")
                p = prev.get(nm)
                if p is not None and l["w"] is not None and p != l["w"]:
                    delta = l["w"] - p
                    d.text((cx + cw - 16, cy + 17),
                           ("+" if delta > 0 else "") + f"{delta:g}",
                           font=font(9, 600), fill=UP, anchor="ra")
                elif l["backoff"]:
                    d.text((cx + cw - 16, cy + 16), l["backoff"], font=font(9),
                           fill="#4E5663", anchor="ra")
                prev[nm] = l["w"]
                cy += 34
    return img, BG, "tl-d-delta"


# ---------------------------------------------------------------------- E light
def e(doc, rows):
    """Same column structure, paper-white palette."""
    BG, CARD, TXT, DIM, LINE = "#FFFFFF", "#F7F8FA", "#14181F", "#6E7681", "#E4E7EC"
    img, d = sheet(BG)
    L, R, gap = 28, W - 28, 20
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 32
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]} – {ds[-1]}", font=font(11), fill=DIM)
    y += 40
    LAC = {"Mon": "#2C6FDB", "Wed": "#C2334D", "Sat": "#1E8A5A"}
    weeks = sorted({r["week"] for r in rows})
    cw = colw(L, R, len(weeks), gap)

    def ch_for(wr):
        h = 48
        for r in wr:
            h += 22 + sum(24 + (17 if l["backoff"] else 0) for l in r["lifts"]) + 12
        return h + 10

    ch = max(ch_for([r for r in rows if r["week"] == w]) for w in weeks)
    for wi, w in enumerate(weeks):
        cx = L + wi * (cw + gap)
        wr = [r for r in rows if r["week"] == w]
        d.rounded_rectangle([cx, y, cx + cw, y + ch], 16, fill=CARD, outline=LINE)
        d.text((cx + 16, y + 16), f"WEEK {w}", font=font(11, 600), fill=LAC[WD[0]])
        d.line([cx + 14, y + 38, cx + cw - 14, y + 38], fill=LINE)
        cy = y + 50
        for r in wr:
            d.rounded_rectangle([cx + 14, cy, cx + 46, cy + 17], 8, fill=LAC[r["wd"]] + "18")
            d.text((cx + 30, cy + 8), r["wd"].upper(), font=font(9, 600),
                   fill=LAC[r["wd"]], anchor="mm")
            d.text((cx + 52, cy + 3), r["d"].strftime("%m/%d"), font=font(10), fill=DIM)
            cy += 26
            for l in r["lifts"]:
                d.text((cx + 14, cy), l["name"], font=fit(d, l["name"], cw - 96, 11),
                       fill=TXT)
                d.text((cx + 14, cy + 15), l["scheme"], font=font(9), fill=DIM)
                d.text((cx + cw - 14, cy), l["weight"], font=font(12, 600),
                       fill=LAC[r["wd"]], anchor="ra")
                cy += 24
                if l["backoff"]:
                    d.text((cx + 22, cy), l["backoff"], font=font(9), fill="#9AA2AE")
                    cy += 17
            cy += 12
    return img, BG, "tl-e-light"


# ------------------------------------------------------------------ F overlays
def f(doc, rows):
    """Columns, but backoffs sit in a tinted sub-strip under each top set."""
    BG, CARD, TXT, DIM, LINE = "#0B0D10", "#12161C", "#E9ECF1", "#79818F", "#222831"
    TINT, UP = "#18202B", "#3DDC97"
    img, d = sheet(BG)
    L, R, gap = 28, W - 28, 18
    y = 34
    d.text((L, y), doc["name"], font=font(22, 600), fill=TXT)
    y += 32
    ds = [r["date"] for r in rows]
    d.text((L, y), f"{ds[0]} – {ds[-1]}", font=font(11), fill=DIM)
    y += 40
    weeks = sorted({r["week"] for r in rows})
    cw = colw(L, R, len(weeks), gap)

    def ch_for(wr):
        h = 48
        for r in wr:
            h += 22
            for l in r["lifts"]:
                h += 22 + (16 if l["backoff"] else 0)
            h += 12
        return h + 8

    ch = max(ch_for([r for r in rows if r["week"] == w]) for w in weeks)
    for wi, w in enumerate(weeks):
        cx = L + wi * (cw + gap)
        wr = [r for r in rows if r["week"] == w]
        d.rounded_rectangle([cx, y, cx + cw, y + ch], 16, fill=CARD, outline=LINE)
        d.text((cx + 16, y + 18), f"WEEK {w}", font=font(11, 600), fill="#7AA2F7")
        cy = y + 46
        for r in wr:
            d.text((cx + 16, cy), f"{r['wd'].upper()}  {r['d'].strftime('%m/%d')}",
                   font=font(10, 600), fill=ACC[r["wd"]])
            cy += 20
            for l in r["lifts"]:
                d.rounded_rectangle([cx + 12, cy - 3, cx + cw - 12, cy + 19], 7,
                                    fill="#171C24")
                nf = fit(d, l["name"], cw - 110, 11)
                d.text((cx + 20, cy), l["name"], font=nf, fill=TXT)
                d.text((cx + cw - 20, cy), l["weight"], font=font(11, 600),
                       fill=UP, anchor="ra")
                cy += 22
                if l["backoff"]:
                    d.rounded_rectangle([cx + 12, cy - 2, cx + cw - 12, cy + 14], 6,
                                        fill=TINT)
                    d.text((cx + 20, cy), l["backoff"], font=font(9), fill=DIM)
                    cy += 16
            cy += 12
    return img, BG, "tl-f-strips"


VARIANTS = [a, b, c, dd, e, f]


def main():
    pid = sys.argv[1] if len(sys.argv) > 1 else "ben-starting-strength"
    import json
    import os.path
    doc = json.load(open(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "programs", f"{pid}.json")))["doc"]
    rows = rows_of(doc)
    for fn in VARIANTS:
        img, bg, name = fn(doc, rows)
        save(img, bg, name.split("-")[1], name, doc)


if __name__ == "__main__":
    main()