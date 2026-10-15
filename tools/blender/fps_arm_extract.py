# 把 FPSArm（手臂、扫描枪、骨架、握持动作）从大文件里单独提到干净工程 art/fps_arm_rig.blend
# 只读源文件，不改动它。后台运行：
#   Blender -b --factory-startup --python tools/blender/fps_arm_extract.py -- <源 .blend>
# 默认源文件 art/city.blend
import bpy, sys

ROOT = '/Users/fengbotao/游戏设计/效果尝试/3D赛博/'
SRC = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else ROOT + 'art/city.blend'
DST = ROOT + 'art/fps_arm_rig.blend'
OBJS = ['FPSArm_Rig', 'RightArm', 'Scanner', 'GameCam', 'PreviewCam', 'PrevKey', 'PrevRimC', 'PrevRimM']
ACTS = ['Grip_Scanner']

bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
sc.name = 'FPSArm'
sc.render.fps = 30

with bpy.data.libraries.load(SRC, link=False) as (src, dst):
    dst.objects = [n for n in OBJS if n in src.objects]
    dst.actions = [n for n in ACTS if n in src.actions]
    dst.worlds = [n for n in ('FPSArmWorld',) if n in src.worlds]

for o in dst.objects:
    sc.collection.objects.link(o)
for a in dst.actions:
    a.use_fake_user = True
if dst.worlds:
    sc.world = dst.worlds[0]
cam = bpy.data.objects.get('GameCam') or bpy.data.objects.get('PreviewCam')
if cam:
    sc.camera = cam

rig = bpy.data.objects['FPSArm_Rig']
if rig.animation_data is None:
    rig.animation_data_create()
if rig.animation_data.action is None and 'Grip_Scanner' in bpy.data.actions:
    rig.animation_data.action = bpy.data.actions['Grip_Scanner']
sc.frame_start = sc.frame_end = 1
sc.frame_set(1)

# 修正：源文件里 Scanner_Mat 的底色和自发光接的是同一张 scanner_emit.png，底色补回 scanner_base.png
smat = bpy.data.materials.get('Scanner_Mat')
if smat:
    nt = smat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bc = bsdf.inputs['Base Color']
    cur = bc.links[0].from_node if bc.links else None
    if cur is None or (cur.type == 'TEX_IMAGE' and cur.image and 'emit' in cur.image.name):
        base = nt.nodes.new('ShaderNodeTexImage')
        base.image = bpy.data.images.load(ROOT + 'art/scanner_src/textures/scanner_base.png', check_existing=True)
        base.location = (bsdf.location.x - 400, bsdf.location.y + 300)
        nt.links.new(base.outputs[0], bc)
        print('fixed Scanner_Mat base color')
bpy.ops.file.pack_all()

for o in sc.objects:
    print('OBJ', o.name, o.type, 'parent=', o.parent and o.parent.name, o.parent_bone)
for im in bpy.data.images:
    print('IMG', im.name, im.filepath, 'packed' if im.packed_file else '')
bpy.ops.wm.save_as_mainfile(filepath=DST)
print('saved', DST)
