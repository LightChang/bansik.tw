import json,re,unicodedata,collections,csv
def norm(s):
    s=unicodedata.normalize('NFKC',s or '').replace('㇐','一').replace('台','臺')
    s=re.sub(r'[\s　()（）\-－、,，]','',s)
    return s
STRIP=['醫療財團法人','醫療社團法人','財團法人','社團法人','學校財團法人','天主教','佛教','基督教','台灣基督長老教會','臺灣基督長老教會','馬偕醫療','附設民眾診療服務處']
def core(s):
    s=norm(s); s=re.sub(r'(委託|醫療合作).*$','',s)
    for w in STRIP: s=s.replace(norm(w),'')
    return s
def addr_core(a):
    a=norm(a); a=re.sub(r'^\d{3,6}','',a)
    a=a.replace('縣政二路','縣政二路')
    m=re.search(r'(.+?[路街道])(.*?段)?(\d+巷)?(\d+弄)?(\d+)號',a)
    if not m: return a[:12]
    road=re.sub(r'^.*?[市縣](.*?[區鄉鎮市])?','',m.group(1))
    return road+(m.group(2) or '').replace('一段','1段').replace('二段','2段').replace('三段','3段').replace('四段','4段')+m.group(5)
nhi=[r for r in json.load(open('nhi_roster.json')) if not r['CONT_E_DATE'] and r['HOSP_TYPE'] in ('01','02','03','04','06','08','10')]
nhi_by_core=collections.defaultdict(list)
for r in nhi: nhi_by_core[core(r['HOSP_NAME'])].append(r)
def match(name,addr):
    c=core(name)
    if c in nhi_by_core and len(nhi_by_core[c])==1: return nhi_by_core[c][0],'name'
    ac=addr_core(addr)
    cand=[r for r in nhi if ac and ac==addr_core(r['HOSP_ADDR']) and '居家' not in r['HOSP_NAME'] and '護理' not in r['HOSP_NAME']]
    if len(cand)==1: return cand[0],'addr'
    if cand:
        best=[r for r in cand if r['HOSP_CNT_TYPE'] in '123']
        if len(best)==1: return best[0],'addr+hosp'
    # substring
    cty=norm(addr)[:3]
    sub=[r for r in nhi if r['HOSP_CNT_TYPE'] in '123' and norm(r['HOSP_ADDR'])[:3]==cty and (c in core(r['HOSP_NAME']) or core(r['HOSP_NAME']) in c) and len(core(r['HOSP_NAME']))>=4]
    if len(sub)==1: return sub[0],'substr'
    return None,'none'
hpa=json.load(open('hpa115.json'))
res=[]
for h in hpa:
    m,how=match(h['name'],h['address'])
    h['hosp_id']=m['HOSP_ID'] if m else None; h['nhi_name']=m['HOSP_NAME'] if m else None; h['how']=how
    res.append(h)
print('HPA matched',collections.Counter(h['how'] for h in res))
for h in res:
    if h['how']!='name': print(h['seq'],h['how'],h['name'],'=>',h['nhi_name'],h['hosp_id'])
json.dump(res,open('hpa115_matched.json','w'),ensure_ascii=False,indent=1)
sf=json.load(open('sfaa_all.json'))
MED={'評估醫院','聯合評估中心','其他經許可辦理評估之醫院','新生兒聽力確診醫院','新生兒聽力篩檢院所','療育-醫療單位'}
for r in sf:
    m,how=match(r['name'],r['地址']) if r['cat'] in MED else (None,'skip')
    r['hosp_id']=m['HOSP_ID'] if m else None; r['how']=how
json.dump(sf,open('sfaa_matched.json','w'),ensure_ascii=False,indent=1)
print('SFAA matched by cat')
for cat in dict.fromkeys(r['cat'] for r in sf):
    l=[r for r in sf if r['cat']==cat]; print(cat,len(l),sum(1 for r in l if r['hosp_id']))
