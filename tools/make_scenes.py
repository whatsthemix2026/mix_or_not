"""把客戶的 3:4 場景圖（網頁jpg/*.jpg）做成網站用的 9:16 場景，並把會動的東西拆成獨立圖層。

用法（在 mix-quiz-site 資料夾）：python tools/make_scenes.py
產出到 assets/scenes/：
  desert / market / eggroll / exotic / eggstall / hometown / closed .png
                    9:16 場景（進度條清空，由網頁依進度填滿；會動的東西都已從場景拿掉、另存一層）
  placeholder.png   還沒畫的頁面用的暫代場景（雲朵天空＋地面＋對話框）
  bar_fill.png      進度條「滿格」那一條（只有青色格子，其他透明），網頁依進度裁切顯示
  actor_desert.png  沙漠路牌上的蛋（網頁上每講一句跳一下）
  egg.png           第 24 頁的精靈蛋（依 23.jpg 的蛋配色重畫完整一顆）
  fx_<場景>_clouds.png / fx_<場景>_fg.png   會飄的雲、雲前面的建築（見 tools/scene_fx.py）
  fx_closed_sign.png   CLOSED 門上的牌子（會晃）
  fx_eggstall_led.png  蛋小舖兩側的燈串（會換顏色閃）
  fx_eggroll_soy.png / fx_eggroll_ketchup.png   醬油膏、番茄醬瓶（選完 Q2 會淋醬）
  fx_eggroll_sauce_soy.png / fx_eggroll_sauce_ketchup.png   淋在蛋餅上的醬
  dither.png        對話框底部的點點漸層（當遮罩用，顏色由網頁依場景決定）
並產生 js/scenes.js：進度條、上一頁、音樂、對話框、各特效的位置（佔 9:16 的百分比）。

9:16 的做法：在對話框中段（白底＋左右框線＋兩側地面）重複插入 341 列，把對話框拉高；場景本身不變形。
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene_fx as fx  # noqa: E402

SRC = r"D:\大專檔案-20261003T125815Z-1-001\大專檔案\網頁\網頁jpg"
AI = os.path.join(SRC, "網頁.ai")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "scenes")
os.makedirs(OUT, exist_ok=True)

SCENES = {"desert": "2.jpg", "market": "3.jpg", "eggroll": "4.jpg", "exotic": "5.jpg", "eggstall": "23.jpg",
          "hometown": "網頁-07.jpg", "closed": "網頁-08.jpg"}
W0, H0 = 768, 1024
W, H = 768, 1365
EXTRA = H - H0                       # 341
TILE = (700, 760)                    # 對話框裡上緣下方的空白段，沒有醬料瓶等前景
INSERT_AT = 760
BAR = (100, 38, 649, 59)             # 進度條格子範圍（含一點邊）
BACK = (10, 18, 86, 78)              # 左上「◀|」
MUSIC = (695, 15, 758, 80)           # 右上音符
TEXT = (84, 712, 690, 1318)          # 9:16 後對話框裡可放文字的區域
CELL = 8
# 會動的角色：從場景裡切出來另存一張透明圖，原位置補回天空；網頁上每講一句就跳一下
# (x0, y0, x1, y1) 都對齊原圖 8px 的像素格（格子從 4 開始）
ACTORS = {"desert": (436, 428, 516, 532)}   # 沙漠路牌上的蛋
# 雲：("ai", AI 第幾頁, 天空上緣, 天空下緣) 或 ("color", [可能有雲的範圍])
CLOUDS = {"desert": ("ai", 1, 80, 345), "market": ("ai", 2, 80, 345),
          "hometown": ("color", [(0, 85, 768, 312)]),
          "closed": ("color", [(0, 240, 112, 372), (650, 375, 768, 545)])}
LAMPS = {"closed": [(174, 414), (232, 414), (528, 414), (586, 414)]}   # CLOSED 窗裡吊燈的燈罩底
SIGN = (344, 406, 418, 462)          # CLOSED 門上的牌子（上緣中間是吊掛點）
DOOR_GLASS = (201, 239, 242)
LED_BOXES = [(0, 150, 150, 300), (650, 165, 768, 300)]   # 蛋小舖兩側燈串
BOTTLES = {"soy": (81, 829, 132, 967), "ketchup": (149, 829, 201, 967)}  # 蛋餅頁對話框裡的兩瓶醬
BOTTLE_REST = {"soy": (612, 625), "ketchup": (672, 625)}   # 拿到桌上站的位置（左 x、底 y）


def pct(box):
    x0, y0, x1, y1 = box
    return {"x": round(x0 / W * 100, 3), "y": round(y0 / H * 100, 3),
            "w": round((x1 - x0) / W * 100, 3), "h": round((y1 - y0) / H * 100, 3)}


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


def save_rgba(arr, name):
    Image.fromarray(arr, "RGBA").save(os.path.join(OUT, name), optimize=True)


def load(f):
    """讀場景圖；新的 07、08 是 3200×4267 的高解析，縮成 768×1024（取最近的像素，保持像素畫清楚）"""
    im = Image.open(os.path.join(SRC, f)).convert("RGB")
    if im.size != (W0, H0):
        im = im.resize((W0, H0), Image.NEAREST)
    return np.array(im)


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


def make_sauces():
    """在蛋餅上畫之字形的醬（對齊像素格），各存一張透明圖；網頁上由左往右慢慢露出"""
    out = {}
    specs = {"ketchup": ((225, 38, 38), (255, 130, 120), 0), "soy": ((105, 52, 22), (170, 100, 60), 36)}
    for k, (col, hi, shift) in specs.items():
        img = np.zeros((H0, W0, 4), np.uint8)
        # 蛋餅大約從左下 (190, 430) 斜到右上 (640, 170)；沿著它來回畫之字
        pts = []
        n = 9
        for i in range(n + 1):
            t = i / n
            cx, cy = 190 + 450 * t + shift * 0.4, 430 - 260 * t + shift
            off = 46 if i % 2 else -46
            pts.append((cx + off * 0.5, cy + off))
        for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
            steps = int(max(abs(xb - xa), abs(yb - ya)) / 4) + 1
            for j in range(steps + 1):
                x = xa + (xb - xa) * j / steps
                y = ya + (yb - ya) * j / steps
                gx, gy = int(x // CELL) * CELL, int(y // CELL) * CELL
                img[gy:gy + 2 * CELL, gx:gx + 2 * CELL] = col + (255,)
        # 上緣每隔幾格點一格亮色，看起來有光澤
        m = img[..., 3] > 0
        top = m & ~np.vstack([np.zeros((CELL, W0), bool), m[:-CELL]])
        img[top & (np.indices(m.shape)[1] // CELL % 3 == 0)] = hi + (255,)
        ys, xs = np.where(img[..., 3] > 0)
        box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        save_rgba(img[box[1]:box[3], box[0]:box[2]], f"fx_eggroll_sauce_{k}.png")
        out[k] = pct(box)
    return out


FX = {}
for name, f in SCENES.items():
    a = load(f)
    assert a.shape[:2] == (H0, W0), (f, a.shape)
    if name in ACTORS:
        cut_actor(a, ACTORS[name], name)
    fxs = {}
    if name in CLOUDS:
        how = CLOUDS[name]
        if how[0] == "ai":
            cl, fg = fx.vector_clouds(AI, how[1], how[2], how[3])
            res = fx.remove_clouds(a, cl, fg)
        else:
            cl, fg = fx.color_clouds(a, how[1])
            res = fx.remove_clouds(a, cl, fg, margin=6, period=96, sky_only=True)
        (y0, y1), clouds, fgl = res
        save_rgba(clouds, f"fx_{name}_clouds.png")
        fxs["clouds"] = {"src": f"fx_{name}_clouds.png", "y": round(y0 / H * 100, 3),
                         "h": round((y1 - y0) / H * 100, 3)}
        if fgl is not None:
            save_rgba(fgl, f"fx_{name}_fg.png")
            fxs["clouds"]["fg"] = f"fx_{name}_fg.png"
    if name in LAMPS:
        fxs["lamps"] = [{"x": round(x / W * 100, 3), "y": round(y / H * 100, 3)} for x, y in LAMPS[name]]
    if name == "closed":
        x0, y0, x1, y1 = SIGN
        reg = a[y0:y1, x0:x1].copy()
        ri = reg.astype(int)
        glass = (ri[..., 0] > 190) & (ri[..., 1] > 225) & (ri[..., 2] > 230)
        save_rgba(np.dstack([reg, np.where(glass, 0, 255).astype(np.uint8)]), "fx_closed_sign.png")
        reg[~glass] = DOOR_GLASS
        a[y0:y1, x0:x1] = reg
        fxs["swing"] = {"src": "fx_closed_sign.png", **pct(SIGN)}
    if name == "eggstall":
        r, g, b = (a[..., i].astype(int) for i in range(3))
        led = (((r > 200) & (g < 130) & (b > 120)) | ((r < 130) & (g > 170) & (b > 210))
               | ((r > 200) & (g > 150) & (b < 90)))
        box = np.zeros(led.shape, bool)
        for x0, y0, x1, y1 in LED_BOXES:
            box[y0:y1, x0:x1] = True
        led &= box
        rgba = np.zeros((H0, W0, 4), np.uint8)
        rgba[led, :3] = a[led]
        rgba[led, 3] = 255
        ys, _ = np.where(led)
        lb = (0, int(ys.min()), W0, int(ys.max()) + 1)
        save_rgba(rgba[lb[1]:lb[3]], "fx_eggstall_led.png")
        fxs["leds"] = {"src": "fx_eggstall_led.png", **pct(lb)}
    if name == "eggroll":
        bottles = {}
        for k, (x0, y0, x1, y1) in BOTTLES.items():
            reg = a[y0:y1, x0:x1].copy()
            white = reg.astype(int).sum(axis=2) > 720
            save_rgba(np.dstack([reg, np.where(white, 0, 255).astype(np.uint8)]), f"fx_eggroll_{k}.png")
            a[y0 - 6:y1 + 6, x0 - 6:x1 + 6] = 255                      # 對話框裡的瓶子拿掉（多 6px 吃掉殘影）
            rx, by = BOTTLE_REST[k]
            bottles[k] = {"src": f"fx_eggroll_{k}.png", **pct((rx, by - (y1 - y0), rx + (x1 - x0), by))}
        sauces = make_sauces()
        fxs["sauce"] = {"bottles": bottles,
                        "sauces": {k: {"src": f"fx_eggroll_sauce_{k}.png", **v} for k, v in sauces.items()}}
    a916 = to916(empty_bar(a.copy()))
    save(a916, f"{name}.png")
    fxs["tint"] = "#%02x%02x%02x" % tuple(int(v) for v in a916[1000, 20])   # 對話框外框的顏色
    FX[name] = fxs

# 進度條滿格（取沙漠那張，只留青色格子）
a = load("2.jpg")
x0, y0, x1, y1 = BAR
crop = a[y0:y1, x0:x1]
Image.fromarray(np.dstack([crop, cyan_mask(crop).astype(np.uint8) * 255])).save(os.path.join(OUT, "bar_fill.png"))

# 暫代場景：已拿掉雲和蛋的沙漠，仙人掌、路牌那段改成天空漸層（取最左邊一欄的顏色）；雲沿用沙漠的
p = np.array(Image.open(os.path.join(OUT, "desert.png")).convert("RGB"))
for y in range(360, 666):
    p[y, :] = p[y, 5]
save(p, "placeholder.png")
FX["placeholder"] = {"clouds": FX["desert"]["clouds"], "tint": FX["desert"]["tint"]}

# 精靈蛋：依 23.jpg 大蛋的配色重畫完整一顆（原圖下半被招牌擋住）
e = load("23.jpg")
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

# 對話框白色內框（取沙漠 9:16），點點漸層放在它的下半部
d916 = np.array(Image.open(os.path.join(OUT, "desert.png")).convert("RGB")).astype(int)
white = (d916[700:] >= 250).all(axis=2)
rows = np.where(white.sum(axis=1) > 400)[0] + 700
cols = np.where(white[rows.min() - 700:rows.max() - 700 + 1].sum(axis=0) > 0.9 * len(rows))[0]
BOX = (int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1)

# 點點漸層遮罩：4 格寬可左右重複，28 格高，由上（沒有點）到下（約 55%）——4×4 Bayer 有序抖動
# 一格畫成 8×8px（跟場景的像素格一樣大），網頁縮放時才不會糊
bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16
ROWS_N = 28
dm = np.zeros((ROWS_N, 4), np.uint8)
for y in range(ROWS_N):
    dm[y] = np.where(bayer[y % 4] < ((y + 1) / ROWS_N) ** 1.4 * 0.55, 255, 0)
Image.fromarray(np.dstack([np.full((ROWS_N, 4, 3), 255, np.uint8), dm]), "RGBA").resize(
    (4 * CELL, ROWS_N * CELL), Image.NEAREST).save(os.path.join(OUT, "dither.png"))

geo = {"bar": pct(BAR), "back": pct(BACK), "music": pct(MUSIC), "text": pct(TEXT), "box": pct(BOX),
       "actors": {k: pct(v) for k, v in ACTORS.items()}, "fx": FX}
with open(os.path.join(ROOT, "js", "scenes.js"), "w", encoding="utf-8") as f:
    f.write("// 由 tools/make_scenes.py 自動產生，請勿手改。位置為佔 9:16 場景的百分比。\n")
    f.write("window.SCENE_GEO = " + json.dumps(geo, ensure_ascii=False, indent=1) + ";\n")
print("scenes:", list(SCENES), "+ placeholder, bar_fill, egg, dither；box:", BOX)
print({k: sorted(v) for k, v in FX.items()})
