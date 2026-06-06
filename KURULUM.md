# 💈 Berber Randevu Botu — Kurulum Rehberi

Gerçek **WhatsApp Business API (Meta resmi API)** ile çalışan berber randevu sistemi.
Bu rehber sıfırdan, hosting bilgisi olmadan kurulumu adım adım anlatır.

---

## 📋 Genel Bakış

- **Müşteri**: WhatsApp'tan mesaj atarak randevu alır (berber → hizmet → tarih → saat → onay).
- **Berber**: Web tabanlı bir panelden randevuları görür, onaylar veya iptal eder.
- Onay/iptal anında müşteriye otomatik WhatsApp mesajı gider.

---

## 1) Node.js Kurulumu

1. https://nodejs.org adresine gidin.
2. **LTS** sürümünü indirin (18 veya üzeri).
3. Kurulumu tamamlayın ve doğrulayın:

```bash
node -v   # v18.x veya üzeri görmelisiniz
npm -v
```

---

## 2) Projeyi Hazırlama

Proje klasöründe terminal açıp:

```bash
npm install
```

Ardından `.env.example` dosyasını kopyalayıp `.env` yapın:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

`.env` içindeki değerleri ilerideki adımlarda Meta panelinden alacağınız bilgilerle dolduracaksınız:

```env
WHATSAPP_TOKEN=        # Adım 7 / 10'da alınır
PHONE_NUMBER_ID=       # Adım 7'de alınır
VERIFY_TOKEN=berber_token_123   # kendiniz belirlersiniz (Meta'da aynısını gireceksiniz)
PORT=3000
```

Yerelde test için:

```bash
npm start
```

`http://localhost:3000/dashboard` adresinde paneli görmelisiniz.

> ℹ️ Yerel makinede WhatsApp mesajı **alabilmek** için internete açık bir adres gerekir.
> En kolay yol Railway'e deploy etmektir (aşağıda). Geçici test için `ngrok` da kullanılabilir.

---

## 3) Railway'e Ücretsiz Deploy

1. https://railway.app adresine gidin, **GitHub ile** giriş yapın.
2. Projeyi bir GitHub deposuna yükleyin (`git init`, `git add .`, `git commit`, `git push`).
3. Railway'de **New Project → Deploy from GitHub repo** seçin.
4. Deponuzu seçin. Railway otomatik olarak `npm install` çalıştırır ve `npm start` ile başlatır.
   - Procfile **gerekmez**; `package.json` içindeki `start` script'i yeterlidir.
5. Deploy bitince Railway size bir URL verir, örn:
   `https://berber-bot-production.up.railway.app`

---

## 4) Railway Variables (Ortam Değişkenleri) Ekleme

Railway projesinde **Variables** sekmesine geçin ve şunları ekleyin:

| Anahtar           | Değer                                      |
|-------------------|--------------------------------------------|
| `WHATSAPP_TOKEN`  | Meta'dan alınan access token                |
| `PHONE_NUMBER_ID` | Meta'dan alınan Phone Number ID             |
| `VERIFY_TOKEN`    | `berber_token_123` (kendi belirlediğiniz)   |
| `PORT`            | `3000`                                      |

Kaydedince Railway otomatik yeniden deploy eder.

---

## 5) Meta Developer Hesabı Açma

1. https://developers.facebook.com adresine gidin.
2. Facebook hesabınızla giriş yapın.
3. Sağ üstten **My Apps → Create App**.

---

## 6) WhatsApp Uygulaması Oluşturma

1. App türü olarak **Business** seçin.
2. Uygulamaya bir isim verin (örn. `Berber Randevu`).
3. Oluşturduktan sonra ürünler listesinden **WhatsApp → Set up** deyin.
4. Bir **Meta Business Account** seçin veya yeni oluşturun.

---

## 7) Phone Number ID ve Geçici Access Token Alma

WhatsApp → **API Setup** sayfasında:

- **Temporary access token** → bu değeri `WHATSAPP_TOKEN` olarak kullanın (24 saat geçerli).
- **Phone number ID** → bu değeri `PHONE_NUMBER_ID` olarak kullanın.
- Sayfada hazır gelen **test numarası** ile hemen test edebilirsiniz.

> ⚠️ Geçici token 24 saatte dolar. Kalıcı çözüm için Adım 10'a bakın.

Bu değerleri Railway **Variables**'a (ve isterseniz yerel `.env` dosyasına) girin.

---

## 8) Webhook Kurma

WhatsApp → **Configuration → Webhook** bölümünde:

- **Callback URL**: `https://SIZIN-RAILWAY-URLNIZ/webhook`
  (örn. `https://berber-bot-production.up.railway.app/webhook`)
- **Verify Token**: `.env` / Variables'taki `VERIFY_TOKEN` ile **birebir aynı** olmalı
  (örn. `berber_token_123`)
- **Verify and Save** deyin.

Doğrulama başarılıysa Meta yeşil onay verir. (Railway loglarında `✅ Webhook doğrulandı.` görürsünüz.)

---

## 9) Webhook Event'lerini Subscribe Etme

Aynı Webhook bölümünde **Manage / Webhook fields** kısmından:

- **`messages`** alanını **Subscribe** edin.

Bu olmadan bot gelen mesajları alamaz.

---

## 10) Gerçek Numara ve Kalıcı System User Token

Geçici token'ın süresi dolmasın diye kalıcı token oluşturun:

1. https://business.facebook.com → **Business Settings**.
2. **Users → System Users → Add** ile bir System User oluşturun (rol: Admin).
3. **Add Assets** ile WhatsApp uygulamanızı bu kullanıcıya atayın (Full control).
4. **Generate New Token** → uygulamanızı seçin → izinler:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Üretilen token'ı `WHATSAPP_TOKEN` olarak Railway Variables'a girin (süresiz).

Gerçek bir numara eklemek için: WhatsApp → **API Setup → Add phone number** (numara doğrulaması yapılır).

---

## 11) Test Etme

1. WhatsApp'tan bot numarasına **merhaba** yazın.
2. Karşılama mesajı + **📅 Randevu Al / 🔍 Randevum** butonları gelmeli.
3. Akışı tamamlayın: ad → berber → hizmet → tarih → saat → onay.
4. Panelde (`/dashboard`) randevu **Bekliyor** olarak görünmeli.
5. Panelden ✅ **Onayla** deyin → müşteriye onay mesajı gitmeli.
6. ❌ **İptal** deyin → müşteriye iptal mesajı gitmeli.

---

## 🛠️ Sık Karşılaşılan Sorunlar

| Sorun | Olası Neden | Çözüm |
|-------|-------------|-------|
| **Webhook doğrulanmıyor** | Verify Token uyuşmuyor | Meta'daki token ile `VERIFY_TOKEN` birebir aynı olsun. URL'nin sonunda `/webhook` olduğundan emin olun. |
| **Bot cevap vermiyor** | `messages` alanı subscribe edilmemiş | Adım 9'u tekrar yapın. Railway loglarına bakın. |
| **Bot cevap vermiyor (2)** | Yanlış token / Phone Number ID | Variables değerlerini kontrol edin, deploy'u yenileyin. |
| **"Token expired" hatası** | Geçici token doldu (24 saat) | Adım 10'daki kalıcı System User token'ı oluşturun. |
| **Mesaj gitmiyor** | Numara formatı yanlış | Numara `+90` ile uluslararası formatta olmalı (örn. `905xxxxxxxxx`). |
| **Sadece kayıtlı numaralara gidiyor** | Test modundasınız | Test numaralarını Meta panelinden ekleyin veya uygulamayı yayına alın. |
| **Panel boş** | Henüz randevu yok / API hatası | WhatsApp'tan bir randevu oluşturun; tarayıcı konsolunu kontrol edin. |

---

## 💰 Maliyet

| Servis | Ücretsiz Kapsam | Not |
|--------|-----------------|-----|
| **Railway** | Ücretsiz başlangıç planı (aylık kullanım kredisi) | Küçük bir bot için fazlasıyla yeter. |
| **Meta WhatsApp API** | İlk **1000 konuşma / ay ücretsiz** | Sonrası için ülke bazlı düşük ücret. |

> Küçük/orta bir berber için aylık maliyet genellikle **0₺**'dir.

---

## 📁 Proje Yapısı

```
.
├── src/
│   ├── index.js      # Express sunucu + webhook + API
│   ├── bot.js        # Konuşma akışı (state machine)
│   ├── whatsapp.js   # Meta Graph API mesaj gönderimi
│   └── db.js         # JSON dosya tabanlı veri katmanı
├── dashboard/
│   └── index.html    # Berber yönetim paneli
├── data/
│   └── randevular.json
├── .env.example
├── package.json
└── KURULUM.md
```
