# 给 art/city.blend 里每栋近景楼自动摆招牌（在打开的 Blender 里运行：文本编辑器 Run Script）
# 招牌是发光面片，放在集合「招牌（导出）」，父级是所属楼，挪楼时跟着走
# 可以手动挪、缩放、删除；自定义属性：
#   sign  = screen(LED 大屏) / hflat(横平贴) / vflat(竖平贴) / blade(竖挑牌，垂直立面伸出)
#   color = cyan/pink/yellow/violet/red/green（霓虹色）   ad = ramen/drink/whisky/idol/arm（大屏广告）
# 面片尺寸 = 招牌尺寸（缩放 x = 宽，y = 高）；平贴类面片法线朝外，挑牌面片垂直立面
# 重跑时只给「还没有招牌」的楼补招牌；想重摆某栋，删掉它的招牌再跑
import bpy, math, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

EXPORT_COL = '导出_近景楼'
SIGN_COL = '招牌（导出）'
EYE_Z = 21.7
NEON = {'cyan': '#20f0ff', 'pink': '#ff2a9a', 'yellow': '#ffd23a', 'violet': '#a060ff', 'red': '#ff3040', 'green': '#40ff90'}
ADS_H = ['ramen', 'drink', 'whisky']
ADS_V = ['idol', 'arm']
ADS_RGB = {'ramen': '#c87a40', 'drink': '#40a0d0', 'whisky': '#c08030', 'idol': '#d050a0', 'arm': '#5080d0'}

def hex2lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def walk(c):
    objs = list(c.objects)
    for ch in c.children: objs += walk(ch)
    return objs

def sign_mat(key, hexcol):
    name = f'招牌_{key}'
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    n = m.node_tree; n.nodes.clear()
    e = n.nodes.new('ShaderNodeEmission'); o = n.nodes.new('ShaderNodeOutputMaterial')
    e.inputs['Color'].default_value = (*hex2lin(hexcol), 1); e.inputs['Strength'].default_value = 4
    n.links.new(e.outputs[0], o.inputs[0])
    m.diffuse_color = (*hex2lin(hexcol), 1)
    return m

def plane_mesh():
    me = bpy.data.meshes.get('招牌面片')
    if me: return me
    me = bpy.data.meshes.new('招牌面片')
    me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(None)   # 材质挂在物体上，每块招牌各自颜色
    return me

scene = bpy.context.scene
col = bpy.data.collections.get(SIGN_COL)
if not col:
    col = bpy.data.collections.new(SIGN_COL); scene.collection.children.link(col)
have = {o.parent for o in col.objects if o.parent}
dg = bpy.context.evaluated_depsgraph_get()
made = 0

for b in sorted(walk(bpy.data.collections[EXPORT_COL]), key=lambda o: o.name):
    if b.type != 'MESH' or b in have: continue
    rnd = random.Random(b.name)
    M = b.matrix_world
    me = b.data
    verts = [M @ v.co for v in me.vertices]
    bvh = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons])
    xs = [v.x for v in verts]; ys = [v.y for v in verts]; zs = [v.z for v in verts]
    side = 1 if (min(xs) + max(xs)) > 0 else -1          # 楼在桥的哪一侧（Blender +X = 游戏右侧）
    out = Vector((-side, 0, 0))                           # 朝桥方向
    x_near = min(xs) if side > 0 else max(xs)
    far_row = abs(x_near) > 45
    y0, y1, ztop = min(ys) + 1.5, max(ys) - 1.5, max(zs)
    ray_x = x_near - side * 5                             # 从楼前 5m 往楼里打射线

    def depth(y, z):
        loc, nrm, idx, dist = bvh.ray_cast(Vector((ray_x, y, z)), Vector((side, 0, 0)), 200)
        return loc.x if loc else None

    def facade(yc, zc, w, h, flat_tol=1.0):
        """矩形区域内 9 根射线都打到墙，且墙面起伏不超过 flat_tol，返回最靠近桥的墙面 x"""
        ds = [depth(yc + dy * w / 2, zc + dz * h / 2) for dy in (-0.9, 0, 0.9) for dz in (-0.9, 0, 0.9)]
        if any(d is None for d in ds): return None
        d = [side * v for v in ds]
        if max(d) - min(d) > flat_tol: return None
        return side * min(d)

    used = []
    def free(yc, zc, w, h, pad=0.8):
        return all(abs(yc - u[0]) > (w + u[2]) / 2 + pad or abs(zc - u[1]) > (h + u[3]) / 2 + pad for u in used)

    def add(kind, yc, zc, w, h, fx, key, hexcol):
        global made
        o = bpy.data.objects.new(f'{b.name}_招牌{len(used) + 1}_{kind}', plane_mesh())
        col.objects.link(o)
        if kind == 'blade':
            # 垂直于立面，从墙面伸出 0.4m
            o.location = (fx + out.x * (0.4 + w / 2), yc, zc)
            o.rotation_euler = (math.pi / 2, 0, 0)
        else:
            o.location = (fx + out.x * 0.3, yc, zc)
            o.rotation_euler = (math.pi / 2, 0, -side * math.pi / 2)
        o.scale = (w, h, 1)
        o['sign'] = kind
        o['ad' if kind == 'screen' else 'color'] = key
        o.material_slots[0].link = 'OBJECT'
        o.material_slots[0].material = sign_mat(key, hexcol)
        o.color = (*hex2lin(hexcol), 1)
        # 父级设为楼，保持世界位置
        o.parent = b; o.matrix_parent_inverse = b.matrix_world.inverted()
        used.append((yc, zc, w, h)); made += 1
        return o

    zlo = 23.0 if not far_row else 26.0
    zlo = max(16.0, min(zlo, ztop - 9))                   # 矮楼（顶在桥面附近）招牌往下放
    zhi = min(ztop - 3, 48.0 if not far_row else 70.0)

    # 1. LED 大屏：找最平整、最靠桥、离视线高度近的一块墙
    best = None
    sizes = [(14, 8), (11, 6.2), (8, 4.5), (6, 10), (5, 8)] if not far_row else [(20, 11.2), (16, 9), (8, 14), (12, 6.75)]
    for w, h in sizes:
        if w > (y1 - y0) * 0.8: continue
        for zc in [z + 0.5 for z in range(int(zlo + h / 2), int(zhi - h / 2) + 1, 2)]:
            for yc in [y0 + w / 2 + i * 1.5 for i in range(int((y1 - y0 - w) / 1.5) + 1)]:
                fx = facade(yc, zc, w, h)
                if fx is None: continue
                score = abs(fx - x_near) * 1.5 + abs(zc - (32 if not far_row else 40)) * 0.3 + abs(yc - (y0 + y1) / 2) * 0.1 - w * h * 0.03 + rnd.random() * 2
                if best is None or score < best[0]: best = (score, yc, zc, w, h, fx)
        if best: break
    if best:
        _, yc, zc, w, h, fx = best
        ad = rnd.choice(ADS_V if h > w else ADS_H)
        add('screen', yc, zc, w, h, fx, ad, ADS_RGB[ad])

    # 2. 竖挑牌：立面两端各一块（后排只放一块）
    for end in ([-1, 1] if not far_row else [rnd.choice([-1, 1])]):
        w, h = rnd.uniform(1.6, 2.0), rnd.choice([8, 9, 10]) * (1.3 if far_row else 1)
        for t in range(20):
            yc = (y0 + 1.5 if end < 0 else y1 - 1.5) - end * rnd.uniform(0, (y1 - y0) * 0.25)
            zc = rnd.uniform(zlo + h / 2, max(zlo + h / 2, min(zhi, 40 if not far_row else 60) - h / 2))
            ds = [depth(yc, zc + dz * h / 2) for dz in (-0.8, 0, 0.8)]
            if any(d is None for d in ds) or not free(yc, zc, 0.6, h): continue
            fx = side * min(side * d for d in ds)
            c = rnd.choice(list(NEON))
            add('blade', yc, zc, w, h, fx, c, NEON[c])
            break

    # 3. 平贴招牌：前排 1~2 块横的，偶尔一块竖的
    for kind in (['hflat'] * (1 + (rnd.random() < 0.5)) + (['vflat'] if rnd.random() < 0.5 else [])) if not far_row else ['hflat']:
        w, h = (rnd.uniform(6, 10), rnd.uniform(1.6, 2.2)) if kind == 'hflat' else (rnd.uniform(1.6, 2.2), rnd.uniform(6, 9))
        if far_row: w, h = w * 1.5, h * 1.5
        for t in range(40):
            yc = rnd.uniform(y0 + w / 2, max(y0 + w / 2, y1 - w / 2))
            zc = rnd.uniform(zlo - 1 + h / 2, max(zlo - 1 + h / 2, min(zhi, 36) - h / 2))
            if not free(yc, zc, w, h): continue
            fx = facade(yc, zc, w, h, 0.6)
            if fx is None: continue
            c = rnd.choice(list(NEON))
            add(kind, yc, zc, w, h, fx, c, NEON[c])
            break

print('@@SIGNS made', made, 'total', len(col.objects))
