# 右侧（副驾）车门拆分：沿车门接缝轮廓切开车身，分离出可绕前铰链转动的 Door_R
# 在 art/supercar_damage.blend 中运行（Blender 5.x）。结果放进集合 ZZ_DoorTest，不改原车
# 坐标：Blender 车身本地坐标，车头 -Y，右侧 -X，Z 向上
import bpy, bmesh, math
from mathutils import Vector, Matrix

COL = 'ZZ_DoorTest'
SRC = 'Body'
# 车门接缝轮廓（侧视 Y-Z），由正交侧视图描出，顺序：后上 → 后下 → 前下 → 前膝 → 前腰 → A 柱 → 车顶 → 窗后
OUTLINE = [
    (0.310, 0.768),
    (0.190, 0.372),
    (-0.488, 0.346),
    (-0.620, 0.574),
    (-0.722, 0.690),
    (-0.650, 0.864),
    (-0.152, 0.924),
    (0.262, 0.804),
]
SIDE_X = -0.30      # 只处理右侧
HINGE = Vector((-0.92, -0.70, 0.60))   # 前铰链（竖轴）
DOOR_T = 0.035      # 车门板厚
JAMB_D = 0.06       # 门框向车内的深度
DENT = (0.08, 0.54, 0.22, 0.045)   # 凹陷中心 y、z，半径，深度（m）
AJAR = 7            # 被撞后门尾外翻的角度（度）


def inner_x(z):
    """车门内侧界限：腰线以下是门板，以上随车窗内倾（tumblehome）向车内收"""
    if z < 0.68:
        return -0.70
    return -0.68 + (min(z, 0.95) - 0.68) / 0.27 * 0.28


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def inside(p, poly):
    y, z = p
    c = False
    n = len(poly)
    for i in range(n):
        y1, z1 = poly[i]
        y2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            yi = y1 + (z - z1) * (y2 - y1) / (z2 - z1)
            if y < yi:
                c = not c
    return c


def collection():
    sc = bpy.context.scene
    col = bpy.data.collections.get(COL) or bpy.data.collections.new(COL)
    if col.name not in sc.collection.children:
        sc.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    return col


def split():
    col = collection()
    src = bpy.data.objects[SRC]
    body = src.copy(); body.data = src.data.copy(); body.name = 'Test_Body'
    col.objects.link(body)
    bm = bmesh.new(); bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)

    # 每条轮廓边一刀：平面含 X 方向，只切右侧、该边附近的面
    n = len(OUTLINE)
    for i in range(n):
        a = Vector((0, *OUTLINE[i])); b = Vector((0, *OUTLINE[(i + 1) % n]))
        d = b - a
        no = Vector((0, -d.z, d.y)).normalized()
        lo_y, hi_y = min(a.y, b.y) - 0.03, max(a.y, b.y) + 0.03
        lo_z, hi_z = min(a.z, b.z) - 0.03, max(a.z, b.z) + 0.03
        faces = []
        for f in bm.faces:
            if not f.is_valid:
                continue
            vs = [v.co for v in f.verts]
            if max(v.x for v in vs) > SIDE_X:
                continue
            if max(v.y for v in vs) < lo_y or min(v.y for v in vs) > hi_y:
                continue
            if max(v.z for v in vs) < lo_z or min(v.z for v in vs) > hi_z:
                continue
            faces.append(f)
        if not faces:
            continue
        geom = set(faces)
        for f in faces:
            geom.update(f.edges); geom.update(f.verts)
        bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-6, plane_co=a, plane_no=no)

    mats = body.data.materials
    sel = []
    for f in bm.faces:
        c = f.calc_center_median()
        mn = mats[f.material_index].name
        if 'Leather' in mn:
            continue
        lim = -0.30 if 'GlassWindshield' in mn else inner_x(c.z)   # 车窗玻璃整块跟门走
        if c.x < lim and inside((c.y, c.z), OUTLINE):
            sel.append(f)

    bm2 = bmesh.new(); vmap = {}
    for f in sel:
        vs = []
        for v in f.verts:
            if v not in vmap:
                vmap[v] = bm2.verts.new(v.co)
            vs.append(vmap[v])
        try:
            nf = bm2.faces.new(vs); nf.material_index = f.material_index; nf.smooth = f.smooth
        except ValueError:
            pass
    bmesh.ops.delete(bm, geom=sel, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    # 门框：开口处车身外皮的边界向车内挤出一圈，开门后看到的是有厚度的门框
    poly = [Vector(p) for p in OUTLINE]
    from mathutils import Vector as V2
    def on_outline(v):
        p = V2((v.co.y, v.co.z))
        return v.co.x < SIDE_X and min(seg_dist(p, V2(poly[i]), V2(poly[(i + 1) % len(poly)])) for i in range(len(poly))) < 0.004
    jamb_mat = next(i for i, m in enumerate(mats) if 'PlasticMatte' in m.name)
    edges = [e for e in bm.edges if e.is_boundary and on_outline(e.verts[0]) and on_outline(e.verts[1])
             and min(v.co.x for v in e.verts) < -0.6]
    if edges:
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            v.co.x += JAMB_D
        for g in ret['geom']:
            if isinstance(g, bmesh.types.BMFace):
                g.material_index = jamb_mat
    print('jamb edges', len(edges))
    bm.to_mesh(body.data); bm.free()

    # 门板厚度：车门外皮沿接缝的边界向车内折一圈（和门框同一做法）
    bmesh.ops.remove_doubles(bm2, verts=bm2.verts, dist=1e-5)
    dedges = [e for e in bm2.edges if e.is_boundary and on_outline(e.verts[0]) and on_outline(e.verts[1])
              and min(v.co.x for v in e.verts) < -0.6]
    if dedges:
        ret = bmesh.ops.extrude_edge_only(bm2, edges=dedges)
        for g in ret['geom']:
            if isinstance(g, bmesh.types.BMVert):
                g.co.x += DOOR_T
            elif isinstance(g, bmesh.types.BMFace):
                g.material_index = jamb_mat
    print('door edge', len(dedges))
    # 凹陷：黄车从后向前刮擦，门板后下部被压进去
    for v in bm2.verts:
        if v.co.x > -0.78:
            continue
        d2 = ((v.co.y - DENT[0]) / DENT[2]) ** 2 + ((v.co.z - DENT[1]) / (DENT[2] * 0.7)) ** 2
        v.co.x += DENT[3] * math.exp(-d2 * 2.0)
    me = bpy.data.meshes.new('Door_R')
    bm2.transform(Matrix.Translation(-HINGE))
    bm2.to_mesh(me); bm2.free()
    for m in body.data.materials:
        me.materials.append(m)
    door = bpy.data.objects.new('Door_R', me)
    door.location = HINGE
    col.objects.link(door)


    for nm in ['Damage_Windshield', 'Damage_Attached_Shards', 'Damage_Hood_Fragments',
               'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']:
        o = bpy.data.objects[nm].copy(); o.name = 'Test_' + nm; col.objects.link(o)
    return body, door, len(sel)


def lc(name):
    return bpy.context.view_layer.layer_collection.children[name]


def render(views, tag, door_angles):
    """views: {name: (location, rotation_deg)}；door_angles: 车门张角（度，门尾向外为正）"""
    sc = bpy.context.scene
    door = bpy.data.objects['Door_R']
    states = {l.name: l.exclude for l in bpy.context.view_layer.layer_collection.children}
    lc('02_DAMAGED_CAR').exclude = True
    lc(COL).exclude = False
    bpy.data.collections[COL].hide_render = False
    cd = bpy.data.cameras.new('TmpCam'); cd.lens = 35
    cam = bpy.data.objects.new('TmpCam', cd); sc.collection.objects.link(cam)
    ld = bpy.data.lights.new('TmpLight', 'AREA'); ld.energy = 600; ld.size = 3
    light = bpy.data.objects.new('TmpLight', ld); sc.collection.objects.link(light)
    old = sc.camera; sc.camera = cam
    r = sc.render; saved = (r.resolution_x, r.resolution_y, r.filepath)
    r.resolution_x, r.resolution_y = 1280, 720
    out = []
    try:
        for ang in door_angles:
            door.rotation_euler = (0, 0, math.radians(ang))
            for k, (loc, rot) in views.items():
                cam.location = loc; cam.rotation_euler = [math.radians(v) for v in rot]
                light.location = Vector(loc) + Vector((0, 0, 1.5))
                light.rotation_euler = cam.rotation_euler
                r.filepath = f'/tmp/{tag}_{k}_{ang}.png'
                bpy.ops.render.render(write_still=True)
                out.append(r.filepath)
    finally:
        sc.camera = old
        bpy.data.objects.remove(cam); bpy.data.cameras.remove(cd)
        bpy.data.objects.remove(light); bpy.data.lights.remove(ld)
        r.resolution_x, r.resolution_y, r.filepath = saved
        for name, ex in states.items():
            lc(name).exclude = ex
        bpy.data.collections[COL].hide_render = True
    return out


VIEWS = {
    'rear34': ((-3.4, 2.6, 1.5), (72, 0, -127)),
    'front34': ((-3.0, -2.8, 1.4), (72, 0, -47)),
}
