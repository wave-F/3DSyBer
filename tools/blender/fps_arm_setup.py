# 第一人称右手：新建场景 FPSArm，导入手臂（只留右手）和扫描枪
# 来源：art/fps_arms_src（bumstrum「Fps arms」，CC-BY）、art/scanner_src（KANTNOLI，Sketchfab Standard）
# 坐标（导入并应用变换后，单位米）：手指朝 -Y，上 +Z，右手在 -X 侧；手掌朝 +X（握手姿势，拇指朝上）
import bpy, bmesh
from mathutils import Vector

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
SCENE = 'FPSArm'

old = bpy.data.scenes.get(SCENE)
if old:
    for o in list(old.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.scenes.remove(old)
sc = bpy.data.scenes.new(SCENE)
win = bpy.context.window_manager.windows[0]
win.scene = sc
vl = sc.view_layers[0]
area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
region = next(r for r in area.regions if r.type == 'WINDOW')


def ctx(obj=None):
    kw = dict(window=win, area=area, region=region, scene=sc, view_layer=vl)
    if obj:
        kw.update(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj])
    return bpy.context.temp_override(**kw)


def select_only(obj):
    for o in sc.objects:
        o.select_set(False, view_layer=vl)
    obj.select_set(True, view_layer=vl)
    vl.objects.active = obj


def import_one(op, **kw):
    before = set(bpy.data.objects)
    with ctx():
        op(**kw)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = [o for o in new if o.type == 'MESH'][0]
    mw = mesh.matrix_world.copy()
    for o in new:
        if o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    mesh.parent = None
    mesh.matrix_world = mw
    select_only(mesh)
    with ctx(mesh):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return mesh


def bsdf_of(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


# ---------- 手臂：删掉左手（+X 一侧） ----------
arm = import_one(bpy.ops.import_scene.fbx, filepath=ROOT + 'art/fps_arms_src/source/fpsarmsC.fbx')
# FBX 里记的是作者机器上的贴图路径（Projects/SOF4/tex），断链会让存盘打包失败：改到本地贴图
_TEX = {'armccolor.png': 'armCcolor.png', 'armcnormal.png': 'armCNormal.png', 'armcroughness.png': 'armcRoughness.png'}
for im in bpy.data.images:
    if 'SOF4' in im.filepath:
        base = im.filepath.replace('\\', '/').split('/')[-1].lower()
        if base in _TEX:
            im.filepath = ROOT + 'art/fps_arms_src/textures/' + _TEX[base]
bm = bmesh.new()
bm.from_mesh(arm.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > 0], context='VERTS')
bm.to_mesh(arm.data)
bm.free()
arm.name = arm.data.name = 'RightArm'

T = ROOT + 'art/fps_arms_src/textures/'
mat = bpy.data.materials.get('FPSArm_Mat') or bpy.data.materials.new('FPSArm_Mat')
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
        nt.nodes.remove(n)
b = bsdf_of(mat)


def tex(name, cs, loc):
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(T + name, check_existing=True)
    t.image.colorspace_settings.name = cs
    t.location = loc
    return t


# armCcolor_noskin.png 由 tools/fps_arm_noskin.py 生成：手腕那圈皮肤换成深色针织
nt.links.new(tex('armCcolor_noskin.png', 'sRGB', (-600, 300)).outputs[0], b.inputs['Base Color'])
nt.links.new(tex('armcRoughness.png', 'Non-Color', (-600, 0)).outputs[0], b.inputs['Roughness'])
nm = nt.nodes.new('ShaderNodeNormalMap')
nm.location = (-250, -300)
nt.links.new(tex('armCNormal.png', 'Non-Color', (-600, -300)).outputs[0], nm.inputs['Color'])
nt.links.new(nm.outputs[0], b.inputs['Normal'])
b.inputs['Metallic'].default_value = 0
arm.data.materials.clear()
arm.data.materials.append(mat)

# ---------- 扫描枪 ----------
scanner = import_one(bpy.ops.import_scene.gltf, filepath=ROOT + 'art/scanner_src/scene.gltf')
scanner.name = scanner.data.name = 'Scanner'
vs = [v.co for v in scanner.data.vertices]
mn = Vector([min(v[i] for v in vs) for i in range(3)])
mx = Vector([max(v[i] for v in vs) for i in range(3)])
scanner.location = (-0.6, 0, 0)


def scanner_material():
    # 贴图由 tools/scanner_cyber_tex.py 生成：红窗改成深色玻璃 + 青色自发光，机身压暗
    st = ROOT + 'art/scanner_src/textures/'
    smat = scanner.data.materials[0]
    smat.name = 'Scanner_Mat'
    snt = smat.node_tree
    sb = bsdf_of(smat)
    base = next(n for n in snt.nodes if n.type == 'TEX_IMAGE')
    base.image = bpy.data.images.load(st + 'scanner_base.png', check_existing=True)
    emit = next((n for n in snt.nodes if n.type == 'TEX_IMAGE' and n is not base), None) or snt.nodes.new('ShaderNodeTexImage')
    emit.image = bpy.data.images.load(st + 'scanner_emit.png', check_existing=True)
    emit.location = (base.location.x, base.location.y - 320)
    snt.links.new(base.outputs[0], sb.inputs['Base Color'])
    snt.links.new(emit.outputs[0], sb.inputs['Emission Color'])
    sb.inputs['Emission Strength'].default_value = 2.0
    sb.inputs['Roughness'].default_value = 0.55
    sb.inputs['Metallic'].default_value = 0.0


scanner_material()

print('ARM verts', len(arm.data.vertices))
print('SCANNER bbox', tuple(round(a, 3) for a in mn), tuple(round(a, 3) for a in mx))
