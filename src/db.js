const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "randevular.json");

function ensureFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, "[]", "utf8");
  }
}

function read() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    console.error("DB okuma hatası:", err.message);
    return [];
  }
}

function write(list) {
  ensureFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(list, null, 2), "utf8");
}

// Tüm randevular, oluşturulma tarihine göre yeniden eskiye sıralı
function getAll() {
  return read().sort((a, b) => b.olusturulma - a.olusturulma);
}

// Yeni randevu ekle
function add(randevu) {
  const list = read();
  const kayit = {
    ...randevu,
    id: Date.now().toString(),
    olusturulma: Date.now(),
    durum: "bekliyor",
  };
  list.push(kayit);
  write(list);
  return kayit;
}

// Bir berber + tarih için iptal edilmemiş (dolu) saatler
function getBusySlots(berberId, tarih) {
  return read()
    .filter(
      (r) =>
        r.berberId === berberId &&
        r.tarih === tarih &&
        r.durum !== "iptal"
    )
    .map((r) => r.saat);
}

// Randevu durumunu güncelle; güncellenen kaydı döndür, yoksa null
function updateStatus(id, durum) {
  const list = read();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx].durum = durum;
  write(list);
  return list[idx];
}

module.exports = { getAll, add, getBusySlots, updateStatus };
