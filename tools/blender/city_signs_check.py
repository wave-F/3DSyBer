# 招牌检查（只读，不改场景）：在打开的 Blender 里运行，挪过楼 / 手动改过招牌后跑一遍
# 体积和撑杆位置用 sign_geom.py（与摆放脚本、src/signs.js 一致），检查：
#   1. 穿插：招牌体积（发光面 + 底板 + 灯条 / 立柱 / 支架）和任何楼体网格相交
#   2. 被挡：招牌正前方（朝桥）被自己的楼挡住，即埋在楼里
#   3. 悬空：够得着墙的撑杆不到一半（其余末端落在窗洞 / 深凹槽里看不见，允许）
#   4. 招牌之间互相重叠
import bpy, os, sys, importlib
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(bpy.data.filepath)), 'tools', 'blender'))
import sign_geom; importlib.reload(sign_geom)
from sign_geom import MOUNT, sign_boxes, box_mesh, strut_dists

EXPORT_COL = '导出_近景楼'
SIGN_COL = '招牌（导出）'
GAP_TOL = 0.15

def walk(c):
    objs = list(c.objects)
    for ch in c.children: objs += walk(ch)
    return objs

bpy.context.view_layer.update()
B = {}
for b in [b for b in walk(bpy.data.collections[EXPORT_COL]) if b.type == 'MESH']:
    M = b.matrix_world
    bb = [M @ Vector(c) for c in b.bound_box]
    B[b] = dict(bvh=BVHTree.FromPolygons([M @ v.co for v in b.data.vertices], [tuple(p.vertices) for p in b.data.polygons]),
                lo=Vector([min(v[i] for v in bb) for i in range(3)]), hi=Vector([max(v[i] for v in bb) for i in range(3)]))

signs = [o for o in bpy.data.collections[SIGN_COL].objects if 'sign' in o]
boxes, issues = [], []
for o in signs:
    kind = o['sign']; gap = float(o.get('gap', 0))
    pb = B[o.parent]
    side = 1 if (pb['lo'].x + pb['hi'].x) > 0 else -1
    p = o.matrix_world.translation
    s = o.matrix_world.to_scale(); w, h = s.x, s.y
    # 还原安装面 front（d = side*x）
    front = side * p.x + ((0.4 + w / 2) if kind == 'blade' else MOUNT[kind])
    ox = (pb['lo'].x if side > 0 else pb['hi'].x) - side * 8
    my = sign_boxes(kind, p.y, p.z, w, h, front, side)
    for lo, hi in my:
        sb = BVHTree.FromPolygons(*box_mesh(lo, hi))
        for bb_, pb_ in B.items():
            if any(hi[i] < pb_['lo'][i] or lo[i] > pb_['hi'][i] for i in range(3)): continue
            pairs = sb.overlap(pb_['bvh'])
            if pairs: issues.append(f'穿插 {o.name} × {bb_.name}（相交三角形 {len(pairs)}）')
        c = (lo + hi) / 2
        hit, *_ = pb['bvh'].ray_cast(c, Vector((-side, 0, 0)), 30)
        if hit: issues.append(f'被挡 {o.name}：正前方 {abs(hit.x - c.x):.2f}m 处是楼体')
        boxes.append((o, lo, hi))
    if kind in ('logo', 'board'): continue
    ds = strut_dists(pb['bvh'], side, kind, p.y, p.z, w, h, front, ox)
    reach = [d for d in ds if d <= gap + GAP_TOL]
    if ds and len(reach) * 2 < len(ds):
        issues.append(f'悬空 {o.name}：gap={gap:.2f}，{len(ds)} 根撑杆只有 {len(reach)} 根够得着墙（各根到墙 ' + ', '.join(f'{d:.1f}' for d in ds) + '）')

for i in range(len(boxes)):
    for j in range(i + 1, len(boxes)):
        a, al, ah = boxes[i]; c, cl, ch = boxes[j]
        if a is not c and all(al[k] < ch[k] and cl[k] < ah[k] for k in range(3)):
            issues.append(f'招牌重叠 {a.name} × {c.name}')

print('@@CHECK signs', len(signs), 'issues', len(issues))
for s in issues: print('@@', s)
