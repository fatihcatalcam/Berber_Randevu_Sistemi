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

// ---------------------------------------------------------------------------
// 1) Webhook doğrulama (Meta panelinden çağrılır)
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

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  try {
    const msg =
      body.entry &&
      body.entry[0] &&
      body.entry[0].changes &&
      body.entry[0].changes[0] &&
      body.entry[0].changes[0].value &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0];

    if (!msg) {
      return res.sendStatus(200);
    }

    let text = "";
    if (msg.type === "text") {
      text = msg.text.body.trim();
    } else if (
      msg.type === "interactive" &&
      msg.interactive.type === "button_reply"
    ) {
      text = msg.interactive.button_reply.id;
    } else if (
      msg.type === "interactive" &&
      msg.interactive.type === "list_reply"
    ) {
      text = msg.interactive.list_reply.id;
    }

    if (text) {
      await handleMessage(msg.from, text);
    }
  } catch (err) {
    console.error("Webhook işleme hatası:", err.message);
  }

  return res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// 3) Berber/hizmet/saat listesi (dashboard çizelgesi için)
// ---------------------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json({ berberler: BERBERLER, hizmetler: HIZMETLER, saatler: SAATLER });
});

// ---------------------------------------------------------------------------
// 4) Tüm randevular (dashboard için)
// ---------------------------------------------------------------------------
app.get("/api/randevular", (req, res) => {
  res.json(db.getAll());
});

// ---------------------------------------------------------------------------
// 4) Randevu durumu güncelle (onayla / iptal) + müşteriye bildir
// ---------------------------------------------------------------------------
app.post("/api/randevular/:id/durum", async (req, res) => {
  const { id } = req.params;
  const { durum } = req.body;

  if (!["onaylı", "iptal"].includes(durum)) {
    return res.status(400).json({ hata: "Geçersiz durum." });
  }

  const kayit = db.updateStatus(id, durum);
  if (!kayit) {
    return res.status(404).json({ hata: "Randevu bulunamadı." });
  }

  // Google Sheets'te hücre rengini/etiketini güncelle (fire-and-forget)
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
// 4b) Google Sheets'i sıfırdan yeniden senkronla (drift onarımı)
// ---------------------------------------------------------------------------
app.post("/api/sheets/resync", async (req, res) => {
  if (!sheets.isEnabled()) {
    return res.status(503).json({ hata: "Google Sheets yapılandırılmamış." });
  }
  const sonuc = await sheets.tumunuYenidenSenkronla(db.getAll());
  res.json({ ok: true, ...sonuc });
});

// ---------------------------------------------------------------------------
// 5) Dashboard
// ---------------------------------------------------------------------------
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"));
});

// Kök yol -> dashboard'a yönlendir
app.get("/", (req, res) => res.redirect("/dashboard"));

const server = app.listen(PORT, () => {
  console.log(`🚀 Berber Randevu Botu çalışıyor: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});

// Arşivleyici: başlangıçta + her 24 saatte geçmiş günleri arşive taşı
if (sheets.isEnabled()) {
  const arsivCalistir = () =>
    sheets
      .arsivle()
      .then((r) => r.tasinan && console.log(`📦 ${r.tasinan} eski sekme arşivlendi.`))
      .catch(() => {});
  // unref: bu zamanlayıcılar süreç çıkışını engellemesin (testler temiz kapansın)
  setTimeout(arsivCalistir, 10000).unref(); // açılıştan 10 sn sonra
  setInterval(arsivCalistir, 24 * 60 * 60 * 1000).unref(); // her 24 saat
}

// Test'lerin sunucuyu kapatabilmesi için dışa aktar
module.exports = { app, server };
