# burp-error-checker

Burp Suite'te **yüklenmeyen extension'lar** için kök neden teşhis aracı.

Ne yapar:

- Burp'un `user_options` / `UserConfig.json` içinden yüklenmemiş extension listesini okur
- Her biri için sırayla test eder:
  - **Dosya varlığı** (config'de gösterilen yol gerçekten var mı)
  - **Jython syntax-only derleme** (python extension'lar — kod ÇALIŞTIRMAZ, sadece `compile()` çağrısı yapar)
  - **JAR geçerliliği** (`jar tf` / `tar -tf`)
- Sonucu Markdown rapor olarak yazar

Kullanım:

```bash
node ext-error-diagnose.js
```

Opsiyonel ortam değişkenleri:

| Değişken | Anlamı |
|---|---|
| `BURP_JYTHON` | jython-standalone jar yolu (varsayılan: çalışma dizininde `jython-standalone-2.7.4.jar`) |
| `DIAGNOSE_OUT` | rapor çıktı dosyası (varsayılan: `ext-error-report.md`) |

MCP kanalı (çalışan Burp + MCP Server extension) varsa canlı config okur; yoksa `%APPDATA%\BurpSuite\UserConfig.json`'a düşer — yani Burp kapalıyken de çalışır.

Gereksinimler: Node.js, Java (Jython için), Burp Suite (test edilecek extension'lar kurulu).

Lisans: MIT.
