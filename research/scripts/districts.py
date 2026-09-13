"""行政區中心點：給機構清單做區級定位，也給行政區頁當座標。

    python districts.py [work_dir] [build_dir]
    輸出 build/district.csv：county, district, lat, lng, source

為什麼是區級而不是逐筆門牌：3,073 家機構只有 1,378 家有座標（全部來自就醫地圖），
其餘 1,695 家沒有。實測 Nominatim 對臺灣的完整地址與街道查詢一律回空陣列，
只有行政區層級查得到，所以逐筆地理編碼這條路走不通。改用區中心點，
在頁面上誠實標成「區級定位」，不假裝是門牌精度。

圖資用 g0v/twgeojson 的鄉鎮界（377 個面）。它是縣市改制前的版本，所以：
  - 縣市名要換（桃園縣→桃園市、台中市→臺中市…）
  - 比對要同時試原名與去掉「區鄉鎮市」尾字的寫法，因為來源端寫法不一
    （平鎮市／平鎮區／平鎮 都有），只去尾字會把「平鎮」削成「平」而對不到
  - 升格改名的（員林鎮→員林市、頭份鎮→頭份市）靠去尾字就能對上
  - 那瑪夏區在這份圖資裡沒有對應的面（改制前是高雄縣三民鄉，與舊高雄市三民區同名，
    不能猜哪一個），單獨補一筆 Nominatim 查到的座標
"""
import csv
import json
import os
import re
import sys
import unicodedata

WORK = sys.argv[1] if len(sys.argv) > 1 else 'work'
BUILD = sys.argv[2] if len(sys.argv) > 2 else 'build'
GEO = os.path.join(WORK, 'geo', 'twTown.geo.json')

COUNTY_FIX = {'台中市': '臺中市', '台北市': '臺北市', '台南市': '臺南市',
              '台東縣': '臺東縣', '桃園縣': '桃園市'}

# 圖資裡沒有的面，單獨補。來源要寫清楚，不要混進圖資算出來的那一批。
EXTRA = [
    {'county': '高雄市', 'district': '那瑪夏區', 'lat': 23.217463, 'lng': 120.693163,
     'source': 'nominatim'},
]


def nz(s):
    """比對用的寫法：全形轉半形、台→臺，並去掉結尾的區鄉鎮市。"""
    s = unicodedata.normalize('NFKC', s or '').replace('台', '臺')
    return re.sub(r'[區鄉鎮市]$', '', s)


def centroid(geom):
    """面積加權中心。MultiPolygon 取面積最大的那一塊，不要把離島平均進來。"""
    def ring_stats(ring):
        a = cx = cy = 0.0
        for i in range(len(ring) - 1):
            x0, y0 = ring[i][:2]
            x1, y1 = ring[i + 1][:2]
            f = x0 * y1 - x1 * y0
            a += f
            cx += (x0 + x1) * f
            cy += (y0 + y1) * f
        if a == 0:
            return 0, ring[0][0], ring[0][1]
        a *= 0.5
        return abs(a), cx / (6 * a), cy / (6 * a)

    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    best = (0, 0, 0)
    for p in polys:
        s = ring_stats(p[0])
        if s[0] > best[0]:
            best = s
    return best[2], best[1]   # lat, lng


def load(build=None):
    """回傳查詢用的索引，給 build.py 用。

    同一個地方在各來源有三種寫法（平鎮市／平鎮區／平鎮），所以原名與去尾字兩種鍵都放，
    查詢時先試原名。只放去尾字的版本會出事：來源端寫「平鎮」時再去一次尾字就變成「平」。
    """
    path = os.path.join(build or BUILD, 'district.csv')
    if not os.path.exists(path):
        return {}
    out = {}
    for r in csv.DictReader(open(path)):
        val = (r['lat'], r['lng'])
        out.setdefault((r['county'], r['district']), val)
        out.setdefault((r['county'], nz(r['district'])), val)
    return out


def find(idx, county, district):
    """先用原名查，查不到才用去尾字的寫法。"""
    if not district:
        return None
    return idx.get((county, district)) or idx.get((county, nz(district)))


def main():
    feats = json.load(open(GEO))['features']
    rows = []
    seen = set()
    for f in feats:
        p = f['properties']
        name = p['TOWNNAME']
        if name.endswith('(海)'):        # 海域面，中心點落在海上
            continue
        county = COUNTY_FIX.get(p['COUNTYNAME'], p['COUNTYNAME'])
        key = (county, nz(name))
        if key in seen:
            continue
        seen.add(key)
        lat, lng = centroid(f['geometry'])
        rows.append({'county': county, 'district': name,
                     'lat': round(lat, 6), 'lng': round(lng, 6), 'source': 'twgeojson'})
    for e in EXTRA:
        if (e['county'], nz(e['district'])) not in seen:
            rows.append(e)
    rows.sort(key=lambda r: (r['county'], r['district']))

    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, 'district.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['county', 'district', 'lat', 'lng', 'source'])
        w.writeheader()
        w.writerows(rows)
    print(f'district.csv {len(rows)} 列')

    # 對得到機構表才有意義，順便報覆蓋率
    ent = os.path.join(BUILD, 'entity.csv')
    if os.path.exists(ent):
        idx = load()
        need = set()
        for e in csv.DictReader(open(ent)):
            m = re.match(r'^(?:臺|台|新)?[^\s]{1,3}?[縣市](.{1,4}?[區鄉鎮市])', e['address'])
            d = e['district'] or (m.group(1) if m else '')
            if d:
                need.add((e['county'], d))
        miss = sorted(k for k in need if not find(idx, *k))
        print(f'  機構用到 {len(need)} 個行政區，對不到 {len(miss)}')
        for m in miss:
            print('   ', m)


if __name__ == '__main__':
    main()
