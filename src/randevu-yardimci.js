// ---------------------------------------------------------------------------
// Randevu slot yardımcıları — hem WhatsApp bot'u (src/bot.js) hem web
// randevu route'ları (src/index.js) tarafından kullanılır. Çift rezervasyon
// ve geçmiş saat kuralı iki yerde de birebir aynı olmak zorunda olduğu için
// tek kaynakta tutuluyor.
// ---------------------------------------------------------------------------
const db = require("./db");

// Bugünün tarihi "YYYY-MM-DD"
function bugunStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Saat string'ine dakika ekler: "10:00" + 60 → "11:00"
function slotEkle(saat, dk) {
  const [h, m] = saat.split(":").map(Number);
  const t = h * 60 + m + dk;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// "10:30" → 630 (gece yarısından beri geçen dakika)
function saatToDk(saat) {
  const [h, m] = saat.split(":").map(Number);
  return h * 60 + m;
}

// Randevu en erken bu kadar dakika sonrasına alınabilir (çok son ana engel).
const MIN_ONCE_DK = 15;

// Slot geçmişte mi (veya alınamayacak kadar yakın mı)? Sadece bugünü ilgilendirir;
// gelecek günlerin tüm saatleri geçerlidir.
function slotGectiMi(tarih, saat) {
  if (tarih !== bugunStr()) return false;
  const now = new Date();
  return saatToDk(saat) <= now.getHours() * 60 + now.getMinutes() + MIN_ONCE_DK;
}

// O berber/tarih için özel açılmış yemek slotları (db yoksa boş döner)
async function acikSaatleriGetir(berberId, tarih) {
  if (typeof db.getAcikSaatlerFor !== "function") return [];
  return db.getAcikSaatlerFor(berberId, tarih).catch(() => []);
}

module.exports = { bugunStr, slotEkle, saatToDk, MIN_ONCE_DK, slotGectiMi, acikSaatleriGetir };
