require("dotenv").config();

const express = require("express");
const path = require("path");

const db = require("./db");
const { handleMessage } = require("./bot");
const { sendText } = require("./whatsapp");
const { BERBERLER, HIZMETLER, SAATLER } = require("./config");
const sheets = require("./sheets");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ADMIN_PIN = process.env.ADMIN_PIN || "admin123";

// ---------------------------------------------------------------------------
// 1) Webhook doğrulama
// ---------------------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
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
    const msg =
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
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
// 3) Dashboard login (PIN doğrulama)
// ---------------------------------------------------------------------------
app.post("/api/auth", (req, res) => {
  const { berberId, pin, admin } = req.body;
  if (admin) {
    if (pin === ADMIN_PIN) return res.json({ ok: true, role: "admin" });
    return res.status(401).json({ hata: "Yanlış PIN." });
  }
  const berber = BERBERLER.find((b) => b.id === berberId);
  if (!berber) return res.status(404).json({ hata: "Berber bulunamadı." });
  if (berber.pin !== pin) return res.status(401).json({ hata: "Yanlış PIN." });
  return res.json({ ok: true, role: "berber", berberId, ad: berber.ad });
});

// ---------------------------------------------------------------------------
// 4) Berber / hizmet / saat listesi (dashboard için)
// ---------------------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json({ berberler: BERBERLER, hizmetler: HIZMETLER, saatler: SAATLER });
});

// ---------------------------------------------------------------------------
// 5) Tüm randevular
// ---------------------------------------------------------------------------
app.get("/api/randevular", (req, res) => {
  res.json(db.getAll());
});

// ---------------------------------------------------------------------------
// 6) Randevu durumu güncelle (onayla / iptal) + müşteriye bildir
// ---------------------------------------------------------------------------
app.post("/api/randevular/:id/durum", async (req, res) => {
  const { id } = req.params;
  const { durum, iptalEden } = req.body;

  if (!["onaylı", "iptal"].includes(durum)) {
    return res.status(400).json({ hata: "Geçersiz durum." });
  }

  const kayit = db.updateStatus(
    id,
    durum,
    iptalEden || (durum === "iptal" ? "berber" : undefined)
  );
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });

  sheets.updateRandevuDurum(kayit).catch(() => {});

  const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  if (durum === "onaylı") {
    await sendText(
      kayit.telefon,
      "✅ *Randevunuz onaylandı!*\n\n" +
        `💈 Berber: ${kayit.berber}\n` +
        `✂️ Hizmet: ${kayit.hizmet}\n` +
        `📅 Tarih: ${tarih}\n` +
        `⏰ Saat: ${kayit.saat}\n\n` +
        "Sizi bekliyoruz! 🙏"
    );
  } else if (durum === "iptal") {
    await sendText(
      kayit.telefon,
      "❌ *Randevunuz iptal edildi.*\n\n" +
        `💈 Berber: ${kayit.berber}\n` +
        `📅 Tarih: ${tarih} ⏰ ${kayit.saat}\n\n` +
        "Yeni randevu için bize *merhaba* yazabilirsiniz."
    );
  }

  res.json(kayit);
});

// ---------------------------------------------------------------------------
// 7) Randevu fiyatını düzenle (gerçek alınan ücret)
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/fiyat", (req, res) => {
  const { id } = req.params;
  const { gercekFiyat } = req.body;
  if (typeof gercekFiyat !== "number" || gercekFiyat < 0) {
    return res.status(400).json({ hata: "Geçersiz fiyat." });
  }
  const kayit = db.updateFiyat(id, gercekFiyat);
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });
  res.json(kayit);
});

// ---------------------------------------------------------------------------
// 8) Kapalı saatler (berber meşgul / mola)
// ---------------------------------------------------------------------------
app.get("/api/kapali-saatler", (req, res) => {
  res.json(db.getKapaliSaatler());
});

app.post("/api/kapali-saat", (req, res) => {
  const { berberId, tarih, saat, kapali } = req.body;
  if (!berberId || !tarih || !saat) {
    return res.status(400).json({ hata: "Eksik parametre." });
  }
  db.setKapaliSaat(berberId, tarih, saat, kapali !== false);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 9) Google Sheets sıfırdan yeniden senkronla
// ---------------------------------------------------------------------------
app.post("/api/sheets/resync", async (req, res) => {
  if (!sheets.isEnabled()) {
    return res.status(503).json({ hata: "Google Sheets yapılandırılmamış." });
  }
  const sonuc = await sheets.tumunuYenidenSenkronla(db.getAll());
  res.json({ ok: true, ...sonuc });
});

// ---------------------------------------------------------------------------
// 10) Dashboard
// ---------------------------------------------------------------------------
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"));
});
app.get("/", (req, res) => res.redirect("/dashboard"));

const server = app.listen(PORT, () => {
  console.log(`🚀 Berber Randevu Botu çalışıyor: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});

if (sheets.isEnabled()) {
  const arsivCalistir = () =>
    sheets
      .arsivle()
      .then((r) => r.tasinan && console.log(`📦 ${r.tasinan} eski sekme arşivlendi.`))
      .catch(() => {});
  setTimeout(arsivCalistir, 10000).unref();
  setInterval(arsivCalistir, 24 * 60 * 60 * 1000).unref();
}

module.exports = { app, server };
