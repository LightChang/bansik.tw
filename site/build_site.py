"""產生 bansik.tw 的靜態站：22 個縣市頁 + 全國首頁。

    cd research && python ../site/build_site.py [build_dir] [dist_dir]
    預設：build ../site/dist

和 prototype/build_page.py 的差別：那支是產給 artifact 平台的單一頁面，
這支是產給 GitHub Pages 的完整靜態站，多做三件事——

1. **補 HTML 骨架**。artifact 平台會自動把內容包進 <!doctype html><head>…</head><body>，
   所以模板本身沒有這些標籤。直接放上 GitHub Pages 會是破的文件：沒有 charset
   中文可能亂碼，沒有 viewport 手機會用 980px 虛擬視窗渲染（先前所有 390px 的
   量測都會失效）。
2. **逐縣市產生**。模板已經參數化，縣市名一律取自 DATA.county，
   <title> 與 <h1> 由 __COUNTY__ 置換。
3. **產全國首頁**，把 22 個縣市的入口與資料的實際狀況列出來。
"""
import collections
import csv
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = sys.argv[1] if len(sys.argv) > 1 else 'build'
DIST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'dist')
TPL = os.path.join(HERE, '..', 'research', 'prototype', 'taichung.template.html')
MAKE = os.path.join(HERE, '..', 'research', 'scripts', 'make_prototype.py')
COUNTIES = json.load(open(os.path.join(HERE, 'counties.json')))['counties']
PY = sys.executable

SITE = 'https://bansik.tw'
GA = 'G-L05CG61N7H'


def skeleton(body, title, description, canonical):
    """補上 artifact 平台原本代勞的那一層。

    模板自己已經有 box-sizing、margin:0、html,body{height:100%} 與 color-scheme，
    這裡只補它沒有的：字元編碼、視窗寬度、搜尋結果用的描述，以及圖片不撐破版面。
    """
    return f"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:type" content="website">
<meta property="og:url" content="{canonical}">
<style>img{{max-width:100%}}</style>
<script async src="https://www.googletagmanager.com/gtag/js?id={GA}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){{dataLayer.push(arguments);}}
gtag('js', new Date());
gtag('config', '{GA}');
// 這是 hash 路由的單頁應用：GA4 的自動 page_view 只在載入時送一次，之後切到
// 篩檢／機構／補助／分布圖都不會再送。少了這一段，六個內頁裡有五個在報表上
// 完全看不到，只會看到一個首頁流量。
addEventListener('hashchange', function () {{
  gtag('event', 'page_view', {{page_location: location.href}});
}});
</script>
</head>
<body>
{body}
</body>
</html>
"""


def rows(name):
    path = os.path.join(BUILD, name)
    return list(csv.DictReader(open(path))) if os.path.exists(path) else []


def county_stats():
    """每個縣市的機構數、聯評中心數、動態筆數——全國首頁要用，也用來寫 description。"""
    ent = rows('entity.csv')
    obs = rows('observation.csv')
    county_of = {e['entity_key']: e['county'] for e in ent}
    n_obs = collections.Counter()
    for o in obs:
        c = county_of.get(o['entity_key'])
        if c:
            n_obs[c] += 1
    n_ent = collections.Counter(e['county'] for e in ent)
    n_ctr = collections.Counter(e['county'] for e in ent if e['cat'] == '聯合評估中心')
    return {c: {'entities': n_ent[c], 'centers': n_ctr[c], 'obs': n_obs[c]} for c in n_ent}


def build_county(c, stats, tpl):
    """切該縣市的資料、注入模板、包骨架，寫成 dist/<code>/index.html。"""
    code, name = c['code'], c['name']
    data_path = os.path.join(BUILD, f'site_{code}.json')
    subprocess.run([PY, MAKE, name, BUILD, data_path], check=True,
                   stdout=subprocess.DEVNULL)
    data = json.load(open(data_path, encoding='utf-8'))
    blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    body = tpl.replace('__COUNTY__', name).replace('__DATA__', blob)
    body = body.replace('__NAV__', nav_html(code))
    s = stats.get(name, {'entities': 0, 'centers': 0, 'obs': 0})
    desc = (f'{name}的兒童發展篩檢時程與早期療育資源：'
            f'{s["entities"]} 家機構、{s["centers"]} 家兒童發展聯合評估中心，'
            f'輸入孩子的月齡就知道現在該做哪一次篩檢、去哪裡評估、補助怎麼申請。')
    html = skeleton(body, f'{name}兒童發展地圖', desc, f'{SITE}/{code}/')

    out_dir = os.path.join(DIST, code)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'index.html')
    open(path, 'w', encoding='utf-8').write(html)
    os.remove(data_path)
    return path, len(data['entities']), os.path.getsize(path)


def nav_html(current):
    """跨縣市導覽。單頁應用也需要換縣市的入口，不然使用者只能改網址。"""
    links = ''.join(
        f'<option value="/{c["code"]}/"{" selected" if c["code"] == current else ""}>'
        f'{c["name"]}</option>' for c in COUNTIES)
    return (f'<label class="switch"><span>看其他縣市</span>'
            f'<select id="countySwitch">{links}</select></label>')


def build_home(stats):
    """全國首頁：22 個縣市的入口，加上資料的實際狀況。

    動態筆數一定要講清楚為什麼各縣市差這麼多——嘉義市有一百多筆、多數縣市只有
    一兩筆，那不是嘉義市資源多，是只有它的衛生局頁附了門診時間。不寫的話，
    首頁會變成一張誤導人的排行榜。
    """
    total_e = sum(v['entities'] for v in stats.values())
    total_o = sum(v['obs'] for v in stats.values())
    total_c = sum(v['centers'] for v in stats.values())
    cards = ''.join(f"""
      <a class="county" href="/{c['code']}/">
        <b>{c['name']}</b>
        <span>{stats.get(c['name'], {}).get('entities', 0)} 家機構</span>
        <span class="sub">聯合評估中心 {stats.get(c['name'], {}).get('centers', 0)} 家</span>
      </a>""" for c in COUNTIES)

    body = f"""<title>bansik.tw｜兒童發展篩檢與早期療育地圖</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@500;700&display=swap">
<style>
  :root {{
    --paper:#F7F8F4; --card:#FFF; --ink:#1C2B26; --ink-soft:#55655E;
    --seal:#2F6F5E; --seal-weak:#E3EDE7; --line:#D6DCD4;
    --serif:"Noto Serif TC","Songti TC",serif;
    --sans:"Noto Sans TC",-apple-system,"PingFang TC",sans-serif;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --paper:#141A18; --card:#1C2421; --ink:#E8EDE7; --ink-soft:#9AAAA2;
      --seal:#6FBFA3; --seal-weak:#1E3830; --line:#2E3A35;
    }}
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--paper); color:var(--ink);
    font-family:var(--sans); font-size:15px; line-height:1.65; }}
  .wrap {{ max-width:960px; margin:0 auto; padding:32px 20px 56px; }}
  h1 {{ font-family:var(--serif); font-size:26px; margin:0 0 6px; }}
  .lead {{ color:var(--ink-soft); margin:0 0 28px; }}
  h2 {{ font-family:var(--serif); font-size:17px; margin:32px 0 10px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }}
  .county {{ display:block; text-decoration:none; color:inherit; background:var(--card);
    border:1px solid var(--line); border-radius:5px; padding:10px 12px; }}
  .county:hover {{ border-color:var(--seal); }}
  .county b {{ display:block; font-size:15.5px; }}
  .county span {{ display:block; font-size:12.5px; color:var(--ink-soft); }}
  .county .sub {{ font-size:11.5px; }}
  .facts {{ display:flex; flex-wrap:wrap; gap:10px 26px; padding:14px 16px;
    background:var(--seal-weak); border-radius:5px; margin-bottom:8px; }}
  .facts div {{ font-size:13px; color:var(--ink-soft); }}
  .facts b {{ display:block; font-family:var(--serif); font-size:22px; color:var(--seal); }}
  .note {{ font-size:13px; color:var(--ink-soft); }}
  .note b {{ color:var(--ink); }}
  footer {{ margin-top:36px; border-top:1px solid var(--line); padding-top:12px;
    font-size:12px; color:var(--ink-soft); }}
  a {{ color:var(--seal); }}
</style>
<div class="wrap">
  <h1>孩子幾個月大，現在該做什麼</h1>
  <p class="lead">兒童發展篩檢的時程、做評估的地方、療育資源與補助規則。選一個縣市開始。</p>

  <div class="facts">
    <div><b>{total_e:,}</b>家機構</div>
    <div><b>{total_c}</b>家聯合評估中心</div>
    <div><b>22</b>個縣市的補助規則</div>
  </div>

  <h2>選縣市</h2>
  <div class="grid">{cards}
  </div>

  <h2>這些資料從哪裡來、哪裡還不夠</h2>
  <p class="note">機構名錄來自社家署的通報暨個管服務網、國健署的聯合評估中心名單與兒童醫療平台的就醫地圖；
    年齡時程來自兒童健康手冊與國健署的分齡篩檢量表；補助規則逐縣市讀官方公告。
    每一頁都標了資料產生的日期。</p>
  <p class="note"><b>等候多久，這裡沒有。</b>不是漏掉——各聯合評估中心不公布等候天數，
    連縣市衛生局的彙整頁也只有聯絡方式。這是這個題目最想解決、但資料端補不上的一塊。</p>
  <p class="note"><b>動態資訊各縣市差很多，那是來源的差別不是資源的差別。</b>
    全國共 {total_o} 筆門診時間、預約方式與電話分機，其中嘉義市就占了一百多筆——
    因為只有它的衛生局頁附了門診時間。不要拿這個數字比較縣市。</p>
  <p class="note">這裡是路標不是掛號窗口，不做機構的品質排名。每個縣市頁都會把
    通報轉介中心放在最前面，因為那才是單一窗口。</p>

  <footer>資料產生於 {datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d')}
    來源：衛福部社家署、國民健康署、兒童醫療健康資訊整合平台、教育部特殊教育通報統計</footer>
</div>
"""
    desc = (f'臺灣 22 縣市的兒童發展篩檢時程與早期療育資源：{total_e:,} 家機構、'
            f'{total_c} 家聯合評估中心。輸入孩子的月齡，就知道現在該做哪一次篩檢、'
            f'去哪裡評估、補助怎麼申請。')
    html = skeleton(body, 'bansik.tw｜兒童發展篩檢與早期療育地圖', desc, f'{SITE}/')
    os.makedirs(DIST, exist_ok=True)
    path = os.path.join(DIST, 'index.html')
    open(path, 'w', encoding='utf-8').write(html)
    return path, os.path.getsize(path)


def main():
    if not os.path.exists(os.path.join(BUILD, 'entity.csv')):
        sys.exit(f'找不到 {BUILD}/entity.csv——要先跑 scripts/build.py')
    tpl = open(TPL, encoding='utf-8').read()
    if '__DATA__' not in tpl or '__COUNTY__' not in tpl:
        sys.exit('模板缺少 __DATA__ 或 __COUNTY__ 佔位符')

    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    stats = county_stats()
    total = 0
    for c in COUNTIES:
        path, n, size = build_county(c, stats, tpl)
        total += size
        print(f'  {c["name"]:<5} /{c["code"]}/  {n:>4} 家  {size // 1024} KB')

    home, hsize = build_home(stats)
    print(f'  全國首頁 /  {hsize // 1024} KB')

    for f in ('CNAME',):
        shutil.copy(os.path.join(HERE, f), os.path.join(DIST, f))
    open(os.path.join(DIST, '.nojekyll'), 'w').close()

    print(f'\n共 {len(COUNTIES)} 個縣市頁 + 首頁，{(total + hsize) // 1024 // 1024} MB，輸出在 {DIST}')


if __name__ == '__main__':
    main()
