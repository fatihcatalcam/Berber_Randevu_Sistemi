// ---------------------------------------------------------------------------
// DEMO kurulumu (DEMO=true) — randevu.catalcamyazilim.online
//   - Sayfalar dükkân adı/logo/adres değiştirilerek gönderilir, analitik çıkar,
//     demo arayüzü (src/demo/arayuz) eklenir.
//   - SMS gönderilmez: istek sırasında "gidecek" SMS'ler yanıta demoSms olarak
//     eklenir, sayfa bunları ekranda gösterir.
//   - Her gece 03:00'te veriler silinip demo randevuları yüklenir.
//   - Render'ın ücretsiz planı 15 dk istek gelmeyince uyur; 10 dk'da bir kendi
//     /saglik adresine istek atılır. /saglik veritabanına dokunmaz, Neon uyuyabilir.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const express = require("express");
const { DUKKAN, GERCEK_DUKKAN, BERBERLER } = require("../config");
const db = require("../db");
const sms = require("../sms");
const { bugunStr, gunEkle } = require("../randevu-yardimci");
const { demoRandevulari, SABITLER } = require("./veri");

const KOK = path.join(__dirname, "..", "..");
const SIFIRLAMA_SAATI = 3;

// Sayfayı demo dükkânına çevirir. Gerçek sayfalardaki sabit yazılar
// (GERCEK_DUKKAN) burada değişir; dosyaların kendisine dokunulmaz.
function demoSayfasi(dosya, sayfa) {
  let html = fs.readFileSync(path.join(KOK, dosya), "utf8");
  html = html.replace(/<!-- analitik -->[\s\S]*?<!-- \/analitik -->/, "");
  // Gerçek dükkânın "Randevu sistemi: Çatalçam Yazılım" satırı demoda yok (orada demo alt yazısı var)
  html = html.replace(/<!-- imza -->[\s\S]*?<!-- \/imza -->/, "");
  html = html.split(GERCEK_DUKKAN.ad).join(DUKKAN.ad);
  html = html.split(GERCEK_DUKKAN.adres).join(DUKKAN.adres);
  html = html.split(`tel:+${GERCEK_DUKKAN.telefon}`).join(`tel:+${DUKKAN.telefon}`);
  html = html.replace(/src="(\/dashboard\/)?logo\.jpg"/g, `src="${DUKKAN.logo}"`);
  const ayar = { sayfa, dukkan: DUKKAN.ad, instagram: DUKKAN.instagram, sifirlamaSaati: SIFIRLAMA_SAATI };
  const ek = `<meta name="robots" content="noindex">
<link rel="stylesheet" href="/demo/demo.css">
<script>window.DEMO = ${JSON.stringify(ayar)};</script>
<script src="/demo/demo.js" defer></script>
</head>`;
  return html.replace("</head>", ek);
}

// Uygulamanın rotalarından ÖNCE çağrılır (statik dosyalar ve /api ondan sonra).
function kur(app) {
  const sayfalar = {
    randevu: demoSayfasi("public-booking/index.html", "randevu"),
    panel:   demoSayfasi("dashboard/index.html", "panel"),
    ciro:    demoSayfasi("dashboard/ciro.html", "ciro"),
  };
  const gonder = (ad) => (req, res) => res.set("Cache-Control", "no-cache").type("html").send(sayfalar[ad]);
  app.get(["/randevu-al", "/randevu-al/index.html"], gonder("randevu"));
  app.get(["/dashboard", "/dashboard/index.html"], gonder("panel"));
  app.get(["/dashboard/ciro", "/dashboard/ciro.html"], gonder("ciro"));
  app.use("/demo", express.static(path.join(__dirname, "arayuz")));
  app.get("/saglik", (req, res) => res.type("text").send("ok"));

  // Bu istek sırasında "gönderilen" SMS'ler yanıta eklenir
  app.use("/api", (req, res, next) => {
    const kutu = [];
    const json = res.json.bind(res);
    res.json = (govde) => json(kutu.length && govde && typeof govde === "object" && !Array.isArray(govde)
      ? { ...govde, demoSms: kutu } : govde);
    sms.demoSmsKutusu.run(kutu, next);
  });
}

function simdiSaat() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Sıfırlama günü 03:00'te değişir: 02:59'da hâlâ "dün"ün sıfırlaması geçerli
function sifirlamaGunu() {
  const d = new Date();
  return d.getHours() < SIFIRLAMA_SAATI ? gunEkle(bugunStr(), -1) : bugunStr();
}

async function sifirla(gun, sabitUret) {
  const randevular = demoRandevulari(bugunStr(), simdiSaat());
  await db.demoSifirla(randevular, gun);
  for (const s of SABITLER) {
    const berber = BERBERLER.find((b) => b.id === s.berberId);
    const kural = await db.sabitEkle({ ...s, fiyat: berber.fiyat[s.hizmetId], baslangic: bugunStr() });
    await sabitUret(kural);
  }
  console.log(`🧹 Demo sıfırlandı (${gun}): ${randevular.length} randevu, ${SABITLER.length} sabit müşteri.`);
}

// db.init() bittikten sonra çağrılır. Gün değişmedikçe veritabanına gitmez.
function baslat({ sabitUret }) {
  let sonSifirlama = null;
  const kontrol = async () => {
    const gun = sifirlamaGunu();
    if (gun === sonSifirlama) return;
    try {
      if (sonSifirlama === null && (await db.demoSonSifirlama()) === gun) { sonSifirlama = gun; return; }
      await sifirla(gun, sabitUret);
      sonSifirlama = gun;
    } catch (e) {
      console.error("Demo sıfırlama hatası:", e.message);
    }
  };
  kontrol();
  setInterval(kontrol, 10 * 60 * 1000).unref();

  // Render, servisin dış adresini RENDER_EXTERNAL_URL olarak verir
  const dis = process.env.RENDER_EXTERNAL_URL;
  if (dis) setInterval(() => fetch(`${dis}/saglik`).catch(() => {}), 10 * 60 * 1000).unref();
}

module.exports = { kur, baslat, sifirla, sifirlamaGunu };
