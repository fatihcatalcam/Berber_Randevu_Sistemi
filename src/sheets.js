// ---------------------------------------------------------------------------
// Google Sheets canlı senkron katmanı
//
// JSON dosyası ANA kaynaktır; bu modül sadece canlı bir AYNA yazar.
// Tüm fonksiyonlar hata durumunda yutar + loglar → bot/rezervasyon ASLA durmaz.
//
// Yapı: Aktif tabloda her gün bir sekme (DD.MM.YYYY). Izgara:
//   A sütunu = saatler, sonraki sütunlar = berberler.
//   Hücre = müşteri adı, arka plan rengi = durum.
// Geçmiş günler arşiv tablosuna taşınır (arsivle()).
// ---------------------------------------------------------------------------

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const { BERBERLER, SAATLER, SAATLER_45, berberSlotDk, berberSaatleri } = require("./config");

// Çizelge yerleşimi: A=Saat(30dk) | 30dk berberler | Saat(45dk) | 45dk berberler
const BERBER_30 = BERBERLER.filter((b) => (b.slotDk || 30) === 30);
const BERBER_45 = BERBERLER.filter((b) => (b.slotDk || 30) === 45);
const SAAT45_KOL = 1 + BERBER_30.length; // "Saat (45dk)" sütununun 0 tabanlı indeksi

// Bir berberin 0 tabanlı sütun indeksi
function berberKolon(berberId) {
  const i30 = BERBER_30.findIndex((b) => b.id === berberId);
  if (i30 !== -1) return 1 + i30;
  const i45 = BERBER_45.findIndex((b) => b.id === berberId);
  if (i45 !== -1) return SAAT45_KOL + 1 + i45;
  return -1;
}

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const AKTIF_ID   = process.env.GOOGLE_SHEET_ID;
const ARSIV_ID   = process.env.GOOGLE_ARCHIVE_SHEET_ID;
const MUSTERI_ID = process.env.GOOGLE_MUSTERI_SHEET_ID; // müşteri veritabanı (ayrı dosya)

let sheetsApi = null;
let aktif = false;

// --- Kimlik doğrulama: önce env (Railway), sonra yerel google-key.json ------
function init() {
  try {
    let auth;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        scopes: SCOPES,
      });
    } else {
      const keyFile = path.join(__dirname, "..", "google-key.json");
      if (!fs.existsSync(keyFile)) {
        console.log("ℹ️ Google Sheets yapılandırılmamış (anahtar yok) — senkron devre dışı.");
        return;
      }
      const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
    }
    if (!AKTIF_ID) {
      console.log("ℹ️ GOOGLE_SHEET_ID yok — Sheets senkron devre dışı.");
      return;
    }
    sheetsApi = google.sheets({ version: "v4", auth });
    aktif = true;
    console.log("✅ Google Sheets senkron aktif.");
  } catch (e) {
    console.error("Sheets init hatası:", e.message);
  }
}
init();

function isEnabled() {
  return aktif;
}

// --- Yardımcılar ------------------------------------------------------------
function tarihToTab(tarih) {
  // "2026-06-09" -> "09.06.2026"
  const [y, m, d] = tarih.split("-");
  return `${d}.${m}.${y}`;
}

function tabToTarih(tab) {
  // "09.06.2026" -> "2026-06-09" (geçersizse null)
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(tab);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  };
}

const DURUM_RENK = {
  bekliyor: hexToRgb("fef9c3"),
  "onaylı": hexToRgb("d1fae5"),
  iptal: hexToRgb("fee2e2"),
  gelmedi: hexToRgb("ffedd5"),
};
const BEYAZ      = hexToRgb("ffffff");
const KAPALI_RENK = hexToRgb("d1d5db"); // gri — berber kapalı saat

function bugunStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Saat string'ine dakika ekler
function slotEkle(saat, dk) {
  const [h, m] = saat.split(":").map(Number);
  const t = h * 60 + m + dk;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// Bir randevunun ızgaradaki konumu (0 tabanlı)
function konum(randevu) {
  const satir = berberSaatleri(randevu.berberId).indexOf(randevu.saat);
  const sutun = berberKolon(randevu.berberId);
  if (satir === -1 || sutun === -1) return null;
  // +1: başlık satırı ofseti
  return { rowIndex: satir + 1, colIndex: sutun };
}

function hucreEtiket(randevu) {
  if (randevu.durum === "iptal") {
    const kim = randevu.iptalEden === "musteri" ? "müşteri" : "berber";
    return `${randevu.ad} — İPTAL (${kim})`;
  }
  if (randevu.durum === "gelmedi") return `${randevu.ad} — GELMEDİ`;
  return randevu.ad;
}

// --- Sekme yönetimi ---------------------------------------------------------
// Bir spreadsheet'teki başlık -> sheetId haritası
async function sekmeHaritasi(spreadsheetId) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const harita = {};
  for (const s of meta.data.sheets) {
    harita[s.properties.title] = s.properties.sheetId;
  }
  return harita;
}

// Günün sekmesini garanti et (yoksa oluştur + ızgara iskeletini yaz). sheetId döner.
async function gunSekmesiGaranti(tarih) {
  const tab = tarihToTab(tarih);
  let harita = await sekmeHaritasi(AKTIF_ID);
  if (harita[tab] !== undefined) return harita[tab];

  // Sekmeyi oluştur
  const ekle = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: AKTIF_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
  });
  const sheetId = ekle.data.replies[0].addSheet.properties.sheetId;

  // İskelet: Saat(30dk) | 30dk berberler | Saat(45dk) | 45dk berberler
  const baslik = ["Saat (30dk)", ...BERBER_30.map((b) => b.ad), "Saat (45dk)", ...BERBER_45.map((b) => b.ad)];
  const maxSatir = Math.max(SAATLER.length, SAATLER_45.length);
  const satirlar = [baslik];
  for (let r = 0; r < maxSatir; r++) {
    const row = new Array(baslik.length).fill("");
    row[0] = SAATLER[r] || "";
    row[SAAT45_KOL] = SAATLER_45[r] || "";
    satirlar.push(row);
  }
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: AKTIF_ID,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: satirlar },
  });

  return sheetId;
}

// --- Genel API --------------------------------------------------------------

// Tek bir randevuyu ilgili güne/hücreye yaz (değer + renk).
// Çoklu kişi randevusu için ardışık satırlara da yazar.
async function syncRandevu(randevu) {
  if (!aktif) return;
  try {
    const k = konum(randevu);
    if (!k) return;
    const sheetId = await gunSekmesiGaranti(randevu.tarih);
    const renk = DURUM_RENK[randevu.durum] || DURUM_RENK.bekliyor;
    const n = (randevu.kisiSayisi > 1 && randevu.durum !== "iptal") ? randevu.kisiSayisi : 1;
    const step = berberSlotDk(randevu.berberId);
    const saatler = berberSaatleri(randevu.berberId);

    const requests = [];
    for (let i = 0; i < n; i++) {
      const slotSaat = i === 0 ? randevu.saat : slotEkle(randevu.saat, i * step);
      const satirIdx = saatler.indexOf(slotSaat);
      if (satirIdx === -1) continue;
      const rowIdx = satirIdx + 1;
      const etiket = i === 0
        ? hucreEtiket(randevu)
        : `↕ ${i + 1}/${n} — ${randevu.ad}`;
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: rowIdx, endRowIndex: rowIdx + 1,
            startColumnIndex: k.colIndex, endColumnIndex: k.colIndex + 1,
          },
          rows: [{ values: [{ userEnteredValue: { stringValue: etiket }, userEnteredFormat: { backgroundColor: renk } }] }],
          fields: "userEnteredValue,userEnteredFormat.backgroundColor",
        },
      });
    }

    if (requests.length) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: AKTIF_ID, requestBody: { requests } });
    }
  } catch (e) {
    console.error("syncRandevu hatası:", e.message);
  }
}

// Durum değişince hücreyi güncelle (renk + etiket). syncRandevu ile aynı işi yapar.
async function updateRandevuDurum(randevu) {
  return syncRandevu(randevu);
}

// Randevu taşındığında eski hücre(ler)i temizle.
async function clearRandevuCell(berberId, tarih, saat, kisiSayisi = 1) {
  if (!aktif) return;
  try {
    const sutun = berberKolon(berberId);
    if (sutun === -1) return;
    const step = berberSlotDk(berberId);
    const saatler = berberSaatleri(berberId);
    const sheetId = await gunSekmesiGaranti(tarih);
    const requests = [];
    for (let i = 0; i < kisiSayisi; i++) {
      const slotSaat = i === 0 ? saat : slotEkle(saat, i * step);
      const satir = saatler.indexOf(slotSaat);
      if (satir === -1) continue;
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: satir + 1, endRowIndex: satir + 2,
            startColumnIndex: sutun, endColumnIndex: sutun + 1,
          },
          rows: [{ values: [{ userEnteredValue: { stringValue: "" }, userEnteredFormat: { backgroundColor: BEYAZ } }] }],
          fields: "userEnteredValue,userEnteredFormat.backgroundColor",
        },
      });
    }
    if (requests.length) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: AKTIF_ID, requestBody: { requests } });
    }
  } catch (e) {
    console.error("clearRandevuCell hatası:", e.message);
  }
}

// Dashboard'dan saat kapatılınca/açılınca ilgili hücreyi güncelle.
async function syncKapaliSaat(berberId, tarih, saat, kapali) {
  if (!aktif) return;
  try {
    const satir = berberSaatleri(berberId).indexOf(saat);
    const sutun = berberKolon(berberId);
    if (satir === -1 || sutun === -1) return;
    const sheetId = await gunSekmesiGaranti(tarih);
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: AKTIF_ID,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: {
                sheetId,
                startRowIndex: satir + 1, endRowIndex: satir + 2,
                startColumnIndex: sutun, endColumnIndex: sutun + 1,
              },
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: kapali ? "⛔ KAPALI" : "" },
                      userEnteredFormat: { backgroundColor: kapali ? KAPALI_RENK : BEYAZ },
                    },
                  ],
                },
              ],
              fields: "userEnteredValue,userEnteredFormat.backgroundColor",
            },
          },
        ],
      },
    });
  } catch (e) {
    console.error("syncKapaliSaat hatası:", e.message);
  }
}

// --- Müşteri veritabanı (ayrı Sheets dosyası) -------------------------------
let musteriBaslikHazir = false;

// Her randevuda müşteri bilgisini ayrı dosyaya ekler: Ad, Telefon, Berber, Tarih/Saat
async function musteriKaydet(randevu) {
  if (!sheetsApi || !MUSTERI_ID) return;
  try {
    // İlk kullanımda başlık satırını garanti et
    if (!musteriBaslikHazir) {
      const mevcut = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: MUSTERI_ID, range: "A1:F1",
      });
      if (!mevcut.data.values || mevcut.data.values.length === 0) {
        await sheetsApi.spreadsheets.values.update({
          spreadsheetId: MUSTERI_ID, range: "A1", valueInputOption: "RAW",
          requestBody: { values: [["Ad Soyad", "Telefon", "Berber", "Tarih", "Saat", "Kayıt Zamanı"]] },
        });
      }
      musteriBaslikHazir = true;
    }
    const kayitZamani = new Date().toLocaleString("tr-TR");
    await sheetsApi.spreadsheets.values.append({
      spreadsheetId: MUSTERI_ID,
      range: "A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          randevu.ad || "", randevu.telefon || "", randevu.berber || "",
          randevu.tarih || "", randevu.saat || "", kayitZamani,
        ]],
      },
    });
  } catch (e) {
    console.error("musteriKaydet hatası:", e.message);
  }
}

// --- Aylık özet (müşteri DB dosyasında "Aylık Özet" sekmesi) ----------------

// Ay etiketi: "2026-07" → "Temmuz 2026"
const AY_ADLARI = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
function ayEtiket(ay) {
  const [yil, a] = ay.split("-").map(Number);
  return `${AY_ADLARI[a - 1] || a} ${yil}`;
}

// Saf hesap: onaylı randevulardan ay bazlı ciro, sayı ve berber kırılımı.
// [{ ay:"2026-07", sayi, ciro, berber:{berberId:sayi} }] (aya göre artan)
function aylikOzetHesapla(randevular) {
  const aylar = {};
  for (const r of randevular || []) {
    if (r.durum !== "onaylı") continue; // sadece gerçekleşen (para kazanılan) randevular
    const ay = (r.tarih || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ay)) continue;
    if (!aylar[ay]) aylar[ay] = { ay, sayi: 0, ciro: 0, berber: {} };
    const a = aylar[ay];
    a.sayi++;
    a.ciro += (r.gercekFiyat != null ? r.gercekFiyat : (r.fiyat || 0));
    a.berber[r.berberId] = (a.berber[r.berberId] || 0) + 1;
  }
  return Object.values(aylar).sort((x, y) => x.ay.localeCompare(y.ay));
}

// Aylık özeti müşteri DB dosyasındaki "Aylık Özet" sekmesine yazar (tam yeniden yazım).
async function aylikOzetYaz(randevular) {
  if (!sheetsApi || !MUSTERI_ID) return;
  try {
    const ozet = aylikOzetHesapla(randevular);
    const SEKME = "Aylık Özet";
    const harita = await sekmeHaritasi(MUSTERI_ID);
    if (harita[SEKME] === undefined) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: MUSTERI_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: SEKME } } }] },
      });
    }
    const baslik = ["Ay", "Randevu", "Ciro (₺)", ...BERBERLER.map((b) => b.ad)];
    const satirlar = ozet.map((o) => [
      ayEtiket(o.ay), o.sayi, o.ciro, ...BERBERLER.map((b) => o.berber[b.id] || 0),
    ]);
    await sheetsApi.spreadsheets.values.clear({ spreadsheetId: MUSTERI_ID, range: `${SEKME}!A1:Z1000` });
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: MUSTERI_ID,
      range: `${SEKME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [baslik, ...satirlar] },
    });
  } catch (e) {
    console.error("aylikOzetYaz hatası:", e.message);
  }
}

// Geçmiş günlerin sekmelerini arşive taşı (kopyala + aktiften sil)
async function arsivle() {
  if (!aktif || !ARSIV_ID) return { tasinan: 0 };
  let tasinan = 0;
  try {
    const harita = await sekmeHaritasi(AKTIF_ID);
    const bugun = bugunStr();
    for (const [tab, sheetId] of Object.entries(harita)) {
      const tarih = tabToTarih(tab);
      if (!tarih) continue; // tarih sekmesi değil (örn. varsayılan Sheet1) → atla
      if (tarih >= bugun) continue; // bugün veya gelecek → kalsın

      // Arşivde aynı isim varsa çakışmayı önle
      const arsivHarita = await sekmeHaritasi(ARSIV_ID);
      let hedefAd = tab;
      if (arsivHarita[hedefAd] !== undefined) hedefAd = `${tab} (${Date.now().toString().slice(-4)})`;

      // 1) Aktiften arşive kopyala
      const kopya = await sheetsApi.spreadsheets.sheets.copyTo({
        spreadsheetId: AKTIF_ID,
        sheetId,
        requestBody: { destinationSpreadsheetId: ARSIV_ID },
      });
      // Kopyanın adını düzelt (copyTo "Kopyası ..." ekler)
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: ARSIV_ID,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: kopya.data.sheetId, title: hedefAd },
                fields: "title",
              },
            },
          ],
        },
      });
      // 2) Aktiften sil
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: AKTIF_ID,
        requestBody: { requests: [{ deleteSheet: { sheetId } }] },
      });
      tasinan++;
    }
  } catch (e) {
    console.error("arsivle hatası:", e.message);
  }
  return { tasinan };
}

// Aktif tabloyu JSON'dan sıfırdan yaz (drift onarımı / "Tümünü yeniden senkronla")
async function tumunuYenidenSenkronla(randevular) {
  if (!aktif) return { yazilan: 0 };
  let yazilan = 0;
  try {
    // Sadece bugün + gelecek randevular (geçmiş zaten arşivde)
    const bugun = bugunStr();
    const gecerli = randevular.filter((r) => r.tarih >= bugun);
    // Tarihe göre sırayla yaz (sekmeler oluşsun)
    for (const r of gecerli) {
      await syncRandevu(r);
      yazilan++;
    }
  } catch (e) {
    console.error("tumunuYenidenSenkronla hatası:", e.message);
  }
  return { yazilan };
}

module.exports = {
  isEnabled,
  syncRandevu,
  updateRandevuDurum,
  clearRandevuCell,
  syncKapaliSaat,
  musteriKaydet,
  arsivle,
  tumunuYenidenSenkronla,
  aylikOzetYaz,
  aylikOzetHesapla,
  // test/iç kullanım için:
  _tarihToTab: tarihToTab,
  _tabToTarih: tabToTarih,
};
