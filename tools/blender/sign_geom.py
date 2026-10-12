# 招牌几何（city_signs.py 摆放 / city_signs_check.py 检查共用，尺寸与 src/signs.js 一致）
# 坐标约定：d = side * x（越小越靠桥），front = 安装面的 d；立面水平方向 = 世界 y，竖直 = z
from mathutils import Vector

MOUNT = {'screen': 0.32, 'vscreen': 0.62, 'hflat': 0.22, 'vflat': 0.22, 'ticker': 0.22, 'holo': 0.0, 'logo': 0.3, 'board': 0.2}
# 发光面之外的边距（左右, 下, 上）：屏幕底板 +0.3、底边灯条；竖屏立柱 / 上下灯条；平贴底板 +0.15
PAD = {'screen': (0.35, 0.45, 0.3), 'vscreen': (0.5, 0.8, 0.8), 'hflat': (0.15, 0.15, 0.15), 'vflat': (0.15, 0.15, 0.15),
       'ticker': (0.15, 0.15, 0.15), 'holo': (0.1, 0.1, 0.1), 'logo': (0.2, 0.2, 0.2), 'board': (0.2, 0.2, 0.2), 'blade': (0.0, 0.1, 0.1)}
FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
EPS = 0.03


def box_mesh(lo, hi):
    return [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)], FACES


def _box(side, d0, d1, y0, y1, z0, z1):
    x0, x1 = sorted((side * d0, side * d1))
    return Vector((x0, y0, z0)), Vector((x1, y1, z1))


def sign_boxes(kind, yc, zc, w, h, front, side):
    """招牌占用的体积（世界坐标 AABB 列表），不含撑杆（撑杆本来就要插到墙上）"""
    px, pb, pt = PAD[kind]
    if kind == 'blade':      # 挑牌：支架根部 → 外沿，厚 0.35
        return [_box(side, front - 0.4 - w, front - EPS, yc - 0.3, yc + 0.3, zc - h / 2 - pb, zc + h / 2 + pt)]
    if kind == 'holo':       # 全息画面（薄片）+ 画面下方的投影器
        return [_box(side, front - 0.05, front + 0.05, yc - w / 2 - px, yc + w / 2 + px, zc - h / 2 - pb, zc + h / 2 + pt)]
    return [_box(side, front - MOUNT[kind] - 0.05, front - EPS, yc - w / 2 - px, yc + w / 2 + px, zc - h / 2 - pb, zc + h / 2 + pt)]


def strut_points(kind, yc, zc, w, h):
    """运行时撑杆 / 支架在立面上的位置 (y, z)，与 src/signs.js 一致"""
    if kind == 'screen':
        us = [-0.4 * w, 0, 0.4 * w] if w > 8 else [-0.35 * w, 0.35 * w]
        vs = [-0.35 * h, 0.35 * h]
    elif kind == 'vscreen':
        us = [-(w / 2 + 0.35), w / 2 + 0.35]
        n = max(2, round(h / 6)); vs = [-h / 2 + h * k / n for k in range(n + 1)]
    elif kind in ('hflat', 'vflat'):
        us, vs = [-0.35 * w, 0.35 * w], [0]
    elif kind == 'ticker':
        n = max(2, round(w / 6)); us = [-w / 2 + 0.5 + (w - 1) * k / (n - 1) for k in range(n)]; vs = [0]
    elif kind == 'blade':
        us, vs = [0], [h / 2 - 0.3, -h / 2 + 0.3]
    elif kind == 'holo':
        us, vs = [0], [-h / 2 - 0.8]
    else:
        return []
    return [(yc + u, zc + v) for u in us for v in vs]


def strut_dists(bvh, side, kind, yc, zc, w, h, front, ox):
    """每根撑杆从安装面打到墙的距离（打空 = inf）；打到安装面前面的外凸物算 0"""
    ds = []
    for y, z in strut_points(kind, yc, zc, w, h):
        loc, *_ = bvh.ray_cast(Vector((ox, y, z)), Vector((side, 0, 0)), 300)
        ds.append(max(0.0, side * loc.x - front) if loc else float('inf'))
    return ds


def strut_gap(ds, limit):
    """撑杆长度：limit 以内够得着墙的撑杆里最长的；够得着的不到一半返回 None
    （超过 limit 的撑杆末端落在窗洞 / 深凹槽口，看不见，不算穿帮）"""
    if not ds: return 0.0
    ok = [d for d in ds if d <= limit]
    if len(ok) * 2 < len(ds): return None
    return max(ok)
