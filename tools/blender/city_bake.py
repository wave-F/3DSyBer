# 近景楼楼体烘焙与导出（从 art/city.blend 的「KB3D_楼体库」）
# 用法：Blender -b art/city.blend --python tools/blender/city_bake.py -- <repo_dir>
#   只烘部分楼：KB3D_ONLY=tower02,capsule；降低采样试跑：KB3D_SAMPLES=64
# 光照用 Cycles 烘焙到顶点色（LM），亮窗颜色直接合进玻璃顶点，运行时无光照计算
# 招牌补光不烘焙（招牌是每栋楼单独摆的，楼型网格共享），改在运行时按招牌位置加
# 产出：public/assets/bldg/<楼型>.glb，src/data/buildings.json（尺寸）
# 只在后台副本里改，不保存 city.blend
import bpy, bmesh, sys, os, math, json, subprocess
import numpy as np
from mathutils import Vector, Matrix

REPO = sys.argv[sys.argv.index('--') + 1]
OUT = os.path.join(REPO, 'public', 'assets', 'bldg')
TEX = os.path.join(REPO, 'art', 'bake_tex')   # 导出用的缩小贴图缓存（不提交）
os.makedirs(OUT, exist_ok=True); os.makedirs(TEX, exist_ok=True)

SAMPLES = int(os.environ.get('KB3D_SAMPLES', 512))
RANGE = 4.0          # 顶点色编码：存 (v/RANGE)^(1/2.2)，运行时解码
TEX_MAX = 1024       # 材质贴图最大边长

# ---- 光源强度（比例关系决定观感，整体亮度在运行时调）----
SKY = 1.2            # 夜空/雾色环境光
GROUND_GLOW = 0.15   # 街面暖色上照光
E_WIN = 1.0          # 亮窗
E_LAMP = 2.0         # 楼体自带灯具（灯带、射灯）
E_LET = 1.2          # 楼体自带字牌
LIT_RATIO = 0.2      # 亮窗比例
CELL = (3.0, 3.0, 3.4)
GLASS_ALBEDO = 0.03

LAMP = {'Signs_Lights': (1.0, 0.82, 0.62), 'EmissiveLightMTL': (1.0, 0.9, 0.75)}
WIN_TINTS = [((1.0, 0.62, 0.3), 0.78), ((0.6, 0.78, 1.0), 0.93), ((1.0, 0.3, 0.75), 1.01)]

def hex2lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def hash3(i, j, k, seed):
    v = math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed * 19.19) * 43758.5453
    return v - math.floor(v)

scene = bpy.context.scene

# ---- 只留楼体库 ----
lib_col = bpy.data.collections['KB3D_楼体库']
libs = {o.data.name: o for o in lib_col.objects if o.type == 'MESH'}
only = os.environ.get('KB3D_ONLY')
NAMES = sorted(n for n in libs if not only or n in only.split(','))
for o in list(bpy.data.objects):
    if o not in libs.values(): bpy.data.objects.remove(o, do_unlink=True)
def walk_lc(lc):
    yield lc
    for c in lc.children: yield from walk_lc(c)
for lc in walk_lc(bpy.context.view_layer.layer_collection):
    if lc.collection is lib_col: lc.exclude = False; lc.hide_viewport = False
lib_col.hide_select = False
for o in libs.values():
    o.hide_set(False); o.hide_viewport = False; o.hide_select = False
    o.matrix_world = Matrix.Identity(4)
    # 关联复制的网格在这里只剩楼体库一个用户，可以直接改
    if o.data.users > 1: o.data = o.data.copy()

scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('@@GPU fallback', e)
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 4
scene.render.bake.target = 'VERTEX_COLORS'
scene.render.bake.use_clear = True

# ---- 世界：地平线雾色 → 天顶近黑 ----
world = bpy.data.worlds.new('bake_sky'); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
mr = nt.nodes.new('ShaderNodeMapRange'); mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
bg = nt.nodes.new('ShaderNodeBackground'); out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.6
nt.links.new(mr.outputs[0], mix.inputs['Factor'])
mix.inputs['A'].default_value = (*hex2lin('#1b2726'), 1); mix.inputs['B'].default_value = (0.002, 0.003, 0.004, 1)
nt.links.new(mix.outputs['Result'], bg.inputs['Color']); bg.inputs['Strength'].default_value = SKY
nt.links.new(bg.outputs[0], out.inputs[0])

# 地面：深色 + 微弱暖色上照
bpy.ops.mesh.primitive_plane_add(size=800, location=(0, 0, -0.05))
ground = bpy.context.active_object; ground.name = '_ground'
gm = bpy.data.materials.new('_ground'); gm.use_nodes = True
gb = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
gb.inputs['Base Color'].default_value = (0.03, 0.03, 0.03, 1)
gb.inputs['Emission Color'].default_value = (1.0, 0.55, 0.28, 1); gb.inputs['Emission Strength'].default_value = GROUND_GLOW
ground.data.materials.append(gm)

# ---- 烘焙材质：去掉金属/高光，只保留底色 + 自发光 ----
# city.blend 的材质名已带类别前缀（std/glass/lamp/let），这里沿用
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

bake_mats = {}   # 原材质名 -> info
def make_bake_mat(src):
    if src.name in bake_mats: return bake_mats[src.name]
    kind, sname = split_name(src.name)
    img, col = base_image(src)
    if kind == 'glass': img, col = None, (GLASS_ALBEDO,) * 3
    m = bpy.data.materials.new('bk_' + src.name); m.use_nodes = True
    n = m.node_tree; bsdf = next(x for x in n.nodes if x.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    tex = None
    if img:
        tex = n.nodes.new('ShaderNodeTexImage'); tex.image = img
        n.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*col, 1)
    if kind == 'glass':
        at = n.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'WE'
        n.links.new(at.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 1.0
    elif kind == 'lamp':
        bsdf.inputs['Emission Color'].default_value = (*LAMP.get(sname, (1.0, 0.85, 0.7)), 1)
        bsdf.inputs['Emission Strength'].default_value = E_LAMP
    elif kind == 'let' and tex:
        n.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = E_LET
    info = dict(mat=m, kind=kind, sname=sname, image=img, color=col, src=src.name)
    bake_mats[src.name] = info
    return info

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

manifest = {}
for name in NAMES:
    ob = libs[name]
    me = ob.data
    for o in scene.objects: o.hide_render = o not in (ob, ground)
    infos = []
    for slot in ob.material_slots:
        info = make_bake_mat(slot.material)
        infos.append(info); slot.material = info['mat']
    glass_idx = {i for i, info in enumerate(infos) if info['kind'] == 'glass'}

    # 亮窗：写入顶点色 WE（烘焙时作为玻璃自发光）
    wcols = window_colors(ob, glass_idx)
    nv = len(me.vertices)
    we = np.zeros((nv, 4), dtype=np.float32); we[:, 3] = 1
    for vi, c in wcols.items(): we[vi, :3] = c
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    attr = me.color_attributes.new('WE', 'FLOAT_COLOR', 'POINT'); attr.data.foreach_set('color', we.ravel())
    lm = me.color_attributes.new('LM', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = lm

    for o in scene.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob

    # 光照：漫反射的直接 + 间接光，不乘底色
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    lmv = np.empty(nv * 4, dtype=np.float32); lm.data.foreach_get('color', lmv); lmv = lmv.reshape(-1, 4)
    print('@@BAKED', name, 'mean', float(lmv[:, :3].mean()), 'p50', float(np.median(lmv[:, :3])), 'p99', float(np.percentile(lmv[:, :3], 99)), flush=True)

    # 玻璃顶点：最终颜色 = 光照 × 玻璃底色 + 亮窗（运行时直接输出）
    gverts = np.zeros(nv, dtype=bool)
    for p in me.polygons:
        if p.material_index in glass_idx: gverts[list(p.vertices)] = True
    lmv[gverts, :3] = lmv[gverts, :3] * GLASS_ALBEDO + we[gverts, :3]
    enc = lmv.copy()
    enc[:, :3] = np.clip(enc[:, :3] / RANGE, 0, 1) ** (1 / 2.2); enc[:, 3] = 1
    lm.data.foreach_set('color', enc.ravel())
    me.color_attributes.remove(me.color_attributes['WE'])

    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    xs, ys, zs = co[:, 0], co[:, 1], co[:, 2]
    manifest[name] = dict(
        file=f'assets/bldg/{name}.glb',
        width=round(float(xs.max() - xs.min()), 2), depth=round(float(ys.max() - ys.min()), 2), height=round(float(zs.max()), 2),
        bounds=[round(float(xs.min()), 2), round(float(xs.max()), 2), round(float(ys.min()), 2), round(float(ys.max()), 2)],
        range=RANGE,
    )

# ---- 导出：简单材质（底色 + 自发光），名字带类别前缀，运行时据此替换 ----
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
        n.links.new(t.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*info['color'], 1)
    if info['kind'] == 'lamp':
        b.inputs['Emission Color'].default_value = (*LAMP.get(info['sname'], (1.0, 0.85, 0.7)), 1); b.inputs['Emission Strength'].default_value = 1
    export_mats[info['src']] = m
    return m

bpy.data.objects.remove(ground, do_unlink=True)
for name in NAMES:
    ob = libs[name]
    ob.name = name
    for slot in ob.material_slots:
        slot.material = export_mat(next(i for i in bake_mats.values() if i['mat'] == slot.material))
    for o in scene.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_image_quality=85,
        export_vertex_color='NAME', export_vertex_color_name='LM', export_all_vertex_colors=False,
        export_draco_mesh_compression_enable=True, export_draco_color_quantization=12, export_draco_position_quantization=14,
        export_yup=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
    )
    print('@@EXPORT', name, os.path.getsize(path) // 1024, 'KB', flush=True)

mpath = os.path.join(REPO, 'src', 'data', 'buildings.json')
old = json.load(open(mpath)) if os.path.exists(mpath) and only else {}
old.update(manifest)
with open(mpath, 'w') as f:
    json.dump(dict(sorted(old.items())), f, ensure_ascii=False, indent=1)
print('@@DONE')
