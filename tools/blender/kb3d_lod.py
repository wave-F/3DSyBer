# KB3D 楼体远景 LOD（L2 / L3）：低模壳 + 烘焙贴图
# 由 scripts/lod.mjs 调用：Blender -b --factory-startup --python tools/blender/kb3d_lod.py -- <out_dir> <name>=<src.glb>=<shell.glb>=<档位>=<壳误差米> ...
# src.glb 是已经烘焙好光照的楼体（public/assets/bldg/<name>.glb，贴图换回 JPG，Blender 读不了 KTX2）
#
# 低模壳由 scripts/lod.mjs 用 meshopt 按几何减面后传进来，这里只展 UV、烘焙；产物 <out_dir>/<name>_l<档位>.glb
# 贴图两张，都是 1:1 还原运行时 modelBuildings.js 的 basic 材质（不含高度明暗，运行时再乘，调参面板照样生效）：
#   wall （底色槽）：底色 × 烘焙光照 × 冷色，运行时 × bldgLight.wall × 高度明暗
#   glow （自发光槽）：亮窗 + 灯具 × 0.7 + 字牌 × 0.9，运行时 × bldgLight.glass
# 编码：存 sRGB(v / range)，GPU 按 sRGB 贴图解码后 × range 即还原；range 写进 buildingLods.json
import bpy, sys, os, math
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
JOBS = [a.split('=') for a in args[1:]]
RANGE = {'wall': 1.0, 'glow': 2.0}
LIGHT_RANGE = 4.0     # 顶点色编码（kb3d_bake.py RANGE）
COOL = (0.78, 0.95, 1.05)
# 贴图边长：L2 矮楼 1024 / 高楼 2048；L3 在 450 m 以外，屏幕上不到 L2 一半大，各降一档
TEX_SIZE = {'2': (1024, 2048), '3': (512, 1024)}
TMP = os.path.join(OUT, '_lod_tmp')
os.makedirs(TMP, exist_ok=True)


def srgb_oetf(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def setup_cycles():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences
        pr.compute_device_type = 'METAL'; pr.get_devices()
        for d in pr.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('@@GPU fallback', e)
    sc.cycles.samples = 16
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.margin = 8


def rebuild(m, col_name):
    """高模材质 → 两路自发光输出（wall / glow），用 Mix Shader 切换"""
    nt = m.node_tree; N = nt.nodes.new; L = nt.links.new
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    kind = m.name.split(':')[0]
    # 底色：glTF 导入会乘上顶点色（这里顶点色是烘焙光照，不是底色），只取另一路
    src = bsdf.inputs['Base Color'].links[0].from_node if bsdf and bsdf.inputs['Base Color'].is_linked else None
    if src and src.type == 'MIX':
        other = next(i for i in src.inputs if i.type == 'RGBA' and not (i.is_linked and i.links[0].from_node.type == 'VERTEX_COLOR'))
        if other.is_linked: base = other.links[0].from_socket
        else:
            rgb = N('ShaderNodeRGB'); rgb.outputs[0].default_value = tuple(other.default_value); base = rgb.outputs[0]
    elif src:
        base = bsdf.inputs['Base Color'].links[0].from_socket
    else:
        rgb = N('ShaderNodeRGB'); rgb.outputs[0].default_value = tuple(bsdf.inputs['Base Color'].default_value) if bsdf else (0.5, 0.5, 0.5, 1)
        base = rgb.outputs[0]
    emis = tuple(bsdf.inputs['Emission Color'].default_value[:3]) if bsdf else (0, 0, 0)
    at = N('ShaderNodeAttribute'); at.attribute_name = col_name
    gm = N('ShaderNodeGamma'); gm.inputs[1].default_value = 2.2; L(at.outputs['Color'], gm.inputs[0])
    light = N('ShaderNodeVectorMath'); light.operation = 'SCALE'; light.inputs['Scale'].default_value = LIGHT_RANGE
    L(gm.outputs[0], light.inputs[0])
    black = N('ShaderNodeRGB'); black.outputs[0].default_value = (0, 0, 0, 1)

    def mul(a, b_vec):
        n = N('ShaderNodeVectorMath'); n.operation = 'MULTIPLY'; L(a, n.inputs[0])
        if isinstance(b_vec, tuple): n.inputs[1].default_value = b_vec
        else: L(b_vec, n.inputs[1])
        return n.outputs[0]

    lit = mul(mul(base, light.outputs[0]), COOL)   # 底色 × 光照 × 冷色
    if kind == 'glass':
        wall, glow = black.outputs[0], light.outputs[0]
    elif kind == 'lamp':
        wall = lit
        c = N('ShaderNodeRGB'); c.outputs[0].default_value = (*[v * 0.7 for v in emis], 1); glow = c.outputs[0]
    elif kind == 'let':
        wall, glow = lit, mul(base, (0.9, 0.9, 0.9))
    else:
        wall, glow = lit, black.outputs[0]
    ew = N('ShaderNodeEmission'); L(wall, ew.inputs['Color'])
    eg = N('ShaderNodeEmission'); L(glow, eg.inputs['Color'])
    mix = N('ShaderNodeMixShader'); mix.name = 'LOD_SWITCH'
    L(ew.outputs[0], mix.inputs[1]); L(eg.outputs[0], mix.inputs[2])
    mo = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); L(mix.outputs[0], mo.inputs['Surface'])
    return mix


def build(name, src, shell, level, shell_error):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_cycles()
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects: o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1: bpy.ops.object.join()
    hi = bpy.context.view_layer.objects.active; hi.name = 'hi'
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    col_name = hi.data.color_attributes[0].name
    switches = [rebuild(m, col_name) for m in {s.material for s in hi.material_slots if s.material}]

    size = TEX_SIZE[level][0 if hi.dimensions.z < 100 else 1]
    # 低模壳（scripts/lod.mjs 用 meshopt 按几何减好的）
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=shell)
    lo = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH'); lo.name = f'{name}_l{level}'
    for o in bpy.context.scene.objects: o.select_set(False)
    lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo.data.materials.clear()
    cell = float(shell_error)   # 低模壳和高模的最大偏差，决定烘焙射线距离
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.uv.smart_project(angle_limit=math.radians(30), island_margin=0.003 if level == '2' else 0.006, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in lo.data.polygons: p.use_smooth = False

    sc = bpy.context.scene
    sc.render.bake.cage_extrusion = cell
    sc.render.bake.max_ray_distance = cell * 2.5
    bake_img = bpy.data.images.new('bake', size, size, float_buffer=True)
    bm = bpy.data.materials.new('bake'); bm.use_nodes = True
    bt = bm.node_tree.nodes.new('ShaderNodeTexImage'); bt.image = bake_img; bm.node_tree.nodes.active = bt
    lo.data.materials.append(bm)
    files = {}
    for i, key in enumerate(('wall', 'glow')):
        for s in switches: s.inputs['Fac'].default_value = float(i)
        for o in sc.objects: o.select_set(False)
        hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
        bpy.ops.object.bake(type='EMIT')
        px = np.array(bake_img.pixels[:], dtype=np.float32).reshape(-1, 4)
        print(f'@@{name} {key} p50 {float(np.median(px[:, :3])):.4f} p99 {float(np.percentile(px[:, :3], 99)):.4f} max {float(px[:, :3].max()):.3f}')
        px[:, :3] = srgb_oetf(px[:, :3] / RANGE[key]); px[:, 3] = 1
        img = bpy.data.images.new(f'{name}_l{level}_{key}', size, size)
        img.pixels.foreach_set(px.ravel())
        img.filepath_raw = os.path.join(TMP, f'{name}_l{level}_{key}.png'); img.file_format = 'PNG'; img.save()
        files[key] = img

    # 导出材质：底色 = wall，自发光 = glow（运行时按槽位取贴图，不用 glTF 的着色）
    lo.data.materials.clear()
    em = bpy.data.materials.new(f'lod:{name}'); em.use_nodes = True
    b = next(n for n in em.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tw = em.node_tree.nodes.new('ShaderNodeTexImage'); tw.image = files['wall']
    tg = em.node_tree.nodes.new('ShaderNodeTexImage'); tg.image = files['glow']
    em.node_tree.links.new(tw.outputs['Color'], b.inputs['Base Color'])
    em.node_tree.links.new(tg.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1
    lo.data.materials.append(em)
    for o in sc.objects: o.select_set(False)
    lo.select_set(True); bpy.context.view_layer.objects.active = lo
    path = os.path.join(OUT, f'{name}_l{level}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
        export_vertex_color='NONE', export_draco_mesh_compression_enable=True,
        export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
        export_yup=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
    )
    print(f'@@L{level} {name} tris {len(lo.data.polygons)} tex {size}')


for name, src, shell, level, shell_error in JOBS:
    build(name, src, shell, level, shell_error)
print('@@DONE')
