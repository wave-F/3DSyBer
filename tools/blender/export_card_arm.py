# 导出骨骼手版插卡 / 拔卡：public/assets/card-insert.glb
# 后台运行：
#   Blender -b --factory-startup art/card_arm_anim.blend --python tools/blender/export_card_arm.py
# 内容：Card_Hand（逐帧）└ FPSArm_Rig（骨骼逐帧）+ RightArm（蒙皮）
#       EvidenceCard（逐帧：手拿着时跟手，插好后停在槽里）
#       CardCamRest（插卡镜头，静止）
# 动画按物体分成几条，时间轴相同（Blender 第 1 帧 = 1/30 秒），游戏里一起播放、一起按时间定位
# 坐标和 supercar_door.glb 相同，游戏里挂在车模根节点下
# 前提：先跑 build_card_arm_anim.py
import bpy, os

OUT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/public/assets/card-insert.glb'
TEX_MAX = 1024

sc = bpy.data.scenes['CardAnim']
vl = sc.view_layers[0]
hand = sc.objects['Card_Hand']
rig = sc.objects['FPSArm_Rig']
arm = sc.objects['RightArm']
card = sc.objects['EvidenceCard']
cam = sc.objects['CardCam']

sc.frame_set(1)
rest = bpy.data.objects.new('CardCamRest', cam.data)
rest.matrix_world = cam.matrix_world.copy()
sc.collection.objects.link(rest)

swaps = []
for slot in arm.material_slots:
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
    o.select_set(False, view_layer=vl)
for o in (hand, rig, arm, card, rest):
    o.hide_set(False, view_layer=vl)
    o.select_set(True, view_layer=vl)
vl.objects.active = hand

try:
    with bpy.context.temp_override(scene=sc, view_layer=vl):
        bpy.ops.export_scene.gltf(
            filepath=OUT,
            export_format='GLB',
            use_selection=True,
            export_yup=True,
            export_cameras=True,
            export_lights=False,
            export_skins=True,
            export_def_bones=False,
            export_animations=True,
            export_animation_mode='SCENE',
            export_force_sampling=True,
            export_frame_range=True,
            export_image_format='WEBP',
            export_image_quality=85,
        )
finally:
    for nd, src, small in swaps:
        nd.image = src
        bpy.data.images.remove(small)
    bpy.data.objects.remove(rest, do_unlink=True)

print('exported', OUT, os.path.getsize(OUT), 'bytes')
