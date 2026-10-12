# 给 art/city.blend 里每栋近景楼自动摆招牌（在打开的 Blender 里运行：文本编辑器 Run Script）
# 2077 风格：每栋楼一种主风格（相邻不重复），招牌按类型分层：
#   mega   墙面 LED 大屏 + 跑马灯        street  街面招牌簇（挑牌 / 灯箱 / 旧招牌，桥面高度附近）
#   corner 楼角竖向巨屏（钢架撑离墙面）   holo    投影式全息广告（悬在立面前）
#   roof   楼顶企业标志 / 楼顶广告牌      dark    暗楼，只亮零星小牌子
# 防穿插：先对朝桥立面打一张 0.4m 间距的深度图（每格记录最靠桥的表面），招牌的安装面放在
#   它覆盖范围内所有外凸物（空调、阳台、灯箱…）的前面，离墙远就补撑杆（gap = 安装面到墙）
# 招牌是面片，放在集合「招牌（导出）」，父级是所属楼，挪楼时跟着走；可手动挪、缩放、删除
# 自定义属性：sign（类型）、gap（撑杆长度）、color（霓虹色）、box（灯箱）、dim（旧招牌偏暗）、idx（标志/跑马灯编号）
# 面片位置 = 招牌的发光面；面片尺寸 = 招牌尺寸（缩放 x = 宽，y = 高）；挑牌面片垂直立面
# RESET = True 时先删掉全部旧招牌重摆；False 时只给还没有招牌的楼补
import bpy, math, random, os, sys, importlib
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(bpy.data.filepath)), 'tools', 'blender'))
import sign_geom; importlib.reload(sign_geom)
from sign_geom import MOUNT, sign_boxes, box_mesh, strut_dists, strut_gap

RESET = True
EXPORT_COL = '导出_近景楼'
SIGN_COL = '招牌（导出）'
STEP = 0.4
NEON = {'cyan': '#20f0ff', 'pink': '#ff2a9a', 'yellow': '#ffd23a', 'violet': '#a060ff', 'red': '#ff3040', 'green': '#40ff90'}
PALETTE = [('yellow', 3), ('cyan', 3), ('pink', 3), ('red', 2), ('violet', 1), ('green', 1)]   # 2077 主色：黄 / 青 / 品红 / 红
N_LOGO, N_TICKER = 9, 4
# 发光面离安装面的距离 MOUNT、招牌体积、撑杆位置都在 sign_geom.py（与 src/signs.js 一致）

def hex2lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def walk(c):
    objs = list(c.objects)
    for ch in c.children: objs += walk(ch)
    return objs

def sign_mat(key, hexcol, k=4):
    name = f'招牌_{key}'
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    n = m.node_tree; n.nodes.clear()
    e = n.nodes.new('ShaderNodeEmission'); o = n.nodes.new('ShaderNodeOutputMaterial')
    e.inputs['Color'].default_value = (*hex2lin(hexcol), 1); e.inputs['Strength'].default_value = k
    n.links.new(e.outputs[0], o.inputs[0])
    m.diffuse_color = (*hex2lin(hexcol), 1)
    return m

def plane_mesh():
    me = bpy.data.meshes.get('招牌面片')
    if me: return me
    me = bpy.data.meshes.new('招牌面片')
    me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(None)
    return me

scene = bpy.context.scene
col = bpy.data.collections.get(SIGN_COL)
if not col:
    col = bpy.data.collections.new(SIGN_COL); scene.collection.children.link(col)
if RESET:
    for o in list(col.objects): bpy.data.objects.remove(o, do_unlink=True)
have = {o.parent for o in col.objects if o.parent}
counter = {'logo': 0, 'ticker': 0, 'made': 0}
STATS = {}

def wpick(rnd, items):
    t = rnd.random() * sum(w for _, w in items)
    for v, w in items:
        t -= w
        if t <= 0: return v
    return items[0][0]

# ---------- 每栋楼的风格（相邻不重复，靠近事故现场的更热闹） ----------
blds = [b for b in walk(bpy.data.collections[EXPORT_COL]) if b.type == 'MESH']
info = {}
for b in blds:
    vs = [b.matrix_world @ Vector(c) for c in b.bound_box]
    xs = [v.x for v in vs]
    side = 1 if (min(xs) + max(xs)) > 0 else -1
    near_x = min(xs) if side > 0 else max(xs)
    info[b] = dict(side=side, far=abs(near_x) > 45, y=sum(v.y for v in vs) / 8, ztop=max(v.z for v in vs))
style = {}
# 每排一袋风格，打乱后保证相邻不同；矮楼（楼顶低于 35m）固定楼顶广告牌
BAGS = {(1, False): ['street', 'street', 'mega', 'corner', 'corner', 'holo', 'dark'],
        (-1, False): ['street', 'street', 'mega', 'mega', 'corner', 'holo', 'dark'],
        (1, True): ['roof', 'corner', 'mega', 'dark'],
        (-1, True): ['roof', 'holo', 'corner', 'mega']}
for (side, far), bag in BAGS.items():
    row = sorted([b for b in blds if info[b]['side'] == side and info[b]['far'] == far], key=lambda b: info[b]['y'])
    low = [b for b in row if info[b]['ztop'] < 35]
    bag = list(bag)
    for _ in low:
        if 'dark' in bag: bag.remove('dark')
        elif len(bag) > 1: bag.pop()
    rnd = random.Random(f'bag{side}{far}')
    for _ in range(200):
        rnd.shuffle(bag)
        seq = iter(bag)
        out_ = [('roof' if b in low else next(seq, 'dark')) for b in row]
        if all(out_[i] != out_[i + 1] for i in range(len(out_) - 1)): break
    for b, s_ in zip(row, out_): style[b] = s_

# ---------- 摆放 ----------
for b in sorted(blds, key=lambda o: o.name):
    if b in have: continue
    rnd = random.Random(b.name + '#v2')
    M = b.matrix_world
    me = b.data
    verts = [M @ v.co for v in me.vertices]
    bvh = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons])
    xs = np.array([v.x for v in verts]); ys = np.array([v.y for v in verts]); zs = np.array([v.z for v in verts])
    side = info[b]['side']; far = info[b]['far']; st = style[b]
    out = Vector((-side, 0, 0))                     # 朝桥方向
    x_near = xs.min() if side > 0 else xs.max()
    ztop = zs.max()
    big = 1.3 if far else 1.0

    # 朝桥立面深度图：D = side * 命中点 x（越小越靠桥），没打到 = nan
    Y = np.arange(ys.min() - 1, ys.max() + 1, STEP)
    Z = np.arange(10.0, min(ztop, 95) + 0.5, STEP)
    D = np.full((len(Y), len(Z)), np.nan)
    ox = x_near - side * 8
    for i, y in enumerate(Y):
        for j, z in enumerate(Z):
            loc, *_ = bvh.ray_cast(Vector((ox, y, z)), Vector((side, 0, 0)), 300)
            if loc: D[i, j] = side * loc.x
    ylo, yhi = ys.min(), ys.max()

    def cells(yc, zc, w, h):
        i0, i1 = np.searchsorted(Y, yc - w / 2), np.searchsorted(Y, yc + w / 2, 'right')
        j0, j1 = np.searchsorted(Z, zc - h / 2), np.searchsorted(Z, zc + h / 2, 'right')
        if i1 <= i0 or j1 <= j0 or zc + h / 2 > Z[-1] + STEP: return None
        return D[i0:i1, j0:j1]

    def mount(yc, zc, w, h, cover=0.97, margin=0.12):
        """安装面（side*x）、到墙距离、覆盖率；覆盖不足返回 None"""
        a = cells(yc, zc, w + 0.4, h + 0.4)          # 四周多看 0.2m（底板、灯条比发光面大一圈）
        if a is None: return None
        cov = np.isfinite(a).mean()
        if cov < cover: return None
        front = np.nanmin(a) - margin
        wall = np.nanpercentile(a, 50)
        return front, max(0.0, wall - front), cov

    # ---------- 精确防穿插：招牌真实体积（发光面 + 底板厚度 + 边框；挑牌含支架）和楼体网格求交 ----------
    def collide(kind, yc, zc, w, h, front):
        """front = 安装面（side*x）；盒子边距和 src/signs.js 里的底板 / 灯条 / 立柱一致"""
        boxes = sign_boxes(kind, yc, zc, w, h, front, side)
        return any(BVHTree.FromPolygons(*box_mesh(lo, hi)).overlap(bvh) for lo, hi in boxes)

    def protrude(kind, yc, zc, w, h):
        """0.1m 细网格量招牌范围内最靠桥的表面（side*x）"""
        hw = 0.35 if kind == 'blade' else w / 2 + 0.2
        best = None
        for y in np.arange(yc - hw, yc + hw + 0.01, 0.1):
            for z in np.arange(zc - h / 2 - 0.2, zc + h / 2 + 0.21, 0.1):
                loc, *_ = bvh.ray_cast(Vector((ox, y, z)), Vector((side, 0, 0)), 300)
                if loc and (best is None or side * loc.x < best): best = side * loc.x
        return best

    def fit(kind, yc, zc, w, h, front, gap, maxgap):
        """不穿插就原样返回；穿插就往桥方向推（撑杆加长），超过 maxgap 返回 None
        通过后按运行时每根撑杆的位置量到墙的距离，gap 取最长那根（每根都够得着墙）"""
        for _ in range(8):
            if not collide(kind, yc, zc, w, h, front):
                ds = strut_dists(bvh, side, kind, yc, zc, w, h, front, ox)
                if not ds: return front, gap
                sg = strut_gap(ds, maxgap + 0.5)
                if sg is None:                                   # 一半以上撑杆够不着墙
                    STATS[kind + ':strut'] = STATS.get(kind + ':strut', 0) + 1; return None
                return front, sg
            p = protrude(kind, yc, zc, w, h)
            nf = min(front - 0.1, (p - 0.12) if p is not None else front - 0.1)
            gap += front - nf; front = nf
            if gap > maxgap:
                STATS[kind + ':push'] = STATS.get(kind + ':push', 0) + 1; return None
        STATS[kind + ':iter'] = STATS.get(kind + ':iter', 0) + 1
        return None

    used = []
    def free(yc, zc, w, h, pad=0.8):
        return all(abs(yc - u[0]) > (w + u[2]) / 2 + pad or abs(zc - u[1]) > (h + u[3]) / 2 + pad for u in used)

    def add(kind, yc, zc, w, h, mnt, gap, **props):
        o = bpy.data.objects.new(f'{b.name}_招牌{len(used) + 1}_{kind}', plane_mesh())
        col.objects.link(o)
        fx = side * mnt                               # 安装面世界 x
        if kind == 'blade':
            o.location = (fx + out.x * (0.4 + w / 2), yc, zc)
            o.rotation_euler = (math.pi / 2, 0, 0)
        else:
            o.location = (fx + out.x * MOUNT[kind], yc, zc)
            o.rotation_euler = (math.pi / 2, 0, -side * math.pi / 2)
        o.scale = (w, h, 1)
        o['sign'] = kind; o['gap'] = round(gap, 3)
        for k, v in props.items(): o[k] = v
        key = props.get('color', 'screen' if kind in ('screen', 'vscreen', 'holo', 'board') else 'cyan')
        hexcol = NEON.get(key, '#d0d8ff')
        o.material_slots[0].link = 'OBJECT'
        o.material_slots[0].material = sign_mat(key, hexcol)
        o.color = (*hex2lin(hexcol), 1)
        o.parent = b; o.matrix_parent_inverse = b.matrix_world.inverted()
        used.append((yc, zc, w if kind != 'blade' else 1.2, h))
        counter['made'] += 1
        return o

    zlo = (23.0 if not far else 26.0)
    zlo = max(15.0, min(zlo, ztop - 9))
    zhi = min(ztop - 3, 55.0 if not far else 80.0, Z[-1])
    span = yhi - ylo

    def search(kind, w, h, z0, z1, ztarget, yfix=None, cover=0.97, maxgap=1.5, stand=0.0, ystep=1.0):
        """按评分从好到差试，第一个通过精确防穿插（必要时推出去）的位置胜出"""
        cands = []
        if z1 - z0 < h: return None
        ys_ = (yfix if isinstance(yfix, list) else [yfix]) if yfix is not None else [ylo + w / 2 + 0.5 + i * ystep for i in range(int((span - w - 1) / ystep) + 1)]
        for zc in np.arange(z0 + h / 2, z1 - h / 2 + 0.01, 1.0):
            for yc in ys_:
                if not free(yc, zc, w, h): continue
                m = mount(yc, zc, w, h, cover)
                if m is None: continue
                front, gap, cov = m
                front -= stand; gap += stand
                if gap > maxgap + stand: continue
                score = gap * 2 + abs(zc - ztarget) * 0.25 + abs(front - (side * x_near)) * 0.5 + rnd.random() * 1.5
                cands.append((score, yc, zc, front, gap))
        cands.sort(key=lambda c: c[0])
        STATS[f'{kind}{w:.0f}x{h:.0f}:cands'] = len(cands)
        for score, yc, zc, front, gap in cands[:60]:
            r = fit(kind, yc, zc, w, h, front, gap, maxgap + stand)
            if r: return (score, yc, zc, r[0], r[1])
        return None

    def color(): return wpick(rnd, PALETTE)

    def wall_screen(sizes, ztarget):
        for w, h in sizes:
            w, h = w * big, h * big
            if w > span * 0.85: continue
            r = search('screen', w, h, zlo, zhi, ztarget, cover=0.9, maxgap=2.5)
            if r:
                _, yc, zc, f, g = r
                add('screen', yc, zc, w, h, f, g, color=color()); return True
        return False

    def corner_screen(end):
        for w, h in [(6, 18), (5.5, 15), (5, 12), (4.5, 10)]:
            w, h = w * big, h * big
            if w + 2 > span * 0.5: continue
            k = np.arange(0, max(0.0, span * 0.3 - w / 2) + 0.01, 1.0)   # 外侧 30% 范围内找
            yl = [float(ylo + w / 2 + 0.8 + d) for d in k] if end < 0 else [float(yhi - w / 2 - 0.8 - d) for d in k]
            r = search('vscreen', w, h, zlo - 3, zhi, zlo + h / 2 + 4, yfix=yl, cover=0.6, maxgap=3.0, stand=rnd.uniform(0.8, 1.6))
            if r:
                _, yc, zc, f, g = r
                add('vscreen', yc, zc, w, h, f, g, color=color()); return True
        return False

    def holo_ad():
        for w, h in ([(8, 12), (14, 8)] if rnd.random() < 0.6 else [(14, 8), (8, 12)]):
            w, h = w * big, h * big
            if w > span * 0.9: continue
            r = search('holo', w, h, zlo + 2, min(zhi + 6, Z[-1]), zlo + h / 2 + 6, cover=0.5, maxgap=3.0, stand=rnd.uniform(3.0, 4.5), ystep=2.0)
            if r:
                _, yc, zc, f, g = r
                add('holo', yc, zc, w, h, f, g); return True
        return False

    def ticker_band(z_pref):
        h = 1.2 * big
        for w in [min(28, span - 2), min(20, span - 2), min(14, span - 2)]:
            if w < 8: continue
            r = search('ticker', w, h, zlo, zhi, z_pref, cover=0.9, maxgap=1.2)
            if r:
                _, yc, zc, f, g = r
                add('ticker', yc, zc, w, h, f, g, idx=counter['ticker'] % N_TICKER); counter['ticker'] += 1; return True
        return False

    def blade(z0, z1, box=False, dim=False):
        w = rnd.uniform(1.5, 2.1) * big; h = rnd.choice([6, 7, 8, 9, 10]) * big
        if z1 - z0 < h: h = z1 - z0
        if h < 3: return False
        for _ in range(30):
            yc = rnd.uniform(ylo + 1.0, yhi - 1.0)
            zc = rnd.uniform(z0 + h / 2, z1 - h / 2)
            if not free(yc, zc, 1.2, h, 0.6): continue
            a = cells(yc, zc, 0.7, h + 0.4)
            if a is None or np.isfinite(a).mean() < 0.85: continue
            front = np.nanmin(a) - 0.05
            if np.nanpercentile(a, 50) - front > 0.6: continue       # 根部离墙太远就不挂
            r = fit('blade', yc, zc, w, h, front, 0.0, 0.3)            # 支架最多加长 0.3m
            if r is None: continue
            add('blade', yc, zc, w, h, r[0], r[1], color=color(), **({'box': 1} if box else {}), **({'dim': 1} if dim else {}))
            return True
        return False

    def flat(z0, z1, vertical, box=False, dim=False):
        w, h = ((rnd.uniform(1.6, 2.2), rnd.uniform(5, 8)) if vertical else (rnd.uniform(5, 9), rnd.uniform(1.5, 2.2)))
        w, h = w * big, h * big
        if z1 - z0 < h: return False
        for _ in range(40):
            yc = rnd.uniform(ylo + w / 2 + 0.3, max(ylo + w / 2 + 0.3, yhi - w / 2 - 0.3))
            zc = rnd.uniform(z0 + h / 2, z1 - h / 2)
            if not free(yc, zc, w, h, 0.5): continue
            m = mount(yc, zc, w, h, 0.95)
            if m is None or m[1] > 1.0: continue
            kind = 'vflat' if vertical else 'hflat'
            m = fit(kind, yc, zc, w, h, m[0], m[1], 1.2)
            if m is None: continue
            add(kind, yc, zc, w, h, m[0], m[1], color=color(), **({'box': 1} if box else {}), **({'dim': 1} if dim else {}))
            return True
        return False

    def roof(kind):
        """楼顶：向下打射线找上层屋顶，在靠桥边缘放标志 / 广告牌"""
        X = np.arange(xs.min(), xs.max() + 0.01, 0.5)
        Yr = np.arange(ylo, yhi + 0.01, 0.5)
        R = np.full((len(X), len(Yr)), np.nan)
        for i, x in enumerate(X):
            for j, y in enumerate(Yr):
                loc, *_ = bvh.ray_cast(Vector((x, y, ztop + 5)), Vector((0, 0, -1)), 200)
                if loc: R[i, j] = loc.z
        if not np.isfinite(R).any(): return False
        rtop = np.nanpercentile(R, 97)                     # 屋顶高度（不用包围盒顶，避免被天线、旗杆拉高）
        top = np.isfinite(R) & (R > rtop - 6)
        cols = [i for i in range(len(X)) if top[i].any()]
        if not cols: return False
        order = sorted(cols, key=lambda i: side * X[i])      # 从靠桥一侧往里
        for w, h in ([(16, 5), (12, 4), (9, 3)] if kind == 'logo' else [(14, 7.9), (11, 6.2), (8, 4.5)]):
            w, h = w * big, h * big
            if w > span - 1: continue
            for i in order[:12]:
                strip_i = [k for k in range(len(X)) if 0.5 <= side * (X[k] - X[i]) <= 2.5]   # 让开女儿墙
                for yc in np.arange(ylo + w / 2 + 0.5, yhi - w / 2 - 0.5 + 0.01, 1.0):
                    js = [j for j in range(len(Yr)) if abs(Yr[j] - yc) <= w / 2]
                    a = R[np.ix_(strip_i, js)]
                    if not np.isfinite(a).all() or not top[np.ix_(strip_i, js)].all(): continue
                    base = np.median(a)
                    if a.max() - base > 3.0: continue        # 屋顶这一条上有高的东西（水箱、机房）就换位置
                    bottom = a.max() + (2.0 if kind == 'logo' else 2.5)
                    zc = bottom + h / 2
                    fx = side * X[i] - 0.3                     # 安装面：屋顶边缘往桥方向一点
                    if collide(kind, float(yc), zc, w, h, fx): continue
                    add(kind, float(yc), float(zc), w, h, fx, float(bottom - base),
                        **({'idx': counter['logo'] % N_LOGO, 'color': 'yellow'} if kind == 'logo' else {'color': color()}))
                    if kind == 'logo': counter['logo'] += 1
                    return True
        return False

    street_z = (zlo - 6 if not far else zlo, min(zhi, zlo + 14))
    if st == 'mega':
        wall_screen([(16, 9), (14, 7.9), (11, 6.2), (8, 4.5)], 34 if not far else 44)
        if rnd.random() < 0.7: ticker_band(zlo + 2)
        for _ in range(1 + (rnd.random() < 0.5)): blade(*street_z)
        flat(*street_z, False)
    elif st == 'street':
        for _ in range(rnd.randint(4, 6)): blade(*street_z, box=rnd.random() < 0.3, dim=rnd.random() < 0.3)
        for _ in range(rnd.randint(3, 5)): flat(*street_z, rnd.random() < 0.45, box=rnd.random() < 0.35, dim=rnd.random() < 0.3)
        if rnd.random() < 0.5: wall_screen([(8, 4.5), (6, 3.4)], street_z[1] + 2)
        if rnd.random() < 0.4: ticker_band(street_z[1] + 3)
    elif st == 'corner':
        ends = [-1, 1] if rnd.random() < 0.6 else [rnd.choice([-1, 1])]
        if not any([corner_screen(e) for e in ends]): wall_screen([(11, 6.2), (8, 4.5)], 34)
        for _ in range(2): blade(*street_z, dim=rnd.random() < 0.3)
        for _ in range(2): flat(*street_z, rnd.random() < 0.5, box=rnd.random() < 0.4)
    elif st == 'holo':
        if not holo_ad(): wall_screen([(11, 6.2), (8, 4.5)], 34)
        for _ in range(rnd.randint(1, 2)): blade(*street_z)
        flat(*street_z, False, dim=rnd.random() < 0.4)
    elif st == 'roof':
        ok = roof('logo' if (far and rnd.random() < 0.6) else 'board')
        if not ok: wall_screen([(11, 6.2), (8, 4.5)], 34)
        if ztop >= 35:
            blade(*street_z); flat(*street_z, rnd.random() < 0.5, box=True)
        else:   # 矮楼：楼顶下面的墙也挂一点
            flat(15, ztop - 1.5, False, box=True)
    else:   # dark
        for _ in range(rnd.randint(1, 2)): (blade if rnd.random() < 0.5 else (lambda *a, **k: flat(*a, False, **k)))(*street_z, dim=True)
    print('@@', b.name, st, len(used), dict(STATS)); STATS.clear()

print('@@SIGNS made', counter['made'], 'total', len(col.objects))
