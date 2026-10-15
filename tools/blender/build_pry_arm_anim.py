# 第 3 轮撬门（骨骼手版）：新建工程 art/pry_arm_anim.blend，逐帧烘焙「右手握撬棍撬门」
# 后台运行（不碰其他 .blend）：
#   Blender -b --factory-startup --python tools/blender/build_pry_arm_anim.py [-- render]
# 内容：
#   supercar_door.glb（车身 + Door_R，只做参考，不导出）
#   Pry_Lever：空物体，原点在门尾接触点。位置/旋转和旧版 build_pry_anim.py 完全相同，游戏的时间常数不用改
#     ├ Crowbar：程序生成的鹅颈撬棍（弯钩在门缝，直柄穿过手心）
#     └ FPSArm_Rig + RightArm：art/fps_arm_rig.blend 的骨骼右手，手指按碰撞弯曲握住撬棍
#   每帧：前臂绕手腕转向画面右下的「肩膀点」（手跟着撬棍转，胳膊不跟着甩）；拽的时候手指再攥紧一点
#   PryCam：撬门镜头（和旧版一致），导出时取第 1 帧存成 PryCamRest
# 坐标（Blender）：车头 -Y，右侧（副驾）-X，上 +Z；Door_R 原点在前铰链，绕 Z 转，正角度门尾外翻
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
DST = ROOT + 'art/pry_arm_anim.blend'
RENDER = 'render' in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else False
PREVIEW_DIR = '/var/folders/hs/pz321y21609c2c2c8spyxc400000gn/T/opencode/pry/'

# ---------- 时间轴：与旧版 build_pry_anim.py、state.js、pryArm.js 一致 ----------
FPS = 30
PRY_KEYS = [(0, 7), (0.25, 11), (0.45, 9), (0.8, 14), (1.05, 12.5), (1.25, 13), (1.38, 24), (1.55, 27), (2.5, 54), (2.75, 57), (3.0, 55)]
PRY_END = 3.3
POP = 1.38
T_RAISE, T_JAB, T_SETTLE = 0.35, 0.18, 0.2
T0 = T_RAISE + T_JAB + T_SETTLE
TAIL = 0.3
K = 1.3
POP_DEG = 15
PULL = 0.06

DOOR_CONTACT = Vector((-0.05, 1.0, -0.07))
OUT = Vector((-1, 0, 0))
BACK = Vector((0, 1, 0))
UP = Vector((0, 0, 1))
CAM_OUT, CAM_BACK, CAM_Z = 0.8, 0.55, 1.5
CAM_FOV_Y = 65

# ---------- 撬棍尺寸（米） ----------
BAR_R = 0.0105          # 六角钢半径
HOOK_R = 0.035          # 鹅颈弯曲半径
HOOK_DEG = 110          # 鹅颈弯过的角度
CLAW_LEN = 0.022        # 弯钩末端扁爪
BUTT = 0.12             # 握点往后还留多长

# ---------- 手（骨架坐标：手指 -Y，上 +Z，手心朝 +X） ----------
GRIP_P = Vector((-0.1475, -0.297, -0.02))        # 撬棍轴线穿过手心的点
GRIP_A = Vector((0.0, -0.38, 0.92)).normalized()  # 撬棍在手里的方向（拇指一侧 = 弯钩一侧），和四指根部连线平行
FINGER_R = 0.0085
MAX_DEG = {1: 95, 2: 105, 3: 80}
STEP = 1.0
RATIO = (1.0, 1.15, 0.75)
SQUEEZE = (2.0, 4.0, 4.0)   # 拽的时候三节手指各再攥紧几度


def smoothstep(x, a, b):
    t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def ss(u):
    u = min(1, max(0, u))
    return u * u * u * (u * (u * 6 - 15) + 10)


def pry_angle(t):
    if t <= 0:
        return PRY_KEYS[0][1]
    for i in range(1, len(PRY_KEYS)):
        t1, a1 = PRY_KEYS[i]
        t0, a0 = PRY_KEYS[i - 1]
        if t <= t1:
            return a0 + (a1 - a0) * smoothstep(t, t0, t1)
    return PRY_KEYS[-1][1]


def frame(x, y):
    x = x.normalized()
    y = (y - x * y.dot(x)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


# ---------- 新工程 ----------
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
sc.name = 'PryAnim'
sc.render.fps = FPS
vl = sc.view_layers[0]

bpy.ops.import_scene.gltf(filepath=ROOT + 'public/assets/supercar_door.glb')
door = bpy.data.objects['Door_R']
DOOR_LOC = door.location.copy()

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


def door_mat(deg):
    return Matrix.Translation(DOOR_LOC) @ Matrix.Rotation(math.radians(deg), 4, 'Z')


def contact(deg):
    return door_mat(deg) @ DOOR_CONTACT


# ---------- 镜头（和旧版一致） ----------
c7 = contact(7)
cam_pos = c7 + OUT * CAM_OUT + BACK * CAM_BACK
cam_pos.z = CAM_Z
look = c7 + BACK * -0.35 + UP * 0.15
fwd = (look - cam_pos).normalized()
right = fwd.cross(UP).normalized()
cup = right.cross(fwd)
cam_rot = Matrix((right, cup, -fwd)).transposed().to_quaternion()
cam_data = bpy.data.cameras.new('PryCam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(CAM_FOV_Y)
cam_data.clip_start = 0.05
cam = bpy.data.objects.new('PryCam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam.rotation_mode = 'QUATERNION'

hand_target = cam_pos + fwd * 0.42 + right * 0.12 - cup * 0.07   # 握点：画面右下、拳头完整入画
shoulder = cam_pos + right * 0.24 - cup * 0.34 - fwd * 0.15     # 胳膊始终朝这个点（画面右下、镜头后面一点）
d_w = (hand_target - c7).normalized()
GRIP_DIST = (hand_target - c7).length

# ---------- 撬棍网格（撬棍坐标：+Z 指向弯钩，原点 = 鹅颈起弯处，弯钩往 +X 弯） ----------
def bar_path():
    pts = []   # (位置, 切线, 扁平系数 n 方向, 扁平系数 b 方向)
    L = GRIP_DIST + BUTT
    n = int(L / 0.015)
    for i in range(n + 1):
        z = -L + L * i / n
        fl = 1.0
        if z < -L + 0.035:                          # 直柄末端扁爪
            u = (z + L) / 0.035
            fl = 0.35 + 0.65 * u
        pts.append((Vector((0, 0, z)), Vector((0, 0, 1)), fl, 1.0 + (1 - fl) * 0.5))
    for k in range(1, 12):
        th = math.radians(HOOK_DEG * k / 11)
        p = Vector((HOOK_R - HOOK_R * math.cos(th), 0, HOOK_R * math.sin(th)))
        pts.append((p, Vector((math.sin(th), 0, math.cos(th))), 1.0, 1.0))
    th = math.radians(HOOK_DEG)
    tdir = Vector((math.sin(th), 0, math.cos(th)))
    end = pts[-1][0]
    for k in range(1, 5):
        u = k / 4
        pts.append((end + tdir * CLAW_LEN * u, tdir, 1.0 - 0.65 * u, 1.0 + 0.35 * u))
    return pts


def build_bar():
    me = bpy.data.meshes.new('Crowbar')
    bm = bmesh.new()
    sides = 6
    rings = []
    B = Vector((0, 1, 0))
    path = bar_path()
    for p, t, fn, fb in path:
        N = B.cross(t).normalized()
        ring = []
        for s in range(sides):
            a = 2 * math.pi * (s + 0.5) / sides
            ring.append(bm.verts.new(p + N * (math.cos(a) * BAR_R * fn) + B * (math.sin(a) * BAR_R * fb)))
        rings.append(ring)
    steel = bpy.data.materials.new('Crowbar_Steel')
    tape = bpy.data.materials.new('Crowbar_Tape')
    for m, col, met, rough in ((steel, (0.035, 0.037, 0.04, 1), 0.85, 0.42), (tape, (0.85, 0.6, 0.03, 1), 0.0, 0.55)):
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Base Color'].default_value = col
        b.inputs['Metallic'].default_value = met
        b.inputs['Roughness'].default_value = rough
    me.materials.append(steel)
    me.materials.append(tape)
    for i in range(len(rings) - 1):
        z = path[i][0].z
        # 握点前面一段缠黄黑胶带（参考图）：每 1.5 cm 一圈，黄黑相间
        is_tape = -GRIP_DIST + 0.07 < z < -GRIP_DIST + 0.25 and path[i][1].z > 0.99 and i % 2 == 0
        for s in range(sides):
            f = bm.faces.new((rings[i][s], rings[i][(s + 1) % sides], rings[i + 1][(s + 1) % sides], rings[i + 1][s]))
            f.material_index = 1 if is_tape else 0
            f.smooth = False
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('Crowbar', me)
    sc.collection.objects.link(ob)
    return ob, path[-1][0]


bar, tip_local = build_bar()

# 撬棍在世界里的朝向（门开 7°、撬棍插好时）：+Z 指向门缝，弯钩往车里（+X）钩
Zb = -d_w
Xb = (-OUT - Zb * (-OUT).dot(Zb)).normalized()
Yb = Zb.cross(Xb)
bar_world = Matrix.Translation(c7) @ Matrix((Xb, Yb, Zb)).transposed().to_4x4()

# 手：撬棍方向对齐 GRIP_A，前臂朝肩膀点，手心点落在握点上
G = c7 + d_w * GRIP_DIST
fa_bone = rig.data.bones['forearm']
elbow_dir = fa_bone.head_local - fa_bone.tail_local
Rr = frame(Zb, shoulder - G) @ frame(GRIP_A, elbow_dir).transposed()
rig_world = Matrix.Translation(G - Rr @ GRIP_P) @ Rr.to_4x4()

lever = bpy.data.objects.new('Pry_Lever', None)
lever.empty_display_type = 'ARROWS'
lever.empty_display_size = 0.08
sc.collection.objects.link(lever)
lever.rotation_mode = 'QUATERNION'
lever.location = c7
lever_rest = Matrix.Translation(c7)
for ob, mw in ((bar, bar_world), (rig, rig_world)):
    ob.parent = lever
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_basis = lever_rest.inverted() @ mw
vl.update()

# ---------- 手指按碰撞握住撬棍 ----------
bvh = BVHTree.FromPolygons([bar.matrix_world @ v.co for v in bar.data.vertices], [p.vertices for p in bar.data.polygons])


def seg_points(names, n=5):
    pts = []
    for nm in names:
        pb = rig.pose.bones[nm]
        h, t = rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail
        pts += [h.lerp(t, i / n) for i in range(1, n + 1)]
    return pts


def touching(pts):
    for p in pts:
        loc, nrm, _, d = bvh.find_nearest(p)
        if loc is not None and (d < FINGER_R or (p - loc).dot(nrm) < 0):
            return True
    return False


def curl(finger, joints=(1, 2, 3)):
    for j in joints:
        chain = [f'{finger}_{k}' for k in range(j, 4)]
        pb = rig.pose.bones[f'{finger}_{j}']
        base = pb.rotation_euler.x
        deg = 0.0
        while deg < MAX_DEG[j]:
            pb.rotation_euler.x = base + math.radians(deg + STEP)
            vl.update()
            if touching(seg_points(chain)):
                pb.rotation_euler.x = base + math.radians(deg)
                break
            deg += STEP
        vl.update()


def curl_coupled(finger):
    pbs = [rig.pose.bones[f'{finger}_{j}'] for j in (1, 2, 3)]
    chain = [p.name for p in pbs]
    t = 0.0
    while t < MAX_DEG[1]:
        for p, r, j in zip(pbs, RATIO, (1, 2, 3)):
            p.rotation_euler.x = math.radians(min(MAX_DEG[j], (t + STEP) * r))
        vl.update()
        if touching(seg_points(chain)):
            break
        t += STEP
    for p, r, j in zip(pbs, RATIO, (1, 2, 3)):
        p.rotation_euler.x = math.radians(min(MAX_DEG[j], t * r))
    vl.update()
    curl(finger, joints=(2, 3))


for f in ('index', 'middle', 'ring', 'pinky'):
    curl_coupled(f)
# 拇指：指尖压到撬棍外侧（离手心远的一面）、食指上方，再弯后两节
palm_n = Rr @ Vector((1, 0, 0))
thumb_target = G + palm_n * (BAR_R + 0.004) + Zb * 0.028
pb = rig.pose.bones['thumb_1']
tip = rig.pose.bones['thumb_3']
h = pb.head.copy()
q = (tip.tail - h).rotation_difference(rig.matrix_world.inverted() @ thumb_target - h)
pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
pb.location = (0, 0, 0)
vl.update()
curl('thumb', joints=(2, 3))
FINGERS = [f'{f}_{j}' for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for j in (1, 2, 3)]
grip_pose = {n: rig.pose.bones[n].rotation_euler.copy() for n in FINGERS}
hand_keep = rig.pose.bones['hand'].matrix.copy()
fa_rest = fa_bone.matrix_local.copy()
wrist = fa_bone.tail_local.copy()
print('grip', {n: tuple(round(math.degrees(a), 1) for a in e) for n, e in grip_pose.items() if n.endswith('_1')})

# ---------- 撬棍轨迹（与旧版一致） ----------
SIGN = 1 if UP.cross(G - c7).dot(Vector((cam_pos.x - c7.x, cam_pos.y - c7.y, 0))) > 0 else -1
TILT_AXIS = UP.cross(d_w).normalized()
hidden_off = right * 0.25 - cup * 0.45 - fwd * 0.1


def lever_pose(time):
    """返回 (位置, 旋转, 用力程度 0~1)"""
    if time < T_RAISE:
        u = ss(time / T_RAISE)
        return c7 + d_w * PULL + hidden_off * (1 - u), Quaternion(TILT_AXIS, -0.6 * (1 - u)), 0
    if time < T_RAISE + T_JAB:
        u = (time - T_RAISE) / T_JAB
        return c7 + d_w * PULL * (1 - u * u), Quaternion(), 0.3 * u
    if time < T0:
        u = (time - T_RAISE - T_JAB) / T_SETTLE
        s = math.sin(u * math.pi)
        return c7 + d_w * 0.008 * s - UP * 0.004 * s, Quaternion(), 0.3
    t = time - T0
    if t < POP:
        deg = pry_angle(t)
        tension = min(1, max(0, (deg - 7) / 7))
        a = 0.0012 if t < 0.8 else 0.0025 + 0.002 * (t - 0.8) / (POP - 0.8)
        off = right * a * math.sin(t * 113) + cup * a * math.sin(t * 97 + 1.3) - UP * 0.01 * tension
        q = Quaternion(UP, math.radians(SIGN * K * (deg - 7))) @ Quaternion(TILT_AXIS, 0.06 * tension)
        return contact(deg) + off, q, 0.3 + 0.7 * tension
    p = t - POP
    lev = K * 6 + POP_DEG * (1 - (1 - min(1, p / 0.08)) ** 3)
    q = Quaternion(UP, math.radians(SIGN * lev))
    slide = (q @ d_w) * 0.07 * ss(p / 0.15)
    r = ss(p / 0.22)
    off = (right * 0.06 - cup * 0.05 - fwd * 0.08) * r
    dn = ss((t - 1.6) / 0.5)
    off = off.lerp(hidden_off, dn)
    q = q @ Quaternion(TILT_AXIS, -0.6 * dn)
    return contact(13) + slide + off, q, max(0, 1 - p / 0.25)


# ---------- 逐帧烘焙 ----------
door.rotation_mode = 'XYZ'
rng = random.Random(7)
total = T0 + PRY_END + TAIL
n = int(round(total * FPS)) + 1
sc.frame_start, sc.frame_end = 1, n
rig_basis = rig.matrix_basis.copy()
fa = rig.pose.bones['forearm']
hd = rig.pose.bones['hand']

for f in range(1, n + 1):
    time = (f - 1) / FPS
    t = time - T0
    deg = 7 if t < 0 else pry_angle(min(t, PRY_END))
    door.rotation_euler = (0, 0, math.radians(deg))
    door.keyframe_insert('rotation_euler', index=2, frame=f)

    pos, q, effort = lever_pose(time)
    lever.location = pos
    lever.rotation_quaternion = q
    lever.keyframe_insert('location', frame=f)
    lever.keyframe_insert('rotation_quaternion', frame=f)

    # 前臂绕手腕转向肩膀点：手在撬棍上不动，胳膊不跟着撬棍甩
    rig_w = Matrix.Translation(pos) @ q.to_matrix().to_4x4() @ rig_basis
    s_local = rig_w.inverted() @ shoulder
    rq = elbow_dir.rotation_difference(s_local - wrist)
    fa.matrix = Matrix.Translation(wrist) @ rq.to_matrix().to_4x4() @ Matrix.Translation(-wrist) @ fa_rest
    vl.update()
    hd.matrix = hand_keep
    vl.update()
    for b in (fa, hd):
        b.keyframe_insert('rotation_euler', frame=f)
        b.keyframe_insert('location', frame=f)
    # 用力时手指攥紧
    for nm in FINGERS:
        e = grip_pose[nm].copy()
        j = int(nm[-1])
        e.x += math.radians(SQUEEZE[j - 1] * effort)
        rig.pose.bones[nm].rotation_euler = e
        rig.pose.bones[nm].keyframe_insert('rotation_euler', frame=f)

    tug = max(0, math.sin(t * 9)) * 0.012 if 0 <= t < 1.3 else 0
    jolt = max(0, 1 - abs(t - 1.4) / 0.25) * 0.03 if t >= 0 else 0
    cam.location = cam_pos + Vector(((rng.random() - 0.5) * jolt, 0, (rng.random() - 0.5) * jolt - tug))
    cam.rotation_quaternion = cam_rot
    cam.keyframe_insert('location', frame=f)
    cam.keyframe_insert('rotation_quaternion', frame=f)


def all_fcurves(act):
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out += list(bag.fcurves)
    return out


for o in (door, lever, cam, rig):
    if o.animation_data and o.animation_data.action:
        for fc in all_fcurves(o.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
if rig.animation_data and rig.animation_data.action:
    rig.animation_data.action.name = 'Pry_Hand'
lever.animation_data.action.name = 'Pry_Lever'

# ---------- 预览用的灯光 / 世界 ----------
w = bpy.data.worlds.new('PryWorld')
sc.world = w
w.use_nodes = True
bg = next(nd for nd in w.node_tree.nodes if nd.type == 'BACKGROUND')
bg.inputs[0].default_value = (0.25, 0.3, 0.38, 1)
for name, rot, col, e in (('PryKey', (50, 0, -70), (0.85, 0.93, 1), 5.0), ('PryRimC', (70, 0, 120), (0.2, 0.9, 1), 3.0), ('PryRimM', (70, 0, -150), (1, 0.25, 0.6), 2.0)):
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
print('cam', tuple(round(v, 3) for v in cam_pos), 'grip dist', round(GRIP_DIST, 3), 'sign', SIGN, 'frames', n, 'saved', DST)

if RENDER:
    import os
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    for fr in (12, 20, 30, 45, 60, 66, 75):
        sc.frame_set(fr)
        sc.render.filepath = PREVIEW_DIR + f'f{fr:03d}.png'
        bpy.ops.render.render(write_still=True)
    print('rendered', PREVIEW_DIR)
