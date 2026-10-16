"""把游戏车身 supercar.glb 的右侧车门换成 K042 源文件里的独立车门零件，生成 art/supercar_door.blend
用法：Blender -b --factory-startup --python tools/blender/build_door_car.py -- [render]
前置：先运行 k042_extract_door.py 生成 art/door_r_src.blend
坐标：Blender 本地坐标，车头 -Y，右侧 -X，Z 向上（导出 glTF 后为车头 +Z、右侧 -X、Y 向上）"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
GLB = ROOT / 'art' / 'supercar.glb'   # 源车身；游戏里不再直接加载，结局车也用 supercar_door.glb
SRC = ROOT / 'art' / 'door_r_src.blend'
OUT = ROOT / 'art' / 'supercar_door.blend'
RENDERS = ROOT / 'art' / 'renders' / 'door_r_k042'

MATCH = 0.03        # 车身上离车门零件这么近的面，视为原车门，删掉
AJAR = 7.0          # 被撞后门尾外翻角度（度）
DENT = (0.10, 0.52, 0.20, 0.05)   # 凹陷：中心 y、z，半径，深度（m）


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_car():
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    body = bpy.data.objects['Body']
    return body


def append_door():
    with bpy.data.libraries.load(str(SRC)) as (src, dst):
        dst.objects = ['Door_R']
    door = dst.objects[0]
    bpy.context.scene.collection.objects.link(door)
    return door


CABIN_SRC = ROOT / 'art' / 'k042_cabin_parts.blend'   # K042 拆分件 Seat / SteeringColumn（已应用世界变换）
CABIN_FLOOR = 0.24       # 座舱地板高度（射线测得 0.237）
DRIVER_X = 0.33          # 驾驶位（左侧，+X）横向中心
SEAT_S, SEAT_BACK_Y = 0.75, 0.30      # 座椅缩放；靠背最后端 y（后隔板约 0.30）
STEER_S, STEER_Y, STEER_Z = 0.8, -0.47, 0.60   # 方向盘缩放；盘面（最靠后端）y；转向柱中心高度


def cabin_material(name, part):
    """K042 拆分件的材质槽换成游戏材质（crash.js 按名字识别）"""
    if 'Slot #3.' in name:
        name = 'Leather' if part == 'Seat' else 'PlasticMatte'
    m = bpy.data.materials.get('GC_' + name)
    return m or bpy.data.materials['GC_PlasticMatte']


def load_part(name, part, scale, ratio):
    with bpy.data.libraries.load(str(CABIN_SRC)) as (src, dst):
        dst.objects = [name]
    ob = dst.objects[0]
    bpy.context.scene.collection.objects.link(ob)
    me = ob.data
    pts = [v.co for v in me.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2
    me.transform(Matrix.Scale(scale, 4) @ Matrix.Translation(-c))
    # 材质槽压到用到的几种游戏材质
    used = {}
    for p in me.polygons:
        gm = cabin_material(me.materials[p.material_index].name, part)
        p.material_index = used.setdefault(gm.name, len(used))
    me.materials.clear()
    for n in used:
        me.materials.append(bpy.data.materials[n])
    if ratio < 1:
        mod = ob.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier='dec')
    size = (hi - lo) * scale
    return ob, size


def add_cabin(body):
    """原车座舱只有一个皮革壳。撬开车门后能看到里面，补上两把座椅和驾驶位转向柱，合并进 Body"""
    parts = []
    for side in (1, -1):
        seat, size = load_part('Seat_W', 'Seat', SEAT_S, 0.12)
        seat.location = (DRIVER_X * side, SEAT_BACK_Y - size.y / 2, CABIN_FLOOR + size.z / 2)
        parts.append(seat)
    steer, size = load_part('SteeringColumn_W', 'Steer', STEER_S, 0.5)
    steer.location = (DRIVER_X, STEER_Y - size.y / 2, STEER_Z)
    parts.append(steer)
    # 卡槽锚点：转向柱下方、朝副驾一侧（-X），给 cardSlot.js 用
    bpy.context.view_layer.update()
    me = steer.data
    mw = steer.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    low = [p for p in pts if p.z < STEER_Z - size.z * 0.15 and p.y < STEER_Y - 0.05]
    anchor = Vector((min(p.x for p in low), sum(p.y for p in low) / len(low), sum(p.z for p in low) / len(low))) if low else Vector((DRIVER_X - 0.08, STEER_Y - 0.12, STEER_Z - 0.08))
    print('CABIN_SLOT_BLENDER', tuple(round(x, 3) for x in anchor))
    print('STEER bbox', tuple(round(min(p[i] for p in pts), 3) for i in range(3)), tuple(round(max(p[i] for p in pts), 3) for i in range(3)))
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body['cabin_slot'] = list(anchor)
    return anchor


def remove_old_door(body, door):
    """删掉车身里和车门零件重合的面（游戏车身是 K042 合并后的版本，车门那块还在里面）"""
    dm = door.data
    bvh = BVHTree.FromPolygons([v.co for v in dm.vertices], [p.vertices for p in dm.polygons])
    lo = Vector([min(v.co[i] for v in dm.vertices) for i in range(3)]) - Vector((0.03,) * 3)
    hi = Vector([max(v.co[i] for v in dm.vertices) for i in range(3)]) + Vector((0.03,) * 3)
    mw = body.matrix_world; inv = mw.inverted()
    bm = bmesh.new(); bm.from_mesh(body.data)
    kill = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if not all(lo[i] <= c[i] <= hi[i] for i in range(3)):
            continue
        ok = True
        for v in f.verts:
            hit = bvh.find_nearest(mw @ v.co)
            if hit[0] is None or hit[3] > MATCH:
                ok = False; break
        if ok:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data); bm.free()
    print('removed body faces', len(kill))
    return len(kill)


def uv_density(ob, filt=None):
    """UV 单位 / 米（按面积开方），用来对齐车漆法线贴图的颗粒大小"""
    bm = bmesh.new(); bm.from_mesh(ob.data); uv = bm.loops.layers.uv.active
    tw = tu = 0.0
    for f in bm.faces:
        if len(f.loops) < 3 or (filt and not filt(f)):
            continue
        l = f.loops
        u = abs((l[1][uv].uv - l[0][uv].uv).cross(l[2][uv].uv - l[0][uv].uv)) / 2
        w = (l[1].vert.co - l[0].vert.co).cross(l[2].vert.co - l[0].vert.co).length / 2
        if w > 1e-8:
            tw += w; tu += u
    bm.free()
    return (tu / tw) ** 0.5 if tw else 0.0


def setup_door(door, body):
    """材质换成游戏的 GC_CarPaint_Main；UV 密度对齐车身；原点移到前铰链；加凹陷"""
    gc = bpy.data.materials.get('GC_CarPaint_Main')
    door.data.materials.clear(); door.data.materials.append(gc)
    for p in door.data.polygons:
        p.material_index = 0
    me = door.data
    # K042 零件的 UV 比合并后的游戏车身稀约 9 倍，车漆闪粉法线会被放大成斑块
    bm_mats = body.data.materials
    k = uv_density(body, lambda f: 'CarPaint_Main' in bm_mats[f.material_index].name) / max(uv_density(door), 1e-6)
    me.uv_layers.active.name = 'UVMap'
    for d in me.uv_layers.active.data:
        d.uv *= k
    print('door uv scale', round(k, 3))
    pts = [v.co.copy() for v in me.vertices]
    # 铰链：车门前缘（y 最小处）外侧，竖轴
    ymin = min(p.y for p in pts)
    # 前缘外皮向车内包住翼子板后沿，铰链取前缘附近外皮的位置，门转开时前角不会插进翼子板
    front = [p for p in pts if p.y < ymin + 0.08]
    hinge = Vector((min(p.x for p in front) + 0.02, ymin + 0.04, sum(p.z for p in front) / len(front)))
    me.transform(Matrix.Translation(-hinge))
    door.location = hinge
    # 凹陷：只压外板（车门外侧那层）
    xmin = min(p.x for p in pts)
    for v in me.vertices:
        w = v.co + hinge
        if w.x > xmin + 0.06:
            continue
        d2 = ((w.y - DENT[0]) / DENT[2]) ** 2 + ((w.z - DENT[1]) / (DENT[2] * 0.7)) ** 2
        v.co.x += DENT[3] * math.exp(-d2 * 2.0)
    door.parent = None
    door['hinge'] = list(hinge)
    print('hinge', tuple(round(x, 3) for x in hinge))
    return hinge


PREVIEW = {   # 只用于审阅渲染，近似游戏里 crash.js 按材质名换上的手调材质
    'CarPaint_Main': ((0.16, 0.42, 0.52), 0.25, 0.4),
    'CarPaint_Accent': ((0.01, 0.012, 0.014), 0.4, 0.3),
    'Carbon_Fiber': ((0.015, 0.016, 0.02), 0.45, 0.2),
    'Chrome': ((0.6, 0.62, 0.64), 0.3, 1.0),
    'MetalFrame': ((0.03, 0.033, 0.036), 0.7, 0.3),
    'EngineMetal': ((0.03, 0.033, 0.036), 0.7, 0.3),
    'PlasticMatte': ((0.012, 0.012, 0.013), 0.8, 0.0),
    'Leather': ((0.05, 0.03, 0.025), 0.6, 0.0),
    'GlassWindshield': ((0.01, 0.015, 0.02), 0.05, 0.2),
}


def preview_materials():
    for m in bpy.data.materials:
        key = m.name.replace('GC_', '')
        if key not in PREVIEW or not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        for link in list(bsdf.inputs['Base Color'].links):
            m.node_tree.links.remove(link)
        col, rough, metal = PREVIEW[key]
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if key == 'GlassWindshield':
            bsdf.inputs['Alpha'].default_value = 0.6


def render(door, tag_angles):
    sc = bpy.context.scene
    preview_materials()
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    world = bpy.data.worlds.new('W'); sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.05, 0.06, 0.08, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    bpy.ops.mesh.primitive_plane_add(size=30)
    ground = bpy.context.object
    gm = bpy.data.materials.new('Ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.25, 0.26, 0.28, 1)
    ground.data.materials.append(gm)
    for name, loc, energy, size in (('Key', (-3, 2, 4), 900, 4), ('Fill', (-3, -3, 2), 400, 3), ('Rim', (3, 1, 3), 300, 3)):
        ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size
        lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0.5)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    ld = bpy.data.lights.new('CabinFill', 'POINT'); ld.energy = 40   # 审阅用：照亮座舱
    lo = bpy.data.objects.new('CabinFill', ld); sc.collection.objects.link(lo); lo.location = (-0.3, -0.1, 0.85)
    cd = bpy.data.cameras.new('Cam'); cd.lens = 35
    cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    views = {
        'rear34': (-3.6, 2.6, 1.5),
        'front34': (-3.4, -3.0, 1.4),
        'close': (-2.2, 1.2, 1.05),
        'inside': (-1.9, -0.4, 1.0),
        'cabin': (-1.25, -0.05, 0.95),
    }
    targets = {'inside': (-0.2, -0.2, 0.45), 'cabin': (0.3, -0.5, 0.5)}
    RENDERS.mkdir(parents=True, exist_ok=True)
    for ang in tag_angles:
        door.rotation_euler = (0, 0, math.radians(ang))
        for k, loc in views.items():
            cam.location = loc
            target = Vector(targets.get(k, (-0.6, 0.0, 0.5)))
            cam.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = str(RENDERS / f'{k}_{int(ang):02d}.png')
            bpy.ops.render.render(write_still=True)
    door.rotation_euler = (0, 0, math.radians(AJAR))


def export_glb(door):
    """导出新车模：节点 Body / Door_R / Wheel_*，材质名不变（crash.js 按名字换材质）"""
    out = ROOT / 'public' / 'assets' / 'supercar_door.glb'
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.name == 'Body' or o.name == 'Door_R' or o.name.startswith('Wheel_'):
            o.select_set(True)
    door.rotation_euler = (0, 0, math.radians(AJAR))
    bpy.ops.export_scene.gltf(
        filepath=str(out), use_selection=True, export_format='GLB',
        export_image_format='WEBP', export_draco_mesh_compression_enable=True,
        export_yup=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
    )
    print('EXPORTED', out, out.stat().st_size // 1024, 'KB')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    reset()
    body = import_car()
    door = append_door()
    remove_old_door(body, door)
    setup_door(door, body)
    add_cabin(body)
    door.rotation_euler = (0, 0, math.radians(AJAR))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
    print('SAVED', OUT)
    export_glb(door)
    if 'render' in argv:   # 渲染改了材质颜色，放在保存之后，不写回文件
        render(door, [0, AJAR, 55])


main()
