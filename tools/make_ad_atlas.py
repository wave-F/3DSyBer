# 广告图集：art/ads_src/h*.png（横版 16:9）+ v*.png（竖版 2:3）→ art/textures/gen/ads_atlas.jpg + src/data/ads.json
# 用法：python3 tools/make_ad_atlas.py && npm run assets:ktx2（游戏加载的是转好的 public/assets/gen/ads_atlas.ktx2）
# 原图是 1024 方图（生成工具只出方图），按内容重心裁成目标比例；白边先切掉
import json, os, glob
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'ads_src')
HW, HH, HC = 768, 432, 4      # 横版格子尺寸、列数
VW, VH, VC = 384, 576, 8      # 竖版格子尺寸、列数

def trim_white(im):
    """逐行/列剥掉四周的纯色边和白色/灰色边框线，直到边缘是有内容的画面"""
    a = np.asarray(im.convert('L'), dtype=np.float32)
    y0, y1, x0, x1 = 0, a.shape[0], 0, a.shape[1]
    flat = lambda v: v.std() < 6 or v.mean() > 150   # 纯色，或亮边框（广告画面边缘不会整条都很亮）
    for _ in range(400):
        moved = False
        if y1 - y0 > 64 and flat(a[y0, x0:x1]): y0 += 1; moved = True
        if y1 - y0 > 64 and flat(a[y1 - 1, x0:x1]): y1 -= 1; moved = True
        if x1 - x0 > 64 and flat(a[y0:y1, x0]): x0 += 1; moved = True
        if x1 - x0 > 64 and flat(a[y0:y1, x1 - 1]): x1 -= 1; moved = True
        if not moved: break
    # 多切 3 像素，去掉边框的抗锯齿残边
    return im.crop((x0 + 3, y0 + 3, x1 - 3, y1 - 3))

MAX_CUT = 0.0    # 比例不合时最多裁掉的比例，剩下的用黑边补（黑 = 屏幕不亮）

def crop_aspect(im, aspect):
    w, h = im.size
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255
    wgt = a.max(2) ** 2 + 1e-4   # 内容权重：越亮越重要
    cx = (wgt.sum(0) * np.arange(w)).sum() / wgt.sum()
    cy = (wgt.sum(1) * np.arange(h)).sum() / wgt.sum()
    if w / h > aspect: cw, ch = max(int(h * aspect), int(w * (1 - MAX_CUT))), h
    else: cw, ch = w, max(int(w / aspect), int(h * (1 - MAX_CUT)))
    x0 = (w - cw) // 2; y0 = (h - ch) // 2
    im = im.crop((x0, y0, x0 + cw, y0 + ch))
    # 补黑边到目标比例
    if cw / ch > aspect: W, H = cw, int(round(cw / aspect))
    else: W, H = int(round(ch * aspect)), ch
    out = Image.new('RGB', (W, H), (0, 0, 0))
    out.paste(im, ((W - cw) // 2, (H - ch) // 2))
    return out

def fit(im, aspect):
    """compose_ads.py 排好的图已是目标比例，不再切边（暗色留白会被误判成纯色边）"""
    if abs(im.width / im.height - aspect) < 0.02: return im
    return crop_aspect(trim_white(im), aspect)

def glow(im):
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255
    lin = np.where(a > 0.04045, ((a + 0.055) / 1.055) ** 2.4, a / 12.92).reshape(-1, 3)
    c = lin.mean(0); c = c / max(1e-3, c.max())
    s = np.where(c > 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, c * 12.92)
    return '#' + ''.join(f'{int(round(v * 255)):02x}' for v in s)

hs = sorted(glob.glob(os.path.join(SRC, 'h*.png')))
vs = sorted(glob.glob(os.path.join(SRC, 'v*.png')))
hrows = (len(hs) + HC - 1) // HC
vrows = (len(vs) + VC - 1) // VC
W = max(HW * HC, VW * VC); H = HH * hrows + VH * vrows
atlas = Image.new('RGB', (W, H), (0, 0, 0))
meta = dict(size=[W, H], h=dict(cell=[HW, HH], cols=HC, y=0, n=len(hs)), v=dict(cell=[VW, VH], cols=VC, y=HH * hrows, n=len(vs)), glow=[], names=[])
for i, f in enumerate(hs):
    im = fit(Image.open(f).convert("RGB"), HW / HH).resize((HW, HH), Image.LANCZOS)
    atlas.paste(im, ((i % HC) * HW, (i // HC) * HH))
    meta['glow'].append(glow(im)); meta['names'].append(os.path.basename(f))
for i, f in enumerate(vs):
    im = fit(Image.open(f).convert("RGB"), VW / VH).resize((VW, VH), Image.LANCZOS)
    atlas.paste(im, ((i % VC) * VW, HH * hrows + (i // VC) * VH))
    meta['glow'].append(glow(im)); meta['names'].append(os.path.basename(f))
out = os.path.join(ROOT, 'art', 'textures', 'gen', 'ads_atlas.jpg')
os.makedirs(os.path.dirname(out), exist_ok=True)
atlas.save(out, quality=85, optimize=True)
json.dump(meta, open(os.path.join(ROOT, 'src', 'data', 'ads.json'), 'w'), indent=1)
print(out, atlas.size, os.path.getsize(out) // 1024, 'KB')
print('接着运行 npm run assets:ktx2 生成游戏用的 KTX2')
