"""Builds ../data/building.json from the floor plans (alaprajz/), rooms.py and photos.py.
Run: python3 build.py   (needs numpy + opencv-python)"""
import json, os, glob, math, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rooms import FLIGHTS, LANDINGS, OFFSETS, ROOMS, CORRIDORS, CORRIDOR_RECTS, CORRIDOR_POLYS, LINES, STAIRS, EXITS
from photos import PHOTOS

HERE = os.path.dirname(os.path.abspath(__file__))
LEVEL_PLAN = {0: 'f0', 1: 'f1', 2: 'f2', 3: 'f2'}
PLAN_FILES = {'f0': 'foldszint.jpg', 'f1': 'emelet1.jpg', 'f2': 'emelet2.jpg'}

def segment(path):
    # dark pixels = walls; dilate so door gaps close, then label the enclosed white areas
    im = cv2.imread(path, 0)
    wall = (im < 140).astype(np.uint8)
    free = (1 - cv2.dilate(wall, np.ones((7, 7), np.uint8))).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(free, 4)
    return lab
LEVEL_NAMES = {0: 'Földszint', 1: '1. emelet', 2: '2. emelet', 3: 'I-szárny tetőtér'}
PX_PER_M = 18.4

def interp(x, xs, ys):
    xs = np.array(xs, float); ys = np.array(ys, float)
    if x <= xs[0]:
        k = (ys[1]-ys[0])/(xs[1]-xs[0]); return ys[0] + (x-xs[0])*k
    if x >= xs[-1]:
        k = (ys[-1]-ys[-2])/(xs[-1]-xs[-2]); return ys[-1] + (x-xs[-1])*k
    return float(np.interp(x, xs, ys))

# Szintenkénti illesztés: alaprajz-pixel -> az 1. emeleti alaprajz pixelrendszere.
# x: szakaszonként lineáris (xs -> ys), y: Y = a*y + b; a 2. emeleti H-tömb külön y-eltolást kap.
TRANSFORM = {
    0: dict(xs=[105, 505, 1535, 2490], ys=[29, 378, 1270, 2540], a=1.04, b=1090 - 404 * 1.04),
    1: dict(xs=[0, 1], ys=[0, 1], a=1.0, b=0.0),
    2: dict(xs=[165, 958, 1600, 2415], ys=[485, 1203, 1905, 2510], a=0.978, b=92.3, hshift=dict(x=1950, y=450, d=-130)),
}
TRANSFORM[3] = TRANSFORM[2]
CENTER = (1290, 600)

def to_ref(level, x, y):
    """plan pixel of a level -> floor-1 reference pixel"""
    t = TRANSFORM[level]
    X = interp(x, t['xs'], t['ys'])
    Y = t['a'] * y + t['b']
    hs = t.get('hshift')
    if hs and x > hs['x'] and y < hs['y']:  # H block is drawn lower on the 2nd floor plan
        Y += hs['d']
    return X, Y

def to_world(level, x, y):
    X, Y = to_ref(level, x, y)
    return round((X-CENTER[0])/PX_PER_M, 3), round((Y-CENTER[1])/PX_PER_M, 3)

labs = {fl: segment(os.path.join(HERE, 'alaprajz', fn)) for fl, fn in PLAN_FILES.items()}

def comp_bbox(level, comps):
    lab = labs[LEVEL_PLAN[level]]
    m = np.isin(lab, comps)
    ys, xs = np.where(m)
    return (int(xs.min())-3, int(ys.min())-3, int(xs.max())+3, int(ys.max())+3)

def comp_polys(level, comps):
    lab = labs[LEVEL_PLAN[level]]
    m = np.isin(lab, comps).astype(np.uint8)
    m = cv2.dilate(m, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < 300: continue
        a = cv2.approxPolyDP(c, 2.5, True)[:, 0, :]
        out.append([(int(p[0]), int(p[1])) for p in a])
    return out

def dy_at(level, x, y):
    for lv, (x0, y0, x1, y1), excl, dy in OFFSETS:
        if lv == level and x0 <= x <= x1 and y0 <= y <= y1 and not any(a <= x <= c and b_ <= y <= d for a, b_, c, d in excl):
            return dy
    return 0

def poly_center(poly):
    return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)

def rect_poly(r):
    x0, y0, x1, y1 = r
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

def wpoly(level, poly):
    return [to_world(level, x, y) for x, y in poly]

# ---------- rooms ----------
rooms = []
for i, (lv, name, sub, typ, geom, extra) in enumerate(ROOMS):
    rect = comp_bbox(lv, geom) if isinstance(geom, list) else geom
    rooms.append(dict(id=f'r{i}', level=lv, name=name, sub=sub, type=typ, rect_px=rect,
                      poly=wpoly(lv, rect_poly(rect)), staff=bool(extra.get('staff')),
                      dy=dy_at(lv, (rect[0]+rect[2])/2, (rect[1]+rect[3])/2),
                      estimated=(lv == 3), keys=extra.get('keys', '')))

corridors = []
for lv, comps, restricted in CORRIDORS:
    for p in comp_polys(lv, comps):
        corridors.append(dict(level=lv, poly=wpoly(lv, p), restricted=restricted, dy=dy_at(lv, *poly_center(p))))
for lv, r, restricted in CORRIDOR_RECTS:
    corridors.append(dict(level=lv, poly=wpoly(lv, rect_poly(r)), restricted=restricted, dy=dy_at(lv, (r[0]+r[2])/2, (r[1]+r[3])/2)))
for lv, pts, restricted in CORRIDOR_POLYS:
    corridors.append(dict(level=lv, poly=wpoly(lv, pts), restricted=restricted, dy=dy_at(lv, *poly_center(pts))))

# ---------- graph ----------
nodes = {}   # key -> dict
def nkey(lv, x, y): return (lv, round(x, 1), round(y, 1))
def add_node(lv, x, y, kind='c', label=None):
    k = nkey(lv, x, y)
    if k not in nodes:
        wx, wz = to_world(lv, x, y)
        nodes[k] = dict(id=len(nodes), level=lv, px=(x, y), x=wx, z=wz, kind=kind, label=label)
    elif label and not nodes[k]['label']:
        nodes[k]['label'] = label; nodes[k]['kind'] = kind
    return nodes[k]['id']

segments = []  # (lv, p0, p1, name, restricted)
EXPLICIT_DY = {}
LINES = [(lv, name, [(p[0], p[1]) for p in pts], restricted) for lv, name, pts, restricted in [
    (lv, name, [(EXPLICIT_DY.__setitem__((lv, p[0], p[1]), p[2]) or p) if len(p) == 3 else p for p in pts], restricted)
    for lv, name, pts, restricted in LINES]]
for lv, name, pts, restricted in LINES:
    for a, b in zip(pts, pts[1:]):
        segments.append([lv, a, b, name, restricted, []])  # last = list of (t, roomindex)

def seg_rect_dist(seg, rect):
    (ax, ay), (bx, by) = seg[1], seg[2]
    x0, y0, x1, y1 = rect
    best = (1e9, 0)
    # sample along segment
    n = max(2, int(math.hypot(bx-ax, by-ay)/4))
    for i in range(n+1):
        t = i/n; px = ax+(bx-ax)*t; py = ay+(by-ay)*t
        dx = max(x0-px, 0, px-x1); dy = max(y0-py, 0, py-y1)
        d = math.hypot(dx, dy)
        if d < best[0] - 1e-6: best = (d, t)
    return best

for ri, r in enumerate(rooms):
    lv = r['level']
    # a tanári folyosóra csak az irodák, tanári mosdók/raktár nyílnak; a tantermek nem
    cands = [(seg_rect_dist(s, r['rect_px']), si) for si, s in enumerate(segments)
             if s[0] == lv and (not s[4] or r['type'] in ('office', 'wc', 'storage'))]
    (d, t), si = min(cands, key=lambda c: (round(c[0][0], 1), c[1]))
    s = segments[si]
    # door point: projection of the room centre onto the segment, clamped to the part facing the room
    (ax, ay), (bx, by) = s[1], s[2]
    cx = (r['rect_px'][0]+r['rect_px'][2])/2; cy = (r['rect_px'][1]+r['rect_px'][3])/2
    L2 = (bx-ax)**2+(by-ay)**2
    tp = ((cx-ax)*(bx-ax)+(cy-ay)*(by-ay))/L2
    tp = min(max(tp, 0.0), 1.0)
    # if the projection is far from the room, fall back to the closest point
    px_, py_ = ax+(bx-ax)*tp, ay+(by-ay)*tp
    x0, y0, x1, y1 = r['rect_px']
    if math.hypot(max(x0-px_, 0, px_-x1), max(y0-py_, 0, py_-y1)) > d + 25:
        tp = t
    s[5].append((tp, ri))
    r['dist_px'] = round(d, 1)

edges = []
for lv, a, b, name, restricted, doors in segments:
    pts = [(0.0, a, None)] + [(t, (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t), ri) for t, ri in sorted(doors)] + [(1.0, b, None)]
    ids = []
    for t, p, ri in pts:
        if ri is not None:
            nid = add_node(lv, p[0], p[1], 'door')
            rooms[ri]['node'] = nid
        else:
            nid = add_node(lv, p[0], p[1])
        ids.append(nid)
    for u, v in zip(ids, ids[1:]):
        if u != v:
            edges.append(dict(a=u, b=v, name=name, restricted=restricted, kind='walk'))

for (la, pa), (lb, pb), name in STAIRS:
    u = add_node(la, *pa, kind='stair', label=name); v = add_node(lb, *pb, kind='stair', label=name)
    edges.append(dict(a=u, b=v, name=name, restricted=False, kind='stair'))

exits = []
for lv, p, name in EXITS:
    k = nkey(lv, *p)
    assert k in nodes, (name, k)
    nodes[k]['kind'] = 'exit'; nodes[k]['label'] = name
    exits.append(dict(name=name, node=nodes[k]['id'], level=lv))

node_list = sorted(nodes.values(), key=lambda n: n['id'])
for e in edges:
    A, B = node_list[e['a']], node_list[e['b']]
    e['len'] = round(math.hypot(A['x']-B['x'], A['z']-B['z']), 2)

# ---------- photos ----------
files = {}
PHOTO_DIR = os.path.join(HERE, '..', 'photos')
for f in glob.glob(f'{PHOTO_DIR}/*/*'):
    num = int(os.path.basename(f)[4:8]); files[num] = os.path.relpath(f, PHOTO_DIR)
photos = []
for num, lv, x, y, hdg, cap in PHOTOS:
    wx, wz = to_world(lv, x, y)
    photos.append(dict(id=f'p{num}', num=num, px=[x, y], file=files[num], level=lv, x=wx, z=wz,
                       heading=hdg, caption=cap, group=files[num].split('/')[0], dy=dy_at(lv, x, y)))
missing = set(files) - {p[0] for p in PHOTOS}
dup = len(PHOTOS) - len({p[0] for p in PHOTOS})
print('photos placed', len(photos), 'missing', sorted(missing), 'dup', dup)

for r in rooms:
    if 'node' not in r: print('NO NODE', r['name'])
    r.pop('rect_px')
flights = [dict(level=lv, poly=wpoly(lv, rect_poly(r)), dir=d, dy0=a0, dy1=a1) for lv, r, d, a0, a1 in FLIGHTS]
landings = [dict(level=lv, poly=wpoly(lv, rect_poly(r)), dy=h) for lv, r, h in LANDINGS]
data = dict(transform=dict(px_per_m=PX_PER_M, center=CENTER, levels=TRANSFORM, offsets=[dict(level=lv, rect=r, excl=ex, dy=d) for lv, r, ex, d in OFFSETS]), flights=flights, landings=landings, levels=[dict(level=k, name=v) for k, v in LEVEL_NAMES.items()],
            rooms=rooms, corridors=corridors,
            nodes=[dict(id=n['id'], level=n['level'], x=n['x'], z=n['z'], dy=EXPLICIT_DY.get((n['level'], *n['px']), dy_at(n['level'], *n['px'])), kind=n['kind'], label=n['label']) for n in node_list],
            edges=edges, exits=exits, photos=photos)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'data', 'building.json')
json.dump(data, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print('rooms', len(rooms), 'corridors', len(corridors), 'nodes', len(node_list), 'edges', len(edges), 'bytes', os.path.getsize(out))
# report long door links
for r in rooms:
    if r['dist_px'] > 45: print('far door', r['level'], r['name'], r['dist_px'])
