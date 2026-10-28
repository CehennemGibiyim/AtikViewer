# Yerel LLM (Ollama) — Taslak İzlenim İçin Ücretsiz Yol

ATIKVIEWER'ın "Sonuç/İzlenim" taslağı üretirken kullandığı LLM, `LLM_API_URL`
tanımlıysa OpenAI uyumlu uç noktaya; tanımlı değilse kural tabanlı yedeğe
düşer. **Hiçbir ücret ödemeden, tek bir bayt veriyi dışarı göndermeden** LLM
kullanmak için yerel Ollama kurmanız yeterlidir. Hasta verisi bu uç noktaya
ASLA gönderilmez (yalnızca hekimce doğrulanmış bulgu etiketleri ve kesit
numaraları gider — bkz. `src/app/api/reports/draft-impression/route.ts`).

## 1. Ollama kurulumu

| Sistem | Komut |
|---|---|
| Windows / macOS | <https://ollama.com/download> → yükleyiciyi çalıştırın |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` |

## 2. Bir model indirin (ücretsiz, açık ağırlıklar)

```bash
ollama pull llama3.1:8b     # genel amaçlı, 8B — 4.7 GB
# veya daha hafif:
ollama pull qwen2.5:7b      # ~4.7 GB, Türkçe başarımı iyi
# düşük bellekli makine için:
ollama pull llama3.2:3b     # ~2.0 GB
```

## 3. Servisin çalıştığını doğrulayın

```bash
ollama serve                 # çoğu kurulumda arka planda zaten çalışır
curl http://127.0.0.1:11434/v1/models
```

`{"object":"list",...}` yanıtı gelirse OpenAI uyumlu uç nokta hazırdır.

## 4. ATIKVIEWER `.env` dosyasını düzenleyin

```dotenv
LLM_API_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama           # Ollama kimlik doğrulama istemez; boş olmamalı
LLM_MODEL=llama3.1:8b        # `ollama list` çıktısındaki model adı
```

Sunucuyu yeniden başlatın. Yönetim → AI performans/ayarlar ekranından ya da
`/api/health` üzerinden yapılandırmayı kontrol edebilirsiniz.

## 5. Davranış notları

- **Uç nokta yanıt vermezse** sunucu sessizce kural tabanlı yedeğe düşer;
  rapor akışı durmaz, yalnızca `source: "kural"` işaretlenir.
- **İstek gövdesi:** yalnızca modalite, vücut bölgesi ve hekimin
  "Onayla/Düzenlendi" olarak işaretlediği bulgular. Ad/hasta kimliği gönderilmez.
- **Sıcaklık:** 0.2 sabittir; üretim çıktısı deterministik değildir, hekim
  onayı zorunludur.
- Sunucu ile Ollama aynı makinede olduğundan trafik dışarı çıkmaz; Ollama'nın
  varsayılan localhost CORS/Origin kuralı sunucu tarafı isteklerde sorun çıkarmaz.

## Alternatif: ücretli OpenAI uyumlu servisler

Aynı `.env` alanları herhangi bir OpenAI uyumlu servisle çalışır
(`LLM_API_URL=https://api.openai.com/v1` vb.). Kurumsal ortamda dış servis
kullanacaksanız veri aktarım politikanızı ve KVKK aydınlatmasını güncelleyin.

İlgili kod: `src/app/api/reports/draft-impression/route.ts`
