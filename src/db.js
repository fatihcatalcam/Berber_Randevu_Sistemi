const { Pool } = require("pg");
const { SAATLER } = require("./config");

// Saat string'ine dakika ekler: "10:00" + 30 → "10:30"
function slotEkle(saat, dk) {
  const [h, m] = saat.split(":").map(Number);
  const t = h * 60 + m + dk;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// DATABASE_URL yoksa pool null kalır; init() erken çıkar, sorgular hata fırlatır.
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

// ---------------------------------------------------------------------------
// Tablo oluşturma — uygulama açılışında çağrılır
// ---------------------------------------------------------------------------
async function init() {
  if (!pool) {
    console.warn("⚠️  DATABASE_URL tanımlı değil — veritabanı devre dışı.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS randevular (
      id           TEXT PRIMARY KEY,
      ad           TEXT,
      telefon      TEXT,
      berber_id    TEXT,
      berber       TEXT,
      hizmet_id    TEXT,
      hizmet       TEXT,
      tarih        TEXT,
      saat         TEXT,
      fiyat        INTEGER,
      gercek_fiyat INTEGER,
      durum        TEXT    DEFAULT 'bekliyor',
      iptal_eden   TEXT,
      kisi_sayisi  INTEGER,
      kisiler      JSONB,
      olusturulma  BIGINT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kapali_saatler (
      berber_id TEXT NOT NULL,
      tarih     TEXT NOT NULL,
      saat      TEXT NOT NULL,
      PRIMARY KEY (berber_id, tarih, saat)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kapali_gunler (
      berber_id TEXT NOT NULL,
      tarih     TEXT NOT NULL,
      PRIMARY KEY (berber_id, tarih)
    )
  `);
  // Mevcut tabloya aciklama sütunu ekle (yoksa)
  await pool.query(`ALTER TABLE randevular ADD COLUMN IF NOT EXISTS aciklama TEXT`);
  // Aynı berber/tarih/saat için iptal olmayan iki randevu engellenir (çift rezervasyon koruması)
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_randevu_slot
      ON randevular (berber_id, tarih, saat)
      WHERE durum <> 'iptal'
    `);
  } catch (e) {
    console.warn("⚠️  Slot benzersizlik indeksi oluşturulamadı (mevcut çakışma olabilir):", e.message);
  }
  console.log("✅ Veritabanı tabloları hazır.");
}

// Slot dolu hatası — çağıranlar bunu yakalayıp kullanıcıya bildirir
class SlotDoluError extends Error {
  constructor() { super("Seçilen saat dolu."); this.code = "SLOT_DOLU"; }
}

// ---------------------------------------------------------------------------
// Yardımcı: DB satırı → JS nesnesi
// ---------------------------------------------------------------------------
function rowToRandevu(row) {
  return {
    id:          row.id,
    ad:          row.ad,
    telefon:     row.telefon,
    berberId:    row.berber_id,
    berber:      row.berber,
    hizmetId:    row.hizmet_id,
    hizmet:      row.hizmet,
    tarih:       row.tarih,
    saat:        row.saat,
    fiyat:       row.fiyat,
    gercekFiyat: row.gercek_fiyat  ?? undefined,
    durum:       row.durum,
    iptalEden:   row.iptal_eden    ?? undefined,
    kisiSayisi:  row.kisi_sayisi   ?? undefined,
    kisiler:     row.kisiler       ?? undefined,
    aciklama:    row.aciklama      ?? undefined,
    olusturulma: Number(row.olusturulma),
  };
}

// ---------------------------------------------------------------------------
// Randevular
// ---------------------------------------------------------------------------
async function getAll() {
  const res = await pool.query("SELECT * FROM randevular ORDER BY olusturulma DESC");
  return res.rows.map(rowToRandevu);
}

async function add(randevu) {
  const id          = Date.now().toString();
  const olusturulma = Date.now();
  const durum       = randevu.durum || "bekliyor";
  try {
    await pool.query(
      `INSERT INTO randevular
         (id, ad, telefon, berber_id, berber, hizmet_id, hizmet,
          tarih, saat, fiyat, durum, kisi_sayisi, kisiler, olusturulma)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, randevu.ad, randevu.telefon,
        randevu.berberId, randevu.berber,
        randevu.hizmetId, randevu.hizmet,
        randevu.tarih, randevu.saat, randevu.fiyat,
        durum,
        randevu.kisiSayisi || null,
        randevu.kisiler    ? JSON.stringify(randevu.kisiler) : null,
        olusturulma,
      ]
    );
  } catch (e) {
    if (e.code === "23505") throw new SlotDoluError(); // benzersizlik ihlali = slot dolu
    throw e;
  }
  return { ...randevu, id, olusturulma, durum };
}

async function getBusySlots(berberId, tarih) {
  const [r1, r2, r3] = await Promise.all([
    pool.query(
      "SELECT saat, kisi_sayisi FROM randevular WHERE berber_id=$1 AND tarih=$2 AND durum!='iptal'",
      [berberId, tarih]
    ),
    pool.query(
      "SELECT saat FROM kapali_saatler WHERE berber_id=$1 AND tarih=$2",
      [berberId, tarih]
    ),
    pool.query(
      "SELECT 1 FROM kapali_gunler WHERE berber_id=$1 AND tarih=$2",
      [berberId, tarih]
    ),
  ]);
  // Gün tamamen kapalıysa tüm slotlar dolu sayılır
  if (r3.rows.length) return [...SAATLER];
  const dolu = new Set(r2.rows.map((r) => r.saat));
  for (const row of r1.rows) {
    const n = row.kisi_sayisi || 1;
    for (let i = 0; i < n; i++) {
      dolu.add(slotEkle(row.saat, i * 30));
    }
  }
  return [...dolu];
}

async function updateStatus(id, durum, iptalEden = null) {
  const res = await pool.query(
    `UPDATE randevular
     SET durum=$1, iptal_eden=COALESCE($2, iptal_eden)
     WHERE id=$3 RETURNING *`,
    [durum, iptalEden, id]
  );
  return res.rows.length ? rowToRandevu(res.rows[0]) : null;
}

async function updateFiyat(id, gercekFiyat) {
  const res = await pool.query(
    "UPDATE randevular SET gercek_fiyat=$1 WHERE id=$2 RETURNING *",
    [gercekFiyat, id]
  );
  return res.rows.length ? rowToRandevu(res.rows[0]) : null;
}

async function updateAciklama(id, aciklama) {
  const res = await pool.query(
    "UPDATE randevular SET aciklama=$1 WHERE id=$2 RETURNING *",
    [aciklama, id]
  );
  return res.rows.length ? rowToRandevu(res.rows[0]) : null;
}

async function updateTarihSaat(id, tarih, saat) {
  const res = await pool.query(
    "UPDATE randevular SET tarih=$1, saat=$2 WHERE id=$3 RETURNING *",
    [tarih, saat, id]
  );
  return res.rows.length ? rowToRandevu(res.rows[0]) : null;
}

async function getTodayAppointments(tarih) {
  const res = await pool.query(
    "SELECT * FROM randevular WHERE tarih=$1 AND durum='onaylı' ORDER BY saat ASC",
    [tarih]
  );
  return res.rows.map(rowToRandevu);
}

// ---------------------------------------------------------------------------
// Kapalı saatler
// ---------------------------------------------------------------------------
async function getKapaliSaatler() {
  const [res, gun] = await Promise.all([
    pool.query("SELECT berber_id, tarih, saat FROM kapali_saatler"),
    pool.query("SELECT berber_id, tarih FROM kapali_gunler"),
  ]);
  const data = {};
  const ekle = (berberId, tarih, saat) => {
    if (!data[berberId])         data[berberId] = {};
    if (!data[berberId][tarih])  data[berberId][tarih] = [];
    if (!data[berberId][tarih].includes(saat)) data[berberId][tarih].push(saat);
  };
  for (const row of res.rows) ekle(row.berber_id, row.tarih, row.saat);
  // Kapalı günleri tüm saatlere genişlet (panelde her hücre kilitli görünür)
  for (const row of gun.rows) for (const s of SAATLER) ekle(row.berber_id, row.tarih, s);
  return data;
}

// Kapalı günler — { berberId: [tarih, ...] }
async function getKapaliGunler() {
  const res  = await pool.query("SELECT berber_id, tarih FROM kapali_gunler");
  const data = {};
  for (const row of res.rows) {
    if (!data[row.berber_id]) data[row.berber_id] = [];
    data[row.berber_id].push(row.tarih);
  }
  return data;
}

async function setKapaliGun(berberId, tarih, kapali) {
  if (kapali) {
    await pool.query(
      "INSERT INTO kapali_gunler (berber_id, tarih) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [berberId, tarih]
    );
  } else {
    await pool.query(
      "DELETE FROM kapali_gunler WHERE berber_id=$1 AND tarih=$2",
      [berberId, tarih]
    );
  }
}

async function getKapaliListByBerber(berberId, tarih) {
  const res = await pool.query(
    "SELECT saat FROM kapali_saatler WHERE berber_id=$1 AND tarih=$2",
    [berberId, tarih]
  );
  return res.rows.map((r) => r.saat);
}

async function setKapaliSaat(berberId, tarih, saat, kapali) {
  if (kapali) {
    await pool.query(
      "INSERT INTO kapali_saatler (berber_id, tarih, saat) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [berberId, tarih, saat]
    );
  } else {
    await pool.query(
      "DELETE FROM kapali_saatler WHERE berber_id=$1 AND tarih=$2 AND saat=$3",
      [berberId, tarih, saat]
    );
  }
}

module.exports = {
  init,
  SlotDoluError,
  getAll,
  add,
  getBusySlots,
  updateStatus,
  updateFiyat,
  updateAciklama,
  updateTarihSaat,
  getTodayAppointments,
  getKapaliSaatler,
  getKapaliListByBerber,
  setKapaliSaat,
  getKapaliGunler,
  setKapaliGun,
};
