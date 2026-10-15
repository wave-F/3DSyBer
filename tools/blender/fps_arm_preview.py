# FPSArm 场景预览渲染：几个固定角度出图到 OUT_DIR（只为了检查，不影响导出）
import bpy, math
from mathutils import Vector, Matrix

OUT_DIR = '/var/folders/hs/pz321y21609c2c2c8spyxc400000gn/T/opencode/arm/'
sc = bpy.data.scenes['FPSArm']
TARGET = Vector((-0.15, -0.33, 0.0))
VIEWS = {
    # 名字: (相机方向（从目标指向相机）, 距离, 镜头焦距 mm)
    'game': (Vector((-0.35, 1.0, 0.45)), 0.55, 35),
    'outer': (Vector((-1, 0.05, 0.1)), 0.45, 50),
    'inner': (Vector((1, 0.1, 0.15)), 0.45, 50),
    'front': (Vector((0.2, -1, 0.2)), 0.45, 50),
    'top': (Vector((0.05, 0.2, 1)), 0.45, 50),
}
RES = (900, 700)

cam = sc.objects.get('PreviewCam')
if cam is None:
    cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
    sc.collection.objects.link(cam)
cam.data.clip_start = 0.01
sc.camera = cam
for name, rot, col, e in (('PrevKey', (50, 0, 30), (0.9, 0.95, 1), 3.0),
                          ('PrevRimC', (70, 0, 140), (0.2, 0.9, 1), 2.0),
                          ('PrevRimM', (70, 0, -140), (1, 0.3, 0.65), 1.2)):
    lo = sc.objects.get(name)
    if lo is None:
        lo = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        sc.collection.objects.link(lo)
    lo.data.energy = e
    lo.data.color = col
    lo.rotation_euler = [math.radians(a) for a in rot]
w = bpy.data.worlds.get('FPSArmWorld') or bpy.data.worlds.new('FPSArmWorld')
sc.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs[0].default_value = (0.16, 0.18, 0.22, 1)
bg.inputs[1].default_value = 1.0
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
sc.render.film_transparent = False
rig = sc.objects.get('FPSArm_Rig')
if rig:
    rig.hide_render = True


def render_game(grip, offset=(0.12, -0.15, -0.45), tag='', res=(1280, 720), pitch=0.0, yaw=0.0):
    # 模拟游戏镜头：握把在相机空间的位置 = viewmodel.js 的扫描姿态 POSE.scan.pos；竖直视角 65°
    # 手的坐标：前 -Y、上 +Z、右 -X
    # pitch / yaw：整只手在相机里的朝向（度）。pitch 正值 = 枪口抬起、肘部更低；yaw 正值 = 枪口往左转
    right, up, fwd = Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))
    r = Matrix.Rotation(math.radians(-yaw), 3, up) @ Matrix.Rotation(math.radians(-pitch), 3, right)
    right, up, fwd = r @ right, r @ up, r @ fwd
    ox, oy, oz = offset
    cam.location = Vector(grip) - (right * ox + up * oy + fwd * -oz)
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = math.radians(65)
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = OUT_DIR + f'prev{tag}_gamecam.png'
    win = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=win, scene=sc):
        bpy.ops.render.render(write_still=True, scene=sc.name)
    cam.data.sensor_fit = 'AUTO'
    sc.render.resolution_x, sc.render.resolution_y = RES
    return sc.render.filepath


def render(names=None, target=None, tag=''):
    t = target or TARGET
    out = []
    for k, (d, dist, lens) in VIEWS.items():
        if names and k not in names:
            continue
        d = d.normalized()
        cam.location = t + d * dist
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        sc.render.filepath = OUT_DIR + f'prev{tag}_{k}.png'
        win = bpy.context.window_manager.windows[0]
        with bpy.context.temp_override(window=win, scene=sc):
            bpy.ops.render.render(write_still=True, scene=sc.name)
        out.append(sc.render.filepath)
    return out
