# 桥面与玩家

`bridge.js`：`DECK_Y = 20`，`HALF_W = 7`，`HALF_L = 260`，右护栏 `BREAK` 是撞断缺口。桥、护栏、灯由代码生成，静态网格走 `mergeStatic`。

`player.js`：眼高 1.7，走 4 / 跑 8。出生 `(-0.5, DECK_Y+1.7, 11)`，朝向事故车。只在鼠标锁定时移动，斜向按长度归一。x 夹在护栏内（`HALF_W - 0.4 - 半径`）。z 夹在封锁再缩 0.8 m。y 固定眼高。

`cordon.js`：`CORDON` 的 z 是 -46 到 68。`crash.js` 的 `carCollider` 把玩家推出，没有刚体引擎。`inv.moveScale` 缩放本帧位移。

点击 overlay 锁定。Esc 解锁并出暂停层。平板打开时 `keepOverlayHidden`，解锁不弹暂停；Esc 收起平板则回到暂停层。`pointerlockerror` 同样回暂停层。

不要从 Blender 再导桥、桥墩、护栏、路灯。不要在调查模块里另写一套夹紧。
