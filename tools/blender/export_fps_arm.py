# 导出第一人称右手给游戏：public/assets/fps-arm.glb
# 内容：FPSArm_Rig（18 根骨骼，蒙皮）+ RightArm + 挂在 prop 骨上的 Scanner
#       + 两个定位空物体（也挂在 prop 骨上，跟着手动）：
#         Grip     握把中心（手掌中心），游戏里把它对齐到 holder 原点
#         Emitter  扫描窗中心，游戏里把发光圈/点光放在这里
# 动作：rig 上所有以 Grip_ 开头的动作（目前只有 Grip_Scanner，单帧姿势）
# 坐标：glTF Y-up 后手的前方为 +Z、上 +Y，游戏里绕 Y 转 180° 变成前 -Z
# 贴图导出时临时缩到 1024（不改动 blend 里的原图）
# 前提：先跑 fps_arm_setup.py、fps_arm_rig.py、fps_arm_pose_scanner.py
import bpy, os
from mathutils import Vector, Matrix

OUT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/public/assets/fps-arm.glb'
TEX_MAX = 1024
GRIP_LOCAL = Vector((-0.32, 0, 0.32))   # 与 fps_arm_pose_scanner.py 相同：扫描枪本地的握把上段中心

# 建议后台跑（交互界面里经 bridge 定时器调用导出曾导致崩溃）：
#   Blender -b art/fps_arm.blend --python tools/blender/export_fps_arm.py
sc = bpy.data.scenes['FPSArm']
wins = bpy.context.window_manager.windows
win = wins[0] if wins else None
prev_scene = win.scene if win else None
if win:
    win.scene = sc
vl = sc.view_layers[0]
rig = sc.objects['FPSArm_Rig']
arm = sc.objects['RightArm']
scanner = sc.objects['Scanner']

if rig.animation_data is None or rig.animation_data.action is None:
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions['Grip_Scanner']
sc.frame_set(1)
vl.update()

# 扫描窗中心：本地 +X 最前面那一段顶点的包围盒中心
vs = [v.co for v in scanner.data.vertices]
mx = max(v.x for v in vs)
front = [v for v in vs if v.x > mx - 0.06]
lo = Vector([min(v[i] for v in front) for i in range(3)])
hi = Vector([max(v[i] for v in front) for i in range(3)])
EMIT_LOCAL = Vector((mx, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))


def bone_empty(name, world):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    sc.collection.objects.link(e)
    e.parent = rig
    e.parent_type = 'BONE'
    e.parent_bone = 'prop'
    vl.update()
    e.matrix_world = Matrix.Translation(world)
    return e


grip = bone_empty('Grip', scanner.matrix_world @ GRIP_LOCAL)
emit = bone_empty('Emitter', scanner.matrix_world @ EMIT_LOCAL)

# 贴图临时缩小：复制一份缩到 1024，材质节点换成副本，导出完换回
swaps = []
for ob in (arm, scanner):
    for slot in ob.material_slots:
        if not slot.material or not slot.material.node_tree:
            continue
        for nd in slot.material.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and max(nd.image.size) > TEX_MAX:
                src = nd.image
                w, h = src.size
                k = TEX_MAX / max(w, h)
                small = src.copy()
                small.name = src.name + '_export'
                small.scale(int(w * k), int(h * k))
                nd.image = small
                swaps.append((nd, src, small))

for o in sc.objects:
    o.select_set(False)
for o in (rig, arm, scanner, grip, emit):
    o.hide_set(False, view_layer=vl)
    o.select_set(True, view_layer=vl)
vl.objects.active = rig

ctx = dict(scene=sc, view_layer=vl)
if win:
    ctx['window'] = win
try:
    with bpy.context.temp_override(**ctx):
        bpy.ops.export_scene.gltf(
            filepath=OUT,
            export_format='GLB',
            use_selection=True,
            export_yup=True,
            export_cameras=False,
            export_lights=False,
            export_skins=True,
            export_def_bones=False,          # prop 骨不变形，但扫描枪和定位点挂在上面，要导出
            export_animations=True,
            export_animation_mode='ACTIONS',
            export_force_sampling=True,
            export_image_format='WEBP',
            export_image_quality=85,
        )
finally:
    for nd, src, small in swaps:
        nd.image = src
        bpy.data.images.remove(small)
    for e in (grip, emit):
        bpy.data.objects.remove(e, do_unlink=True)
    if win:
        win.scene = prev_scene

print('emitter local', tuple(round(a, 4) for a in EMIT_LOCAL))
print('exported', OUT, os.path.getsize(OUT), 'bytes')
