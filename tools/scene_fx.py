"""場景特效用的拆圖工具（給 make_scenes.py 用）。

雲：把場景裡的雲切出來另存一層，原位置補回天空，網頁上讓雲層慢慢往右飄（左右接起來循環）。
  - 有向量原稿的頁（網頁.ai 裡的沙漠、市集、異國攤）：直接用 AI 裡畫雲的那幾筆路徑當遮罩，最準。
  - 只有圖片的頁（網頁-07、08）：用顏色找雲——以奶油色格子為核心，往外兩格內的非天空格都算雲。
  - 雲飄過的那幾列裡如果有建築物，建築物另存一層蓋在雲上面（雲從建築後面飄過）。
天空的補法：天空是「上下漸層＋規律的點點」，左右方向週期重複，所以每個被雲蓋住的像素，
從同一列左右相隔 32px 倍數、沒有被雲蓋住的地方複製過來。
"""
import numpy as np

CELL = 8          # 客戶的像素畫一格＝8px（768 寬的圖）
PERIOD = 32       # 天空點點的左右週期：AI 那幾頁 32px；網頁-07、08 的點點間隔 19.2px，用 5 個＝96px


# ---------- 向量原稿 ----------
CLOUD_COLORS = {(252, 251, 227), (192, 246, 255), (136, 233, 255), (61, 185, 234),
                (41, 177, 231), (41, 178, 234), (253, 253, 253)}
DOTS_LAST = 2496  # AI 裡天空點點是最前面那一批路徑（seqno 2～2496），雲在點點之後


def _rgb(f):
    return tuple(round(v * 255) for v in f) if f else None


def _render(paths):
    """把 get_drawings() 的路徑重畫到一張 768×1024 的透明圖（關掉反鋸齒，像素畫才不會糊）"""
    import fitz
    fitz.TOOLS.set_aa_level(0)
    doc = fitz.open()
    page = doc.new_page(width=768, height=1024)
    for g in paths:
        sh = page.new_shape()
        for it in g["items"]:
            if it[0] == "l":
                sh.draw_line(it[1], it[2])
            elif it[0] == "c":
                sh.draw_bezier(it[1], it[2], it[3], it[4])
            elif it[0] == "re":
                sh.draw_rect(it[1])
            elif it[0] == "qu":
                sh.draw_quad(it[1])
        stroke = g.get("color") if g["type"] in ("s", "fs") else None
        sh.finish(fill=g.get("fill") if g["type"] in ("f", "fs") else None, color=stroke,
                  width=g.get("width") or 0, closePath=g.get("closePath", False),
                  even_odd=g.get("even_odd", False), fill_opacity=g.get("fill_opacity") or 1)
        sh.commit()
    pix = page.get_pixmap(alpha=True)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 4).copy()
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    return a


def vector_clouds(ai_path, page_no, top=80, bottom=345):
    """回傳 (雲 RGBA, 前景遮罩)。雲＝點點之後、天空範圍內、雲色的那一段路徑；前景＝雲之後才畫、壓在雲上的東西"""
    import fitz
    page = fitz.open(ai_path)[page_no]
    dr = page.get_drawings()
    in_sky = [g for g in dr if g["seqno"] > DOTS_LAST and g["rect"].y0 >= top and g["rect"].y1 <= bottom]
    seqs = [g["seqno"] for g in in_sky if _rgb(g.get("fill")) in CLOUD_COLORS]
    if not seqs:
        return None, None
    lo, hi = min(seqs), max(seqs)
    clouds = _render([g for g in in_sky if lo <= g["seqno"] <= hi])
    fg = _render([g for g in dr if g["seqno"] > hi and g["rect"].y1 > top and g["rect"].y0 < bottom])
    return clouds, fg[..., 3] > 0


# ---------- 只有圖片 ----------
def grid_offset(a, axis=1):
    """找像素格的起點（0～7）：格線上的顏色變化最多。axis=1 左右、axis=0 上下"""
    d = np.abs(np.diff(a.astype(int), axis=axis)).sum(axis=2) > 40   # 相鄰兩欄（列）不同
    if axis == 0:
        d = d.T
    score = [d[:, (np.arange(d.shape[1]) % CELL) == (o - 1) % CELL].sum() for o in range(CELL)]
    return int(np.argmax(score))


def color_clouds(a, boxes):
    """用顏色找雲（boxes＝可能有雲的範圍），逐像素處理。回傳 (雲 RGBA, 前景遮罩)
    天空的點點只有半格大、跟建築的像素格對不齊，所以不用格子，直接看每個像素。"""
    from scipy import ndimage as ndi
    H, W = a.shape[:2]
    c = a.astype(int)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    sky = (g >= 244) & (b >= 248) & (r < 248)                      # 最淺的天空底色
    cream = (r > 245) & (g > 238) & (b > 212) & (b < 246)          # 雲的奶油色
    cloudish = (b >= 228) & (g >= 190) & (r >= 100)                # 雲只有奶油、淺青、藍三種顏色
    inbox = np.zeros((H, W), bool)
    for x0, y0, x1, y1 in boxes:
        inbox[y0:y1, x0:x1] = True
    seed = cream & inbox
    k = np.ones((3, 3), bool)
    # 天空點點的顏色：範圍內、離奶油色 24px 以上、最常見的非底色
    far = inbox & ~sky & ~ndi.binary_dilation(seed, k, iterations=24)
    isdot = np.zeros((H, W), bool)
    if far.any():
        cols, cnt = np.unique(c[far] // 6, axis=0, return_counts=True)
        dot = cols[np.argmax(cnt)] * 6 + 3
        isdot = np.abs(c - dot).max(axis=2) < 12
    # 從奶油色往外長：碰到的雲色像素都算雲；點點色只有緊貼奶油色（8px 內）才算
    allow = inbox & ~sky & cloudish & (~isdot | ndi.binary_dilation(seed, k, iterations=8))
    lab, _ = ndi.label(allow | seed, structure=k)
    keep = np.unique(lab[seed])
    cloud = np.isin(lab, keep[keep > 0])
    rows = np.where(cloud.any(axis=1))[0]
    band = np.zeros((H, W), bool)
    if len(rows):
        band[rows.min():rows.max() + 1] = True
    # 雲那幾列裡的建築物等（不是天空、不是點點、不是雲），之後蓋在雲上面
    # 建築物：整張圖裡不是天空、點點、雲的東西，補滿內部（窗戶玻璃也算），再只留雲那幾列
    fg = ~sky & ~isdot & ~cloud & ~(cloudish & ~inbox & (g >= 236))
    fg = ndi.binary_opening(fg, k)                                 # 去掉 JPG 邊緣的零星像素
    fg = ndi.binary_fill_holes(fg) & band
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[cloud, :3] = a[cloud]
    rgba[cloud, 3] = 255
    return rgba, fg


# ---------- 共用 ----------
def remove_clouds(a, cloud_rgba, fg_mask, margin=2, period=PERIOD, sky_only=False):
    """把雲從 a 上拿掉（原地修改），回傳雲所在的列範圍 (y0, y1)、雲層、前景層（都裁成那幾列）"""
    cm = cloud_rgba[..., 3] > 0
    if not cm.any():
        return None
    # 雲邊緣多吃 margin px（JPG 的殘影）
    from scipy import ndimage as ndi
    grow = ndi.binary_dilation(cm, np.ones((3, 3), bool), iterations=margin)
    bad = grow | ndi.binary_dilation(fg_mask, np.ones((3, 3), bool), iterations=3)   # 建築邊緣的殘影也不能拿來補
    if sky_only:                                                       # 只拿天空色來補（不拿到窗戶玻璃）
        r_ = a[..., 0].astype(int)
        bad |= ~((a[..., 1] >= 215) & (a[..., 2] >= 245) & ((r_ >= 225) | (r_ <= 175)))   # 天空底色或點點，不含玻璃
    H, W = cm.shape
    for y in np.where(grow.any(axis=1))[0]:
        for x in np.where(grow[y] & ~fg_mask[y])[0]:
            for k in range(1, W // period + 1):
                for sx in (x - k * period, x + k * period):
                    if 0 <= sx < W and not bad[y, sx]:
                        a[y, x] = a[y, sx]
                        break
                else:
                    continue
                break
    rows = np.where(cm.any(axis=1))[0]
    y0, y1 = max(int(rows.min()) - 2, 0), min(int(rows.max()) + 3, H)
    fg = np.zeros((H, W, 4), np.uint8)
    fg[fg_mask, :3] = a[fg_mask]
    fg[fg_mask, 3] = 255
    fgb = fg[y0:y1]
    return (y0, y1), cloud_rgba[y0:y1], (fgb if fgb[..., 3].any() else None)
