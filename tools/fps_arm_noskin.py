# 手臂贴图：把手腕露出的皮肤（手套和袖口之间那一圈）换成深色针织，第一人称里压腕时不露肉
# 输入 art/fps_arms_src/textures/armCcolor.png，输出同目录 armCcolor_noskin.png
from PIL import Image, ImageFilter
import numpy as np

SRC = 'art/fps_arms_src/textures/armCcolor.png'
DST = 'art/fps_arms_src/textures/armCcolor_noskin.png'
im = np.array(Image.open(SRC).convert('RGB')).astype(float)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
skin = (r > 70) & (r - b > 35) & (r > g) & (g > b)
mask = Image.fromarray((skin * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
k = np.array(mask).astype(float)[..., None] / 255
lum = (0.3 * r + 0.59 * g + 0.11 * b)[..., None]
knit = np.concatenate([lum * 0.16 + 14, lum * 0.16 + 15, lum * 0.16 + 17], axis=2)   # 偏冷的深灰，保留原图明暗
out = im * (1 - k) + knit * k
Image.fromarray(out.clip(0, 255).astype('uint8')).save(DST)
print('skin px', int(skin.sum()), '->', DST)
