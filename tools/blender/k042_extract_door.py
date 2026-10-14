"""从 K042 源文件取出 SuperCarA 的右侧车门（CarA036 的 -X 半边），变换到游戏车身坐标，存为 art/door_r_src.blend
用法：Blender -b art/supercar_k042.blend -S Scene --python tools/blender/k042_extract_door.py
SuperCarA → 游戏 Body：统一缩放 0.8，Z 抬高 TZ（由顶点对位求得）"""
import bpy, bmesh
from pathlib import Path
from mathutils import Vector, Matrix, kdtree

ROOT = Path(bpy.data.filepath).parent.parent
OUT = ROOT / 'art' / 'door_r_src.blend'
sc = bpy.data.scenes['Scene']


def walk(lc):
    lc.exclude = False
    for c in lc.children:
        walk(c)


for c in sc.view_layers[0].layer_collection.children:
    walk(c)
sc.view_layers[0].update()

game = bpy.data.objects['Body']
gv = [game.matrix_world @ v.co for v in game.data.vertices]
kd = kdtree.KDTree(len(gv))
for i, v in enumerate(gv):
    kd.insert(v, i)
kd.balance()

src = bpy.data.objects['CarA036']
dv = [src.matrix_world @ v.co for v in src.data.vertices]
S = 0.8


def score(tz):
    d = sorted(kd.find(p * S + Vector((0, 0, tz)))[2] for p in dv[::7])
    return d[len(d) // 2], d[int(len(d) * 0.95)]


best = min((score(0.48 + i * 0.0005)[0], 0.48 + i * 0.0005) for i in range(61))
TZ = best[1]
print('TZ', TZ, 'median/p95', score(TZ))

xf = Matrix.Translation((0, 0, TZ)) @ Matrix.Scale(S, 4) @ src.matrix_world
me = src.data.copy()
me.transform(xf)
bm = bmesh.new(); bm.from_mesh(me)
# 只要右侧（-X）那扇
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().x > 0], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me); bm.free()
me.name = 'Door_R'
door = bpy.data.objects.new('Door_R', me)
pts = [v.co for v in me.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
print('door verts', len(pts), 'faces', len(me.polygons), 'bbox', tuple(round(x, 3) for x in lo), tuple(round(x, 3) for x in hi))
print('materials', [m.name for m in me.materials if m])
d = sorted(kd.find(p)[2] for p in pts)
print('door→game dist median', d[len(d) // 2], 'max', d[-1])
door['k042_tz'] = TZ
bpy.data.libraries.write(str(OUT), {door}, fake_user=True)
print('WROTE', OUT)
