"""把客戶的 3:4 封面（網頁jpg/1.jpg）做成 9:16，並把標題字、按鈕拆成獨立圖層，網頁上才能讓字跳動。

用法（在 mix-quiz-site 資料夾）：python tools/make_cover.py 封面.jpg
產出：
  assets/cover/bg.png      9:16 背景（字已移除、上方延伸天空、下方雲海鏡像）
  assets/cover/c00.png...  每個字一張透明圖
  assets/cover/start.png   開始按鈕
  js/cover.js              各圖層的位置（百分比），網頁讀這個檔排版

說明：原圖的字直接畫在 JPG 裡，這裡用顏色分離：
  - 「MIX OR NOT???」是深藍色 → 取深色
  - 「怎麼拌」是白字＋黑陰影，那一帶背景沒有白雲 → 取深色＋白色
若之後設計師提供分層檔（透明 PNG），直接換掉 assets/cover 裡的圖即可。
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:\大專檔案-20261003T125815Z-1-001\大專檔案\網頁\網頁jpg\1.jpg"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "cover")
os.makedirs(OUT, exist_ok=True)

# 原圖（768×1024）上的區段，依實際圖檔量測
MIX_BAND = (325, 415)     # MIX OR NOT???
KANJI_BAND = (442, 642)   # [ 怎麼拌 ]
BTN_BAND = (670, 805)     # 開始!

im = np.array(Image.open(SRC).convert("RGB"))
H0, W0 = im.shape[:2]
r, g, b = (im[..., i].astype(np.int16) for i in range(3))
dark = (r + g + b) < 330
cream = (r > 215) & (g > 215) & (b > 190) & (np.abs(r - g) < 25)
yellow = (r > 200) & (g > 150) & (b < 120)

mask = np.zeros((H0, W0), bool)
y0, y1 = MIX_BAND
mask[y0:y1] = dark[y0:y1]
y0, y1 = KANJI_BAND
mask[y0:y1] = dark[y0:y1] | cream[y0:y1]
# 按鈕：黃色＋深色外框，取整塊外接矩形
by0, by1 = BTN_BAND
bmask = np.zeros((H0, W0), bool)
bmask[by0:by1] = yellow[by0:by1] | dark[by0:by1]
ys, xs = np.where(bmask)
PAD = 8   # 按鈕外圍的橘色漸層、陰影也要包進來，不然補背景時黃色會擴散成殘影
btn = (max(0, int(xs.min()) - PAD), max(0, int(ys.min()) - PAD),
       min(W0, int(xs.max()) + 1 + PAD), min(H0, int(ys.max()) + 1 + PAD))
bx0, bby0, bx1, bby1 = btn
bmask[bby0:bby1, bx0:bx1] = True

mask = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0   # 多包 1px，避免 JPG 邊緣殘影


def pieces(band, gap=2):
    """用直向投影把一行字切成一個一個字（字與字之間的空白欄 ≥ gap）"""
    y0, y1 = band
    cols = mask[y0:y1].any(0)
    out, x, n = [], 0, len(cols)
    while x < n:
        if cols[x]:
            s = x
            while x < n and (cols[x:x + gap].any()):
                x += 1
            out.append((s, x))
        x += 1
    res = []
    for xs0, xs1 in out:
        sub = mask[y0:y1, xs0:xs1]
        rows = np.where(sub.any(1))[0]
        if len(rows) == 0 or (xs1 - xs0) < 3:
            continue
        res.append((xs0, y0 + rows.min(), xs1, y0 + rows.max() + 1))
    return res


def split_wide(boxes, unit):
    """黏在一起的字（陰影相連）：寬度明顯超過一個字寬時，在最稀疏的欄位切開"""
    out = []
    for (x0, y0, x1, y1) in boxes:
        n = max(1, int(round((x1 - x0) / unit)))
        if n == 1:
            out.append((x0, y0, x1, y1))
            continue
        prof = mask[y0:y1, x0:x1].sum(0).astype(float)
        cuts = [x0]
        for k in range(1, n):
            c = int((x1 - x0) * k / n)
            lo, hi = max(1, c - int(unit * 0.3)), min(len(prof) - 1, c + int(unit * 0.3))
            cuts.append(x0 + lo + int(prof[lo:hi].argmin()))
        cuts.append(x1)
        for a, b2 in zip(cuts[:-1], cuts[1:]):
            rows = np.where(mask[y0:y1, a:b2].any(1))[0]
            out.append((a, y0 + rows.min(), b2, y0 + rows.max() + 1))
    return out


mix = pieces(MIX_BAND)
mix_unit = float(np.median([b[2] - b[0] for b in mix]))          # 英文字的典型寬度
kanji = pieces(KANJI_BAND, gap=2)
kanji_h = max(b[3] - b[1] for b in kanji)                        # 中文字是方的：字寬約等於字高
kanji = [b for b in kanji if (b[2] - b[0]) < kanji_h * 0.4] + \
        split_wide([b for b in kanji if (b[2] - b[0]) >= kanji_h * 0.4], kanji_h)
kanji.sort()
letters = [("mix", p) for p in split_wide(mix, mix_unit * 1.0)] + [("kanji", p) for p in kanji]

# 背景：挖掉字與按鈕，用周圍顏色補（字只會小幅跳動，補的地方大多被字蓋住）
hole = mask.copy()
hole[bby0:bby1, bx0:bx1] = True
hole = cv2.dilate(hole.astype(np.uint8), np.ones((5, 5), np.uint8))
bg = cv2.inpaint(cv2.cvtColor(im, cv2.COLOR_RGB2BGR), hole, 5, cv2.INPAINT_TELEA)
bg = cv2.cvtColor(bg, cv2.COLOR_BGR2RGB)

# 9:16：上方延伸天空、下方雲海鏡像（下方補的高度小於按鈕到底部的距離，鏡像不會出現倒過來的按鈕）
W = W0
H = int(round(W * 16 / 9))
top = (H - H0) // 2
bot = H - H0 - top
canvas = np.zeros((H, W, 3), np.uint8)
canvas[top:top + H0] = bg
canvas[:top] = bg[:4].mean(0).astype(np.uint8)
canvas[top + H0:] = bg[::-1][:bot]
Image.fromarray(canvas).save(os.path.join(OUT, "bg.png"), optimize=True)


def pct(v, total):
    return round(v / total * 100, 3)


layers = []
for i, (line, (x0, y0, x1, y1)) in enumerate(letters):
    rgba = np.dstack([im[y0:y1, x0:x1], (mask[y0:y1, x0:x1] * 255).astype(np.uint8)])
    name = f"c{i:02d}.png"
    Image.fromarray(rgba).save(os.path.join(OUT, name), optimize=True)
    layers.append({"src": name, "line": line, "x": pct(x0, W), "y": pct(y0 + top, H),
                   "w": pct(x1 - x0, W), "h": pct(y1 - y0, H)})
# 按鈕只留按鈕本身（黃、橘、深色外框），四周背景透明，跳動時才不會帶著一塊雲
crop = im[bby0:bby1, bx0:bx1]
cr, cg, cb = (crop[..., i].astype(np.int16) for i in range(3))
btn_px = ((cr > 200) & (cg > 150) & (cb < 120)) | ((cr + cg + cb) < 330) | ((cr > 170) & (cg > 90) & (cg < 190) & (cb < 120))
btn_px = cv2.morphologyEx(btn_px.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
# 填滿內部（文字之間的黃色以外的小洞）：從邊框往內 flood fill 找外部，其餘都是按鈕
ff = np.pad(1 - btn_px, 1, constant_values=1).astype(np.uint8)
cv2.floodFill(ff, None, (0, 0), 2)
btn_alpha = (ff[1:-1, 1:-1] != 2).astype(np.uint8) * 255
Image.fromarray(np.dstack([crop, btn_alpha])).save(os.path.join(OUT, "start.png"), optimize=True)
start = {"src": "start.png", "x": pct(bx0, W), "y": pct(bby0 + top, H), "w": pct(bx1 - bx0, W), "h": pct(bby1 - bby0, H)}

with open(os.path.join(ROOT, "js", "cover.js"), "w", encoding="utf-8") as f:
    f.write("// 由 tools/make_cover.py 自動產生，請勿手改。位置為佔 9:16 封面的百分比。\n")
    f.write("window.COVER = " + json.dumps({"bg": "bg.png", "layers": layers, "start": start}, ensure_ascii=False, indent=1) + ";\n")

print(f"9:16 背景 {W}x{H}（上補 {top}px、下補 {bot}px），字 {len(layers)} 個"
      f"（MIX 行 {sum(l['line'] == 'mix' for l in layers)}、怎麼拌行 {sum(l['line'] == 'kanji' for l in layers)}），按鈕 {btn}")


