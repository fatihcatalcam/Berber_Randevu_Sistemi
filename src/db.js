const { Pool } = require("pg");

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
  console.log("✅ Veritabanı tabloları hazır.");
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
      "bekliyor",
      randevu.kisiSayisi || null,
      randevu.kisiler    ? JSON.stringify(randevu.kisiler) : null,
      olusturulma,
    ]
  );
  return { ...randevu, id, olusturulma, durum: "bekliyor" };
}

async function getBusySlots(berberId, tarih) {
  const [r1, r2] = await Promise.all([
    pool.query(
      "SELECT saat FROM randevular WHERE berber_id=$1 AND tarih=$2 AND durum!='iptal'",
      [berberId, tarih]
    ),
    pool.query(
      "SELECT saat FROM kapali_saatler WHERE berber_id=$1 AND tarih=$2",
      [berberId, tarih]
    ),
  ]);
  return [...new Set([...r1.rows.map((r) => r.saat), ...r2.rows.map((r) => r.saat)])];
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

// ---------------------------------------------------------------------------
// Kapalı saatler
// ---------------------------------------------------------------------------
async function getKapaliSaatler() {
  const res  = await pool.query("SELECT berber_id, tarih, saat FROM kapali_saatler");
  const data = {};
  for (const row of res.rows) {
    if (!data[row.berber_id])              data[row.berber_id] = {};
    if (!data[row.berber_id][row.tarih])   data[row.berber_id][row.tarih] = [];
    data[row.berber_id][row.tarih].push(row.saat);
  }
  return data;
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
  getAll,
  add,
  getBusySlots,
  updateStatus,
  updateFiyat,
  getKapaliSaatler,
  getKapaliListByBerber,
  setKapaliSaat,
};
