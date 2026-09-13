import re,html,json,glob,collections
NAMES={'1_qtype2_1':'評估醫院','1_qtype2_2':'聯合評估中心','1_qtype2_3':'其他經許可辦理評估之醫院','1_qtype2_4':'新生兒聽力確診醫院','1_qtype2_5':'新生兒聽力篩檢院所','1_qtype2_6':'通報轉介中心','1_qtype2_7':'個案管理中心','1_qtype2_8':'服務-教育單位','2_qtype2_4':'療育-醫療單位','2_qtype2_5':'療育-教育單位','2_qtype2_7_qtype3_1':'早療機構','2_qtype2_7_qtype3_3':'社區療育據點','2_qtype2_7_qtype3_9':'其他社福單位'}
def clean(x): return html.unescape(re.sub(r'<[^>]+>','',x)).strip()
out=[]
for f in sorted(glob.glob('sfaa/*.html')):
    key=f.split('/')[1][:-5]; s=open(f,encoding='utf-8').read()
    s=s[s.find('insidePage'):s.find('隱私權保護政策')]
    toks=re.split(r'(<h3>[^<]*</h3>|<div class="panel panel-default">)',s)
    county=None
    for i,t in enumerate(toks):
        if t.startswith('<h3>'): county=clean(t)
        elif t.startswith('<div class="panel panel-default">'):
            body=toks[i+1]
            name=clean(re.search(r'<h4 class="panel-title">(.*?)</h4>',body,re.S).group(1))
            rec={'cat':NAMES[key],'county':county,'name':name}
            pb=body[body.find('panel-body'):]
            rec['links']=sorted({html.unescape(l) for l in re.findall(r'href="(http[^"]+)"',pb) if 'google.com/maps' not in l})
            for p in re.findall(r'<p>(.*?)</p>',pb,re.S):
                t2=clean(p)
                mm=re.match(r'(郵遞區號|地址|電話|服務內容|服務區域|服務方式|更新日期|辦理單位|傳真|網址|服務對象|服務時間|Email|E-mail|署本部)[：:](.*)',t2,re.S)
                if mm: rec[mm.group(1)]=mm.group(2).strip()
                elif t2: rec.setdefault('_other',[]).append(t2)
            out.append(rec)
json.dump(out,open('sfaa_all.json','w'),ensure_ascii=False,indent=1)
c=collections.Counter(r['cat'] for r in out)
for k in NAMES.values(): print(c[k],k)
print('total',len(out))
print(collections.Counter(k for r in out for k in r).most_common())
print(collections.Counter(r['county'] for r in out).most_common())
