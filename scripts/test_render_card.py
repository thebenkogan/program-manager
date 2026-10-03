"""Prove the self-check has teeth: it must pass every real program and FAIL
when the layout is deliberately broken."""
import glob
import json
import os
import sys

sys.path.insert(0, "/home/benkogan/code/coach/scripts")
import render_card as r  # noqa: E402

ROOT = "/home/benkogan/code/coach"

print("== every client program ==")
ok = True
for f in sorted(glob.glob(os.path.join(ROOT, "data", "programs", "*.json"))):
    pid = os.path.basename(f)[:-5]
    doc = json.load(open(f))["doc"]
    r.VIOLATIONS.clear()
    try:
        r.render(pid, doc, None, f"/tmp/t-{pid}.png")
        print(f"  PASS  {pid}")
    except r.LayoutError as e:
        ok = False
        print(f"  FAIL  {pid}\n{e}")

print("\n== negative tests (must FAIL) ==")
doc = json.load(open(os.path.join(
    ROOT, "data", "programs", "ben-starting-strength.json")))["doc"]

# 1. a comically long lift name that cannot fit
bad = json.loads(json.dumps(doc))
bad["sessions"][0]["exercises"][0]["name"] = "Very Long Descriptive Exercise Name Here"
r.VIOLATIONS.clear()
try:
    r.render("neg1", bad, None, "/tmp/neg1.png")
    print("  BAD: long name was NOT caught"); ok = False
except r.LayoutError as e:
    print("  caught long name:", str(e).splitlines()[1].strip())

# 2. a week with a different number of sessions -> ragged row
bad2 = json.loads(json.dumps(doc))
bad2["sessions"] = bad2["sessions"][:-1]
r.VIOLATIONS.clear()
try:
    r.render("neg2", bad2, None, "/tmp/neg2.png")
    print("  BAD: ragged week was NOT caught"); ok = False
except r.LayoutError as e:
    print("  caught ragged week:", str(e).splitlines()[1].strip())

# 3. huge weight string overflowing its column
bad3 = json.loads(json.dumps(doc))
bad3["sessions"][0]["exercises"][0]["intensity"] = "12345 lb"
r.VIOLATIONS.clear()
try:
    r.render("neg3", bad3, None, "/tmp/neg3.png")
    print("  note: giant weight accepted (column grew to fit) - acceptable")
except r.LayoutError as e:
    print("  caught giant weight:", str(e).splitlines()[1].strip())

# 4. tiny font forced on a short name
bad4 = json.loads(json.dumps(doc))
bad4["sessions"][0]["exercises"][0]["name"] = "Squat (Light, Wide Stance, Tempo Pause)"
r.VIOLATIONS.clear()
try:
    r.render("neg4", bad4, None, "/tmp/neg4.png")
    print("  BAD: shrink-to-unreadable was NOT caught"); ok = False
except r.LayoutError as e:
    print("  caught unreadable shrink:", str(e).splitlines()[1].strip())

print("\nRESULT:", "all good" if ok else "CHECKER HAS GAPS")