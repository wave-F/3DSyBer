# 导出撬门动画给游戏：public/assets/pry-arm.glb
# 内容：Pry_Lever（逐帧位置/旋转）+ 子物体 Crowbar（手和撬棍）+ PryCamRest（撬门镜头，静止）
# 坐标与 supercar_door.glb 相同，游戏里直接挂到车模根节点下
# 不导出车门动画：车门由 state.js 的 PRY_KEYS 驱动；镜头抖动也由代码加
# 前提：先跑 build_pry_anim.py
import bpy

OUT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/public/assets/pry-arm.glb'
TEX_MAX = 1024

sc = bpy.data.scenes['PryAnim']
bpy.context.window.scene = sc
lever = sc.objects['Pry_Lever']
bar = sc.objects['Crowbar']
cam = sc.objects['PryCam']

# 贴图缩到 1024（原图 7.7MB）
for slot in bar.material_slots:
    if not slot.material or not slot.material.node_tree:
        continue
    for nd in slot.material.node_tree.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image:
            w, h = nd.image.size
            if max(w, h) > TEX_MAX:
                k = TEX_MAX / max(w, h)
                nd.image.scale(int(w * k), int(h * k))

# 镜头静止位姿：第 1 帧（还没开始抖）
sc.frame_set(1)
rest = bpy.data.objects.get('PryCamRest')
if rest:
    bpy.data.objects.remove(rest, do_unlink=True)
rest = bpy.data.objects.new('PryCamRest', cam.data)
rest.matrix_world = cam.matrix_world.copy()
sc.collection.objects.link(rest)

# Crowbar 上只有显隐关键帧（glTF 不支持），导出时先摘掉
bar_action = bar.animation_data.action if bar.animation_data else None
if bar.animation_data:
    bar.animation_data.action = None
bar.hide_viewport = bar.hide_render = False

for o in sc.objects:
    o.select_set(False)
for o in (lever, bar, rest):
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = lever

try:
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_cameras=True,
        export_lights=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_frame_range=True,
        export_image_format='WEBP',
        export_image_quality=85,
    )
finally:
    if bar_action:
        bar.animation_data.action = bar_action
    bpy.data.objects.remove(rest, do_unlink=True)
    sc.frame_set(1)

import os
print('exported', OUT, os.path.getsize(OUT), 'bytes')
