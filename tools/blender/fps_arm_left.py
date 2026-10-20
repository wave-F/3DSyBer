# 第一人称左手：从 art/fps_arms_src 里留下 +X 侧，按右手关节沿 X 镜像建骨骼并自动刷权重
# 网格是源模型自带的左手，不翻转右手网格
#   Blender -b --factory-startup --python tools/blender/fps_arm_left.py
# 关节与 tools/blender/fps_arm_rig.py 的右手一一对应（X 取反）
# 手指局部 Z 朝手心（-X），绕局部 X 正转 = 手指往手心弯
import bpy
import bmesh
from mathutils import Vector

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
OUT = ROOT + 'art/fps_arm_left.blend'

bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
sc.name = 'FPSArmLeft'
vl = sc.view_layers[0]

before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=ROOT + 'art/fps_arms_src/source/fpsarmsC.fbx')
arm = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
for o in [o for o in bpy.data.objects if o not in before and o is not arm]:
    bpy.data.objects.remove(o, do_unlink=True)
arm.parent = None
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True, view_layer=vl)
vl.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

_TEX = {'armccolor.png': 'armCcolor.png', 'armcnormal.png': 'armCNormal.png', 'armcroughness.png': 'armcRoughness.png'}
for im in bpy.data.images:
    if 'SOF4' in im.filepath:
        base = im.filepath.replace('\\', '/').split('/')[-1].lower()
        if base in _TEX:
            im.filepath = ROOT + 'art/fps_arms_src/textures/' + _TEX[base]

bm = bmesh.new()
bm.from_mesh(arm.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < 0], context='VERTS')
bm.to_mesh(arm.data)
bm.free()
arm.name = arm.data.name = 'LeftArm'

with bpy.data.libraries.load(ROOT + 'art/fps_arm.blend', link=False) as (src, dst):
    dst.materials = ['FPSArm_Mat']
arm.data.materials.clear()
arm.data.materials.append(bpy.data.materials['FPSArm_Mat'])

# 右手关节的 X 取反。手心朝 -X（朝身体中线）
def mx(p):
    return (-p[0], p[1], p[2])

J = {
    'forearm': [mx((-0.220, 0.240, 0.105)), mx((-0.203, -0.235, -0.010))],
    'hand': [mx((-0.203, -0.235, -0.010)), mx((-0.188, -0.330, -0.020))],
    'thumb': [mx((-0.180, -0.262, -0.008)), mx((-0.152, -0.295, 0.018)), mx((-0.127, -0.322, 0.032)), mx((-0.110, -0.344, 0.036))],
    'index': [mx((-0.180, -0.340, 0.004)), mx((-0.169, -0.385, -0.006)), mx((-0.153, -0.415, -0.011)), mx((-0.138, -0.440, -0.017))],
    'middle': [mx((-0.187, -0.335, -0.015)), mx((-0.169, -0.383, -0.033)), mx((-0.147, -0.413, -0.045)), mx((-0.127, -0.435, -0.056))],
    'ring': [mx((-0.192, -0.325, -0.035)), mx((-0.175, -0.366, -0.054)), mx((-0.150, -0.392, -0.068)), mx((-0.128, -0.410, -0.081))],
    'pinky': [mx((-0.192, -0.315, -0.055)), mx((-0.176, -0.345, -0.072)), mx((-0.146, -0.368, -0.083)), mx((-0.125, -0.384, -0.092))],
}
PALM = Vector((-1, 0, 0))
THUMB_CURL = Vector((-0.3, 0, -1))

ad = bpy.data.armatures.new('FPSArm_Rig')
rig = bpy.data.objects.new('FPSArm_Rig', ad)
sc.collection.objects.link(rig)
ad.display_type = 'STICK'
rig.show_in_front = True
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True, view_layer=vl)
vl.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = ad.edit_bones


def bone(name, head, tail, parent=None, roll_to=None, connect=False):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    if roll_to is not None:
        b.align_roll(roll_to)
    return b


bone('forearm', *J['forearm'], roll_to=PALM)
bone('hand', *J['hand'], parent='forearm', roll_to=PALM, connect=True)
for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
    pts = J[f]
    for i in range(3):
        bone(f'{f}_{i + 1}', pts[i], pts[i + 1], parent=('hand' if i == 0 else f'{f}_{i}'),
             roll_to=(THUMB_CURL if f == 'thumb' else PALM), connect=(i > 0))

bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True, view_layer=vl)
rig.select_set(True, view_layer=vl)
vl.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

empty = [vg.name for vg in arm.vertex_groups if not any(vg.index in [g.group for g in v.groups] for v in arm.data.vertices)]
unweighted = sum(1 for v in arm.data.vertices if not v.groups)
print('bones', len(ad.bones), 'groups', len(arm.vertex_groups), 'empty', empty, 'unweighted', unweighted)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('saved', OUT)
