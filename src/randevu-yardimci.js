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

function tarihStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function gunEkle(tarih, n) {
  const d = new Date(tarih + "T00:00:00");
  d.setDate(d.getDate() + n);
  return tarihStr(d);
}

// Haftalık sabit kuralın üretilecek tarihleri. son_uretilen'e kadar olanlar bir
// daha üretilmez — iptal edilen/silinen tek bir hafta böylece geri gelmez.
function sabitTarihleri(kural, bugun = bugunStr(), ufukGun = 56) {
  let bas = kural.baslangic > bugun ? kural.baslangic : bugun;
  if (kural.son_uretilen) {
    const sonraki = gunEkle(kural.son_uretilen, 1);
    if (sonraki > bas) bas = sonraki;
  }
  const bit = gunEkle(bugun, ufukGun);
  const sonuc = [];
  for (let t = bas; t <= bit; t = gunEkle(t, 1)) {
    if (new Date(t + "T00:00:00").getDay() === kural.gun) sonuc.push(t);
  }
  return { tarihler: sonuc, bitis: bit };
}

module.exports = { bugunStr, slotEkle, saatToDk, MIN_ONCE_DK, slotGectiMi, acikSaatleriGetir, gunEkle, sabitTarihleri };
