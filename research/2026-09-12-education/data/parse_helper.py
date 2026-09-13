import re,html,sys
def text(p,enc=None):
    b=open(p,'rb').read()
    e=enc or (re.search(rb'charset=["\']?([\w-]+)',b).group(1).decode() if re.search(rb'charset=["\']?([\w-]+)',b) else 'utf-8')
    s=b.decode('big5hkscs' if 'big5' in e.lower() else e,errors='ignore')
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S)
    return s,[l.strip() for l in html.unescape(re.sub(r'<[^>]+>','\n',t)).split('\n') if l.strip()]
if __name__=='__main__':
    s,L=text(sys.argv[1])
    pat=sys.argv[2] if len(sys.argv)>2 else None
    print(len(L))
    for l in (L if not pat else [x for x in L if re.search(pat,x)])[:60]: print('  ',l[:160])
