# 导出骨骼手版撬门动画：public/assets/pry-arm.glb（替换旧的 Tripo 手+撬棍）
# 后台运行：
#   Blender -b --factory-startup art/pry_arm_anim.blend --python tools/blender/export_pry_arm.py
# 内容：Pry_Lever（逐帧位置/旋转）
#         ├ Crowbar
#         └ FPSArm_Rig（骨骼逐帧旋转）+ RightArm（蒙皮）
#       PryCamRest（撬门镜头第 1 帧，静止）
# 动画导出成一条（SCENE 模式，撬棍和骨骼在同一条时间轴上），时间和旧版一致：Blender 第 1 帧 = 1/30 秒
# 坐标和 supercar_door.glb 相同，游戏里挂在车模根节点下
# 前提：先跑 build_pry_arm_anim.py
import bpy, os

OUT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/public/assets/pry-arm.glb'
TEX_MAX = 1024

sc = bpy.data.scenes['PryAnim']
vl = sc.view_layers[0]
lever = sc.objects['Pry_Lever']
bar = sc.objects['Crowbar']
rig = sc.objects['FPSArm_Rig']
arm = sc.objects['RightArm']
cam = sc.objects['PryCam']

sc.frame_set(1)
rest = bpy.data.objects.new('PryCamRest', cam.data)
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
for o in (lever, bar, rig, arm, rest):
    o.hide_set(False, view_layer=vl)
    o.select_set(True, view_layer=vl)
vl.objects.active = lever

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
