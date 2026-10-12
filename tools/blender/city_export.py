# 导出近景楼布局到游戏：src/data/cityLayout.json
# 在打开的 art/city.blend 里运行（文本编辑器 Run Script），或：
#   Blender -b art/city.blend --python tools/blender/city_export.py
# 导出内容：
#   buildings  集合「导出_近景楼」里每栋楼的楼型、位置、朝向（游戏坐标）
#   signs      集合「招牌（导出）」里的招牌面片（父级 = 所属楼）
#   footprints 每栋楼的占地矩形（程序楼避让用）
# 楼型 = 网格名（关联复制共享楼体库网格，例如 tower02）；楼型网格本身改了才需要重新烘焙（city_bake.py）
import bpy, os, re, json, math
from mathutils import Vector

EXPORT_COL = '导出_近景楼'
SIGN_COL = '招牌（导出）'
REPO = os.path.dirname(os.path.dirname(bpy.path.abspath('//')))   # art/city.blend → 仓库根目录
OUT = os.path.join(REPO, 'src', 'data', 'cityLayout.json')
BAKED = json.load(open(os.path.join(REPO, 'src', 'data', 'buildings.json')))

def walk(c):
    objs = list(c.objects)
    for ch in c.children: objs += walk(ch)
    return objs

def g(v):          # Blender 坐标 → 游戏 three.js 坐标
    return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]

def r3(x): return round(x, 3)

buildings, footprints, index = [], [], {}
for o in sorted(walk(bpy.data.collections[EXPORT_COL]), key=lambda o: o.name):
    if o.type != 'MESH' or o.hide_render: continue
    kind = o.get('kb3d') or re.sub(r'\.\d+$', '', o.data.name)
    if kind not in BAKED:
        print('@@SKIP 没有烘焙过的楼型', o.name, kind); continue
    m = o.matrix_world
    if abs(m.to_euler().x) > 1e-3 or abs(m.to_euler().y) > 1e-3 or max(abs(s - 1) for s in m.to_scale()) > 1e-3:
        print('@@WARN 只支持绕 Z 旋转、缩放为 1：', o.name)
    index[o] = len(buildings)
    buildings.append(dict(name=o.name, type=kind, pos=g(m.translation), yaw=r3(m.to_euler().z)))
    bb = [m @ Vector(c) for c in o.bound_box]
    gx = [v.x for v in bb]; gz = [-v.y for v in bb]
    footprints.append([r3(min(gx)), r3(max(gx)), r3(min(gz)), r3(max(gz))])

signs = []
col = bpy.data.collections.get(SIGN_COL)
for s in sorted(col.objects if col else [], key=lambda o: o.name):
    kind = s.get('sign')
    if not kind or s.hide_render: continue
    if s.parent not in index:
        print('@@SKIP 招牌没有挂在导出的楼上', s.name); continue
    m = s.matrix_world
    p = m.translation
    ax = m.col[0].xyz; ay = m.col[1].xyz; az = m.col[2].xyz
    w, h = ax.length, ay.length
    if kind == 'blade':
        n = ax.normalized()
        if n.dot(Vector((-p.x, 0, 0))) < 0: n = -n        # 挑牌伸出方向朝桥
        c = p - n * (0.4 + w / 2)
    else:
        n = az.normalized()
        if n.dot(Vector((-p.x, 0, 0))) < 0: n = -n        # 平贴类法线朝桥
        c = p - n * 0.3
    n.z = 0; n.normalize()
    item = dict(b=index[s.parent], type=kind, c=[r3(c.x), r3(-c.y)], y=r3(p.z), n=[r3(n.x), r3(-n.y)], w=r3(w), h=r3(h))
    if kind == 'screen': item['ad'] = s.get('ad', 'ramen')
    else: item['color'] = s.get('color', 'cyan')
    signs.append(item)

zs = [f[2] for f in footprints] + [f[3] for f in footprints]
data = dict(near=[r3(min(zs)), r3(max(zs))], buildings=buildings, footprints=footprints, signs=signs)
with open(OUT, 'w') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print('@@EXPORT', OUT, len(buildings), 'buildings', len(signs), 'signs')
