# 统一场景光照图烘焙（取代原来逐楼型烘顶点色的 city_bake.py）
# 用法：npm run lightmap（先导出再烘焙），或单独：
#   Blender -b art/city.blend --python tools/blender/scene_bake.py -- <repo_dir>
#   LM_QUICK=1 低采样、小图集试跑；LM_SAMPLES=2048 指定采样
# 输入：
#   art/bake/scene.json + scene.bin + tex/   bake.html 导出的代码生成静态场景（桥、招牌、事故车、程序楼……）
#   art/city.blend 的「KB3D_楼体库」         近景楼楼型，按 src/data/cityLayout.json 摆成每栋一份
# 所有东西放进同一个 Cycles 场景，烘焙漫反射（直接 + 间接，不乘底色）：
#   bridge.exr / bldg.exr        主光照图（天空、路灯、招牌、亮窗、街面上照光）
#   bridge_sc.exr / bldg_sc.exr  通道大屏：每块屏单独用白光烘一遍，存进 RGBA，运行时乘当前广告色
# 产出：public/assets/lightmap/（光照图 + manifest.json）、public/assets/bldg/<楼型>.glb（带第二套 UV + 亮窗顶点色）、src/data/buildings.json
# 只在后台副本里改，不保存 city.blend
import bpy, bmesh, sys, os, math, json, subprocess, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from bpy_extras import bmesh_utils

REPO = sys.argv[sys.argv.index('--') + 1]
BAKE = os.path.join(REPO, 'art', 'bake')
OUT_LM = os.path.join(REPO, 'public', 'assets', 'lightmap')
OUT_BLDG = os.path.join(REPO, 'public', 'assets', 'bldg')
TEX = os.path.join(REPO, 'art', 'bake_tex')   # 导出用的缩小贴图缓存（不提交）
for d in (OUT_LM, OUT_BLDG, TEX): os.makedirs(d, exist_ok=True)

QUICK = os.environ.get('LM_QUICK') == '1'
SAMPLES = int(os.environ.get('LM_SAMPLES', 48 if QUICK else 1024))
SC_SAMPLES = max(16, SAMPLES // 4)      # 通道大屏只有一个光源，采样可以少
BLDG_ATLAS = (2048, 2048) if QUICK else (4096, 4096)
BLDG_DENSITY = 2.5                       # 近景楼每米像素（装不下会整体缩小）
MARGIN = 3                               # 烘焙向外扩的像素（与 charts.js 的 PAD 配合）

# ---- 光源（与 three 同单位：自发光 = 辐亮度；点光 W = 4π × three 的 candela）----
SKY = 4.0            # 夜空：地平线雾色 → 天顶近黑（被城市灯光照亮的雨云）
GROUND_GLOW = 0.3    # 街面暖色上照光（店面、车灯）
E_WIN = 1.0          # 近景楼亮窗
E_LAMP = 2.0         # 楼体自带灯具（灯带、射灯）
E_LET = 1.2          # 楼体自带字牌
LIT_RATIO = 0.2      # 亮窗比例
CELL = (3.0, 3.0, 3.4)
GLASS_ALBEDO = 0.03  # 与 src/modelBuildings.js 一致
RANGE = 4.0          # 亮窗顶点色编码：(v/RANGE)^(1/2.2)
SMALL_ISLAND = 2.0   # 小于这个面积（m²）的零件（空调、窗框……）不占光照图，取最近大面的光照
SMALL_CHART = 1.0    # 展开后小于这个面积的 UV 块（倒角条等）同样处理
TEX_MAX = 1024       # 楼型 GLB 里材质贴图最大边长
EXPOSURE = 1.0       # 写进 manifest 的运行时亮度

LAMP = {'Signs_Lights': (1.0, 0.82, 0.62), 'EmissiveLightMTL': (1.0, 0.9, 0.75)}
WIN_TINTS = [((1.0, 0.62, 0.3), 0.78), ((0.6, 0.78, 1.0), 0.93), ((1.0, 0.3, 0.75), 1.01)]

t_start = time.time()
def log(*a): print('@@', f'[{time.time() - t_start:6.0f}s]', *a, flush=True)

def hex2lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def hash3(i, j, k, seed):
    v = math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed * 19.19) * 43758.5453
    return v - math.floor(v)

scene = bpy.context.scene
data = json.load(open(os.path.join(BAKE, 'scene.json')))
buf = np.fromfile(os.path.join(BAKE, 'scene.bin'), dtype=np.float32)
layout = json.load(open(os.path.join(REPO, 'src', 'data', 'cityLayout.json')))

# ---------------- 只留楼体库 ----------------
lib_col = bpy.data.collections['KB3D_楼体库']
libs = {o.data.name: o for o in lib_col.objects if o.type == 'MESH'}
USED = sorted({b['type'] for b in layout['buildings'] if b['type'] in libs})
for o in list(bpy.data.objects):
    if o not in libs.values(): bpy.data.objects.remove(o, do_unlink=True)
def walk_lc(lc):
    yield lc
    for c in lc.children: yield from walk_lc(c)
for lc in walk_lc(bpy.context.view_layer.layer_collection):
    if lc.collection is lib_col: lc.exclude = False; lc.hide_viewport = False
lib_col.hide_select = False
for name, o in list(libs.items()):
    if name not in USED:
        bpy.data.objects.remove(o, do_unlink=True); del libs[name]; continue
    if o.name not in scene.collection.objects: scene.collection.objects.link(o)   # 楼体库可能不在视图层里
    o.hide_set(False); o.hide_viewport = False; o.hide_select = False
    o.matrix_world = Matrix.Identity(4)
    if o.data.users > 1: o.data = o.data.copy()

# ---------------- 渲染设置 ----------------
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    log('GPU fallback', e)
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 3
scene.cycles.sample_clamp_indirect = 10.0
scene.render.bake.target = 'IMAGE_TEXTURES'
scene.render.bake.use_clear = True
scene.render.bake.margin = MARGIN
scene.render.use_persistent_data = True   # 多次烘焙之间复用 BVH
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1

# 世界：地平线雾色 → 天顶近黑
world = bpy.data.worlds.new('bake_sky'); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
mr = nt.nodes.new('ShaderNodeMapRange'); mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
bg = nt.nodes.new('ShaderNodeBackground'); wout = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.6
nt.links.new(mr.outputs[0], mix.inputs['Factor'])
mix.inputs['A'].default_value = (*hex2lin('#1b2726'), 1); mix.inputs['B'].default_value = (0.002, 0.003, 0.004, 1)
nt.links.new(mix.outputs['Result'], bg.inputs['Color']); bg.inputs['Strength'].default_value = SKY
nt.links.new(bg.outputs[0], wout.inputs[0])
SKY_SOCKET = bg.inputs['Strength']

# 自发光登记：(socket, 主烘焙值)。通道大屏烘焙时全部关掉
EMITTERS = []
SCREEN_MATS = {}   # 通道 → [材质 emission 节点]
RECV_NODES = []    # (图片节点, 图集名)

def new_bsdf_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED')
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Roughness'].default_value = 1.0
    b.inputs['Specular IOR Level'].default_value = 0.0
    return m, b

def add_target(m, atlas):
    img_node = m.node_tree.nodes.new('ShaderNodeTexImage')
    img_node.name = 'LM_TARGET'
    m.node_tree.nodes.active = img_node
    RECV_NODES.append((img_node, atlas))

# ---------------- 近景楼：烘焙材质 + 亮窗 + 第二套 UV ----------------
def split_name(name):
    kind, _, src = name.partition(':')
    return (kind, src) if src else ('std', name)

def base_image(src):
    b = next((n for n in src.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if src.node_tree else None
    if b and b.inputs['Base Color'].is_linked:
        n = b.inputs['Base Color'].links[0].from_node
        if getattr(n, 'image', None): return n.image, (1.0, 1.0, 1.0)
    col = tuple(b.inputs['Base Color'].default_value[:3]) if b else (0.5, 0.5, 0.5)
    return None, col

bake_mats = {}
def make_bake_mat(src):
    if src.name in bake_mats: return bake_mats[src.name]
    kind, sname = split_name(src.name)
    img, col = base_image(src)
    if kind == 'glass': img, col = None, (GLASS_ALBEDO,) * 3
    m, bsdf = new_bsdf_mat('bk_' + src.name)
    n = m.node_tree
    tex = None
    if img:
        tex = n.nodes.new('ShaderNodeTexImage'); tex.image = img
        uvn = n.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
        n.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        n.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*col, 1)
    es = bsdf.inputs['Emission Strength']
    if kind == 'glass':
        es.default_value = 0.0             # 不亮的窗；亮窗换成 lit_glass() 的副本（只让真正发光的三角形当光源，烘得快、噪点少）
    elif kind == 'lamp':
        bsdf.inputs['Emission Color'].default_value = (*LAMP.get(sname, (1.0, 0.85, 0.7)), 1)
        es.default_value = E_LAMP
    elif kind == 'let' and tex:
        n.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
        es.default_value = E_LET
    else:
        es.default_value = 0.0
    EMITTERS.append((es, es.default_value))
    add_target(m, 'bldg')
    info = dict(mat=m, kind=kind, sname=sname, image=img, color=col, src=src.name)
    bake_mats[src.name] = info
    return info

def lit_glass(info):
    key = info['src'] + '#lit'
    if key in bake_mats: return bake_mats[key]
    m = info['mat'].copy(); m.name = info['mat'].name + '_lit'
    n = m.node_tree; bsdf = next(x for x in n.nodes if x.type == 'BSDF_PRINCIPLED')
    at = n.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'WE'
    n.links.new(at.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    EMITTERS.append((bsdf.inputs['Emission Strength'], 1.0))
    RECV_NODES.append((n.nodes['LM_TARGET'], 'bldg'))
    n.nodes.active = n.nodes['LM_TARGET']
    lit = dict(info, mat=m)
    bake_mats[key] = lit
    return lit

def window_colors(ob, glass_idx):
    """玻璃面拆成独立顶点；按窗格（小岛按岛中心，大面按面中心）随机点亮。返回 {vert_index: color}"""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    gfaces = [f for f in bm.faces if f.material_index in glass_idx]
    bmesh.ops.split_edges(bm, edges=list({e for f in gfaces for e in f.edges}))
    bm.faces.ensure_lookup_table()
    gset = set(f.index for f in bm.faces if f.material_index in glass_idx)
    seen, cols = set(), {}
    for f0 in [f for f in bm.faces if f.index in gset]:
        if f0.index in seen: continue
        stack, island = [f0], []
        seen.add(f0.index)
        while stack:
            f = stack.pop(); island.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index in gset and g.index not in seen:
                        seen.add(g.index); stack.append(g)
        pts = [v.co for f in island for v in f.verts]
        ext = max(max(p[a] for p in pts) - min(p[a] for p in pts) for a in range(3))
        groups = [island] if ext < 4.0 else [[f] for f in island]
        for grp in groups:
            c = sum((f.calc_center_median() for f in grp), Vector()) / len(grp)
            i, j, k = (math.floor(c[a] / CELL[a]) for a in range(3))
            if hash3(i, j, k, 1) > LIT_RATIO:
                col = (0, 0, 0)
            else:
                t = hash3(i, j, k, 2)
                tint = next(tc for tc, lim in WIN_TINTS if t < lim)
                s = (0.4 + 0.8 * hash3(i, j, k, 3)) * E_WIN
                col = tuple(v * s for v in tint)
            for f in grp:
                for v in f.verts: cols[v.index] = col
    bm.to_mesh(me); bm.free(); me.update()
    return cols

def uv_area(me, layer):
    n = len(me.loops)
    uv = np.empty(n * 2, dtype=np.float32); me.uv_layers[layer].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    ls = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_total', lt)
    a = 0.0
    for k in range(1, lt.max() - 1):   # 扇形三角化
        sel = lt > k + 1
        p0, p1, p2 = uv[ls[sel]], uv[ls[sel] + k], uv[ls[sel] + k + 1]
        a += np.abs(np.cross(p1 - p0, p2 - p0)).sum() / 2
    return a

type_info = {}
for name in USED:
    ob = libs[name]; me = ob.data
    infos = []
    for slot in ob.material_slots:
        info = make_bake_mat(slot.material); infos.append(info); slot.material = info['mat']
    glass_idx = {i for i, info in enumerate(infos) if info['kind'] == 'glass'}
    wcols = window_colors(ob, glass_idx)
    nv = len(me.vertices)
    we = np.zeros((nv, 4), dtype=np.float32); we[:, 3] = 1
    for vi, c in wcols.items(): we[vi, :3] = c
    # 亮窗的面换到发光的玻璃材质
    lit_slot = {}
    for p in me.polygons:
        if p.material_index in glass_idx and we[list(p.vertices), :3].max() > 0:
            gi = p.material_index
            if gi not in lit_slot:
                me.materials.append(lit_glass(infos[gi])['mat']); lit_slot[gi] = len(me.materials) - 1
            p.material_index = lit_slot[gi]
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    attr = me.color_attributes.new('WE', 'FLOAT_COLOR', 'POINT'); attr.data.foreach_set('color', we.ravel())
    # 第二套 UV：智能投影，按面积均匀分配
    while len(me.uv_layers) > 1: me.uv_layers.remove(me.uv_layers[-1])
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    me.uv_layers[0].name = 'UVMap'
    lm = me.uv_layers.new(name='LM'); me.uv_layers.active = lm
    me.uv_layers[0].active_render = True
    # 按连通性分零件；小零件不展开
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    isl = np.full(len(bm.faces), -1, dtype=np.int32); isl_area = []
    for f0 in bm.faces:
        if isl[f0.index] >= 0: continue
        k = len(isl_area); stack = [f0]; isl[f0.index] = k; a = 0.0
        while stack:
            f = stack.pop(); a += f.calc_area()
            for e in f.edges:
                for g in e.link_faces:
                    if isl[g.index] < 0: isl[g.index] = k; stack.append(g)
        isl_area.append(a)
    bm.free()
    isl_area = np.array(isl_area)
    big = isl_area[isl] >= SMALL_ISLAND
    for o in bpy.context.view_layer.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    ebm = bmesh.from_edit_mesh(me); ebm.faces.ensure_lookup_table()
    for f in ebm.faces: f.select_set(bool(big[f.index]))
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    # 展开出来的碎块太多（倒角、斜面），每块都要留边距，图集利用率只有 1~2%：小块也收到最近大面，剩下的重新装箱
    ebm = bmesh.from_edit_mesh(me); ebm.faces.ensure_lookup_table()
    uvl = ebm.loops.layers.uv['LM']
    for chart in bmesh_utils.bmesh_linked_uv_islands(ebm, uvl):
        if sum(f.calc_area() for f in chart) < SMALL_CHART:
            for f in chart: big[f.index] = False
    for f in ebm.faces: f.select_set(bool(big[f.index]))
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.pack_islands(margin_method='FRACTION', margin=0.003, rotate=True, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    # 小零件：整块 UV 收到最近大面的中心（光照取所贴墙面的值）
    uvd = np.empty(len(me.loops) * 2, dtype=np.float32); me.uv_layers['LM'].data.foreach_get('uv', uvd); uvd = uvd.reshape(-1, 2)
    ls = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_total', lt)
    big_idx = np.nonzero(big)[0]
    if len(big_idx) and not big.all():
        verts = [v.co for v in me.vertices]
        tree = BVHTree.FromPolygons(verts, [list(me.polygons[int(i)].vertices) for i in big_idx])
        centers = {}
        for i in np.nonzero(~big)[0]:
            c = centers.setdefault(isl[i], [Vector(), 0])
            c[0] += me.polygons[int(i)].center; c[1] += 1
        target = {}
        for k, (c, nf) in centers.items():
            hit = tree.find_nearest(c / nf)
            j = int(big_idx[hit[2]]) if hit[2] is not None else int(big_idx[0])
            target[k] = uvd[ls[j]:ls[j] + lt[j]].mean(axis=0)
        for i in np.nonzero(~big)[0]:
            uvd[ls[i]:ls[i] + lt[i]] = target[isl[i]]
        me.uv_layers['LM'].data.foreach_set('uv', uvd.ravel())
    area = sum(p.area for p in me.polygons if big[p.index])
    type_info[name] = dict(area=area, cover=max(uv_area(me, 'LM'), 1e-3), wverts=we)
    log('楼型', name, f'{len(me.polygons)} 面', f'面积 {area:.0f} m²', f'UV 覆盖 {type_info[name]["cover"]:.2f}')

# 每栋楼在图集里一块正方形区域（按表面积给边长），货架装箱
W, H = BLDG_ATLAS
blds = [b for b in layout['buildings'] if b['type'] in libs]
need = [math.sqrt(type_info[b['type']]['area'] / type_info[b['type']]['cover']) * BLDG_DENSITY for b in blds]
def pack_rects(scale):
    out, x, y, row = [None] * len(blds), 0, 0, 0
    for i in sorted(range(len(blds)), key=lambda i: -need[i]):
        s = max(16, int(need[i] * scale))
        if s + 4 > W: return None
        if x + s + 4 > W: x, y, row = 0, y + row, 0
        if y + s + 4 > H: return None
        out[i] = (x + 2, y + 2, s); x += s + 4; row = max(row, s + 4)
    return out
scale = 1.0
while True:
    rects = pack_rects(scale)
    if rects: break
    scale *= 0.95
log(f'近景楼图集 {W}×{H}，密度 {BLDG_DENSITY * scale:.2f} px/m')

lib_hidden = []
rect_out = {}
recv_objs = []
for b, (x, y, s) in zip(blds, rects):
    lib = libs[b['type']]
    inst = bpy.data.objects.new(b['name'], lib.data.copy())
    scene.collection.objects.link(inst)
    p = b['pos']
    inst.matrix_world = Matrix.Translation((p[0], -p[2], p[1])) @ Matrix.Rotation(b['yaw'], 4, 'Z')
    me = inst.data
    uv = np.empty(len(me.loops) * 2, dtype=np.float32); me.uv_layers['LM'].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2) * (s / W, s / H) + (x / W, y / H)
    me.uv_layers['LM'].data.foreach_set('uv', uv.ravel()); me.uv_layers.active = me.uv_layers['LM']
    rect_out[b['name']] = [round(x / W, 6), round(y / H, 6), round(s / W, 6), round(s / H, 6)]
    recv_objs.append(inst)
for o in libs.values(): o.hide_render = True

# ---------------- 代码生成的静态场景 ----------------
def emit_tex_node(m, path):
    img = bpy.data.images.load(os.path.join(BAKE, path), check_existing=True)
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    uvn = m.node_tree.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    m.node_tree.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    return t

js_mats = {}
def js_mat(idx, kind, ground=False):
    key = (idx, kind, ground)
    if key in js_mats: return js_mats[key]
    d = data['materials'][idx]
    m, b = new_bsdf_mat(f'js{idx}_{kind}')
    b.inputs['Base Color'].default_value = (*d['albedo'], 1)
    es = b.inputs['Emission Strength']
    emit = d['emit']
    if 'channel' in d:
        SCREEN_MATS.setdefault(d['channel'], []).append((b, d['gain']))
        b.inputs['Emission Color'].default_value = (*emit, 1)
        es.default_value = 0.0             # 通道大屏不进主图
        EMITTERS.append((es, 0.0))
    elif max(emit) > 0:
        if d.get('emitTex'):
            t = emit_tex_node(m, d['emitTex'])
            mm = m.node_tree.nodes.new('ShaderNodeMix'); mm.data_type = 'RGBA'; mm.blend_type = 'MULTIPLY'
            mm.inputs['Factor'].default_value = 1.0
            m.node_tree.links.new(t.outputs['Color'], mm.inputs['A']); mm.inputs['B'].default_value = (*emit, 1)
            m.node_tree.links.new(mm.outputs['Result'], b.inputs['Emission Color'])
        else:
            b.inputs['Emission Color'].default_value = (*emit, 1)
        es.default_value = 1.0
        EMITTERS.append((es, 1.0))
    if ground:
        b.inputs['Emission Color'].default_value = (1.0, 0.55, 0.28, 1); es.default_value = GROUND_GLOW
        EMITTERS.append((es, GROUND_GLOW))
    if kind == 'recv': add_target(m, 'bridge')
    js_mats[key] = m
    return m

def make_mesh(name, P, U0, U1):
    n = len(P) // 9
    me = bpy.data.meshes.new(name)
    me.vertices.add(n * 3); me.vertices.foreach_set('co', P)
    me.loops.add(n * 3); me.loops.foreach_set('vertex_index', np.arange(n * 3, dtype=np.int32))
    me.polygons.add(n); me.polygons.foreach_set('loop_start', np.arange(0, n * 3, 3, dtype=np.int32))
    if U0 is not None:
        l = me.uv_layers.new(name='UVMap'); l.data.foreach_set('uv', U0)
    if U1 is not None:
        l = me.uv_layers.new(name='LM'); l.data.foreach_set('uv', U1); me.uv_layers.active = l
    me.update(calc_edges=True)
    return me

# 按（类型, 材质）合并成少量大网格
groups = {}
for o in data['objects']:
    ground = o['name'].startswith('ground')
    groups.setdefault((o['kind'], o['mat'], ground), []).append(o)
for (kind, mi, ground), objs in groups.items():
    P = np.concatenate([buf[o['pos']:o['pos'] + o['tris'] * 9] for o in objs])
    has0 = all(o['uv0'] >= 0 for o in objs)
    U0 = np.concatenate([buf[o['uv0']:o['uv0'] + o['tris'] * 6] for o in objs]) if has0 else None
    U1 = np.concatenate([buf[o['uv1']:o['uv1'] + o['tris'] * 6] for o in objs]) if kind == 'recv' else None
    me = make_mesh(f'js_{kind}_{mi}', P, U0, U1)
    me.materials.append(js_mat(mi, kind, ground))
    ob = bpy.data.objects.new(me.name, me); scene.collection.objects.link(ob)
    if kind == 'recv': recv_objs.append(ob)
log('导入代码场景', len(data['objects']), '个物体 →', len(groups), '个网格')

# Blender 烘焙按「每个接收物体 × 整张图」跑一遍，接收面按图集各合成一个物体（20 多个物体时开销是几十倍）
def join(objs, name):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]
_js = [o for o in recv_objs if o.name.startswith('js_')]
_bl = [o for o in recv_objs if not o.name.startswith('js_')]
recv_objs = [join(_js, 'recv_bridge'), join(_bl, 'recv_bldg')]
for o in recv_objs: o.data.uv_layers.active = o.data.uv_layers['LM']

# 路灯
LIGHTS = []
for i, l in enumerate(data['lights']):
    ld = bpy.data.lights.new(f'street{i}', 'POINT')
    ld.energy = 4 * math.pi * l['intensity']
    ld.color = l['color']
    ld.shadow_soft_size = l['radius']
    lo = bpy.data.objects.new(ld.name, ld); scene.collection.objects.link(lo); lo.location = l['pos']
    LIGHTS.append(ld)

# ---------------- 烘焙 ----------------
ATLAS_SIZE = {'bridge': (data['atlases']['bridge']['width'], data['atlases']['bridge']['height']), 'bldg': BLDG_ATLAS}
if QUICK: ATLAS_SIZE['bridge'] = tuple(v // 2 for v in ATLAS_SIZE['bridge'])

def new_images(tag):
    return {a: bpy.data.images.new(f'LM_{a}_{tag}', w, h, alpha=True, float_buffer=True) for a, (w, h) in ATLAS_SIZE.items()}

# OIDN 降噪：用合成器（单独的空场景）对烘焙结果跑 Denoise 节点
DN_TMP = os.path.join(BAKE, '_dn_in.exr'), os.path.join(BAKE, '_dn_out.exr')
dn_scene = bpy.data.scenes.new('lm_denoise')
dn_scene.render.engine = 'BLENDER_WORKBENCH'
dn_scene.view_settings.view_transform = 'Standard'
_cam = bpy.data.objects.new('dn_cam', bpy.data.cameras.new('dn_cam')); dn_scene.collection.objects.link(_cam); dn_scene.camera = _cam
_ng = bpy.data.node_groups.new('lm_denoise', 'CompositorNodeTree'); dn_scene.compositing_node_group = _ng
_ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
_dn_img = _ng.nodes.new('CompositorNodeImage'); _dn = _ng.nodes.new('CompositorNodeDenoise'); _out = _ng.nodes.new('NodeGroupOutput')
_ng.links.new(_dn_img.outputs['Image'], _dn.inputs['Image']); _ng.links.new(_dn.outputs['Image'], _out.inputs[0])
def denoise(px):
    h, w = px.shape[:2]
    out = px.copy()
    for chans in ([0, 1, 2], [3]) if px[:, :, 3].max() > 0 and not np.allclose(px[:, :, 3], 1) else ([0, 1, 2],):
        src = np.zeros_like(px); src[:, :, 3] = 1
        src[:, :, :3] = px[:, :, chans] if len(chans) == 3 else px[:, :, chans * 3]
        img = bpy.data.images.new('dn_in', w, h, alpha=True, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(src.ravel()); img.filepath_raw = DN_TMP[0]; img.file_format = 'OPEN_EXR'; img.save()
        bpy.data.images.remove(img)
        _dn_img.image = bpy.data.images.load(DN_TMP[0], check_existing=False)
        dn_scene.render.resolution_x, dn_scene.render.resolution_y, dn_scene.render.resolution_percentage = w, h, 100
        st = dn_scene.render.image_settings; st.file_format = 'OPEN_EXR'; st.color_depth = '32'; st.color_mode = 'RGBA'
        dn_scene.render.filepath = DN_TMP[1]
        bpy.ops.render.render(write_still=True, scene=dn_scene.name)
        r = bpy.data.images.load(DN_TMP[1], check_existing=False)
        d = np.empty(w * h * 4, dtype=np.float32); r.pixels.foreach_get(d); d = d.reshape(h, w, 4)
        bpy.data.images.remove(r); bpy.data.images.remove(_dn_img.image)
        # 只替换原本有内容的像素（不把空白处填上颜色）
        mask = px[:, :, :3].max(axis=2, keepdims=True) > 0 if len(chans) == 3 else (px[:, :, 3:4] > 0)
        if len(chans) == 3: out[:, :, :3] = np.where(mask, np.maximum(d[:, :, :3], 0), px[:, :, :3])
        else: out[:, :, 3:4] = np.where(mask, np.maximum(d[:, :, :3].mean(axis=2, keepdims=True), 0), px[:, :, 3:4])
    return out

def bake_into(imgs, samples):
    for node, a in RECV_NODES: node.image = imgs[a]
    scene.cycles.samples = samples
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in recv_objs: o.select_set(True)
    bpy.context.view_layer.objects.active = recv_objs[0]
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=MARGIN, use_clear=True)
    out = {}
    for a, img in imgs.items():
        px = np.empty(len(img.pixels), dtype=np.float32); img.pixels.foreach_get(px)
        out[a] = px.reshape(img.size[1], img.size[0], 4)
    return out

def denoise_all(res):
    return {a: denoise(px) for a, px in res.items()}

log('主烘焙', SAMPLES, '采样')
main = denoise_all(bake_into(new_images('main'), SAMPLES))
log('主烘焙完成')

channels = sorted(SCREEN_MATS)
sc = {a: np.zeros((h, w, 4), dtype=np.float32) for a, (w, h) in ATLAS_SIZE.items()}
if channels:
    SKY_SOCKET.default_value = 0
    energy = [ld.energy for ld in LIGHTS]
    for ld in LIGHTS: ld.energy = 0
    for s, _ in EMITTERS: s.default_value = 0
    for c in channels:
        for b, gain in SCREEN_MATS[c]:
            b.inputs['Emission Color'].default_value = (1, 1, 1, 1); b.inputs['Emission Strength'].default_value = gain
        log('通道大屏', c, SC_SAMPLES, '采样')
        res = denoise_all(bake_into(new_images(f'sc{c}'), SC_SAMPLES))
        for a in sc: sc[a][:, :, c] = res[a][:, :, :3].mean(axis=2)
        for b, _ in SCREEN_MATS[c]: b.inputs['Emission Strength'].default_value = 0
    SKY_SOCKET.default_value = SKY
    for ld, e in zip(LIGHTS, energy): ld.energy = e
    for s, v in EMITTERS: s.default_value = v

# ---------------- 动态物体探针（L2 球谐） ----------------
# 每个探针放一个小球（42 个顶点，法线朝四面八方），漫反射烘到顶点色 = 各方向的辐照度 / π，
# 再用最小二乘拟合成 three 的 LightProbeGrid 用的 9 个辐亮度球谐系数（three 世界坐标：y 向上）
PROBES = dict(min=[-10.0, 20.4, -50.0], max=[10.0, 27.4, 72.0], res=[6, 3, 21])
def bake_probes():
    nx, ny, nz = PROBES['res']
    lo, hi = PROBES['min'], PROBES['max']
    pts = []
    deps = bpy.context.evaluated_depsgraph_get()
    for iz in range(nz):
        for iy in range(ny):
            for ix in range(nx):
                t = [lo[a] + (hi[a] - lo[a]) * i / (n - 1) for a, i, n in ((0, ix, nx), (1, iy, ny), (2, iz, nz))]
                p = Vector((t[0], -t[2], t[1]))
                for _ in range(3):   # 在实体里（车身、桥面）就往上挪
                    inside = 0
                    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                        hit, loc, nrm, *_ = scene.ray_cast(deps, p, Vector(d), distance=4.0)
                        if hit and nrm.dot(Vector(d)) > 0: inside += 1
                    if inside < 3: break
                    p.z += 1.2
                pts.append(p)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.04)
    sphere = [v.co.copy() for v in bm.verts]
    tris = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    nv = len(sphere)
    verts = [p + c for p in pts for c in sphere]
    faces = [[i * nv + k for k in f] for i in range(len(pts)) for f in tris]
    me = bpy.data.meshes.new('probes'); me.from_pydata(verts, [], faces); me.shade_smooth()
    m, _ = new_bsdf_mat('probe'); me.materials.append(m)
    pr = me.color_attributes.new('PR', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = pr
    ob = bpy.data.objects.new('probes', me); scene.collection.objects.link(ob)
    ob.visible_shadow = False; ob.visible_diffuse = False; ob.visible_glossy = False; ob.visible_transmission = False
    for o in bpy.context.view_layer.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    scene.render.bake.target = 'VERTEX_COLORS'
    scene.cycles.samples = max(64, SAMPLES // 2)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    scene.render.bake.target = 'IMAGE_TEXTURES'
    col = np.empty(len(me.vertices) * 4, dtype=np.float32); pr.data.foreach_get('color', col)
    E = col.reshape(len(pts), nv, 4)[:, :, :3] * math.pi
    # 基函数（three 坐标：Blender (x, y, z) → three (x, z, -y)）乘余弦卷积系数
    n = np.array([[c.x, c.z, -c.y] for c in sphere]); n /= np.linalg.norm(n, axis=1, keepdims=True)
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    A0, A1, A2 = math.pi, 2 * math.pi / 3, math.pi / 4
    M = np.stack([A0 * 0.282095 * np.ones_like(x), A1 * 0.488603 * y, A1 * 0.488603 * z, A1 * 0.488603 * x,
                  A2 * 1.092548 * x * y, A2 * 1.092548 * y * z, A2 * 0.315392 * (3 * z * z - 1), A2 * 1.092548 * x * z,
                  A2 * 0.546274 * (x * x - y * y)], axis=1)
    pinv = np.linalg.pinv(M)
    sh = np.einsum('cv,pvk->pck', pinv, E).astype(np.float32)   # (探针, 9, rgb)
    sh.tofile(os.path.join(OUT_LM, 'probes.bin'))
    bpy.data.objects.remove(ob, do_unlink=True)
    log('探针', len(pts), '个，平均辐照度', float(E.mean()))
    return dict(PROBES, file='probes.bin')

def save_exr(px, path, channels_rgba):
    h, w = px.shape[:2]
    img = bpy.data.images.new('save', w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    p = px.copy()
    if not channels_rgba: p[:, :, 3] = 1
    img.pixels.foreach_set(p.ravel())
    s = scene.render.image_settings
    s.file_format = 'OPEN_EXR'; s.color_depth = '16'; s.exr_codec = 'DWAA'
    s.color_mode = 'RGBA' if channels_rgba else 'RGB'
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    log('写出', os.path.relpath(path, REPO), os.path.getsize(path) // 1024, 'KB')

log('探针烘焙')
probe_info = bake_probes()

atlases = {}
for a in ATLAS_SIZE:
    save_exr(main[a], os.path.join(OUT_LM, f'{a}.exr'), False)
    entry = dict(file=f'{a}.exr')
    if channels:
        save_exr(sc[a], os.path.join(OUT_LM, f'{a}_sc.exr'), True)
        entry['screens'] = f'{a}_sc.exr'
    atlases[a] = entry
    p99 = float(np.percentile(main[a][:, :, :3], 99)); med = float(np.median(main[a][:, :, :3][main[a][:, :, :3] > 0]))
    log(f'  {a}: 中位 {med:.4f}  p99 {p99:.3f}')
atlases['bridge']['hash'] = data['atlases']['bridge']['hash']
atlases['bldg']['rects'] = rect_out
manifest = dict(version=1, exposure=EXPOSURE, samples=SAMPLES, quick=QUICK, atlases=atlases, screens=data['screens'], probes=probe_info,
                time=time.strftime('%Y-%m-%d %H:%M'))
with open(os.path.join(OUT_LM, 'manifest.json'), 'w') as f: json.dump(manifest, f, ensure_ascii=False, indent=1)

# ---------------- 导出楼型 GLB（第二套 UV + 亮窗顶点色，简单材质） ----------------
def small_image(img):
    path = os.path.join(TEX, f'{bpy.path.clean_name(img.name)}.jpg')
    if not os.path.exists(path):
        c = img.copy()
        w, h = c.size
        s = min(1.0, TEX_MAX / max(w, h))
        if s < 1: c.scale(max(1, int(w * s)), max(1, int(h * s)))
        png = path.replace('.jpg', '.png')
        c.filepath_raw = png; c.file_format = 'PNG'; c.save()
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', png, '--out', path], check=True, capture_output=True)
        os.remove(png)
        bpy.data.images.remove(c)
    return bpy.data.images.load(path, check_existing=True)

export_mats = {}
def export_mat(info):
    if info['src'] in export_mats: return export_mats[info['src']]
    m = bpy.data.materials.new(f"{info['kind']}:{info['sname']}"); m.use_nodes = True
    n = m.node_tree; b = next(x for x in n.nodes if x.type == 'BSDF_PRINCIPLED')
    b.inputs['Metallic'].default_value = 0; b.inputs['Roughness'].default_value = 1
    if info['image']:
        t = n.nodes.new('ShaderNodeTexImage'); t.image = small_image(info['image'])
        uvn = n.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
        n.links.new(uvn.outputs['UV'], t.inputs['Vector'])
        n.links.new(t.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*info['color'], 1)
    if info['kind'] == 'lamp':
        b.inputs['Emission Color'].default_value = (*LAMP.get(info['sname'], (1.0, 0.85, 0.7)), 1); b.inputs['Emission Strength'].default_value = 1
    export_mats[info['src']] = m
    return m

buildings = {}
for name in USED:
    ob = libs[name]; me = ob.data
    ob.hide_render = False
    ob.name = name
    we = type_info[name]['wverts'].copy()
    we[:, :3] = np.clip(we[:, :3] / RANGE, 0, 1) ** (1 / 2.2)
    me.color_attributes['WE'].data.foreach_set('color', we.ravel())
    for slot in ob.material_slots:
        slot.material = export_mat(next(i for i in bake_mats.values() if i['mat'] == slot.material))
    for o in bpy.context.view_layer.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    path = os.path.join(OUT_BLDG, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_image_quality=85,
        export_vertex_color='NAME', export_vertex_color_name='WE', export_all_vertex_colors=False,
        export_draco_mesh_compression_enable=True, export_draco_color_quantization=12, export_draco_position_quantization=14,
        export_draco_texcoord_quantization=14,
        export_yup=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
    )
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    xs, ys, zs = co[:, 0], co[:, 1], co[:, 2]
    buildings[name] = dict(
        file=f'assets/bldg/{name}.glb',
        width=round(float(xs.max() - xs.min()), 2), depth=round(float(ys.max() - ys.min()), 2), height=round(float(zs.max()), 2),
        bounds=[round(float(xs.min()), 2), round(float(xs.max()), 2), round(float(ys.min()), 2), round(float(ys.max()), 2)],
        range=RANGE, lightmap=True,
    )
    log('导出楼型', name, os.path.getsize(path) // 1024, 'KB')

mpath = os.path.join(REPO, 'src', 'data', 'buildings.json')
old = json.load(open(mpath)) if os.path.exists(mpath) else {}
old.update(buildings)
with open(mpath, 'w') as f:
    json.dump(dict(sorted(old.items())), f, ensure_ascii=False, indent=1)
log('完成')
