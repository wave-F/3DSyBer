# 世界观广告排版：art/ads_src/raw/*.png（无字底图）+ 本文件里的文案 → art/ads_src/<id>.png
# 用法：python3 tools/compose_ads.py [id ...] && python3 tools/make_ad_atlas.py && npm run assets:ktx2
# 生图模型写不对中文，所以底图一律无字，文字在这里用系统字体排，改文案只改这里
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'art', 'ads_src', 'raw')
OUT = os.path.join(ROOT, 'art', 'ads_src')
SIZE = {'h': (1536, 864), 'v': (768, 1152)}   # 16:9 / 2:3，与图集格子同比例

F = '/System/Library/Fonts/'
FONTS = {
  'song': (F + 'Supplemental/Songti.ttc', 0),     # 宋体 Black：财团、保险、经纬这类“体面”品牌
  'songl': (F + 'Supplemental/Songti.ttc', 3),
  'hei': (F + 'Hiragino Sans GB.ttc', 2),          # 黑体 W6：街头品牌
  'heil': (F + 'Hiragino Sans GB.ttc', 0),
  'en': (F + 'Avenir Next.ttc', 2),                # Demi Bold
  'enl': (F + 'Avenir Next.ttc', 5),               # Medium（Ultra Light 在远处 LED 上看不清）
  'enb': (F + 'Avenir Next.ttc', 8),               # Heavy
  'fut': (F + 'Supplemental/Futura.ttc', 4),       # Condensed ExtraBold
}
_cache = {}
def font(name, size):
  k = (name, size)
  if k not in _cache: _cache[k] = ImageFont.truetype(FONTS[name][0], size, index=FONTS[name][1])
  return _cache[k]

def content_box(im):
  """去掉生图偶尔带的白边/白色信箱条"""
  a = np.asarray(im.convert('L'), dtype=np.float32)
  rows = np.where((a > 235).mean(1) < 0.9)[0]; cols = np.where((a > 235).mean(0) < 0.9)[0]
  return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1

def crop(im, kind, cx=0.5, cy=0.5, zoom=1.0):
  W, H = SIZE[kind]; asp = W / H
  x0, y0, x1, y1 = content_box(im)
  rw, rh = x1 - x0, y1 - y0
  cw, ch = (rh * asp, rh) if rw / rh > asp else (rw, rw / asp)
  cw, ch = cw * zoom, ch * zoom
  l = min(max(x0 + rw * cx - cw / 2, x0), x1 - cw); t = min(max(y0 + rh * cy - ch / 2, y0), y1 - ch)
  return im.crop((int(l), int(t), int(l + cw), int(t + ch))).resize((W, H), Image.LANCZOS)

def shade(im, side, amount=0.75, span=0.55):
  """文字一侧压暗，保证可读"""
  W, H = im.size
  n = W if side in 'lr' else H
  g = np.clip(1 - np.arange(n) / (n * span), 0, 1) ** 1.4 * amount
  if side in 'rb': g = g[::-1]
  m = np.tile(g, (H, 1)) if side in 'lr' else np.tile(g[:, None], (1, W))
  a = np.asarray(im, dtype=np.float32) * (1 - m[..., None])
  return Image.fromarray(a.astype(np.uint8))

def text(im, s, fname, size, color, x, y, anchor='la', glow=0, track=0, stroke=0, stroke_fill=None):
  """x/y 是 0-1 比例坐标；track 为字距（像素）；glow 为辉光半径；stroke 为描边宽度（亮底上用）"""
  W, H = im.size
  f = font(fname, size)
  layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
  d = ImageDraw.Draw(layer)
  px, py = x * W, y * H
  sk = dict(stroke_width=stroke, stroke_fill=stroke_fill) if stroke else {}
  if track:
    widths = [d.textlength(ch, font=f) + track for ch in s]
    total = sum(widths) - track
    if anchor[0] == 'm': px -= total / 2
    elif anchor[0] == 'r': px -= total
    for ch, w in zip(s, widths):
      d.text((px, py), ch, font=f, fill=color, anchor='l' + anchor[1], **sk); px += w
  else:
    d.text((px, py), s, font=f, fill=color, anchor=anchor, **sk)
  if glow:
    g = layer.filter(ImageFilter.GaussianBlur(glow))
    im.alpha_composite(g); im.alpha_composite(g)
  im.alpha_composite(layer)

def rule(im, x0, x1, y, color, w=2):
  W, H = im.size
  ImageDraw.Draw(im).line((x0 * W, y * H, x1 * W, y * H), fill=color, width=w)

GOLD, WHITE, CYAN, AMBER, PALE = '#e8c77a', '#f2f2ee', '#7fe8ff', '#ffb43a', '#c9d6dc'

# 文案原则：点到为止。不喊口号，不直说“保护你”“控制你”，让玩家自己品
ADS = {
  'h01': dict(kind='h', crop=dict(cx=0.5, cy=0.5), shade='l', draw=lambda im: (
    text(im, '醒', 'hei', 300, AMBER, 0.08, 0.50, 'ls', glow=18),
    text(im, 'XING', 'en', 54, WHITE, 0.30, 0.43, 'ls', track=18),
    text(im, '能量饮料', 'heil', 34, PALE, 0.30, 0.50, 'ls', track=6),
    text(im, '再撑一班。', 'hei', 56, WHITE, 0.08, 0.68, 'ls'),
    text(im, 'ONE MORE SHIFT', 'en', 28, AMBER, 0.08, 0.75, 'ls', track=8))),
  'h02': dict(kind='h', crop=dict(cx=0.5, cy=0.5), shade='r', draw=lambda im: (
    text(im, '恒骨义体', 'song', 110, WHITE, 0.58, 0.40, 'ls', glow=6),
    text(im, 'HENGGU  PROSTHETICS', 'enl', 32, CYAN, 0.585, 0.48, 'ls', track=6),
    rule(im, 0.585, 0.93, 0.53, '#7fe8ff88'),
    text(im, '换一只，还是你。', 'songl', 50, PALE, 0.585, 0.63, 'ls'),
    text(im, 'STILL YOU.', 'en', 26, PALE, 0.585, 0.70, 'ls', track=6))),
  'h03': dict(kind='h', crop=dict(cx=0.5, cy=0.42), shade='r', draw=lambda im: (
    text(im, '经纬', 'song', 150, WHITE, 0.68, 0.42, 'ls', glow=10),
    text(im, 'MERIDIAN', 'en', 48, GOLD, 0.685, 0.51, 'ls', track=14),
    text(im, 'URBAN SYSTEMS', 'enl', 26, GOLD, 0.685, 0.56, 'ls', track=10),
    text(im, '今晚，城市照常运转。', 'songl', 36, PALE, 0.685, 0.70, 'ls'),
    text(im, 'THE CITY, AS USUAL.', 'enl', 22, PALE, 0.685, 0.75, 'ls', track=5))),
  'h04': dict(kind='h', crop=dict(cx=0.5, cy=0.55), shade='l', shade_amt=0.8, draw=lambda im: (
    text(im, '龍神', 'hei', 210, '#ff6a4a', 0.07, 0.42, 'ls', glow=16),
    text(im, 'RYUJIN RAMEN  ·  24H', 'en', 32, AMBER, 0.075, 0.50, 'ls', track=8),
    text(im, '夜班的人，先吃。', 'hei', 54, WHITE, 0.075, 0.68, 'ls'),
    text(im, 'NIGHT SHIFT EATS FIRST.', 'en', 24, PALE, 0.075, 0.74, 'ls', track=6))),
  'h08': dict(kind='h', crop=dict(cx=0.45, cy=0.5), shade='r', draw=lambda im: (
    text(im, 'DREAMLINK', 'enl', 76, WHITE, 0.60, 0.38, 'ls', glow=10, track=10),
    text(im, '织梦 · 沉浸睡眠', 'heil', 32, '#c9a8ff', 0.605, 0.45, 'ls', track=6),
    text(im, '换一个人，过一晚。', 'hei', 50, WHITE, 0.605, 0.63, 'ls'),
    text(im, 'SOMEONE ELSE, FOR A NIGHT.', 'en', 24, '#c9a8ff', 0.605, 0.69, 'ls', track=5))),
  'h10': dict(kind='h', crop=dict(cx=0.55, cy=0.45), shade='l', draw=lambda im: (
    text(im, '月蚀', 'hei', 180, '#ff4fa8', 0.07, 0.40, 'ls', glow=16),
    text(im, 'CLUB  ECLIPSE', 'fut', 48, WHITE, 0.075, 0.49, 'ls', track=8),
    text(im, '零点以后，没人认得你。', 'hei', 46, WHITE, 0.075, 0.66, 'ls'),
    text(im, 'AFTER MIDNIGHT, NO ONE KNOWS YOU.', 'en', 22, '#ffb0d0', 0.075, 0.72, 'ls', track=4),
    text(im, '入场请出示 URSA 通行码', 'heil', 20, '#9fb4bc', 0.075, 0.90, 'ls', track=2))),
  'h05': dict(kind='h', crop=dict(cx=0.5, cy=0.55), shade='r', draw=lambda im: (
    text(im, '安途', 'hei', 120, WHITE, 0.70, 0.30, 'ls', glow=8),
    text(im, 'ANTU  AUTODRIVE', 'en', 30, CYAN, 0.705, 0.37, 'ls', track=6),
    text(im, '放心睡吧。', 'hei', 52, WHITE, 0.705, 0.55, 'ls'),
    text(im, 'SLEEP. WE DRIVE.', 'en', 26, PALE, 0.705, 0.61, 'ls', track=5),
    text(im, '已接入 URSA 路网  URSA CONNECTED', 'heil', 20, '#9fb4bc', 0.705, 0.90, 'ls'))),
  'h06': dict(kind='h', crop=dict(cx=0.5, cy=0.30), shade='r', draw=lambda im: (
    text(im, '承岳置地', 'song', 104, GOLD, 0.58, 0.42, 'ls', glow=8),
    text(im, 'CHENGYUE  ESTATES', 'enl', 30, GOLD, 0.585, 0.50, 'ls', track=8),
    rule(im, 0.585, 0.93, 0.55, '#e8c77a88'),
    text(im, '北岸一号 · 江景臻席', 'songl', 44, WHITE, 0.585, 0.65, 'ls'),
    text(im, 'NORTH BANK No.1', 'enl', 24, PALE, 0.585, 0.71, 'ls', track=6))),
  'h07': dict(kind='h', crop=dict(cx=0.5, cy=0.5), shade='r', shade_amt=0.85, draw=lambda im: (
    text(im, '零号保障', 'song', 100, WHITE, 0.665, 0.42, 'ls', glow=8),
    text(im, 'ZERO  PRIORITY', 'enl', 30, GOLD, 0.67, 0.50, 'ls', track=10),
    rule(im, 0.67, 0.95, 0.55, '#e8c77a88'),
    text(im, '您先请。', 'songl', 54, WHITE, 0.67, 0.66, 'ls'),
    text(im, 'AFTER YOU.', 'enl', 26, PALE, 0.67, 0.72, 'ls', track=6))),
  'h09': dict(kind='h', crop=dict(cx=0.5, cy=0.5), shade='l', draw=lambda im: (
    text(im, '新星', 'hei', 150, '#ff7ab8', 0.07, 0.40, 'ls', glow=14),
    text(im, 'NOVA  BEER', 'fut', 50, WHITE, 0.075, 0.49, 'ls', track=8),
    text(im, '下班了。', 'hei', 62, WHITE, 0.075, 0.68, 'ls'),
    text(im, 'OFF THE CLOCK.', 'en', 26, '#ffb0d0', 0.075, 0.75, 'ls', track=6))),
  'h11': dict(kind='h', crop=dict(cx=0.5, cy=0.5), shade='l', draw=lambda im: (
    text(im, '城脉', 'song', 150, WHITE, 0.06, 0.38, 'ls', glow=8),
    text(im, 'METRO PULSE', 'en', 40, CYAN, 0.065, 0.46, 'ls', track=10),
    rule(im, 0.065, 0.36, 0.51, '#7fe8ff88'),
    text(im, '2187 季风特刊', 'hei', 44, WHITE, 0.065, 0.61, 'ls'),
    text(im, '雨季出行指南 · MONSOON ISSUE', 'heil', 26, PALE, 0.065, 0.67, 'ls'))),
  'h12': dict(kind='h', crop=dict(cx=0.5, cy=0.48), shade='r', draw=lambda im: (
    text(im, '云渡', 'hei', 120, WHITE, 0.68, 0.32, 'ls', glow=8),
    text(im, 'YUNDU  AIR TAXI', 'en', 30, CYAN, 0.685, 0.39, 'ls', track=6),
    text(im, '雨天，也准时。', 'hei', 46, WHITE, 0.685, 0.57, 'ls'),
    text(im, 'ON TIME, RAIN OR SHINE.', 'en', 22, PALE, 0.685, 0.63, 'ls', track=4))),
  'h13': dict(kind='h', crop=dict(cx=0.5, cy=0.51), shade='l', shade_amt=0.6, draw=lambda im: (
    text(im, 'HACKMAN', 'fut', 150, CYAN, 0.06, 0.36, 'ls', glow=16, track=12),
    text(im, '海克曼  ·  网络安全', 'heil', 32, PALE, 0.065, 0.44, 'ls', track=6),
    rule(im, 0.065, 0.42, 0.49, '#7fe8ff88'),
    text(im, '小心黑客。', 'hei', 64, WHITE, 0.065, 0.62, 'ls'),
    text(im, '我们就是。', 'hei', 64, '#ff4a5a', 0.065, 0.72, 'ls', glow=8),
    text(im, 'BEWARE OF HACKERS. WE ARE THEM.', 'en', 22, PALE, 0.065, 0.79, 'ls', track=5),
    text(im, '渗透测试 · 数据找回 · 不问来路', 'heil', 20, '#8aa0a8', 0.065, 0.92, 'ls', track=2))),
  'h14': dict(kind='h', crop=dict(cx=0.5, cy=0.44), shade='l', shade_amt=0.35, draw=lambda im: (
    text(im, '胡闹洗车', 'hei', 140, WHITE, 0.055, 0.36, 'ls', stroke=8, stroke_fill='#e8532e'),
    text(im, 'HUNAO  CAR WASH', 'fut', 46, '#ffd84a', 0.06, 0.45, 'ls', track=8, stroke=3, stroke_fill='#1d4d48'),
    text(im, '越闹，越干净。', 'hei', 58, WHITE, 0.06, 0.64, 'ls', stroke=4, stroke_fill='#1d4d48'),
    text(im, 'THE MESSIER, THE CLEANER.', 'en', 24, '#fff3c4', 0.06, 0.71, 'ls', track=5, stroke=2, stroke_fill='#1d4d48'),
    text(im, '洗车 · 打蜡 · 不保证车顶有没有猫', 'heil', 22, WHITE, 0.06, 0.93, 'ls', track=2, stroke=2, stroke_fill='#1d4d48'))),
  'v01': dict(kind='v', crop=dict(cx=0.69, cy=0.5), shade='t', shade_amt=0.6, draw=lambda im: (
    text(im, 'AURA', 'enl', 120, WHITE, 0.5, 0.13, 'ms', glow=12, track=26),
    text(im, '奥拉 · 今夜开唱', 'heil', 30, CYAN, 0.5, 0.18, 'ms', track=6),
    text(im, '只唱给你听。', 'songl', 46, WHITE, 0.5, 0.26, 'ms'),
    text(im, 'TONIGHT, JUST FOR YOU.', 'enl', 20, '#f3b6c8', 0.5, 0.295, 'ms', track=6),
    text(im, 'URSA 已按您的喜好预留座位', 'heil', 18, '#8aa0a8', 0.5, 0.965, 'ms', track=2))),
  'v02': dict(kind='v', crop=dict(cx=0.5, cy=0.5), shade='t', shade_amt=0.55, draw=lambda im: (
    text(im, '莲华诊所', 'song', 96, WHITE, 0.5, 0.15, 'ms', glow=8, track=6),
    text(im, 'LOTUS  CLINIC', 'enl', 26, '#f3b6c8', 0.5, 0.20, 'ms', track=10),
    text(im, '更像你自己。', 'songl', 44, WHITE, 0.5, 0.28, 'ms'),
    text(im, 'MORE LIKE YOU.', 'enl', 20, PALE, 0.5, 0.315, 'ms', track=8),
    text(im, '恒骨义体 指定合作机构', 'heil', 16, '#8aa0a8', 0.5, 0.965, 'ms', track=3))),
  'v04': dict(kind='v', crop=dict(cx=0.5, cy=0.5), shade='t', shade_amt=0.5, draw=lambda im: (
    text(im, '赤鬼', 'hei', 170, '#e8343a', 0.5, 0.17, 'ms', glow=16, track=10),
    text(im, 'RED ONI  ·  AGED 12 YEARS', 'en', 20, AMBER, 0.5, 0.21, 'ms', track=5),
    text(im, '今天，就到这儿。', 'songl', 44, WHITE, 0.5, 0.30, 'ms'),
    text(im, 'THAT\'S ENOUGH FOR TODAY.', 'enl', 20, PALE, 0.5, 0.335, 'ms', track=5),
    text(im, '请理性饮酒 · 酒后请勿上岗', 'heil', 16, '#8a7a72', 0.5, 0.975, 'ms', track=3))),
  'v06': dict(kind='v', crop=dict(cx=0.62, cy=0.5), shade='t', shade_amt=0.6, draw=lambda im: (
    text(im, '团团', 'hei', 130, WHITE, 0.5, 0.15, 'ms', glow=10, track=10),
    text(im, 'TUANTUAN  ·  MERIDIAN HOME', 'en', 18, CYAN, 0.5, 0.19, 'ms', track=5),
    text(im, '它记得你几点回家。', 'hei', 38, WHITE, 0.5, 0.27, 'ms'),
    text(im, 'IT KNOWS WHEN YOU\'RE HOME.', 'en', 18, PALE, 0.5, 0.30, 'ms', track=5),
    text(im, '经纬家居 · 已接入 URSA 家庭网络', 'heil', 16, '#8aa0a8', 0.5, 0.975, 'ms', track=2))),
  'v03': dict(kind='v', crop=dict(cx=0.64, cy=0.5), shade='b', shade_amt=0.92, shade_span=0.6, draw=lambda im: (
    text(im, 'URSA', 'enl', 120, WHITE, 0.5, 0.66, 'ms', glow=10, track=30),
    text(im, '城市资源与系统管理中枢', 'heil', 26, CYAN, 0.5, 0.71, 'ms', track=6),
    text(im, '晚安。', 'songl', 54, PALE, 0.5, 0.84, 'ms'),
    text(im, 'GOOD NIGHT.', 'enl', 24, PALE, 0.5, 0.88, 'ms', track=8),
    text(im, 'URBAN RESOURCE & SYSTEMS ADMINISTRATOR', 'enl', 14, '#8aa0a8', 0.5, 0.95, 'ms', track=3))),
  'v05': dict(kind='v', crop=dict(cx=0.5, cy=0.5), shade='t', draw=lambda im: (
    text(im, '零号保障', 'song', 104, WHITE, 0.5, 0.17, 'ms', glow=8),
    text(im, 'ZERO  PRIORITY', 'enl', 30, GOLD, 0.5, 0.22, 'ms', track=10),
    text(im, '一路绿灯。', 'songl', 50, WHITE, 0.5, 0.88, 'ms'),
    text(im, 'ALL GREEN.', 'enl', 24, PALE, 0.5, 0.92, 'ms', track=8))),
  'v07': dict(kind='v', crop=dict(cx=0.5, cy=0.5), shade='t', draw=lambda im: (
    text(im, '阿婆面', 'hei', 130, '#ffd27a', 0.5, 0.17, 'ms', glow=14),
    text(im, '开到最后一盏灯', 'heil', 38, WHITE, 0.5, 0.235, 'ms', track=4),
    text(im, 'OPEN TILL THE LAST LIGHT', 'en', 20, '#ffd27a', 0.5, 0.27, 'ms', track=4))),
  'v08': dict(kind='v', crop=dict(cx=0.5, cy=0.5), shade='t', draw=lambda im: (
    text(im, '公序', 'song', 140, WHITE, 0.5, 0.16, 'ms', glow=8, track=8),
    text(im, 'CIVIC ORDER SERVICES', 'en', 22, CYAN, 0.5, 0.20, 'ms', track=6),
    text(im, '夜班复核员 招募中', 'hei', 44, WHITE, 0.5, 0.29, 'ms'),
    text(im, 'NOW HIRING · NIGHT SHIFT', 'en', 20, PALE, 0.5, 0.325, 'ms', track=4),
    text(im, '签约即上岗', 'heil', 30, CYAN, 0.5, 0.93, 'ms', track=6))),
}

if __name__ == '__main__':
  ids = sys.argv[1:] or sorted(ADS)
  for k in ids:
    a = ADS[k]
    im = crop(Image.open(os.path.join(RAW, k + '.png')).convert('RGB'), a['kind'], **a['crop'])
    if a.get('shade'): im = shade(im, a['shade'], a.get('shade_amt', 0.75), a.get('shade_span', 0.55))
    im = im.convert('RGBA')
    a['draw'](im)
    im.convert('RGB').save(os.path.join(OUT, k + '.png'))
    print(k, im.size)
