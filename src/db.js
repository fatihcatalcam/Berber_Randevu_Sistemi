const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "randevular.json");
const KAPALI_PATH = path.join(__dirname, "..", "data", "kapali_saatler.json");

function ensureDir() {
  const dir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "[]", "utf8");
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8") || "[]");
  } catch (err) {
    console.error("DB okuma hatası:", err.message);
    return [];
  }
}

function write(list) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(list, null, 2), "utf8");
}

function getAll() {
  return read().sort((a, b) => b.olusturulma - a.olusturulma);
}

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

function getBusySlots(berberId, tarih) {
  const randevuSlots = read()
    .filter((r) => r.berberId === berberId && r.tarih === tarih && r.durum !== "iptal")
    .map((r) => r.saat);
  const kapaliSlots = getKapaliListByBerber(berberId, tarih);
  return [...new Set([...randevuSlots, ...kapaliSlots])];
}

function updateStatus(id, durum, iptalEden) {
  const list = read();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx].durum = durum;
  if (iptalEden) list[idx].iptalEden = iptalEden;
  write(list);
  return list[idx];
}

function updateFiyat(id, gercekFiyat) {
  const list = read();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx].gercekFiyat = gercekFiyat;
  write(list);
  return list[idx];
}

// --- Kapalı saatler ---------------------------------------------------------

function readKapali() {
  ensureDir();
  try {
    if (!fs.existsSync(KAPALI_PATH)) return {};
    return JSON.parse(fs.readFileSync(KAPALI_PATH, "utf8") || "{}");
  } catch {
    return {};
  }
}

function writeKapali(data) {
  ensureDir();
  fs.writeFileSync(KAPALI_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getKapaliSaatler() {
  return readKapali();
}

function getKapaliListByBerber(berberId, tarih) {
  const data = readKapali();
  return (data[berberId] && data[berberId][tarih]) || [];
}

function setKapaliSaat(berberId, tarih, saat, kapali) {
  const data = readKapali();
  if (!data[berberId]) data[berberId] = {};
  if (!data[berberId][tarih]) data[berberId][tarih] = [];

  if (kapali) {
    if (!data[berberId][tarih].includes(saat)) data[berberId][tarih].push(saat);
  } else {
    data[berberId][tarih] = data[berberId][tarih].filter((s) => s !== saat);
    if (!data[berberId][tarih].length) delete data[berberId][tarih];
  }
  writeKapali(data);
}

module.exports = {
  getAll,
  add,
  getBusySlots,
  updateStatus,
  updateFiyat,
  getKapaliSaatler,
  getKapaliListByBerber,
  setKapaliSaat,
};
