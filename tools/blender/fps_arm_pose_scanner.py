# 握扫描枪：扫描枪摆进手里（握把右侧贴手心、前沿在指根后面、扳机对着食指），
# 手指从伸直开始逐节往手心弯，碰到扫描枪就停；拇指贴握把左侧
# 扫描枪挂到 prop 骨骼，姿势存成动作 Grip_Scanner
# 先跑 fps_arm_setup.py、fps_arm_rig.py
import bpy, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

sc = bpy.data.scenes['FPSArm']
vl = sc.view_layers[0]
rig = sc.objects['FPSArm_Rig']
scanner = sc.objects['Scanner']

# 扫描枪：模型本地前（扫描窗）+X，上 +Z，长 1.0。握把自带约 26° 后倾，和四指根部连线（约 23°）基本一致，不用再转
SCALE = 0.20
GRIP_LOCAL = Vector((-0.32, 0, 0.32))         # 握把上段中心
# 手的坐标：X 贴手心（手心表面 X≈-0.16，握把半宽 1.7 cm）；Y 让握把前沿落在中指根后面一个指头半径；
# Z 让扳机（模型 z≈0.36）对着食指
GRIP_HAND = Vector((-0.143, -0.290, -0.008))
THUMB_LOCAL = Vector((-0.22, 0.13, 0.43))     # 拇指尖贴的位置（扫描枪本地：握把左上、机头下方）

FINGER_R = 0.0085                            # 手指半径
MAX_DEG = {1: 95, 2: 105, 3: 75}
STEP = 1.5


def scanner_matrix():
    return (Matrix.Translation(GRIP_HAND) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
            @ Matrix.Diagonal((SCALE, SCALE, SCALE, 1)) @ Matrix.Translation(-GRIP_LOCAL))


def reset_pose():
    if rig.animation_data:
        rig.animation_data.action = None    # 否则每次刷新都会被旧关键帧盖回去
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    vl.update()


def seg_points(names, n=5):
    pts = []
    for nm in names:
        pb = rig.pose.bones[nm]
        h, t = rig.matrix_world @ pb.head, rig.matrix_world @ pb.tail
        pts += [h.lerp(t, i / n) for i in range(1, n + 1)]
    return pts


scanner.parent = None
scanner.matrix_world = scanner_matrix()
reset_pose()
bvh = BVHTree.FromPolygons([scanner.matrix_world @ v.co for v in scanner.data.vertices],
                           [p.vertices for p in scanner.data.polygons])


def touching(pts):
    for p in pts:
        loc, nrm, _, d = bvh.find_nearest(p)
        if loc is not None and (d < FINGER_R or (p - loc).dot(nrm) < 0):
            return True
    return False


def curl(finger, joints=(1, 2, 3)):
    log = []
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
        log.append(round(deg, 1))
    return log


RATIO = (1.0, 1.15, 0.75)   # 三节一起弯的比例（掌指 : 近端 : 远端），比一节节弯更像真手


def curl_coupled(finger):
    # 先三节按比例一起弯到第一次碰到，再让没碰到的远端几节继续弯
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
    return [round(t, 1)] + curl(finger, joints=(2, 3))


# 手腕：手和扫描枪不动，前臂绕手腕把肘部压低、往外摆（原模型前臂几乎水平、肘比手还高，第一人称里像从侧面伸进来）
ELBOW_PITCH = math.radians(-15)   # 绕 X：负值肘部往下（压太多手套和袖口之间会拉开露出手腕）
ELBOW_YAW = math.radians(8)       # 绕 Z：正值肘部往右（-X）


def bend_wrist():
    fa, hd = rig.pose.bones['forearm'], rig.pose.bones['hand']
    w = fa.tail.copy()
    keep = hd.matrix.copy()
    r = (Matrix.Rotation(ELBOW_YAW, 4, 'Z') @ Matrix.Rotation(ELBOW_PITCH, 4, 'X'))
    fa.matrix = Matrix.Translation(w) @ r @ Matrix.Translation(-w) @ fa.matrix
    vl.update()
    hd.matrix = keep
    vl.update()


bend_wrist()
rest = {f: touching(seg_points([f'{f}_1', f'{f}_2', f'{f}_3'])) for f in ('index', 'middle', 'ring', 'pinky', 'thumb')}
print('touching at rest', rest)
result = {f: curl_coupled(f) for f in ('index', 'middle', 'ring', 'pinky')}

# 拇指：先指向握把左上，再弯后两节
target = scanner.matrix_world @ THUMB_LOCAL
pb = rig.pose.bones['thumb_1']
tip = rig.pose.bones['thumb_3']
h = pb.head.copy()
q = (tip.tail - h).rotation_difference(rig.matrix_world.inverted() @ target - h)
pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
pb.location = (0, 0, 0)
vl.update()
result['thumb'] = curl('thumb', joints=(2, 3))
print('curl', result)

# 扫描枪挂到 prop 骨骼（保持世界位置）
mw = scanner.matrix_world.copy()
scanner.parent = rig
scanner.parent_type = 'BONE'
scanner.parent_bone = 'prop'
vl.update()
scanner.matrix_world = mw

# 存成动作
act = bpy.data.actions.get('Grip_Scanner') or bpy.data.actions.new('Grip_Scanner')
act.use_fake_user = True
if rig.animation_data is None:
    rig.animation_data_create()
rig.animation_data.action = act
for b in rig.pose.bones:
    b.keyframe_insert('rotation_euler', frame=1)
    b.keyframe_insert('location', frame=1)
