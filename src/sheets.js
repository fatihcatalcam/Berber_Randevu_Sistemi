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

const { BERBERLER, SAATLER } = require("./config");

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const AKTIF_ID = process.env.GOOGLE_SHEET_ID;
const ARSIV_ID = process.env.GOOGLE_ARCHIVE_SHEET_ID;

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
};
const BEYAZ      = hexToRgb("ffffff");
const KAPALI_RENK = hexToRgb("d1d5db"); // gri — berber kapalı saat

function bugunStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Bir randevunun ızgaradaki konumu (0 tabanlı)
function konum(randevu) {
  const satir = SAATLER.indexOf(randevu.saat); // 0..17
  const sutun = BERBERLER.findIndex((b) => b.id === randevu.berberId); // 0..n-1
  if (satir === -1 || sutun === -1) return null;
  // +1: başlık satırı / saat sütunu için ofset
  return { rowIndex: satir + 1, colIndex: sutun + 1 };
}

function hucreEtiket(randevu) {
  if (randevu.durum === "iptal") {
    const kim = randevu.iptalEden === "musteri" ? "müşteri" : "berber";
    return `${randevu.ad} — İPTAL (${kim})`;
  }
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

  // İskelet: başlık satırı (Saat + berber adları) + saat sütunu
  const baslik = ["Saat", ...BERBERLER.map((b) => b.ad)];
  const satirlar = [baslik, ...SAATLER.map((saat) => [saat])];
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: AKTIF_ID,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: satirlar },
  });

  return sheetId;
}

// --- Genel API --------------------------------------------------------------

// Tek bir randevuyu ilgili güne/hücreye yaz (değer + renk)
async function syncRandevu(randevu) {
  if (!aktif) return;
  try {
    const k = konum(randevu);
    if (!k) return;
    const sheetId = await gunSekmesiGaranti(randevu.tarih);
    const renk = DURUM_RENK[randevu.durum] || DURUM_RENK.bekliyor;

    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: AKTIF_ID,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: {
                sheetId,
                startRowIndex: k.rowIndex,
                endRowIndex: k.rowIndex + 1,
                startColumnIndex: k.colIndex,
                endColumnIndex: k.colIndex + 1,
              },
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: hucreEtiket(randevu) },
                      userEnteredFormat: { backgroundColor: renk },
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
    console.error("syncRandevu hatası:", e.message);
  }
}

// Durum değişince hücreyi güncelle (renk + etiket). syncRandevu ile aynı işi yapar.
async function updateRandevuDurum(randevu) {
  return syncRandevu(randevu);
}

// Randevu taşındığında eski hücreyi temizle.
async function clearRandevuCell(berberId, tarih, saat) {
  if (!aktif) return;
  try {
    const satir = SAATLER.indexOf(saat);
    const sutun = BERBERLER.findIndex((b) => b.id === berberId);
    if (satir === -1 || sutun === -1) return;
    const sheetId = await gunSekmesiGaranti(tarih);
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: AKTIF_ID,
      requestBody: {
        requests: [{
          updateCells: {
            range: {
              sheetId,
              startRowIndex: satir + 1, endRowIndex: satir + 2,
              startColumnIndex: sutun + 1, endColumnIndex: sutun + 2,
            },
            rows: [{ values: [{ userEnteredValue: { stringValue: "" }, userEnteredFormat: { backgroundColor: BEYAZ } }] }],
            fields: "userEnteredValue,userEnteredFormat.backgroundColor",
          },
        }],
      },
    });
  } catch (e) {
    console.error("clearRandevuCell hatası:", e.message);
  }
}

// Dashboard'dan saat kapatılınca/açılınca ilgili hücreyi güncelle.
async function syncKapaliSaat(berberId, tarih, saat, kapali) {
  if (!aktif) return;
  try {
    const satir = SAATLER.indexOf(saat);
    const sutun = BERBERLER.findIndex((b) => b.id === berberId);
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
                startColumnIndex: sutun + 1, endColumnIndex: sutun + 2,
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
  arsivle,
  tumunuYenidenSenkronla,
  // test/iç kullanım için:
  _tarihToTab: tarihToTab,
  _tabToTarih: tabToTarih,
};
