require("dotenv").config();

const express = require("express");
const path = require("path");

const db = require("./db");
const { handleMessage } = require("./bot");
const { sendText } = require("./whatsapp");
const { BERBERLER, HIZMETLER, SAATLER, ADMIN_PIN } = require("./config");
const sheets = require("./sheets");

const app = express();
app.use(express.json());

const PORT         = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ---------------------------------------------------------------------------
// 1) Webhook doğrulama
// ---------------------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook doğrulandı.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------------------------------------------------------------------------
// 2) Gelen WhatsApp mesajları
// ---------------------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "whatsapp_business_account") return res.sendStatus(404);
  try {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);
    let text = "";
    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive" && msg.interactive.type === "button_reply")
      text = msg.interactive.button_reply.id;
    else if (msg.type === "interactive" && msg.interactive.type === "list_reply")
      text = msg.interactive.list_reply.id;
    if (text) await handleMessage(msg.from, text);
  } catch (err) {
    console.error("Webhook işleme hatası:", err.message);
  }
  return res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// 3) Dashboard login
// ---------------------------------------------------------------------------
app.post("/api/auth", (req, res) => {
  const { berberId, pin, admin } = req.body;
  if (admin) {
    if (pin === ADMIN_PIN) return res.json({ ok: true, role: "admin" });
    return res.status(401).json({ ok: false, hata: "Yanlış PIN." });
  }
  const berber = BERBERLER.find((b) => b.id === berberId);
  if (!berber)          return res.status(404).json({ ok: false, hata: "Berber bulunamadı." });
  if (berber.pin !== pin) return res.status(401).json({ ok: false, hata: "Yanlış PIN." });
  return res.json({ ok: true, role: berber.admin ? "admin" : "berber", berberId, ad: berber.ad });
});

// ---------------------------------------------------------------------------
// 4) Config — PIN alanı gizlenir
// ---------------------------------------------------------------------------
app.get("/api/config", (req, res) => {
  const berberler = BERBERLER.map(({ pin, ...rest }) => rest);
  res.json({ berberler, hizmetler: HIZMETLER, saatler: SAATLER });
});

// ---------------------------------------------------------------------------
// 5) Tüm randevular
// ---------------------------------------------------------------------------
app.get("/api/randevular", async (req, res) => {
  res.json(await db.getAll());
});

// ---------------------------------------------------------------------------
// 6) Randevu durumu güncelle + müşteriye bildir
// ---------------------------------------------------------------------------
app.post("/api/randevular/:id/durum", async (req, res) => {
  const { id } = req.params;
  const { durum, iptalEden } = req.body;

  if (!["onaylı", "iptal"].includes(durum))
    return res.status(400).json({ hata: "Geçersiz durum." });

  const kayit = await db.updateStatus(
    id, durum,
    iptalEden || (durum === "iptal" ? "berber" : undefined)
  );
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });

  sheets.updateRandevuDurum(kayit).catch(() => {});

  const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (durum === "onaylı") {
    await sendText(
      kayit.telefon,
      "✅ *Randevunuz onaylandı!*\n\n" +
        `💈 Berber: ${kayit.berber}\n✂️ Hizmet: ${kayit.hizmet}\n` +
        `📅 Tarih: ${tarih}\n⏰ Saat: ${kayit.saat}\n\nSizi bekliyoruz! 🙏`
    );
  } else if (durum === "iptal") {
    await sendText(
      kayit.telefon,
      "❌ *Randevunuz iptal edildi.*\n\n" +
        `💈 Berber: ${kayit.berber}\n📅 Tarih: ${tarih} ⏰ ${kayit.saat}\n\n` +
        "Yeni randevu için bize *merhaba* yazabilirsiniz."
    );
  }
  res.json(kayit);
});

// ---------------------------------------------------------------------------
// 7) Randevu fiyatı düzenle
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/fiyat", async (req, res) => {
  const { id } = req.params;
  const { gercekFiyat } = req.body;
  if (typeof gercekFiyat !== "number" || gercekFiyat < 0)
    return res.status(400).json({ hata: "Geçersiz fiyat." });
  const kayit = await db.updateFiyat(id, gercekFiyat);
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });
  sheets.updateRandevuDurum(kayit).catch(() => {});
  res.json(kayit);
});

// ---------------------------------------------------------------------------
// 8) Randevu taşı (farklı tarih/saat)
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/tasi", async (req, res) => {
  const { id } = req.params;
  const { tarih, saat } = req.body;
  if (!tarih || !saat) return res.status(400).json({ hata: "Eksik parametre." });

  const tumRandevular = await db.getAll();
  const kayit = tumRandevular.find((r) => r.id === id);
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });

  const dolu = await db.getBusySlots(kayit.berberId, tarih);
  // Aynı randevunun eski slotunu meşgul saymamak için çıkar
  const doluFiltered = dolu.filter(
    (s) => !(tarih === kayit.tarih && s === kayit.saat)
  );
  if (doluFiltered.includes(saat))
    return res.status(409).json({ hata: "Seçilen saat dolu." });

  const eskiTarih = kayit.tarih;
  const eskiSaat  = kayit.saat;
  const guncellenen = await db.updateTarihSaat(id, tarih, saat);
  if (!guncellenen) return res.status(404).json({ hata: "Güncelleme başarısız." });

  sheets.clearRandevuCell(kayit.berberId, eskiTarih, eskiSaat, kayit.kisiSayisi || 1).catch(() => {});
  sheets.syncRandevu(guncellenen).catch(() => {});

  const tarihStr = new Date(tarih + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long", day: "numeric", month: "long",
  });
  await sendText(
    guncellenen.telefon,
    `📅 *Randevunuz güncellendi!*\n\n💈 ${guncellenen.berber}\n✂️ ${guncellenen.hizmet}\n` +
    `📅 ${tarihStr} ⏰ ${saat}\n\nGörüşürüz! 🙏`
  );
  res.json(guncellenen);
});

// ---------------------------------------------------------------------------
// 9) Randevu açıklaması (berber notu)
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/aciklama", async (req, res) => {
  const { id } = req.params;
  const { aciklama } = req.body;
  if (typeof aciklama !== "string") return res.status(400).json({ hata: "Geçersiz açıklama." });
  const kayit = await db.updateAciklama(id, aciklama.trim());
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });
  res.json(kayit);
});

// ---------------------------------------------------------------------------
// 10) Kapalı saatler
// ---------------------------------------------------------------------------
app.get("/api/kapali-saatler", async (req, res) => {
  res.json(await db.getKapaliSaatler());
});

app.post("/api/kapali-saat", async (req, res) => {
  const { berberId, tarih, saat, kapali } = req.body;
  if (!berberId || !tarih || !saat)
    return res.status(400).json({ hata: "Eksik parametre." });
  await db.setKapaliSaat(berberId, tarih, saat, kapali !== false);
  sheets.syncKapaliSaat(berberId, tarih, saat, kapali !== false).catch(() => {});
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 9) Google Sheets yeniden senkronla
// ---------------------------------------------------------------------------
app.post("/api/sheets/resync", async (req, res) => {
  if (!sheets.isEnabled())
    return res.status(503).json({ hata: "Google Sheets yapılandırılmamış." });
  const sonuc = await sheets.tumunuYenidenSenkronla(await db.getAll());
  res.json({ ok: true, ...sonuc });
});

// ---------------------------------------------------------------------------
// 10) Dashboard
// ---------------------------------------------------------------------------
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));
app.get("/dashboard", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"))
);
app.get("/", (req, res) => res.redirect("/dashboard"));

// ---------------------------------------------------------------------------
// Başlat
// ---------------------------------------------------------------------------

// Sunucu hemen başlar (test uyumluluğu için sync)
const server = app.listen(PORT, () => {
  console.log(`🚀 Berber Randevu Botu çalışıyor: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});

// DB tabloları arka planda oluştur
db.init().catch((err) => {
  console.error("❌ Veritabanı başlatma hatası:", err.message);
  if (process.env.NODE_ENV !== "test") process.exit(1);
});

// ---------------------------------------------------------------------------
// Sabah hatırlatma (08:00 — o günkü onaylı randevulara WhatsApp mesajı)
// ---------------------------------------------------------------------------
function hatirlatmaMsKalan() {
  const now  = new Date();
  const hedef = new Date(now);
  hedef.setHours(8, 0, 0, 0);
  if (hedef <= now) hedef.setDate(hedef.getDate() + 1);
  return hedef - now;
}

async function hatirlatmaGonder() {
  const bugun = new Date();
  const tarih = `${bugun.getFullYear()}-${String(bugun.getMonth()+1).padStart(2,"0")}-${String(bugun.getDate()).padStart(2,"0")}`;
  try {
    const liste = await db.getTodayAppointments(tarih);
    const gunLabel = bugun.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
    for (const r of liste) {
      await sendText(
        r.telefon,
        `⏰ *Randevu Hatırlatması!*\n\nBugün randevunuz var:\n\n💈 ${r.berber}\n✂️ ${r.hizmet}\n📅 ${gunLabel} ⏰ ${r.saat}\n\nSizi bekliyoruz! 🙏`
      );
    }
    if (liste.length) console.log(`📬 ${liste.length} hatırlatma mesajı gönderildi.`);
  } catch (e) {
    console.error("Hatırlatma hatası:", e.message);
  }
  setTimeout(hatirlatmaGonder, hatirlatmaMsKalan()).unref();
}

setTimeout(hatirlatmaGonder, hatirlatmaMsKalan()).unref();

// Google Sheets arşivleyici
if (sheets.isEnabled()) {
  const arsivCalistir = () =>
    sheets.arsivle()
      .then((r) => r.tasinan && console.log(`📦 ${r.tasinan} eski sekme arşivlendi.`))
      .catch(() => {});
  setTimeout(arsivCalistir, 10000).unref();
  setInterval(arsivCalistir, 24 * 60 * 60 * 1000).unref();
}

module.exports = { app, server };
