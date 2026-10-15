# 第 3 轮插卡 / 拔卡（骨骼手版）：新建工程 art/card_arm_anim.blend，逐帧烘焙
# 后台运行（不碰其他 .blend）：
#   Blender -b --factory-startup --python tools/blender/build_card_arm_anim.py [-- render]
# 一条时间轴两段动作（秒，和 src/investigation/cardArm.js 的常数一致）：
#   插卡 0 ~ INSERT_END：举起 → 对准 → 推进（HIT 时卡插到底，游戏里指示灯开始闪）→ 松手 → 手收出画面，卡留在槽里
#   拔卡 PULL0 ~ PULL_END：手伸回来 → 捏住 → 拔出 → 放下出画面
# 内容：
#   supercar_door.glb（车身、座椅、转向柱，只做参考，不导出）+ 卡槽面板（和 cardSlot.js 同尺寸，只做参考）
#   Card_Hand：空物体，逐帧位置/旋转，子物体 FPSArm_Rig + RightArm（art/fps_arm_rig.blend 的骨骼右手）
#   EvidenceCard：取证卡，逐帧位置/旋转（手拿着时跟手，插好后停在槽里）
#   CardCam：插卡镜头（和游戏 state.js startInsert 算出的终点机位一致），导出时存成 CardCamRest
# 握法：钥匙式侧捏，卡平放在弯曲食指的侧面，拇指指肚压在卡上面；手心朝下，前臂从画面右下伸进来
# 坐标（Blender）：车头 -Y，右侧（副驾）-X，上 +Z
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
DST = ROOT + 'art/card_arm_anim.blend'
RENDER = 'render' in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else False
PREVIEW_DIR = '/var/folders/hs/pz321y21609c2c2c8spyxc400000gn/T/opencode/card/'
FPS = 30

# ---------- 游戏里取到的数值（车模 GLB 坐标换成 Blender：x, -z, y） ----------
SLOT = Vector((-0.063, -0.649, 0.541))          # 卡槽面板中心（cardSlot.js 的 slot.world）
N = Vector((-1, 0, 0))                          # 卡槽朝外
CAM = Vector((-0.4844, -0.4675, 0.6331))        # state.js startInsert 的 camTo（已压到门框顶以下）
WORLD_UP = Vector((-0.0146, 0.0164, 0.9998))    # 撞后车身微倾，世界竖直方向在车模里的方向
CAM_FOV_Y = 65
MOUTH = SLOT + N * 0.0055                       # 卡槽口（面板前表面）

# ---------- 卡（米） ----------
CARD_LEN, CARD_H, CARD_T = 0.0856, 0.054, 0.0018
GRIP_BACK = 0.016        # 捏的位置离卡尾多远
CARD_Z_OFF = 0.017       # 卡在手里往手心一侧偏（避开食指根部的指节）
DEPTH = 0.045            # 插到底时卡头进槽多深
READY_OUT = 0.10         # 对准时卡头停在槽口外多远
LEAD = CARD_LEN - GRIP_BACK   # 捏点到卡头

# ---------- 时间轴（秒） ----------
T_RAISE, T_ALIGN, T_PUSH, T_REL, T_RET = 0.45, 0.15, 0.35, 0.15, 0.35
HIT = T_RAISE + T_ALIGN + T_PUSH
INSERT_END = HIT + T_REL + T_RET
PULL0 = 1.5
T_REACH, T_PINCH, T_PULL, T_DROP = 0.4, 0.15, 0.3, 0.4
PULL_END = PULL0 + T_REACH + T_PINCH + T_PULL + T_DROP
TOTAL = PULL_END + 0.1

# ---------- 手指（骨架坐标：手指 -Y，上 +Z，手心朝 +X；弯曲 = 绕本地 X 正转） ----------
CURL = {'index': (40, 70, 35), 'middle': (70, 95, 55), 'ring': (72, 95, 55), 'pinky': (72, 90, 50)}
FINGER_R = 0.0085
OPEN_THUMB = 0.65        # 松开时拇指往自然伸直的姿势回多少
OPEN_INDEX = 0.25


def ss(u):
    u = min(1, max(0, u))
    return u * u * u * (u * (u * 6 - 15) + 10)


def frame(x, y):
    x = x.normalized()
    y = (y - x * y.dot(x)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


# ---------- 新工程 ----------
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
sc.name = 'CardAnim'
sc.render.fps = FPS
vl = sc.view_layers[0]
bpy.ops.import_scene.gltf(filepath=ROOT + 'public/assets/supercar_door.glb')
door = bpy.data.objects['Door_R']
door.rotation_mode = 'XYZ'
door.rotation_euler = (0, 0, math.radians(55))   # 插卡时门已撬开

with bpy.data.libraries.load(ROOT + 'art/fps_arm_rig.blend', link=False) as (src, dst):
    dst.objects = ['FPSArm_Rig', 'RightArm']
for o in dst.objects:
    sc.collection.objects.link(o)
rig = bpy.data.objects['FPSArm_Rig']
arm = bpy.data.objects['RightArm']
rig.animation_data_clear()
rig.hide_render = True
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)
vl.update()

# ---------- 镜头 ----------
fwd = (SLOT - CAM).normalized()
right = fwd.cross(WORLD_UP).normalized()
cup = right.cross(fwd)
cam_data = bpy.data.cameras.new('CardCam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(CAM_FOV_Y)
cam_data.clip_start = 0.05
cam = bpy.data.objects.new('CardCam', cam_data)
sc.collection.objects.link(cam)
cam.matrix_world = Matrix.Translation(CAM) @ Matrix((right, cup, -fwd)).transposed().to_4x4()
sc.camera = cam
shoulder = CAM + right * 0.2 - cup * 0.36 - fwd * 0.1

# ---------- 卡槽面板（参考，和 cardSlot.js 同尺寸） ----------
def box(name, size, mw, col, emit=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new(name + '_Mat')
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = col
    if emit:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = 3.0
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.matrix_world = mw
    return ob


slot_rot = frame(-N.cross(WORLD_UP).normalized(), WORLD_UP)   # 本地 X 横、Y 竖、Z = 朝外
slot_m = Matrix((slot_rot.col[0], slot_rot.col[1], N)).transposed().to_4x4()
box('SlotPlate', (0.055, 0.16, 0.01), Matrix.Translation(SLOT) @ slot_m, (0.1, 0.11, 0.13, 1))
box('SlotSlit', (0.008, 0.09, 0.002), Matrix.Translation(SLOT + N * 0.0045) @ slot_m, (0, 0, 0, 1))

# ---------- 取证卡（卡坐标：X 卡头方向，Y 卡面法线（拇指一侧），Z 卡的高度方向；原点 = 捏点、卡下表面往上半个厚度） ----------
def build_card():
    me = bpy.data.meshes.new('EvidenceCard')
    bm = bmesh.new()
    mats = []
    for nm, col, met, rough, emit in (('Card_Body', (0.025, 0.028, 0.032, 1), 0.3, 0.35, None),
                                      ('Card_Stripe', (0.0, 0.0, 0.0, 1), 0.0, 0.5, (0.19, 0.78, 1.0, 1)),
                                      ('Card_Contact', (0.8, 0.6, 0.25, 1), 1.0, 0.3, None)):
        m = bpy.data.materials.new(nm)
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Base Color'].default_value = col
        b.inputs['Metallic'].default_value = met
        b.inputs['Roughness'].default_value = rough
        if emit:
            b.inputs['Emission Color'].default_value = emit
            b.inputs['Emission Strength'].default_value = 4.0
        me.materials.append(m)

    def add_box(c, s, mi):
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']:
            v.co = Vector((c.x + v.co.x * s.x, c.y + v.co.y * s.y, c.z + v.co.z * s.z))
        for f in {f for v in r['verts'] for f in v.link_faces}:
            f.material_index = mi

    cx = (CARD_LEN / 2) - GRIP_BACK
    add_box(Vector((cx, 0, CARD_Z_OFF)), Vector((CARD_LEN, CARD_T, CARD_H)), 0)
    # 卡尾的青色发光条（两面都有）、卡头的金色触点
    for sy in (1, -1):
        add_box(Vector((-GRIP_BACK + 0.006, sy * (CARD_T / 2 + 0.0002), CARD_Z_OFF)), Vector((0.004, 0.0004, CARD_H * 0.8)), 1)
        add_box(Vector((LEAD - 0.008, sy * (CARD_T / 2 + 0.0002), CARD_Z_OFF)), Vector((0.010, 0.0004, CARD_H * 0.5)), 2)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('EvidenceCard', me)
    sc.collection.objects.link(ob)
    ob.rotation_mode = 'QUATERNION'
    return ob


card = build_card()

# 卡插到底时的位姿：卡头方向 = 往槽里（-N），卡面法线朝车尾（+Y，拇指一侧，对着镜头），高度方向 = 竖直
X_in = -N
Y_in = (Vector((0, 1, 0)) - X_in * X_in.dot(Vector((0, 1, 0)))).normalized()
Z_in = X_in.cross(Y_in)
CARD_ROT = Matrix((X_in, Y_in, Z_in)).transposed()
POS_IN = MOUTH + X_in * (DEPTH - LEAD)
POS_IN = POS_IN + Z_in * ((SLOT - POS_IN).dot(Z_in) - CARD_Z_OFF)   # 卡的竖直中心对准卡槽中心
POS_READY = POS_IN - X_in * (DEPTH + READY_OUT)

# ---------- 手指：先摆钥匙式侧捏，再算卡在手里的位置 ----------
for f, degs in CURL.items():
    for j, d in zip((1, 2, 3), degs):
        rig.pose.bones[f'{f}_{j}'].rotation_euler.x = math.radians(d)
vl.update()

# 手的朝向：卡面法线 = 骨架 +Z（拇指一侧），前臂朝肩膀点
fa_bone = rig.data.bones['forearm']
elbow_dir = fa_bone.head_local - fa_bone.tail_local
Rr = frame(Y_in, shoulder - POS_READY) @ frame(Vector((0, 0, 1)), elbow_dir).transposed()
f_rig = (Rr.transposed() @ X_in).normalized()          # 卡头方向在骨架里的方向
ib = rig.pose.bones['index_2']
contact = (ib.head + ib.tail) / 2 + Vector((0, 0, FINGER_R + CARD_T / 2))
Zr = Vector((0, 0, 1))
CARD_IN_RIG = Matrix.Translation(contact) @ Matrix((f_rig, Zr, f_rig.cross(Zr))).transposed().to_4x4()

hand = bpy.data.objects.new('Card_Hand', None)
hand.empty_display_type = 'ARROWS'
hand.empty_display_size = 0.05
sc.collection.objects.link(hand)
hand.rotation_mode = 'QUATERNION'
rig.parent = hand
rig.matrix_parent_inverse = Matrix.Identity(4)
rig.matrix_basis = CARD_IN_RIG.inverted()      # Card_Hand 的位姿 = 「手里那张卡」的位姿


def put_hand(pos, rot):
    hand.location = pos
    hand.rotation_quaternion = rot


Q_IN = CARD_ROT.to_quaternion()
put_hand(POS_READY, Q_IN)
card.location = POS_READY
card.rotation_quaternion = Q_IN
vl.update()

# 拇指：指尖压到卡上面、捏点稍往卡头一点，再弯后两节直到碰到卡
bvh = BVHTree.FromPolygons([card.matrix_world @ v.co for v in card.data.vertices], [p.vertices for p in card.data.polygons])


def seg_points(names, n=5):
    pts = []
    for nm in names:
        pb = rig.pose.bones[nm]
        h, t = rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail
        pts += [h.lerp(t, i / n) for i in range(1, n + 1)]
    return pts


def touching(pts, r=FINGER_R):
    for p in pts:
        loc, nrm, _, d = bvh.find_nearest(p)
        if loc is not None and (d < r or (p - loc).dot(nrm) < 0):
            return True
    return False


thumb_target = card.matrix_world @ Vector((0.004, CARD_T / 2 + FINGER_R, CARD_Z_OFF - 0.004))
pb = rig.pose.bones['thumb_1']
tip = rig.pose.bones['thumb_3']
h = pb.head.copy()
q = (tip.tail - h).rotation_difference(rig.matrix_world.inverted() @ thumb_target - h)
pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
pb.location = (0, 0, 0)
vl.update()
for j in (2, 3):
    p2 = rig.pose.bones[f'thumb_{j}']
    base = p2.rotation_euler.x
    d = 0.0
    while d < 80:
        p2.rotation_euler.x = base + math.radians(d + 1)
        vl.update()
        if touching(seg_points([f'thumb_{k}' for k in range(j, 4)])):
            p2.rotation_euler.x = base + math.radians(d)
            break
        d += 1
vl.update()
print('index touching card at grip:', touching(seg_points(['index_2']), r=FINGER_R * 0.6))

FINGERS = [f'{f}_{j}' for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for j in (1, 2, 3)]
GRIP = {n: rig.pose.bones[n].rotation_euler.copy() for n in FINGERS}
OPEN = {}
for n in FINGERS:
    k = OPEN_THUMB if n.startswith('thumb') else OPEN_INDEX if n.startswith('index') else 0.0
    OPEN[n] = Vector(GRIP[n]).lerp(Vector((0, 0, 0)), k)
hand_keep = rig.pose.bones['hand'].matrix.copy()
fa_rest = fa_bone.matrix_local.copy()
wrist = fa_bone.tail_local.copy()

# ---------- 时间轴 ----------
hidden_off = right * 0.22 - cup * 0.42 - fwd * 0.12
Q_HID = Quaternion(right, -0.7) @ Q_IN
POS_HID = POS_READY + hidden_off
BACK_OFF = -X_in * 0.018 + Z_in * 0.004       # 松手后手往外退一点


def lerp_pose(a, b, u):
    e = ss(u)
    return a[0].lerp(b[0], e), a[1].slerp(b[1], e)


P_HID = (POS_HID, Q_HID)
P_READY = (POS_READY, Q_IN)
P_ALIGN = (POS_READY + X_in * 0.02, Q_IN)
P_IN = (POS_IN, Q_IN)
P_OFF = (POS_IN + BACK_OFF, Q_IN)
P_OUT = (POS_IN - X_in * (DEPTH + 0.06), Q_IN)


def pose_at(t):
    """返回 (手的位姿, 卡是否在手里, 手指张开程度 0 捏紧 ~ 1 张开)"""
    if t < T_RAISE:
        return lerp_pose(P_HID, P_READY, t / T_RAISE), True, 0
    t1 = T_RAISE
    if t < t1 + T_ALIGN:
        return lerp_pose(P_READY, P_ALIGN, (t - t1) / T_ALIGN), True, 0
    t1 += T_ALIGN
    if t < HIT:
        return lerp_pose(P_ALIGN, P_IN, (t - t1) / T_PUSH), True, 0
    if t < HIT + T_REL:
        u = (t - HIT) / T_REL
        return lerp_pose(P_IN, P_OFF, u), False, ss(u)
    if t < PULL0:
        return lerp_pose(P_OFF, P_HID, (t - HIT - T_REL) / T_RET), False, 1
    t1 = PULL0
    if t < t1 + T_REACH:
        return lerp_pose(P_HID, P_OFF, (t - t1) / T_REACH), False, 1
    t1 += T_REACH
    if t < t1 + T_PINCH:
        u = (t - t1) / T_PINCH
        return lerp_pose(P_OFF, P_IN, u), False, 1 - ss(u)
    t1 += T_PINCH
    if t < t1 + T_PULL:
        return lerp_pose(P_IN, P_OUT, (t - t1) / T_PULL), True, 0
    t1 += T_PULL
    return lerp_pose(P_OUT, P_HID, (t - t1) / T_DROP), True, 0


n = int(round(TOTAL * FPS)) + 1
sc.frame_start, sc.frame_end = 1, n
fa = rig.pose.bones['forearm']
hd = rig.pose.bones['hand']
rig_basis = rig.matrix_basis.copy()
for f in range(1, n + 1):
    t = (f - 1) / FPS
    (pos, rot), held, open_k = pose_at(t)
    put_hand(pos, rot)
    hand.keyframe_insert('location', frame=f)
    hand.keyframe_insert('rotation_quaternion', frame=f)
    if held:
        card.location, card.rotation_quaternion = pos, rot
    else:
        card.location, card.rotation_quaternion = POS_IN, Q_IN
    card.keyframe_insert('location', frame=f)
    card.keyframe_insert('rotation_quaternion', frame=f)

    rig_w = Matrix.Translation(pos) @ rot.to_matrix().to_4x4() @ rig_basis
    s_local = rig_w.inverted() @ shoulder
    rq = elbow_dir.rotation_difference(s_local - wrist)
    fa.matrix = Matrix.Translation(wrist) @ rq.to_matrix().to_4x4() @ Matrix.Translation(-wrist) @ fa_rest
    vl.update()
    hd.matrix = hand_keep
    vl.update()
    for b in (fa, hd):
        b.keyframe_insert('rotation_euler', frame=f)
        b.keyframe_insert('location', frame=f)
    for nm in FINGERS:
        rig.pose.bones[nm].rotation_euler = Vector(GRIP[nm]).lerp(OPEN[nm], open_k)
        rig.pose.bones[nm].keyframe_insert('rotation_euler', frame=f)


def all_fcurves(act):
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out += list(bag.fcurves)
    return out


for o in (hand, card, rig):
    for fc in all_fcurves(o.animation_data.action):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
hand.animation_data.action.name = 'Card_Hand'
card.animation_data.action.name = 'Card_Card'
rig.animation_data.action.name = 'Card_Fingers'

# ---------- 预览用的灯光 / 世界 ----------
w = bpy.data.worlds.new('CardWorld')
sc.world = w
w.use_nodes = True
bg = next(nd for nd in w.node_tree.nodes if nd.type == 'BACKGROUND')
bg.inputs[0].default_value = (0.25, 0.3, 0.38, 1)
for name, rot, col, e in (('Key', (50, 0, -70), (0.85, 0.93, 1), 4.0), ('RimC', (70, 0, 120), (0.2, 0.9, 1), 2.5), ('RimM', (70, 0, -150), (1, 0.25, 0.6), 1.5)):
    lo = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
    sc.collection.objects.link(lo)
    lo.data.energy = e
    lo.data.color = col
    lo.rotation_euler = [math.radians(a) for a in rot]
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=DST)
print('HIT', round(HIT, 3), 'INSERT_END', round(INSERT_END, 3), 'PULL0', PULL0, 'PULL_END', round(PULL_END, 3), 'frames', n, 'saved', DST)

if RENDER:
    import os
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    for t in (0.3, 0.5, HIT, HIT + 0.12, INSERT_END - 0.1, PULL0 + 0.45, PULL0 + 0.7, PULL0 + 0.9):
        fr = int(round(t * FPS)) + 1
        sc.frame_set(fr)
        sc.render.filepath = PREVIEW_DIR + f'f{fr:03d}.png'
        bpy.ops.render.render(write_still=True)
    # 握法特写
    sc.frame_set(int(round(0.5 * FPS)) + 1)
    G = card.matrix_world.translation.copy()
    c2 = bpy.data.objects.new('CloseCam', bpy.data.cameras.new('CloseCam'))
    sc.collection.objects.link(c2)
    c2.data.clip_start = 0.005
    c2.data.lens = 45
    sc.camera = c2
    sc.render.resolution_x, sc.render.resolution_y = 700, 520
    for k, d in {'fromcam': -fwd, 'top': Vector((0, 0, 1)), 'side': Vector((0, -1, 0.3)), 'under': Vector((0.2, 0.3, -1))}.items():
        d = d.normalized()
        c2.location = G + d * 0.3
        c2.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = PREVIEW_DIR + f'close_{k}.png'
        bpy.ops.render.render(write_still=True)
    sc.camera = cam
    print('rendered', PREVIEW_DIR)
