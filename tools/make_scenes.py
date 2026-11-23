"""把客戶的 3:4 場景圖（網頁jpg/*.jpg，768×1024）做成網站用的 9:16 場景。

用法（在 mix-quiz-site 資料夾）：python tools/make_scenes.py
產出到 assets/scenes/：
  desert / market / eggroll / exotic / eggstall .png   9:16 場景（進度條清空，由網頁依進度填滿）
  placeholder.png   還沒畫的頁面用的暫代場景（雲朵天空＋地面＋對話框）
  bar_fill.png      進度條「滿格」那一條（只有青色格子，其他透明），網頁依進度裁切顯示
  actor_desert.png  沙漠路牌上的蛋（從場景切出來，網頁上會跳）
  egg.png           第 24 頁的精靈蛋（依 23.jpg 的蛋配色重畫完整一顆）
並產生 js/scenes.js：進度條、上一題、音樂、對話框文字區的位置（佔 9:16 的百分比）。

9:16 的做法：在對話框中段（白底＋左右框線＋兩側地面）重複插入 341 列，把對話框拉高；場景本身不變形。
"""
import json
import os

import numpy as np
from PIL import Image

SRC = r"D:\大專檔案-20261003T125815Z-1-001\大專檔案\網頁\網頁jpg"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "scenes")
os.makedirs(OUT, exist_ok=True)

SCENES = {"desert": "2", "market": "3", "eggroll": "4", "exotic": "5", "eggstall": "23"}
W0, H0 = 768, 1024
W, H = 768, 1365
EXTRA = H - H0                       # 341
TILE = (700, 760)                    # 對話框裡上緣下方的空白段，沒有醬料瓶等前景
INSERT_AT = 760
BAR = (100, 38, 649, 59)             # 進度條格子範圍（含一點邊）
BACK = (10, 18, 86, 78)              # 左上「◀|」
MUSIC = (695, 15, 758, 80)           # 右上音符
TEXT = (84, 712, 690, 1318)          # 9:16 後對話框裡可放文字的區域
# 會動的角色：從場景裡切出來另存一張透明圖，原位置補回天空；網頁上每講一句就跳一下
# (x0, y0, x1, y1) 都對齊原圖 8px 的像素格（格子從 4 開始）
ACTORS = {"desert": (436, 428, 516, 532)}   # 沙漠路牌上的蛋
CELL = 8


def to916(a):
    tile = a[TILE[0]:TILE[1]]
    reps = np.array([tile[i % len(tile)] for i in range(EXTRA)])
    return np.vstack([a[:INSERT_AT], reps, a[INSERT_AT:]])


def cyan_mask(a):
    r, g, b = (a[..., i].astype(int) for i in range(3))
    return (r < 90) & (g > 190) & (b > 190)


def empty_bar(a):
    """進度條的青色格子換成暗色，網頁再依進度蓋上亮的"""
    x0, y0, x1, y1 = BAR
    region = a[y0:y1, x0:x1]
    m = cyan_mask(region)
    region[m] = (region[m].astype(int) * np.array([0.25, 0.35, 0.45])).astype(np.uint8)
    return a


def save(arr, name):
    Image.fromarray(arr).save(os.path.join(OUT, name), optimize=True)


def is_sky(c):
    r, g, b = (int(v) for v in c)
    return b > 200 and g > 200 and r < 235


def cut_actor(a, box, name):
    """依 8px 格子取每格中心色，非天空的格子＝角色；角色存成透明 PNG，原位置每列補上左邊的天空色"""
    x0, y0, x1, y1 = box
    cols, rows = (x1 - x0) // CELL, (y1 - y0) // CELL
    spr = np.zeros((rows, cols, 4), np.uint8)
    for j in range(rows):
        for i in range(cols):
            cx, cy = x0 + i * CELL, y0 + j * CELL
            c = a[cy + CELL // 2, cx + CELL // 2]
            if not is_sky(c):
                spr[j, i] = tuple(int(v) for v in c) + (255,)
    # 整個框（左右上多 4px，吃掉 JPG 的殘影）每列換成框左邊的天空色；框裡只有天空和角色
    a[y0 - 4:y1, x0 - 4:x1 + 4] = a[y0 - 4:y1, x0 - 8][:, None]
    Image.fromarray(spr).resize((cols * CELL, rows * CELL), Image.NEAREST).save(os.path.join(OUT, f"actor_{name}.png"))


for name, n in SCENES.items():
    a = np.array(Image.open(os.path.join(SRC, f"{n}.jpg")).convert("RGB"))
    assert a.shape[:2] == (H0, W0), (n, a.shape)
    if name in ACTORS:
        cut_actor(a, ACTORS[name], name)
    save(to916(empty_bar(a.copy())), f"{name}.png")

# 進度條滿格（取沙漠那張，只留青色格子）
a = np.array(Image.open(os.path.join(SRC, "2.jpg")).convert("RGB"))
x0, y0, x1, y1 = BAR
crop = a[y0:y1, x0:x1]
Image.fromarray(np.dstack([crop, cyan_mask(crop).astype(np.uint8) * 255])).save(os.path.join(OUT, "bar_fill.png"))

# 暫代場景：沙漠那張留上方的雲，下面仙人掌、路牌那段改成天空漸層（取最左邊一欄的顏色）
p = empty_bar(a.copy())
for y in range(360, 666):
    p[y, :] = p[y, 5]
save(to916(p), "placeholder.png")

# 精靈蛋：依 23.jpg 大蛋的配色重畫完整一顆（原圖下半被招牌擋住）
e = np.array(Image.open(os.path.join(SRC, "23.jpg")).convert("RGB"))
YEL, LIGHT, DARK = (250, 230, 20), tuple(int(v) for v in e[110, 410]), (20, 120, 30)
w, h = 26, 34
yy, xx = np.mgrid[0:h, 0:w] + 0.5
cx, cy = w / 2, h * 0.56
rx = w / 2 - 0.5
ry_top, ry_bot = h * 0.56 - 0.5, h * 0.44 - 0.5
ry = np.where(yy < cy, ry_top, ry_bot)
d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
egg = np.zeros((h, w, 4), np.uint8)
egg[d <= 1] = LIGHT + (255,)
egg[(d <= 1) & (d > 0.78)] = YEL + (255,)
for sx, sy, sr in ((8, 9, 2.4), (17, 13, 2.8), (10, 19, 2.6), (19, 23, 2.2), (7, 27, 1.8), (14, 28, 2.0)):
    spot = ((xx - sx) ** 2 + (yy - sy) ** 2 <= sr ** 2) & (d <= 0.7)
    egg[spot] = DARK + (255,)
Image.fromarray(egg).resize((w * 8, h * 8), Image.NEAREST).save(os.path.join(OUT, "egg.png"))


def pct(box):
    x0, y0, x1, y1 = box
    return {"x": round(x0 / W * 100, 3), "y": round(y0 / H * 100, 3),
            "w": round((x1 - x0) / W * 100, 3), "h": round((y1 - y0) / H * 100, 3)}


geo = {"bar": pct(BAR), "back": pct(BACK), "music": pct(MUSIC), "text": pct(TEXT),
       "actors": {k: pct(v) for k, v in ACTORS.items()}}
with open(os.path.join(ROOT, "js", "scenes.js"), "w", encoding="utf-8") as f:
    f.write("// 由 tools/make_scenes.py 自動產生，請勿手改。位置為佔 9:16 場景的百分比。\n")
    f.write("window.SCENE_GEO = " + json.dumps(geo, ensure_ascii=False, indent=1) + ";\n")
print("scenes:", list(SCENES), "+ placeholder, bar_fill, egg；geo:", geo)
