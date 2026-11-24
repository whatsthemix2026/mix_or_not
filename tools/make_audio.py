"""把客戶給的音效（WAV）轉成網站用的 MP3，輸出到 assets/audio/。

用法（在 mix-quiz-site 資料夾，需要 ffmpeg）：python tools/make_audio.py
來源：客戶雲端「音效」資料夾下載到本機的 SRC（BGM/、音效/ 兩個子資料夾）。
背景音樂比音效大聲很多，轉檔時先降 5 dB（iPhone 不能用程式調音量，只能先做在檔案裡）。
"""
import os
import subprocess

SRC = r"D:\大專檔案-20261003T125815Z-1-001\大專檔案\音效下載"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio")
os.makedirs(OUT, exist_ok=True)

# (來源, 輸出檔名, 位元率, 音量調整 dB)
FILES = [
    (r"BGM\主畫面.wav", "bgm-title.mp3", "128k", -5),        # 封面
    (r"BGM\遊戲中.wav", "bgm-game.mp3", "128k", -5),         # 劇情、孵蛋、結果頁
    (r"音效\點擊.wav", "sfx-click.mp3", "96k", 0),           # 按任何按鈕
    (r"音效\滑鼠移動到按鍵的聲音+.wav", "sfx-hover.mp3", "96k", 0),  # 電腦上滑鼠移到按鈕
    (r"音效\對話出現+.wav", "sfx-line.mp3", "96k", 0),       # 每出現一句對話
    (r"音效\煎台.wav", "sfx-griddle.mp3", "96k", 0),         # 市集「滋——煎台的聲音」
    (r"音效\蛋在動2.wav", "sfx-wobble.mp3", "96k", 0),       # 孵蛋：蛋在動
    (r"音效\孵化完成.wav", "sfx-hatch.mp3", "96k", 0),       # 孵蛋：孵出來
]

for src, dst, br, gain in FILES:
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", os.path.join(SRC, src)]
    if gain:
        cmd += ["-af", f"volume={gain}dB"]
    cmd += ["-codec:a", "libmp3lame", "-b:a", br, os.path.join(OUT, dst)]
    subprocess.run(cmd, check=True)
    print(f"{dst:18s} {os.path.getsize(os.path.join(OUT, dst)) // 1024:5d} KB  ← {src}")
