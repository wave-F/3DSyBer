# 城市

现网是程序楼加四栋 GLB：`bldgLG`、`bldgM`、`capsule`、`tower02`。位置在 `modelBuildings.js` 的 `MODEL_PLACEMENTS`。`city.js` 的程序楼跳过这些脚印。

导入楼用 `MeshBasicNodeMaterial`，不吃场景灯。缺烘焙就是灰的。招牌霓虹可以钉死，以便和烘焙墙面一致。

Blender `(x, y, z)` → three.js `(x, -z, y)`。桥沿 Blender 的 Y。`build_city.py` 里 `UNIT = 100`，`TEX_MAX = 2048`。`KB3D_楼体库` 只是库。脚本导出 `近景楼_左` / `近景楼_右`。`参照_游戏`、相机、辅助线、备选楼不导出。`art/` 不进 git。横幅上有 KitBash3D 商标。

blend 里还有 `tower03`、`tower08`、`towerL`、`towerC`、`bldgS`、`midrise`，仓库没有这些 GLB。

未约定前不要改 `art/city.blend`，也不要整段替换手写摆放。桥仍在 `bridge.js`。
