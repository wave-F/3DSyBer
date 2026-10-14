# 第 3 轮撬门：在 Blender 里搭撬门镜头（车门 + 手握撬棍 + 镜头），逐帧烘焙动画
# 前提：当前文件里已有场景 PryAnim，导入了 public/assets/supercar_door.glb 和 撬棍.glb
# 坐标（Blender，导入 glTF 后）：车头 -Y，右侧（副驾）-X，上 +Z；Door_R 原点在前铰链，绕 Z 转，正角度门尾外翻
# 门的角度沿用 src/investigation/state.js 的 PRY_KEYS，节奏与游戏一致
import bpy, math, random
from mathutils import Vector, Matrix, Quaternion

FPS = 30
PRY_KEYS = [(0, 7), (0.25, 11), (0.45, 9), (0.8, 14), (1.05, 12.5), (1.25, 13), (1.38, 24), (1.55, 27), (2.5, 54), (2.75, 57), (3.0, 55)]
PRY_END = 3.3
POP = 1.38
T_RAISE, T_JAB, T_SETTLE = 0.35, 0.18, 0.2
T0 = T_RAISE + T_JAB + T_SETTLE          # 开始撬的时刻
TAIL = 0.3

S = 0.85             # 撬棍模型缩放（模型被归一化成 1 m）
K = 1.3              # 撬棍扳动角度 = (门角度 - 7°) × K
POP_DEG = 15         # 卡扣崩开时扳过头
PULL = 0.06          # 插入前弯钩停在缝外的距离

# 门本地坐标里的点（门尾外缘、把手高度）
DOOR_CONTACT = Vector((-0.05, 1.0, -0.07))
OUT = Vector((-1, 0, 0))
BACK = Vector((0, 1, 0))
UP = Vector((0, 0, 1))
CAM_OUT, CAM_BACK, CAM_Z = 0.8, 0.55, 1.5
CAM_FOV_Y = 65


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


sc = bpy.data.scenes['PryAnim']
bpy.context.window.scene = sc
sc.render.fps = FPS
door = sc.objects['Door_R']
bar = sc.objects.get('Crowbar') or [o for o in sc.objects if o.name.startswith('tripo_node')][0]
bar.name = 'Crowbar'
DOOR_LOC = door.location.copy()


def door_mat(deg):
    return Matrix.Translation(DOOR_LOC) @ Matrix.Rotation(math.radians(deg), 4, 'Z')


def contact(deg):
    return door_mat(deg) @ DOOR_CONTACT


# ---------- 清理上一次生成的内容 ----------
for n in ('Pry_Lever', 'PryCam'):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
for o in (door, bar):
    o.animation_data_clear()
bar.parent = None
bar.matrix_world = Matrix.Identity(4)

# ---------- 撬棍模型上的参考点（网格本地坐标，Tripo 导出：长轴 Y） ----------
vs = [v.co.copy() for v in bar.data.vertices]


def mean(pts):
    return sum(pts, Vector()) / len(pts)


hook_tip = mean(sorted(vs, key=lambda p: p.y)[:20])               # 鹅颈弯钩的爪尖
chisel = mean(sorted(vs, key=lambda p: -p.x)[:20])                # 直柄末端的扁爪
bend = mean([p for p in vs if -0.40 <= p.y < -0.33])              # 鹅颈起弯处
hand = mean([p for p in vs if -0.20 <= p.y < -0.05])              # 手
arm_end = mean([p for p in vs if p.y > 0.42])                     # 袖口末端


def frame(x, y):
    x = x.normalized()
    y = (y - x * y.dot(x)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


# ---------- 镜头 ----------
c7 = contact(7)
cam_pos = c7 + OUT * CAM_OUT + BACK * CAM_BACK
cam_pos.z = CAM_Z
look = c7 + BACK * -0.35 + UP * 0.15
fwd = (look - cam_pos).normalized()
right = fwd.cross(UP).normalized()
cup = right.cross(fwd)
cam_rot = Matrix((right, cup, -fwd)).transposed().to_quaternion()

cam_data = bpy.data.cameras.get('PryCam') or bpy.data.cameras.new('PryCam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(CAM_FOV_Y)
cam_data.clip_start = 0.05
cam = bpy.data.objects.new('PryCam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam.rotation_mode = 'QUATERNION'

# ---------- 撬棍朝向：弯钩在门缝，直柄指向画面右下的手 ----------
hand_target = cam_pos + fwd * 0.5 + right * 0.18 - cup * 0.2
arm_target = cam_pos + right * 0.35 - cup * 0.45 - fwd * 0.1
d_w = (hand_target - c7).normalized()
R0 = frame(-d_w, arm_target - hand_target) @ frame(bend - chisel, arm_end - hand).transposed()
local = Matrix.Translation(-(R0 @ (hook_tip * S))) @ R0.to_4x4() @ Matrix.Diagonal((S, S, S, 1))

lever = bpy.data.objects.new('Pry_Lever', None)
lever.empty_display_type = 'ARROWS'
lever.empty_display_size = 0.08
sc.collection.objects.link(lever)
lever.rotation_mode = 'QUATERNION'
bar.parent = lever
bar.matrix_parent_inverse = Matrix.Identity(4)
bar.matrix_basis = local

# 扳动方向：绕竖直轴正转时，手往镜头方向走则 sign = 1
hand_w = (local @ hand) 
to_cam = (cam_pos - c7)
to_cam.z = 0
SIGN = 1 if UP.cross(hand_w).dot(to_cam) > 0 else -1
TILT_AXIS = UP.cross(d_w).normalized()
hidden_off = right * 0.25 - cup * 0.45 - fwd * 0.1

# ---------- 逐帧烘焙 ----------
door.rotation_mode = 'XYZ'
rng = random.Random(7)
total = T0 + PRY_END + TAIL
n = int(round(total * FPS)) + 1
sc.frame_start, sc.frame_end = 1, n
sc.frame_current = 1


def lever_pose(time):
    """返回 (位置, 旋转, 是否可见)"""
    pitch = 0.0
    off = Vector()
    if time < T_RAISE:
        u = ss(time / T_RAISE)
        return c7 + d_w * PULL + hidden_off * (1 - u), Quaternion(TILT_AXIS, -0.6 * (1 - u)), True
    if time < T_RAISE + T_JAB:
        u = (time - T_RAISE) / T_JAB
        return c7 + d_w * PULL * (1 - u * u), Quaternion(), True
    if time < T0:
        u = (time - T_RAISE - T_JAB) / T_SETTLE
        s = math.sin(u * math.pi)
        return c7 + d_w * 0.008 * s - UP * 0.004 * s, Quaternion(), True
    t = time - T0
    if t < POP:
        deg = pry_angle(t)
        tension = min(1, max(0, (deg - 7) / 7))
        a = 0.0012 if t < 0.8 else 0.0025 + 0.002 * (t - 0.8) / (POP - 0.8)
        off = right * a * math.sin(t * 113) + cup * a * math.sin(t * 97 + 1.3) - UP * 0.01 * tension
        q = Quaternion(UP, math.radians(SIGN * K * (deg - 7))) @ Quaternion(TILT_AXIS, 0.06 * tension)
        return contact(deg) + off, q, True
    p = t - POP
    lev = K * 6 + POP_DEG * (1 - (1 - min(1, p / 0.08)) ** 3)
    q = Quaternion(UP, math.radians(SIGN * lev))
    slide = (q @ d_w) * 0.07 * ss(p / 0.15)
    r = ss(p / 0.22)
    off = (right * 0.06 - cup * 0.05 - fwd * 0.08) * r
    dn = ss((t - 1.6) / 0.5)
    off = off.lerp(hidden_off, dn)
    q = q @ Quaternion(TILT_AXIS, -0.6 * dn)
    return contact(13) + slide + off, q, t < 2.1


for f in range(1, n + 1):
    time = (f - 1) / FPS
    t = time - T0
    deg = 7 if t < 0 else pry_angle(min(t, PRY_END))
    door.rotation_euler = (0, 0, math.radians(deg))
    door.keyframe_insert('rotation_euler', index=2, frame=f)

    pos, q, vis = lever_pose(time)
    lever.location = pos
    lever.rotation_quaternion = q
    lever.keyframe_insert('location', frame=f)
    lever.keyframe_insert('rotation_quaternion', frame=f)
    bar.hide_render = not vis
    bar.hide_viewport = not vis
    bar.keyframe_insert('hide_render', frame=f)
    bar.keyframe_insert('hide_viewport', frame=f)

    # 镜头：拽的时候往下顿，卡扣崩开时一下抖动（和游戏的 tug / jolt 一致）
    tug = max(0, math.sin(t * 9)) * 0.012 if 0 <= t < 1.3 else 0
    jolt = max(0, 1 - abs(t - 1.4) / 0.25) * 0.03 if t >= 0 else 0
    cam.location = cam_pos + Vector(((rng.random() - 0.5) * jolt, 0, (rng.random() - 0.5) * jolt - tug))
    cam.rotation_quaternion = cam_rot
    cam.keyframe_insert('location', frame=f)
    cam.keyframe_insert('rotation_quaternion', frame=f)

for o in (door, lever, cam, bar):
    if o.animation_data and o.animation_data.action:
        act = o.animation_data.action
        fcs = []
        if hasattr(act, 'fcurves'):
            fcs = list(act.fcurves)
        else:
            for layer in act.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        fcs += list(bag.fcurves)
        for fc in fcs:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT' if fc.data_path.startswith('hide') else 'LINEAR'

# ---------- 灯光 / 世界（只为了在 Blender 里看效果） ----------
w = bpy.data.worlds.get('PryWorld') or bpy.data.worlds.new('PryWorld')
sc.world = w
w.use_nodes = True
nt = w.node_tree
bg = next((nd for nd in nt.nodes if nd.type == 'BACKGROUND'), None)
if bg is None:
    bg = nt.nodes.new('ShaderNodeBackground')
    out = next((nd for nd in nt.nodes if nd.type == 'OUTPUT_WORLD'), None) or nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs[0])
bg.inputs[0].default_value = (0.25, 0.3, 0.38, 1)
bg.inputs[1].default_value = 1.0
for name, rot, col, e in (('PryKey', (50, 0, -70), (0.85, 0.93, 1), 5.0), ('PryRimC', (70, 0, 120), (0.2, 0.9, 1), 3.0), ('PryRimM', (70, 0, -150), (1, 0.25, 0.6), 2.0)):
    lo = bpy.data.objects.get(name)
    if lo is None:
        lo = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        sc.collection.objects.link(lo)
    lo.data.energy = e
    lo.data.color = col
    lo.rotation_euler = [math.radians(a) for a in rot]
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.frame_set(1)

# 视口直接透过镜头看，材质预览，按空格播放
for win in bpy.context.window_manager.windows:
    for area in win.screen.areas:
        if area.type == 'VIEW_3D':
            sp = area.spaces.active
            sp.shading.type = 'MATERIAL'
            sp.region_3d.view_perspective = 'CAMERA'
            sp.lock_camera = False

print('cam', tuple(round(v, 3) for v in cam_pos), 'contact7', tuple(round(v, 3) for v in c7), 'sign', SIGN, 'frames', n, 'pry starts at frame', int(T0 * FPS) + 1)
