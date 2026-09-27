# vendor/seo-ops-jsonld

四站共用 JSON-LD 規則檔與驗證器的**原樣複本**。CI（GitHub Actions）拿不到本機 `/mnt/yao-care/seo-ops`，所以帶進 repo。

- 來源：`/mnt/yao-care/seo-ops/jsonld/`（seo-ops repo）
- 來源 commit：`057f8b2`（057f8b25ac40c26f0a76d31cffbded125a722d38）
- 複本：`validate.mjs`、`rules.json`、`validate.test.mjs`，內容與來源逐位元相同，**不要在這裡改**。
- 查證紀錄、問題代碼、每季重查步驟：看來源的 `README.md`。

## 同步

來源更新（每季重查或 Search Central 有結構化資料相關更新）之後：

```sh
SRC=/mnt/yao-care/seo-ops/jsonld
cp $SRC/validate.mjs $SRC/rules.json $SRC/validate.test.mjs vendor/seo-ops-jsonld/
git -C /mnt/yao-care/seo-ops log -1 --format=%h -- jsonld   # 把上面的「來源 commit」改成這個
pnpm test                                                   # 本站測試＋驗證器自己的測試
pnpm run build                                              # 建置時驗證（jsonld-check）要 0 錯誤
```

核對複本沒被改過：`diff -r -x README.md /mnt/yao-care/seo-ops/jsonld vendor/seo-ops-jsonld`（來源的 README.md 不複製）。
