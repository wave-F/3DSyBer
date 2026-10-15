# 扫描枪贴图改色：红色扫描窗 → 深色玻璃 + 青色自发光；机身压暗一点和黑手套统一
# 输入 art/scanner_src/textures/*_baseColor.jpeg，输出同目录 scanner_base.png / scanner_emit.png
from PIL import Image, ImageFilter
import numpy as np, glob

D = 'art/scanner_src/textures/'
src = glob.glob(D + 'tripo_mat_*_baseColor.jpeg')[0]
im = np.array(Image.open(src).convert('RGB')).astype(float)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
red = np.clip((r - np.maximum(g, b) - 25) / 60, 0, 1) * (r > 60)
m = Image.fromarray((red * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(2))
k = np.array(m).astype(float)[..., None] / 255
lum = (0.3 * r + 0.59 * g + 0.11 * b)[..., None]

BODY = 0.72                                        # 机身压暗
glass = np.concatenate([lum * 0.05 + 6, lum * 0.12 + 16, lum * 0.14 + 20], axis=2)
base = im * BODY * (1 - k) + glass * k
Image.fromarray(base.clip(0, 255).astype('uint8')).save(D + 'scanner_base.png')

glow = np.clip(r[..., None] / 255 * 1.4, 0.35, 1)  # 原图越亮的地方越亮
cyan = np.array([0.38, 0.87, 0.92]) * 255          # 和 viewmodel.js 的发光色 0x9edeea 一致
emit = k * glow * cyan
Image.fromarray(emit.clip(0, 255).astype('uint8')).save(D + 'scanner_emit.png')
print('red px', int((red > 0.5).sum()))
