# 拿平板的左手：用参数重算握姿，并覆盖 art/tablet_hand.blend。
# 平时不要跑这个。摆姿势请开 art/tablet_hand.blend，改完用 export_tablet_hand.py 导出。
#   Blender -b --factory-startup --python tools/blender/build_tablet_hand.py [-- render]
# 左手骨骼在 art/fps_arm_left.blend（源模型 +X 侧，tools/blender/fps_arm_left.py）
# 直接握平板左边缘，游戏里不再做 scale.x 镜像
# 握法：平板边缘卡在虎口，四指在背面托着、指肚贴住背板，拇指绕到正面压在边框上；前臂从画面左下伸进来
# 坐标：导出后 glTF 坐标 = 平板 holder 的本地坐标（three：X 右、Y 上、Z 朝镜头），游戏里直接挂到 holder 下
#       Blender 里对应 X = x, Y = -z, Z = y（平板正面朝 Blender -Y）
# 平板尺寸、举起姿态和 src/investigation/tablet.js 一致（改了要两边一起改）
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix, Euler, Quaternion
from mathutils.bvhtree import BVHTree

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
DST = ROOT + 'art/tablet_hand.blend'
OUT = ROOT + 'public/assets/tablet-hand.glb'
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = 'render' in ARGS
PREVIEW_DIR = '/var/folders/hs/pz321y21609c2c2c8spyxc400000gn/T/opencode/tablet/'
TEX_MAX = 1024

# ---------- 平板（tablet.js：W、H、BEZEL、RIM、DEPTH，正面 z = 0.0025） ----------
W, H, BEZEL, RIM, DEPTH = 0.48, 0.3, 0.012, 0.0045, 0.0075
OW, OH = W + BEZEL * 2 + RIM * 2, H + BEZEL * 2 + RIM * 2
FRONT = 0.0025
BACK = FRONT - DEPTH
EDGE = OW / 2

# 游戏里平板举起后的姿态（相机空间，tablet.js SHOWN）
SHOWN_POS = Vector((0.035, -0.022, -0.43))
SHOWN_ROT = Euler((-0.06, 0.08, 0.02), 'XYZ')
CAM_FOV_Y = 65
SHOULDER_CAM = Vector((-0.46, -0.42, 0.02))   # 左肩在画面外的左下方，小臂从外侧伸进来

# ---------- 握法参数（平板坐标：左手握左边缘，+X 朝平板中间） ----------
GRIP_Y = -0.02            # 握点高度（平板中心为 0）
INSET = -0.018            # 中指根关节在外边缘外侧（负 = 在平板外面）
UP_DEG = 40               # 四指相对平板长边抬起的角度
AWAY_DEG = 8              # 四指基本贴着背板，只留一点空隙给手套厚度
KNUCKLE = 0.028           # 中指根关节骨骼到背板的距离，给手套厚度留空
THUMB_AT = Vector((-EDGE + 0.008, GRIP_Y + 0.045, FRONT + 0.004))   # 拇指指肚压在正面边框上
FINGER_R = 0.0085
MAX_DEG = {1: 70, 2: 80, 3: 60}
RATIO = (1.0, 1.15, 0.75)
STEP = 1.0

C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))   # three 坐标 → Blender 坐标


def T(v):
    return C @ Vector(v)


# ---------- 新工程 ----------
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
sc.name = 'TabletHand'
vl = sc.view_layers[0]
with bpy.data.libraries.load(ROOT + 'art/fps_arm_left.blend', link=False) as (src, dst):
    dst.objects = ['FPSArm_Rig', 'LeftArm']
for o in dst.objects:
    sc.collection.objects.link(o)
rig = bpy.data.objects['FPSArm_Rig']
arm = bpy.data.objects['LeftArm']
rig.animation_data_clear()
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)
vl.update()


# ---------- 平板替身（只做碰撞和预览，不导出） ----------
def mat(name, col, met=0.0, rough=0.5, emit=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = col
    b.inputs['Metallic'].default_value = met
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = 1.0
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def box(name, lo, hi, m):
    """lo / hi 为 three 坐标的包围盒"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    c, s = (Vector(lo) + Vector(hi)) / 2, Vector(hi) - Vector(lo)
    for v in bm.verts:
        v.co = T(Vector((c.x + v.co.x * s.x, c.y + v.co.y * s.y, c.z + v.co.z * s.z)))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


tab = box('TabletProxy', (-OW / 2, -OH / 2, BACK), (OW / 2, OH / 2, FRONT), mat('Tab_Metal', (0.09, 0.1, 0.12, 1), 0.9, 0.3))
scr = box('ScreenProxy', (-W / 2, -H / 2, FRONT), (W / 2, H / 2, FRONT + 0.0003),
          mat('Tab_Screen', (0.02, 0.06, 0.08, 1), 0, 0.1, emit=(0.05, 0.25, 0.35, 1), alpha=0.35))
scr.hide_render = True    # 游戏里屏幕是透明的，预览时先关掉，看得到背后的手指
bvh = BVHTree.FromPolygons([tab.matrix_world @ v.co for v in tab.data.vertices], [p.vertices for p in tab.data.polygons])


# ---------- 相机和肩膀（平板坐标） ----------
R = SHOWN_ROT.to_matrix()
Rt = R.transposed()
cam_pos = Rt @ (-SHOWN_POS)
cam_rot = Rt
shoulder = Rt @ (SHOULDER_CAM - SHOWN_POS)

cam_data = bpy.data.cameras.new('TabletCam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(CAM_FOV_Y)
cam_data.clip_start = 0.02
cam = bpy.data.objects.new('TabletCam', cam_data)
sc.collection.objects.link(cam)
cam.matrix_world = Matrix.Translation(T(cam_pos)) @ (C @ cam_rot).to_4x4()
sc.camera = cam

# ---------- 手的位置：四指朝平板中间往上斜，手心朝背板（+z），中指根关节贴在背板后面 ----------
a, b = math.radians(UP_DEG), math.radians(AWAY_DEG)
d_f = Vector((math.cos(a), math.sin(a), 0)) * math.cos(b) + Vector((0, 0, -math.sin(b)))   # 手指朝平板中间（+X）
n_p = Vector((0, 0, 1))
n_p = (n_p - d_f * n_p.dot(d_f)).normalized()                                                # 手心方向
# 骨架里手指自然姿势本身往手心弯：用中指根到指尖的实际方向对齐，而不是骨架 -Y
# 左手手心在骨架里朝 -X
mb1, mb3 = rig.data.bones['middle_1'], rig.data.bones['middle_3']
f_rig = (mb3.tail_local - mb1.head_local).normalized()
p_rig = Vector((-1, 0, 0))
p_rig = (p_rig - f_rig * p_rig.dot(f_rig)).normalized()
R_t = (Matrix((d_f, n_p, d_f.cross(n_p))).transposed()
       @ Matrix((f_rig, p_rig, f_rig.cross(p_rig))))          # 骨架本地 → 平板（three）
Rb = C @ R_t
anchor = rig.data.bones['middle_1'].head_local
P = Vector((-EDGE + INSET, GRIP_Y, BACK - KNUCKLE))
rig.matrix_world = Matrix.Translation(T(P) - Rb @ anchor) @ Rb.to_4x4()
vl.update()


def seg_points(names, n=5):
    pts = []
    for nm in names:
        pb = rig.pose.bones[nm]
        h, t = rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail
        pts += [h.lerp(t, i / n) for i in range(1, n + 1)]
    return pts


def skinned(names, wmin=0.35):
    """这些骨骼上权重大的手套顶点，three 坐标"""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = arm.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    want = {ev.vertex_groups[nm].index for nm in names}
    pts = [C.inverted() @ (mw @ v.co) for v in me.vertices
           if any(g.group in want and g.weight > wmin for g in v.groups)]
    ev.to_mesh_clear()
    return pts


def finger_state(pts):
    """crossed：顶点进了机身。on_lip：指肚贴在左边缘背面，还没伸进屏幕。"""
    crossed = on_lip = 0
    screen_l = -W / 2
    for p in pts:
        if p.z > BACK + 0.001 and -EDGE - 0.004 < p.x < EDGE and abs(p.y) < OH / 2 + 0.01:
            crossed += 1
        if screen_l - 0.004 < p.x < screen_l + 0.006 and BACK - 0.004 <= p.z <= BACK + 0.001 and abs(p.y) < OH / 2:
            on_lip += 1
    return crossed, on_lip


# 前臂：绕手腕转向肩膀（手不动）
fa, hd = rig.pose.bones['forearm'], rig.pose.bones['hand']
fa_bone = rig.data.bones['forearm']
elbow_dir = fa_bone.head_local - fa_bone.tail_local
wrist = fa_bone.tail_local.copy()
keep = hd.matrix.copy()
s_local = rig.matrix_world.inverted() @ T(shoulder)
rq = elbow_dir.rotation_difference(s_local - wrist)
fa.matrix = Matrix.Translation(wrist) @ rq.to_matrix().to_4x4() @ Matrix.Translation(-wrist) @ fa_bone.matrix_local
vl.update()
hd.matrix = keep
vl.update()


# 拿平板：四指几乎伸直，托在背板上；只略弯，让指肚贴住背面，不去勾边框
GRIP = {
    'index': (14, 10, 6),
    'middle': (16, 11, 6),
    'ring': (15, 10, 6),
    'pinky': (13, 9, 5),
}
for finger, degs in GRIP.items():
    for j, deg in enumerate(degs, 1):
        rig.pose.bones[f'{finger}_{j}'].rotation_euler.x = math.radians(deg)
vl.update()
pad_names = [f'{f}_{j}' for f in GRIP for j in (2, 3)]
pads = skinned(pad_names, 0.5)
cent = sum(pads, Vector()) / len(pads)
target = Vector((-EDGE + 0.055, GRIP_Y + 0.01, BACK - 0.008))
delta = T(target - cent)
rig.matrix_world = Matrix.Translation(delta) @ rig.matrix_world
vl.update()
print('pad shift (three)', tuple(round(c, 4) for c in (target - cent)))

# 拇指：指尖指向正面边框上的目标点，再弯后两节到碰到
# 先让拇指指向目标点正上方（离开正面 4 cm），再绕「拇指 × 正面法线」往正面压，压到碰到为止，退回 1°
th1, th3 = rig.pose.bones['thumb_1'], rig.pose.bones['thumb_3']
inv = rig.matrix_world.inverted()


def rot_thumb(q):
    h = th1.head.copy()
    th1.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ th1.matrix
    th1.location = (0, 0, 0)
    vl.update()


for j, deg in enumerate((12, 8, 6), 1):
    rig.pose.bones[f'thumb_{j}'].rotation_euler.x = math.radians(deg)
vl.update()
inv = rig.matrix_world.inverted()
rot_thumb((th3.tail - th1.head).rotation_difference(inv @ T(THUMB_AT) - th1.head))
for _ in range(25):
    pts = skinned(['thumb_2', 'thumb_3'], 0.45)
    # 指肚还在正面之外（更靠近镜头）就往背板方向收，收到正面边框为止
    front = [p for p in pts if p.x > -EDGE - 0.03]
    if not front:
        break
    if sum(p.z for p in front) / len(front) < FRONT + 0.006:
        break
    tip_dir = (th3.tail - th1.head).normalized()
    nrm = (inv.to_3x3() @ (C @ Vector((0, 0, -1)))).normalized()
    axis = tip_dir.cross(nrm)
    if axis.length < 1e-5:
        break
    rot_thumb(Quaternion(axis.normalized(), math.radians(2)))
    inv = rig.matrix_world.inverted()
pads = skinned(pad_names, 0.5)
inside = sum(1 for p in pads if BACK < p.z < FRONT + 0.002 and p.x > -EDGE)
print('pads inside slab', inside, 'of', len(pads))

act = bpy.data.actions.new('Grip_Tablet')
act.use_fake_user = True
rig.animation_data_create()
rig.animation_data.action = act
baked = [(pb, pb.matrix_basis.to_euler('XYZ')) for pb in rig.pose.bones]
for pb, euler in baked:
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = euler
vl.update()
for pb in rig.pose.bones:
    pb.keyframe_insert('rotation_euler', frame=1)
    pb.keyframe_insert('location', frame=1)

# ---------- 预览灯光 ----------
w = bpy.data.worlds.new('TabWorld')
sc.world = w
w.use_nodes = True
next(nd for nd in w.node_tree.nodes if nd.type == 'BACKGROUND').inputs[0].default_value = (0.05, 0.06, 0.08, 1)
for name, rot, col, e in (('Key', (50, 0, -30), (0.85, 0.93, 1), 3.0), ('RimC', (70, 0, 120), (0.2, 0.9, 1), 2.0), ('RimM', (70, 0, -150), (1, 0.25, 0.6), 1.2)):
    lo = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
    sc.collection.objects.link(lo)
    lo.data.energy = e
    lo.data.color = col
    lo.rotation_euler = [math.radians(x) for x in rot]
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.frame_start = sc.frame_end = 1
sc.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=DST)
print('saved', DST)

# ---------- 导出：rig + 手臂，贴图临时缩到 1024 ----------
swaps = []
for slot in arm.material_slots:
    if not slot.material or not slot.material.node_tree:
        continue
    for nd in slot.material.node_tree.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image and max(nd.image.size) > TEX_MAX:
            src_im = nd.image
            iw, ih = src_im.size
            k = TEX_MAX / max(iw, ih)
            small = src_im.copy()
            small.name = src_im.name + '_export'
            small.scale(int(iw * k), int(ih * k))
            nd.image = small
            swaps.append((nd, src_im, small))
for o in sc.objects:
    o.select_set(False, view_layer=vl)
for o in (rig, arm):
    o.select_set(True, view_layer=vl)
vl.objects.active = rig
try:
    with bpy.context.temp_override(scene=sc, view_layer=vl):
        bpy.ops.export_scene.gltf(
            filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
            export_cameras=False, export_lights=False, export_skins=True, export_def_bones=True,
            export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
            export_image_format='WEBP', export_image_quality=85,
        )
finally:
    for nd, src_im, small in swaps:
        nd.image = src_im
        bpy.data.images.remove(small)
print('exported', OUT, os.path.getsize(OUT), 'bytes')

if RENDER:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    tab_bsdf = next(n for n in tab.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tab_bsdf.inputs['Alpha'].default_value = 0.25
    tab.data.materials[0].blend_method = 'BLEND' if hasattr(tab.data.materials[0], 'blend_method') else None
    sc.render.filepath = PREVIEW_DIR + 'cam.png'
    bpy.ops.render.render(write_still=True)
    G = T(Vector((-EDGE + 0.03, GRIP_Y, 0)))
    c2 = bpy.data.objects.new('CloseCam', bpy.data.cameras.new('CloseCam'))
    sc.collection.objects.link(c2)
    c2.data.clip_start = 0.005
    c2.data.lens = 40
    sc.camera = c2
    sc.render.resolution_x, sc.render.resolution_y = 800, 600
    for k, d in {'front': T((-0.2, 0, 1)), 'back': T((-0.3, 0.1, -1)), 'edge': T((-1, 0.2, 0.15)), 'top': T((-0.2, 1, 0.3))}.items():
        d = d.normalized()
        c2.location = G + d * 0.32
        c2.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = PREVIEW_DIR + f'close_{k}.png'
        bpy.ops.render.render(write_still=True)
    sc.camera = cam
    print('rendered', PREVIEW_DIR)
