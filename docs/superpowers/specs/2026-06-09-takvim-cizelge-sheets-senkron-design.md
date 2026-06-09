# Takvim + Çizelge + Canlı Google Sheets Senkronu — Tasarım

**Tarih:** 2026-06-09
**Durum:** Onaylandı (kullanıcı brainstorming'de tüm bölümleri onayladı)

## Amaç

Berber dashboard'una bir **takvim** ve **günlük çizelge (ızgara)** görünümü eklemek;
ayrıca tüm randevuları **Google Sheets'e canlı (gerçek zamanlı)** yansıtmak. Yeni randevu
veya durum değişikliği oldukça Google tablosu otomatik güncellenir. Eski günler aktif
tablodan otomatik olarak ayrı bir **arşiv** tablosuna taşınır ki aktif tablo hiç yavaşlamasın.

## Kapsam Dışı (YAGNI)

- Aylık ayrı arşiv dosyaları (tek arşiv dosyası yeterli; ileride gerekirse eklenir)
- OAuth kullanıcı akışı (service account kullanılacak)
- Excel/CSV indirme (kullanıcı canlı Google Sheets'i tercih etti)

---

## Mimari & Veri Akışı

```
Müşteri (WhatsApp) ──► bot.js ──► db.js (JSON = ANA KAYNAK)
                                      │
                                      ├──► sheets.js ──► Google Sheets (CANLI AYNA)
                                      │
Berber (Dashboard) ──► /api ──► db.js ┘
```

- **JSON dosyası tek doğruluk kaynağıdır.** Google Sheets canlı bir **ayna**dır;
  Sheets'te hata olsa bile randevular kaybolmaz.
- Sheets yazma işlemleri **fire-and-forget + try/catch**: Sheets API çökse/yavaşlasa bile
  bot ve rezervasyon akışı **asla durmaz**, hata yalnızca loglanır.
- **Tek kaynak ilkesi:** Berber/hizmet/saat listeleri `src/config.js`'e taşınır; bot,
  dashboard ve çizelge hepsi oradan okur. İsim/fiyat değişikliği tek yerden yapılır.

---

## Bileşenler

### 1. `src/config.js` (YENİ — tek doğruluk kaynağı)
- `BERBERLER`, `HIZMETLER`, `SAATLER`, `gelecekTarihler()` buraya taşınır
- `bot.js` ve `index.js` buradan import eder
- Berber isimleri şimdilik **placeholder** (kullanıcı tek yerden değiştirecek);
  yapı 8-9 berberi destekler
- `GET /api/config` ile frontend'e sunulur (çizelgenin sütunları = berberler)

### 2. `src/sheets.js` (YENİ — Google Sheets entegrasyonu)
- `googleapis` paketi + **service account** ile kimlik doğrulama
- Fonksiyonlar:
  - `syncRandevu(randevu)` — randevuyu ilgili günün sekmesindeki `[saat, berber]` hücresine yazar; sekme yoksa oluşturur
  - `updateRandevuDurum(randevu)` — hücre içeriğini/rengini günceller (onay/iptal)
  - `arsivle()` — tarihi bugünden eski sekmeleri arşiv dosyasına kopyalar, aktiften siler
  - `tumunuYenidenSenkronla()` — aktif tabloyu JSON'dan sıfırdan yazar (drift onarımı)
- Tüm fonksiyonlar hata durumunda yutar + loglar (bot'u bloke etmez)

### 3. `src/db.js` (DEĞİŞİKLİK)
- Randevu modeline `iptalEden: "musteri" | "berber" | null` alanı eklenir
- `updateStatus(id, durum, iptalEden)` imzası genişler (iptalEden opsiyonel)
- `getBusySlots` mevcut davranış: `durum !== "iptal"` olanlar dolu → iptal saatleri
  tekrar müsait olur (uzlaşma kararı)

### 4. `src/bot.js` (DEĞİŞİKLİK)
- Sabit veriler `config.js`'ten import edilir
- "🔍 Randevum" akışı genişler: her randevunun altında **"❌ İptal Et"** butonu
  (`iptal_randevu_{id}` formatında)
- Müşteri iptal edince: `db.updateStatus(id, "iptal", "musteri")` + berbere bilgi mesajı
- Randevu oluşturulunca / iptal edilince `sheets` senkronu tetiklenir (fire-and-forget)

### 5. `src/index.js` (DEĞİŞİKLİK)
- Dashboard'dan iptal: `iptalEden: "berber"` ile kaydedilir
- Durum güncellemesi sonrası `sheets.updateRandevuDurum` tetiklenir
- Yeni endpoint'ler:
  - `GET /api/config` — berber/hizmet/saat listesi
  - `POST /api/sheets/resync` — "Tümünü yeniden senkronla" butonu
- Başlangıçta + her 24 saatte `sheets.arsivle()` çalışır (zamanlanmış görev)

### 6. `dashboard/index.html` (DEĞİŞİKLİK)
- **Aylık takvim:** her günde randevu sayısı rozeti, bugün vurgulu
- **Güne tıkla → çizelge:** saat satırları (09:00–17:30) × berber sütunları ızgara
- **Hücre içeriği:** müşteri adı; renk = durum (🟡 bekliyor / 🟢 onaylı / 🔴 iptal)
- İptal hücresi: `Ad — İPTAL (müşteri/berber)`, kırmızı kalır ama saat tekrar müsait;
  yeni müşteri alırsa hücre güncellenir
- **Hücreye tıkla → popup:** randevu detayı + ✅ Onayla / ❌ İptal
- İstatistik kartları üstte kalır; eski düz liste "Liste görünümü" sekmesiyle erişilir
- 10 sn otomatik yenileme korunur

---

## Google Sheets Yapısı

**Aktif Tablo** (`GOOGLE_SHEET_ID`):
- Sadece **bugün + gelecek 7 gün** sekmeleri (en fazla ~8 sekme → hep hızlı)
- Sekme adı = tarih (örn. `09.06.2026`)
- Izgara: A sütunu saatler, sonraki sütunlar berberler; hücre = müşteri adı, arka plan = durum rengi

**Arşiv Tablo** (`GOOGLE_ARCHIVE_SHEET_ID`):
- Tarihi geçmiş tüm gün sekmeleri buraya taşınır
- Nadiren açılır; insan gözüyle geçmiş kayıt için (asıl kayıt JSON'da)

**Arşivleyici:**
- Sunucu başlangıcında + her 24 saatte çalışır
- `tarih < bugün` olan sekmeleri arşive kopyalar, aktiften siler

---

## Durum Renkleri (Sheets + Dashboard ortak)

| Durum | Arka plan | Metin |
|-------|-----------|-------|
| bekliyor | sarı (#fef9c3) | koyu sarı (#713f12) |
| onaylı | yeşil (#d1fae5) | koyu yeşil (#065f46) |
| iptal | kırmızı (#fee2e2) | koyu kırmızı (#991b1b) |

---

## Yeni Bağımlılıklar & Ortam Değişkenleri

**Paket:** `googleapis`

**Env:**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — robot hesabın e-postası
- `GOOGLE_PRIVATE_KEY` — service account özel anahtarı (\\n kaçışlarına dikkat)
- `GOOGLE_SHEET_ID` — aktif tablo ID'si
- `GOOGLE_ARCHIVE_SHEET_ID` — arşiv tablo ID'si

`.env.example` güncellenir; Railway Variables'a eklenir.

---

## Google Cloud Kurulumu (kullanıcıyla birlikte, ~10 dk)

1. Google Cloud Console → yeni proje
2. **Google Sheets API**'yi etkinleştir
3. Service Account oluştur → JSON anahtar indir
4. İki Google Sheet oluştur (aktif + arşiv), ikisini de service account e-postasıyla **paylaş** (Editör)
5. Sheet ID'lerini ve anahtarı env'e gir

---

## Güvenilirlik & Hata Yönetimi

- Sheets çağrıları **bloke etmez**: `try/catch` + log, başarısızlıkta sessizce geç
- JSON ana kaynak → Sheets drift ederse `POST /api/sheets/resync` ile onarılır
- Google API rate limit (60 istek/dk/kullanıcı) 100 randevu/gün için fazlasıyla yeterli

---

## Test Stratejisi

1. **Birim/akış (mock Sheets):** `sheets.js` mock'lanır; bot akışı + iptal akışı + config
   senkronu test edilir (gerçek API çağrısı yok)
2. **Arşivleyici testi:** geçmiş tarihli sahte sekme → arşive taşınıyor mu
3. **Gerçek tablo dumanı (smoke):** 1 randevu oluştur → aktif tabloda doğru hücrede mi,
   doğru renkte mi; onayla → yeşile dönüyor mu
4. **Dashboard:** takvim güne tıklama → çizelge doğru günü gösteriyor mu; hücre popup
   onayla/iptal çalışıyor mu

---

## Açık Olmayan Kararlar (kullanıcı onayladı)

- Export yöntemi: **Google Sheets (canlı)** — service account (A)
- Senkron modeli: **günlük ayrı sekmeler**
- Sekme düzeni: **ızgara (saat × berber)**
- Berber listesi: **placeholder, yapı önce, tek kaynaktan**
- Dashboard gün görünümü: **çizelgenin aynısı (ızgara)**
- İptal: **müşteri WhatsApp'tan iptal edebilir + çizelgede kim iptal etti etiketlenir**
- İptal slot davranışı: **kayıt kırmızı kalır ama saat tekrar müsait olur**
- Arşiv: **eski günler ayrı arşiv dosyasına otomatik taşınır**
