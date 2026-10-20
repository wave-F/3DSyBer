# 把 art/tablet_hand.blend 里当前的手姿导出到游戏，不再重算握姿。
# 在 Blender 里摆好 FPSArm_Rig（姿态模式），保存，然后：
#   Blender -b art/tablet_hand.blend --python tools/blender/export_tablet_hand.py
# 不要用 build_tablet_hand.py，那个脚本会按参数重新摆手并覆盖这个文件。
import bpy
import os

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
OUT = ROOT + 'public/assets/tablet-hand.glb'
TEX_MAX = 1024

sc = bpy.context.scene
vl = sc.view_layers[0]
rig = sc.objects['FPSArm_Rig']
arm = sc.objects['LeftArm']
sc.frame_set(1)
vl.update()

act = bpy.data.actions.get('Grip_Tablet') or bpy.data.actions.new('Grip_Tablet')
act.use_fake_user = True
rig.animation_data_create()
rig.animation_data.action = act
for pb in rig.pose.bones:
    pb.keyframe_insert('rotation_euler', frame=1)
    pb.keyframe_insert('location', frame=1)

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
