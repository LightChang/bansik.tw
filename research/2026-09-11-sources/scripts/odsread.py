import zipfile,re,html,sys,json
def rows(path):
    x=zipfile.ZipFile(path).read('content.xml').decode('utf-8')
    out=[]
    for r in re.findall(r'<table:table-row[^>]*>(.*?)</table:table-row>',x,re.S):
        cells=[]
        for m in re.finditer(r'<table:table-cell([^>]*?)(?:/>|>(.*?)</table:table-cell>)',r,re.S):
            rep=re.search(r'number-columns-repeated="(\d+)"',m.group(1)); n=min(int(rep.group(1)),50) if rep else 1
            v=html.unescape(re.sub(r'<[^>]+>','',re.sub(r'</text:p>\s*<text:p[^>]*>','\n',m.group(2) or ''))).strip()
            cells+= [v]*n
        while cells and not cells[-1]: cells.pop()
        if cells: out.append(cells)
    return out
if __name__=='__main__':
    R=rows(sys.argv[1]); print(len(R))
    for r in R[:5]: print(r)
    json.dump(R,open(sys.argv[1]+'.json','w'),ensure_ascii=False)
