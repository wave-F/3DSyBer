# 第一人称右手：建骨骼并自动刷权重（先跑 fps_arm_setup.py）
# 关节位置是在正交视图上量的，X 用沿 X 的射线穿过手指取实体段中点
# 手指骨骼的局部 Z 轴朝手心（+X），绕局部 X 正转 = 手指往手心弯
import bpy
from mathutils import Vector

SCENE = 'FPSArm'
sc = bpy.data.scenes[SCENE]
win = bpy.context.window_manager.windows[0]
win.scene = sc
vl = sc.view_layers[0]
area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
region = next(r for r in area.regions if r.type == 'WINDOW')
arm = sc.objects['RightArm']

J = {
    'forearm': [(-0.220, 0.240, 0.105), (-0.203, -0.235, -0.010)],
    'hand': [(-0.203, -0.235, -0.010), (-0.188, -0.330, -0.020)],
    'thumb': [(-0.180, -0.262, -0.008), (-0.152, -0.295, 0.018), (-0.127, -0.322, 0.032), (-0.110, -0.344, 0.036)],
    'index': [(-0.180, -0.340, 0.004), (-0.169, -0.385, -0.006), (-0.153, -0.415, -0.011), (-0.138, -0.440, -0.017)],
    'middle': [(-0.187, -0.335, -0.015), (-0.169, -0.383, -0.033), (-0.147, -0.413, -0.045), (-0.127, -0.435, -0.056)],
    'ring': [(-0.192, -0.325, -0.035), (-0.175, -0.366, -0.054), (-0.150, -0.392, -0.068), (-0.128, -0.410, -0.081)],
    'pinky': [(-0.192, -0.315, -0.055), (-0.176, -0.345, -0.072), (-0.146, -0.368, -0.083), (-0.125, -0.384, -0.092)],
}
PALM = Vector((1, 0, 0))            # 手心朝向
THUMB_CURL = Vector((0.3, 0, -1))   # 拇指弯向
PROP = ((-0.140, -0.320, -0.030), (-0.140, -0.320, 0.020))   # 道具骨：握把中心，竖直

old = sc.objects.get('FPSArm_Rig')
if old:
    for m in [m for m in arm.modifiers if m.type == 'ARMATURE']:
        arm.modifiers.remove(m)
    arm.parent = None
    arm.vertex_groups.clear()
    data = old.data
    bpy.data.objects.remove(old, do_unlink=True)
    bpy.data.armatures.remove(data)

ad = bpy.data.armatures.new('FPSArm_Rig')
rig = bpy.data.objects.new('FPSArm_Rig', ad)
sc.collection.objects.link(rig)
ad.display_type = 'STICK'
rig.show_in_front = True


def ctx(active, selected):
    return bpy.context.temp_override(window=win, area=area, region=region, scene=sc, view_layer=vl,
                                     active_object=active, object=active,
                                     selected_objects=selected, selected_editable_objects=selected)


for o in sc.objects:
    o.select_set(False, view_layer=vl)
rig.select_set(True, view_layer=vl)
vl.objects.active = rig
with ctx(rig, [rig]):
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
p = bone('prop', *PROP, parent='hand', roll_to=Vector((0, -1, 0)))
p.use_deform = False

with ctx(rig, [rig]):
    bpy.ops.object.mode_set(mode='OBJECT')

# 自动权重
for o in sc.objects:
    o.select_set(False, view_layer=vl)
arm.select_set(True, view_layer=vl)
rig.select_set(True, view_layer=vl)
vl.objects.active = rig
with ctx(rig, [arm, rig]):
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

empty = [vg.name for vg in arm.vertex_groups if not any(vg.index in [g.group for g in v.groups] for v in arm.data.vertices)]
print('bones', len(ad.bones), 'groups', len(arm.vertex_groups), 'empty groups', empty)
unweighted = sum(1 for v in arm.data.vertices if not v.groups)
print('unweighted verts', unweighted)
