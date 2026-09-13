"""依各來源的更新頻率排程抓取：只抓「已到期」的來源，抓完算出下次到期時間。

    python sync.py --list            # 看每個來源的頻率、上次抓取、下次到期
    python sync.py --due             # 只抓已到期的（給 cron 用）
    python sync.py --due --dry-run   # 只列出這次會抓什麼，不動手
    python sync.py --all             # 不管到期與否全部抓
    python sync.py --only nhi_roster,csh_quota
    python sync.py --due --with-big  # 連標記 big 的大檔一起抓

狀態記在 state.json：每個來源的 last_fetched / next_due / 每個檔案的 sha256。
內容真的變了（sha256 不同）而且該來源標了 archive，就把新版另存到
archive/<source_id>/<YYYY-MM-DD>/ ——那些來源不留歷史，只能自己存。
"""
import argparse
import hashlib
import json
import os
import shutil
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128 Safari/537.36')
# healthforkids 的憑證 2026-09-10 過期；這裡抓的都是公開資料，不送任何憑證或個資
NOVERIFY = ssl.create_default_context()
NOVERIFY.check_hostname = False
NOVERIFY.verify_mode = ssl.CERT_NONE


def now():
    return datetime.now(timezone.utc)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(url, dest, data=None, timeout=120, retries=2):
    req = urllib.request.Request(url, headers={'User-Agent': UA}, method='POST' if data else 'GET')
    body = urllib.parse.urlencode(data).encode() if data else None
    last = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, data=body, timeout=timeout, context=NOVERIFY) as r:
                payload = r.read()
            os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
            with open(dest, 'wb') as f:
                f.write(payload)
            return len(payload)
        except Exception as e:  # 逾時或改版都不該中斷整輪，記下來繼續下一個
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def fetch_api_paged(api, dest, timeout=120):
    rows, off = [], 0
    while True:
        url = f'{api}?limit=1000&offset={off}'
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout, context=NOVERIFY) as r:
            batch = json.load(r)['result']['records']
        rows += batch
        off += 1000
        if len(batch) < 1000:
            break
        time.sleep(0.3)
    os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
    with open(dest, 'w') as f:
        json.dump(rows, f, ensure_ascii=False)
    return os.path.getsize(dest)


def targets(src, with_big):
    """回傳 (要抓的 job 清單, 是否有大檔被跳過)。

    job 是 (kind, url_or_api, data, out)。標了 big 的檔案預設不抓，
    但要回報「跳過了」，否則會被當成已完成而推進到期日，大檔就再也不會補抓。
    """
    out, skipped_big = [], False
    for f in src.get('files', []):
        if f.get('big') and not with_big:
            skipped_big = True
            continue
        out.append(('get', f['url'], None, f['out'], bool(f.get('big'))))
    for p in src.get('posts', []):
        out.append(('post', src['url'], p['data'], p['out'], False))
    if src['method'] == 'api_paged':
        out.append(('api', src['api'], None, src['out'], False))
    return out, skipped_big


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--due', action='store_true')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--with-big', action='store_true')
    ap.add_argument('--work', default=os.path.join(ROOT, 'work'))
    ap.add_argument('--archive', default=os.path.join(ROOT, 'archive'))
    # state 放在 work/ 之外：work/ 是可重建的暫存並且不進版控，
    # 但排程狀態一旦遺失，所有來源都會被判定為到期而全部重抓。
    ap.add_argument('--state', default=os.path.join(ROOT, 'state.json'))
    args = ap.parse_args()

    cfg = json.load(open(os.path.join(HERE, 'sources.json')))
    days = cfg['cadence_days']
    state = json.load(open(args.state)) if os.path.exists(args.state) else {'sources': {}}
    only = {s for s in args.only.split(',') if s}

    if args.list:
        print(f"{'來源':28} {'頻率':11} {'上次抓取':12} {'下次到期':12} 狀態")
        for src in cfg['sources']:
            st = state['sources'].get(src['id'], {})
            last = (st.get('last_fetched') or '')[:10] or '—'
            due = (st.get('next_due') or '')[:10] or '未抓過'
            overdue = (not st.get('next_due')) or st['next_due'] <= now().isoformat()
            print(f"{src['id']:28} {src['cadence']:11} {last:12} {due:12} {'到期' if overdue else '-'}")
        return

    picked = []
    for src in cfg['sources']:
        if only and src['id'] not in only:
            continue
        st = state['sources'].get(src['id'], {})
        # 還有大檔沒補抓的來源，只要這次帶了 --with-big 就視為到期
        due = ((not st.get('next_due')) or st['next_due'] <= now().isoformat()
               or (args.with_big and st.get('pending_big')))
        if args.all or only or (args.due and due):
            picked.append(src)
        elif args.due:
            print(f"跳過 {src['id']}（下次到期 {(st.get('next_due') or '')[:10]}）")

    if not picked:
        print('沒有到期的來源。')
        return

    for src in picked:
        jobs, skipped_big = targets(src, args.with_big)
        if args.dry_run:
            note = '（另有大檔待補，需 --with-big）' if skipped_big else ''
            print(f"[dry-run] {src['id']}（{src['cadence']}）→ {len(jobs)} 個檔案{note}")
            continue
        if not jobs:
            # 整個來源只有大檔，這輪什麼都沒抓，不能推進到期日
            state['sources'].setdefault(src['id'], {})['pending_big'] = True
            print(f"{src['id']}: 只有大檔，已跳過（下次帶 --with-big 才會抓）")
            continue
        st = state['sources'].setdefault(src['id'], {})
        files = st.setdefault('files', {})
        changed, failed = [], []
        for kind, url, data, out, is_big in jobs:
            dest = os.path.join(args.work, out)
            try:
                if kind == 'api':
                    fetch_api_paged(url, dest)
                else:
                    fetch(url, dest, data=data)
            except Exception as e:
                failed.append(f'{out}: {type(e).__name__}')
                continue
            h = sha256(dest)
            if files.get(out, {}).get('sha256') != h:
                changed.append(out)
                # 大檔不留快照：一份 102MB 的教材每改版存一次會把 archive 撐爆，
                # 版本資訊在 state.json 的 sha256 已經夠用，真要留舊版再人工決定
                if src.get('archive') and not is_big:
                    snap = os.path.join(args.archive, src['id'], now().strftime('%Y-%m-%d'), out)
                    os.makedirs(os.path.dirname(snap), exist_ok=True)
                    shutil.copy2(dest, snap)
            files[out] = {'sha256': h, 'bytes': os.path.getsize(dest),
                          'fetched_at': now().isoformat()}
        st['last_fetched'] = now().isoformat()
        st['next_due'] = (now() + timedelta(days=days[src['cadence']])).isoformat()
        st['pending_big'] = skipped_big
        if changed:
            st['last_changed'] = now().isoformat()
        print(f"{src['id']}: 抓 {len(jobs)} 檔，變動 {len(changed)}，失敗 {len(failed)}"
              f"{'，大檔待補' if skipped_big else ''}"
              f"{'，下次 ' + st['next_due'][:10]}")
        for c in changed:
            print(f"   變動 {c}" + ('（已存檔）' if src.get('archive') else ''))
        for f in failed:
            print(f"   失敗 {f}")

    if not args.dry_run:
        os.makedirs(os.path.dirname(args.state), exist_ok=True)
        json.dump(state, open(args.state, 'w'), ensure_ascii=False, indent=1)
        print(f'狀態已更新：{args.state}')


if __name__ == '__main__':
    sys.exit(main())
