# 搭建近景楼场景 art/city.blend（Blender 当关卡编辑器用）
# 用法：Blender -b K044——赛博朋克建筑大楼模型.blend --python tools/blender/build_city.py -- <repo_dir>
#
# 坐标约定：Blender (x, y, z) = 游戏 three.js (x, -z, y)
#   桥沿 Blender Y 轴，桥面高 20m；游戏右侧（车所在一侧）= Blender +X
# 集合：
#   KB3D_楼体库  每栋楼合并成一个物体，正面朝 -Y，原点在占地中心地面（不显示，只被引用）
#   近景楼_右/左  楼体库的关联复制（共享网格），游戏导出时只导出这两个集合
#   参照_游戏     桥、车、警戒线的简易外形，只用来对位置，不导出
import bpy, sys, os, math, re, random
from mathutils import Vector, Matrix

REPO = sys.argv[sys.argv.index('--') + 1]
ART = os.path.join(REPO, 'art')
TEX = os.path.join(ART, 'tex')
os.makedirs(TEX, exist_ok=True)

UNIT = 100.0          # KB3D 原始顶点 1 单位 = 100 米（物体上的 0.001 缩放是导入错误）
TEX_MAX = 2048
GLASS = {'Glass', 'Material #25', 'Window', 'GlsBlack', 'GlsE', 'GlsF'}
LAMP = {'Signs_Lights': (1.0, 0.82, 0.62), 'EmissiveLightMTL': (1.0, 0.9, 0.75)}
LETTERS = {'Characters'}
BANNER = {'Pic_Banners'}   # 原贴图带 KitBash3D 商标

# 楼体库：组名、丢弃部件、目标面数
LIB = {
    'tower02':  dict(group='_GROUP_006_grp', drop=[], tris=100000),
    'tower08':  dict(group='_GROUP_007_grp', drop=[], tris=100000),
    'tower03':  dict(group='_GROUP_008_grp', drop=[], tris=90000),
    'capsule':  dict(group='_GROUP_011_grp', drop=[r'Ext_Floor_Ground', r'TrashCan'], tris=80000),
    'bldgM':    dict(group='_GROUP_009_grp', drop=[r'SpeedwayTiles'], tris=80000),
    'bldgLG':   dict(group='_GROUP_002_grp', drop=[r'SpeedwayTiles'], tris=100000),
    'bldgS':    dict(group='_GROUP_012_grp', drop=[r'SpeedwayTiles'], tris=60000),
    'midrise':  dict(group='_GROUP_005_grp', drop=[], tris=60000),
    'towerL':   dict(group='_GROUP_010_grp', drop=[r'SpeedwayTiles'], tris=80000),
    'towerC':   dict(group='_GROUP_004_grp', drop=[r'SpeedwayTiles'], tris=120000),
}

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
def g2b(x, y, z): return Vector((x, -z, y))   # 游戏坐标 → Blender

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

# ---------------- 1. 楼体库 ----------------
lib_col = bpy.data.collections.new('KB3D_楼体库')
scene.collection.children.link(lib_col)
lib = {}
for name, cfg in LIB.items():
    root = bpy.data.objects[cfg['group']]
    objs = [o for o in root.children_recursive if o.type == 'MESH' and not any(re.search(p, o.name) for p in cfg['drop'])]
    for o in objs:
        o.animation_data_clear()
        o.parent = None
        o.matrix_parent_inverse.identity()
        o.matrix_world = Matrix.Scale(UNIT, 4)
        if o.data.users > 1: o.data = o.data.copy()
    bpy.context.view_layer.update()
    # 多材质重件按材质拆开，玻璃不减面
    for o in list(objs):
        if tris(o) > 4000 and len(o.material_slots) > 1:
            for x in bpy.context.view_layer.objects: x.select_set(False)
            o.select_set(True); bpy.context.view_layer.objects.active = o
            before = set(bpy.data.objects)
            bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
            objs += [x for x in bpy.data.objects if x not in before]
    is_glass = lambda o: any(s.material and s.material.name in GLASS for s in o.material_slots)
    heavy_o = lambda o: tris(o) > 4000 and not is_glass(o)
    total = sum(tris(o) for o in objs); heavy = sum(tris(o) for o in objs if heavy_o(o))
    k = 1.0 if total <= cfg['tris'] else max(0.06, (cfg['tris'] - (total - heavy)) / max(1, heavy))
    for o in objs:
        if heavy_o(o) and k < 1:
            m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = k
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=m.name)
    main = max(objs, key=lambda o: len(o.data.polygons))
    with bpy.context.temp_override(active_object=main, selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    ob = main; ob.name = 'LIB_' + name; ob.data.name = name
    with bpy.context.temp_override(object=ob, active_object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = ob.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    me.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0)))
    for c in list(ob.users_collection): c.objects.unlink(ob)
    lib_col.objects.link(ob)
    vs = [v.co for v in me.vertices]
    srt = lambda a: sorted(v[a] for v in vs)
    sx, sy = srt(0), srt(1)
    n = len(vs)
    info = dict(
        width=max(v.x for v in vs) - min(v.x for v in vs), depth=max(v.y for v in vs) - min(v.y for v in vs),
        height=max(v.z for v in vs),
        core_w=sx[int(n * 0.97)] - sx[int(n * 0.03)], front=sy[int(n * 0.03)], back=sy[int(n * 0.97)],
    )
    ob['kb3d'] = name
    for k2, v2 in info.items(): ob['kb3d_' + k2] = round(v2, 2)
    lib[name] = (ob, info)
    print('@@LIB', name, tris(ob), {k2: round(v2, 1) for k2, v2 in info.items()})

# 删除 K044 其余内容
keep = {o for o, _ in lib.values()}
for o in list(bpy.data.objects):
    if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    if c is not lib_col: bpy.data.collections.remove(c)

# ---------------- 2. 材质：去掉金属感，换掉商标贴图，贴图外置压缩 ----------------
def base_image(src):
    b = next((n for n in src.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if src.node_tree else None
    if b and b.inputs['Base Color'].is_linked:
        n = b.inputs['Base Color'].links[0].from_node
        if getattr(n, 'image', None): return n.image, (1, 1, 1)
    col = tuple(b.inputs['Base Color'].default_value[:3]) if b else (0.5, 0.5, 0.5)
    return None, col

ext_cache = {}
def external(img):
    if img.name in ext_cache: return ext_cache[img.name]
    path = os.path.join(TEX, bpy.path.clean_name(img.name) + '.jpg')
    w, h = img.size
    s = min(1.0, TEX_MAX / max(w, h))
    c = img.copy()
    if s < 1: c.scale(max(1, int(w * s)), max(1, int(h * s)))
    c.filepath_raw = path; c.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    c.save()
    bpy.data.images.remove(c)
    new = bpy.data.images.load(path)
    ext_cache[img.name] = new
    return new

new_mats = {}
def clean_mat(src):
    if src.name in new_mats: return new_mats[src.name]
    img, col = base_image(src)
    kind = 'glass' if src.name in GLASS else 'lamp' if src.name in LAMP else 'let' if src.name in LETTERS else 'std'
    if src.name in BANNER: img, col = None, (0.09, 0.025, 0.03)
    m = bpy.data.materials.new(f'{kind}:{src.name}')
    m.use_nodes = True
    n = m.node_tree; b = next(x for x in n.nodes if x.type == 'BSDF_PRINCIPLED')
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Roughness'].default_value = 0.8
    if kind == 'glass':
        b.inputs['Base Color'].default_value = (0.02, 0.022, 0.025, 1)
        b.inputs['Roughness'].default_value = 0.15
    elif img:
        t = n.nodes.new('ShaderNodeTexImage'); t.image = external(img)
        n.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if kind == 'let':
            n.links.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.5
    else:
        b.inputs['Base Color'].default_value = (*col, 1)
    if kind == 'lamp':
        b.inputs['Emission Color'].default_value = (*LAMP[src.name], 1); b.inputs['Emission Strength'].default_value = 3
    new_mats[src.name] = m
    return m

for ob, _ in lib.values():
    for s in ob.material_slots:
        if s.material: s.material = clean_mat(s.material)
for _ in range(3): bpy.ops.outliner.orphans_purge(do_recursive=True)
for img in list(bpy.data.images):
    if img.packed_file and img.users == 0: bpy.data.images.remove(img)

# ---------------- 3. 游戏参照（桥、车、警戒线），不导出 ----------------
ref_col = bpy.data.collections.new('参照_游戏（不导出）')
scene.collection.children.link(ref_col)
def ref_mat(name, rgb, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = 0.7
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = emit
    return m
M_CON = ref_mat('ref_混凝土', (0.12, 0.13, 0.14))
M_ROAD = ref_mat('ref_路面', (0.03, 0.03, 0.035))
M_MET = ref_mat('ref_金属', (0.25, 0.27, 0.3))
M_CAR = ref_mat('ref_车', (0.1, 0.35, 0.45))
M_COR = ref_mat('ref_警戒线', (1.0, 0.75, 0.1), 1.0)
M_LAMP = ref_mat('ref_路灯', (1.0, 0.85, 0.6), 8.0)
M_NEON_C = ref_mat('ref_霓虹青', (0.12, 0.9, 1.0), 6.0)
M_NEON_P = ref_mat('ref_霓虹品红', (1.0, 0.16, 0.6), 6.0)
M_GROUND = ref_mat('ref_地面', (0.02, 0.022, 0.024))

def box(name, gx0, gx1, gy0, gy1, gz0, gz1, mat, rot_z=0.0):
    """游戏坐标的轴对齐盒子 → Blender"""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object; o.name = name
    o.scale = (gx1 - gx0, gz1 - gz0, gy1 - gy0)
    o.location = g2b((gx0 + gx1) / 2, (gy0 + gy1) / 2, (gz0 + gz1) / 2)
    o.rotation_euler.z = rot_z
    o.data.materials.append(mat)
    for c in list(o.users_collection): c.objects.unlink(o)
    ref_col.objects.link(o)
    return o

DECK_Y, HALF_W, HALF_L = 20, 7, 260
box('桥面', -HALF_W - 0.5, HALF_W + 0.5, DECK_Y - 1.4, DECK_Y, -HALF_L, HALF_L, M_CON)
box('路面', -HALF_W + 0.5, HALF_W - 0.5, DECK_Y, DECK_Y + 0.02, -HALF_L, HALF_L, M_ROAD)
for z in range(-HALF_L + 15, HALF_L, 30):
    box(f'桥墩_{z}', -2, 2, 0, DECK_Y - 1.4, z - 1.5, z + 1.5, M_CON)
for s, mat in ((1, M_NEON_C), (-1, M_NEON_P)):
    x = s * (HALF_W - 0.2)
    box(f'护栏_{s}', x - 0.2, x + 0.2, DECK_Y, DECK_Y + 1.2, -HALF_L, HALF_L, M_MET)
    box(f'护栏灯带_{s}', x - 0.03, x + 0.03, DECK_Y + 1.2, DECK_Y + 1.25, -HALF_L, HALF_L, mat)
for z in range(-240, 241, 30):
    for s in (-1, 1):
        zz = z + (15 if s > 0 else 0)
        box(f'路灯杆_{s}_{zz}', s * (HALF_W - 0.3) - 0.1, s * (HALF_W - 0.3) + 0.1, DECK_Y, DECK_Y + 8, zz - 0.1, zz + 0.1, M_MET)
        box(f'路灯头_{s}_{zz}', s * (HALF_W - 1.6) - 0.35, s * (HALF_W - 1.6) + 0.35, DECK_Y + 7.8, DECK_Y + 7.9, zz - 0.15, zz + 0.15, M_LAMP)
for gz in (-48, 70):
    for s in (-1, 1):
        box(f'龙门架柱_{gz}_{s}', s * (HALF_W + 0.25) - 0.25, s * (HALF_W + 0.25) + 0.25, DECK_Y, DECK_Y + 8.4, gz - 0.25, gz + 0.25, M_MET)
    box(f'龙门架_{gz}', -HALF_W - 1.5, HALF_W + 1.5, DECK_Y + 6.6, DECK_Y + 8.4, gz - 0.5, gz + 0.5, M_MET)
for cz in (-46, 68):
    box(f'警戒线_{cz}', -HALF_W + 0.3, HALF_W - 0.3, DECK_Y, DECK_Y + 2.6, cz - 0.05, cz + 0.05, M_COR)
# 事故车（游戏中位置 (5.5, 20, 0.2)，朝向 -0.75 rad）
box('事故车', 5.5 - 2.1, 5.5 + 2.1, DECK_Y, DECK_Y + 1.25, 0.2 - 1.0, 0.2 + 1.0, M_CAR, rot_z=-0.75)
bpy.ops.mesh.primitive_plane_add(size=1200, location=(0, 0, 0))
gnd = bpy.context.active_object; gnd.name = '地面'; gnd.data.materials.append(M_GROUND)
for c in list(gnd.users_collection): c.objects.unlink(gnd)
ref_col.objects.link(gnd)

# 玩家活动范围标记（警戒线之间，桥面上）
cams_col = ref_col
def camera(name, gpos, gtarget, fov=65, active=False):
    cd = bpy.data.cameras.new(name); cd.sensor_fit = 'VERTICAL'; cd.angle = math.radians(fov); cd.clip_end = 3000; cd.clip_start = 0.1
    c = bpy.data.objects.new(name, cd); ref_col.objects.link(c)
    c.location = g2b(*gpos)
    c.rotation_euler = (g2b(*gtarget) - c.location).to_track_quat('-Z', 'Y').to_euler()
    if active: scene.camera = c
    return c
camera('相机_玩家开场', (-0.5, 21.7, 11), (4, 20.6, 1), active=True)
camera('相机_看右侧', (-3, 21.7, 8), (30, 30, -30))
camera('相机_看左侧', (3, 21.7, -10), (-30, 30, 20))
camera('相机_沿路远望', (0, 21.7, 40), (0, 26, -120))
camera('相机_鸟瞰', (-120, 160, 120), (0, 20, -10), fov=45)

# ---------------- 4. 近景楼布局 ----------------
# 每侧沿桥 z ∈ [-150, 150]；前排主立面距桥中线 20m，后排 58m
# 每项：(楼名, 朝向)  朝向 0=正面朝桥，180=背面朝桥，90/-90=侧面朝桥
random.seed(2077)
FRONT_NEAR, FRONT_BACK = 20.0, 58.0
LAYOUT = {
    ('右', 1): {
        'near': [('tower08', 0), ('bldgS', 0), ('tower02', 0), ('capsule', 0), ('bldgM', 0), ('tower03', 0), ('midrise', 0), ('tower02', 180)],
        'back': [('bldgLG', 0), ('towerL', 0), ('towerC', 0), ('midrise', 90)],
    },
    ('左', -1): {
        'near': [('tower03', 0), ('capsule', 0), ('midrise', 0), ('tower02', 0), ('bldgS', 0), ('tower08', 0), ('bldgM', 0)],
        'back': [('towerL', 0), ('bldgLG', 0), ('tower08', 90), ('towerC', 0)],
    },
}

def footprint(info, rot):
    """朝向旋转后：沿桥方向的宽度、主立面到原点的距离（朝桥一侧）"""
    r = rot % 360
    if r == 0:   return info['width'], -info['front']
    if r == 180: return info['width'], info['back']
    return info['depth'], info['width'] / 2

placed = []
for (label, side), rows in LAYOUT.items():
    for row, items in rows.items():
        col = bpy.data.collections.new(f'近景楼_{label}_{"前排" if row == "near" else "后排"}')
        scene.collection.children.link(col)
        front_x = FRONT_NEAR if row == 'near' else FRONT_BACK
        z = -150.0
        gap_lo, gap_hi = (3, 8) if row == 'near' else (12, 30)
        for name, rot in items:
            ob_lib, info = lib[name]
            along, fdist = footprint(info, rot)
            if z + along > 155: break
            cz = z + along / 2
            o = bpy.data.objects.new(f'{name}_{label}{"前" if row == "near" else "后"}_{len(placed):02d}', ob_lib.data)
            col.objects.link(o)
            # 楼体局部正面朝 -Y；右侧楼正面要朝 Blender -X，左侧朝 +X
            face_yaw = -math.pi / 2 if side > 0 else math.pi / 2
            o.rotation_euler.z = face_yaw + math.radians(rot)
            gx = side * (front_x + fdist)
            o.location = g2b(gx, 0, cz)
            o['kb3d'] = name
            placed.append((o.name, round(gx, 1), round(cz, 1), round(along, 1), round(info['height'], 1)))
            z += along + random.uniform(gap_lo, gap_hi)
for p in placed: print('@@PLACE', p)

# ---------------- 5. 观感：夜景世界 + EEVEE ----------------
world = bpy.data.worlds.new('夜景'); scene.world = world; world.use_nodes = True
bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
if bg is None:
    bg = world.node_tree.nodes.new('ShaderNodeBackground')
    out = next((n for n in world.node_tree.nodes if n.type == 'OUTPUT_WORLD'), None) or world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(bg.outputs[0], out.inputs[0])
bg.inputs['Color'].default_value = (0.0116, 0.0203, 0.0194, 1)   # 游戏雾色 #1b2726
bg.inputs['Strength'].default_value = 1.5
sun_d = bpy.data.lights.new('月光', 'SUN'); sun_d.energy = 0.15; sun_d.color = (0.55, 0.62, 0.8)
sun = bpy.data.objects.new('月光', sun_d); ref_col.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.view_settings.view_transform = 'AgX'

# 楼体库集合不显示
lc = bpy.context.view_layer.layer_collection.children[lib_col.name]
lc.exclude = True

path = os.path.join(ART, 'city.blend')
bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
bpy.ops.file.make_paths_relative()
bpy.ops.wm.save_mainfile(compress=True)
print('@@SAVED', path, os.path.getsize(path) // (1024 * 1024), 'MB')
