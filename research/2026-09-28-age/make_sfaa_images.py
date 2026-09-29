"""社家署線上兒童發展檢核表的題目示意圖 → 站上用的 WebP 縮圖。

    python3 research/2026-09-28-age/make_sfaa_images.py   → public/age/sfaa/*.webp

站主 2026-09-29 回報社家署同意本站引用檢核表，圖因此跟題目一起放上 /age/。
來源：research/archive/tw8-2026-09-28/sfaa/images/*.png（臺灣主機 tw8 2026-09-29 代抓，
清單 list.txt，原站路徑 /cecm/assets/images/screenView/）。

原圖約 1068px 見方、透明底。站上顯示高 160px，輸出 2 倍：
尺寸照 sfaa.json 每題 imgs 記的寬高（extract_sfaa.py 算好），透明處墊白底（去掉 alpha 後檔案小一半以上），
WebP quality 70。只轉 sfaa.json 用到的圖，多的不放。已存在且尺寸相同的檔不重做。
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'archive', 'tw8-2026-09-28', 'sfaa', 'images')
DST = os.path.join(HERE, '..', '..', 'public', 'age', 'sfaa')

os.makedirs(DST, exist_ok=True)
want = {}
for b in json.load(open(os.path.join(HERE, 'sfaa.json'), encoding='utf-8')):
    for x in b['items']:
        for g in x['imgs']:
            want[g['file']] = (g['w'], g['h'])

made = total = 0
for name, size in sorted(want.items()):
    out = os.path.join(DST, name)
    if not (os.path.exists(out) and Image.open(out).size == size):
        im = Image.open(os.path.join(SRC, name[:-5] + '.png')).convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel('A'))
        bg.resize(size, Image.LANCZOS).save(out, 'WEBP', quality=70, method=6)
        made += 1
    total += os.path.getsize(out)

stale = sorted(set(os.listdir(DST)) - set(want))
for name in stale:
    os.remove(os.path.join(DST, name))
print('images', len(want), 'made', made, 'removed', len(stale), 'bytes', total, '→', DST)
