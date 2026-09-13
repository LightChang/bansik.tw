"""偵測社福單位更名，補上「沒有穩定 ID」這個洞。

    python renames.py [build_dir] [snapshot]
    預設：build、../entity_prev.csv

為什麼需要這支：3,073 家機構裡只有 1,177 家有醫事機構代碼（健保署的 HOSP_ID），
其餘 1,896 家是社福單位，來源端（社家署資源查詢）**沒有給任何識別碼**——
每一筆就是一個 panel，沒有 detail 頁、沒有 id 參數，翻頁也沒有序號可用。
所以 entity_key 只能用「縣市＋正規化名稱」組出來。

這個 key 的弱點很具體：機構改名、承辦單位換人、加掛地區前綴，key 就變了，
下一次 build 會把它當成一家新機構，而舊的那筆就這樣消失——看起來像是「關掉了」。
名錄類來源的健康檢查規則是「消失即警示」，這種假消失會把警示灌爆。

補法不是去猜一個 ID，是**留住上一次的樣子再比對**：地址與電話比名稱穩定得多，
所以用 (縣市, 正規化地址, 電話) 當指紋，指紋一樣但 key 變了，就是更名的候選。
輸出只是候選，不自動合併——aliases.json 的規矩是「每筆都要寫證據，不要憑印象合併」，
自動合併會破壞那條規矩。

輸出 build/rename_candidates.csv，同時把這次的 entity 存成快照給下次比對。
快照要進版控：它就是「來源端不留歷史」的補救，弄丟了就得再等一次更名才能發現。
"""
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# build.py 在模組層就讀 sys.argv 決定 work/build 目錄，還會 makedirs。
# 直接 import 會讓它把這支腳本的參數當成目錄建出來（快照路徑被 mkdir 成資料夾）。
# 借用它的 norm/addr_core 之前先把 argv 藏起來。
_argv, sys.argv = sys.argv, [sys.argv[0]]
import build as B   # noqa: E402  比對規則必須跟 build 一致，所以共用同一份函式
sys.argv = _argv

BUILD = sys.argv[1] if len(sys.argv) > 1 else 'build'
SNAP = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'entity_prev.csv')

FIELDS = ['county', 'old_key', 'old_name', 'new_key', 'new_name',
          'evidence', 'address', 'tel', 'sources']


def tel_core(t):
    """只留數字，並去掉分機：各來源寫法有 04-22052121#12130、(04)2205-2121 轉 12130。"""
    t = (t or '').split('#')[0].split('轉')[0].split('分機')[0]
    return ''.join(c for c in t if c.isdigit())


def fingerprint(r):
    """地址與電話都要有才算數，只有其中一個太容易誤配（同一棟樓、總機共用）。"""
    a = B.addr_core(r.get('address') or '')
    t = tel_core(r.get('tel'))
    return (r.get('county') or '', a, t) if a and t else None


def rows(path):
    return list(csv.DictReader(open(path))) if os.path.exists(path) else []


def main():
    cur = rows(os.path.join(BUILD, 'entity.csv'))
    prev = rows(SNAP)
    out_path = os.path.join(BUILD, 'rename_candidates.csv')

    if not prev:
        # 第一次跑沒有比對基準，只建快照。這不是錯誤，但要講清楚，
        # 不然會以為「0 筆更名」是已經檢查過的結論。
        write(out_path, [])
        snapshot(cur)
        print(f'沒有上一版快照，這次只建立基準（{len(cur)} 家）。下次 build 才能比對更名。')
        return

    cur_keys = {r['entity_key'] for r in cur}
    prev_keys = {r['entity_key'] for r in prev}
    gone = [r for r in prev if r['entity_key'] not in cur_keys]
    fresh = [r for r in cur if r['entity_key'] not in prev_keys]

    by_fp = {}
    for r in fresh:
        fp = fingerprint(r)
        if fp:
            by_fp.setdefault(fp, []).append(r)

    cands = []
    for old in gone:
        fp = fingerprint(old)
        if not fp:
            continue
        hits = by_fp.get(fp, [])
        if len(hits) != 1:        # 同址同電話有兩家以上時不猜，留給人看
            continue
        new = hits[0]
        cands.append({
            'county': old.get('county', ''),
            'old_key': old['entity_key'], 'old_name': old['name'],
            'new_key': new['entity_key'], 'new_name': new['name'],
            'evidence': '地址與電話相同：' + fp[1] + ' / ' + fp[2],
            'address': new.get('address', ''), 'tel': new.get('tel', ''),
            'sources': new.get('sources', ''),
        })

    write(out_path, cands)
    snapshot(cur)
    print(f'上一版 {len(prev)} 家 → 這一版 {len(cur)} 家；'
          f'消失 {len(gone)}、新增 {len(fresh)}、更名候選 {len(cands)}')
    for c in cands[:10]:
        print(f"  {c['county']} {c['old_name']} → {c['new_name']}")
    if cands:
        print(f'  候選寫在 {out_path}，確認後再手動加進 scripts/aliases.json，不自動合併。')


def write(path, cands):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(cands)


def snapshot(cur):
    cols = ['entity_key', 'name', 'cat', 'county', 'district', 'address', 'tel', 'sources']
    with open(SNAP, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(cur)


if __name__ == '__main__':
    main()
