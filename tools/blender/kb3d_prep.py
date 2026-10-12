# KB3D Mini Kit Cyberpunk 楼体预处理（第一步）
# 用法：Blender -b K044.blend --python tools/blender/kb3d_prep.py -- <work_dir>
# 产出：<work_dir>/prep.blend（每栋楼合并成一个物体、米制、正面朝 -Y、带光照贴图 UV）
#       <work_dir>/prev/<name>_<view>.jpg 四个方向的预览
import bpy, bmesh, sys, os, math, re
from mathutils import Vector, Matrix

WORK = sys.argv[sys.argv.index('--') + 1]
os.makedirs(os.path.join(WORK, 'prev'), exist_ok=True)

# KB3D 原始顶点坐标已是正确拼装位置，1 单位 = 100 米；物体上的 0.001 缩放和位置是导入时的错误
UNIT = 100.0
GRID = (1.5, 1.5, 1.7)
GLASS = {'Glass', 'Material #25', 'Window'}

# name: 组名, 正面方向旋转（绕 Z，度），丢弃部件的正则，目标面数
BUILDINGS = {
    'tower02': dict(group='_GROUP_006_grp', rot=0, drop=[], tris=90000),
    'capsule': dict(group='_GROUP_011_grp', rot=0, drop=[r'Ext_Floor_Ground', r'TrashCan'], tris=70000),
    'bldgLG':  dict(group='_GROUP_002_grp', rot=0, drop=[r'SpeedwayTiles'], tris=90000),
    'bldgM':   dict(group='_GROUP_009_grp', rot=0, drop=[r'SpeedwayTiles'], tris=70000),
    'tower08': dict(group='_GROUP_007_grp', rot=0, drop=[], tris=90000),
    'tower03': dict(group='_GROUP_008_grp', rot=0, drop=[], tris=80000),
}
only = os.environ.get('KB3D_ONLY')
if only: BUILDINGS = {k: v for k, v in BUILDINGS.items() if k in only.split(',')}

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

keep = set()
results = {}
for name, cfg in BUILDINGS.items():
    root = bpy.data.objects[cfg['group']]
    objs = [o for o in root.children_recursive if o.type == 'MESH']
    objs = [o for o in objs if not any(re.search(p, o.name) for p in cfg['drop'])]
    for o in objs:
        o.animation_data_clear()
        o.parent = None
        o.matrix_parent_inverse.identity()
        o.matrix_world = Matrix.Scale(UNIT, 4)
        # 每个物体独立网格数据，避免共享数据被反复变换
        if o.data.users > 1: o.data = o.data.copy()
    bpy.context.view_layer.update()

    # 多材质的重件先按材质拆开，玻璃不参与减面（减面会把窗玻璃打碎，亮窗变成碎三角）
    for o in list(objs):
        if tris(o) > 4000 and len(o.material_slots) > 1:
            for x in bpy.context.view_layer.objects: x.select_set(False)
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            before = set(bpy.data.objects)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.separate(type='MATERIAL')
            bpy.ops.object.mode_set(mode='OBJECT')
            objs += [x for x in bpy.data.objects if x not in before]
    is_glass = lambda o: any(s.material and s.material.name in GLASS for s in o.material_slots)

    # 减面：小件和玻璃不动，重件统一比例压缩到目标面数
    heavy_o = lambda o: tris(o) > 4000 and not is_glass(o)
    total = sum(tris(o) for o in objs)
    heavy = sum(tris(o) for o in objs if heavy_o(o))
    light = total - heavy
    k = 1.0 if total <= cfg['tris'] else max(0.06, (cfg['tris'] - light) / max(1, heavy))
    for o in objs:
        if heavy_o(o) and k < 1:
            m = o.modifiers.new('dec', 'DECIMATE')
            m.decimate_type = 'COLLAPSE'
            m.ratio = k
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=m.name)

    # 合并成一个物体并应用变换
    main = max(objs, key=lambda o: len(o.data.polygons))
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = main
    with bpy.context.temp_override(active_object=main, selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    ob = main
    ob.name = name
    ob.data.name = name
    with bpy.context.temp_override(object=ob, active_object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 朝向：正面转到 -Y；原点放到占地中心、地面高度
    me = ob.data
    R = Matrix.Rotation(math.radians(cfg['rot']), 4, 'Z')
    me.transform(R)
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2
    me.transform(Matrix.Translation((-cx, -cy, 0)))
    me.update()

    # 光照烘焙到顶点：大面按网格切开，保证墙面有足够顶点承载光照变化
    # 网格步长 1.5/1.5/1.7 与亮窗房间格（3/3/3.4）对齐
    bm = bmesh.new(); bm.from_mesh(me)
    for axis, step in ((0, GRID[0]), (1, GRID[1]), (2, GRID[2])):
        lo = min(v.co[axis] for v in bm.verts); hi = max(v.co[axis] for v in bm.verts)
        c = math.ceil(lo / step) * step
        nrm = Vector((0, 0, 0)); nrm[axis] = 1
        while c < hi:
            faces = []
            for f in bm.faces:
                vs = [v.co[axis] for v in f.verts]
                if min(vs) < c - 0.05 and max(vs) > c + 0.05 and f.calc_area() > 0.6:
                    faces.append(f)
            if faces:
                edges = {e for f in faces for e in f.edges}
                verts = {v for f in faces for v in f.verts}
                co = Vector((0, 0, 0)); co[axis] = c
                bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, plane_co=co, plane_no=nrm, dist=0.0005)
            c += step
    # 折角处断开顶点，避免光照在转角两侧互相串
    sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(35)]
    bmesh.ops.split_edges(bm, edges=sharp)
    bm.to_mesh(me); bm.free(); me.update()

    keep.add(ob)
    zs = [v.co.z for v in me.vertices]
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    results[name] = (tris(ob), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1), round(max(zs), 1), round(min(zs), 1), len(ob.material_slots))
    print('@@BLD', name, 'tris', results[name][0], 'size xyz', results[name][1:4], 'minz', results[name][4], 'mats', results[name][5], 'k', round(k, 3))

# 删除其余物体并清理
for o in list(bpy.data.objects):
    if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
for _ in range(3): bpy.ops.outliner.orphans_purge(do_recursive=True)
for o in keep:
    if o.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(o)
    for c in list(o.users_collection):
        if c != bpy.context.scene.collection: c.objects.unlink(o)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'prep.blend'), compress=False)
print('@@SAVED')
if os.environ.get('KB3D_NOPREV'): sys.exit(0)

# 预览：四个方向正交图
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 400; scene.render.resolution_y = 600
scene.render.image_settings.file_format = 'JPEG'
world = bpy.data.worlds.new('pv'); scene.world = world; world.use_nodes = True
bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
if bg is None:
    bg = world.node_tree.nodes.new('ShaderNodeBackground')
    out = next((n for n in world.node_tree.nodes if n.type == 'OUTPUT_WORLD'), None) or world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(bg.outputs[0], out.inputs[0])
bg.inputs[0].default_value = (0.5, 0.55, 0.6, 1)
sun_d = bpy.data.lights.new('s', 'SUN'); sun_d.energy = 3
sun = bpy.data.objects.new('s', sun_d); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0, math.radians(20))
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'
cam = bpy.data.objects.new('c', cam_d); scene.collection.objects.link(cam); scene.camera = cam
for ob in keep:
    for o in keep: o.hide_render = o is not ob
    zs = [v.co.z for v in ob.data.vertices]
    h = max(zs); size = max(results[ob.name][1:3])
    cam_d.ortho_scale = max(h * 1.05, size * 1.05 * 600 / 400)
    cam_d.clip_end = 2000
    for view, ang in [('front', 0), ('right', 90), ('back', 180), ('left', 270)]:
        a = math.radians(ang)
        d = Vector((math.sin(a), -math.cos(a), 0))
        cam.location = d * 500 + Vector((0, 0, h / 2))
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(WORK, 'prev', f'{ob.name}_{view}.jpg')
        bpy.ops.render.render(write_still=True)
print('@@DONE')
