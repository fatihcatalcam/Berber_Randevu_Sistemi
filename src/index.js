require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const db = require("./db");
const { handleMessage } = require("./bot");
const { sendText } = require("./whatsapp");
const { BERBERLER, HIZMETLER, SAATLER, SAATLER_45, ADMIN_PIN } = require("./config");
const sheets = require("./sheets");

const app = express();
// Webhook imza doğrulaması için ham gövdeyi sakla
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// API yanıtları önbelleğe alınmasın (mobil tarayıcı eski/boş veriyi cache'lemesin)
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

const PORT         = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET   = process.env.APP_SECRET; // Meta App Secret (webhook imzası)

// ---------------------------------------------------------------------------
// Oturum token'ları (bellek içi) — sunucu yeniden başlayınca sıfırlanır
// ---------------------------------------------------------------------------
const tokens = new Map(); // token -> { role, berberId, ad, olusturulma }
const TOKEN_OMUR_MS = 12 * 60 * 60 * 1000; // 12 saat

function tokenUret(bilgi) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, { ...bilgi, olusturulma: Date.now() });
  return token;
}

// Süresi dolan token'ları periyodik temizle
setInterval(() => {
  const simdi = Date.now();
  for (const [t, v] of tokens) {
    if (simdi - v.olusturulma > TOKEN_OMUR_MS) tokens.delete(t);
  }
}, 60 * 60 * 1000).unref();

// Async route sarmalayıcı — reddedilen promise'leri yakalar (sunucu çökmesin)
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Korumalı uçlar için kimlik doğrulama middleware'i
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  const bilgi  = token && tokens.get(token);
  if (!bilgi || Date.now() - bilgi.olusturulma > TOKEN_OMUR_MS) {
    if (token) tokens.delete(token);
    return res.status(401).json({ hata: "Yetkisiz. Lütfen tekrar giriş yapın." });
  }
  req.auth = bilgi;
  next();
}

// Webhook imza doğrulama (APP_SECRET yoksa atlanır — yerel geliştirme için)
function webhookImzaGecerli(req) {
  if (!APP_SECRET) return true; // imza kontrolü devre dışı
  const imza = req.headers["x-hub-signature-256"];
  if (!imza || !req.rawBody) return false;
  const beklenen = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
  const a = Buffer.from(imza);
  const b = Buffer.from(beklenen);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Webhook idempotency — aynı mesaj iki kez işlenmesin
const islenenMesajlar = new Set();
const ISLENEN_MAX = 1000;
function mesajDahaOnceIslendi(id) {
  if (!id) return false;
  if (islenenMesajlar.has(id)) return true;
  islenenMesajlar.add(id);
  if (islenenMesajlar.size > ISLENEN_MAX) {
    // En eski kayıtları at (Set ekleme sırasını korur)
    const ilk = islenenMesajlar.values().next().value;
    islenenMesajlar.delete(ilk);
  }
  return false;
}

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
  if (!webhookImzaGecerli(req)) {
    console.warn("⚠️  Geçersiz webhook imzası — istek reddedildi.");
    return res.sendStatus(403);
  }
  const body = req.body;
  if (body.object !== "whatsapp_business_account") return res.sendStatus(404);
  try {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);
    if (mesajDahaOnceIslendi(msg.id)) return res.sendStatus(200); // tekrarı atla
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
    if (pin === ADMIN_PIN) {
      const token = tokenUret({ role: "admin", berberId: null, ad: "Admin" });
      return res.json({ ok: true, role: "admin", token });
    }
    return res.status(401).json({ ok: false, hata: "Yanlış PIN." });
  }
  const berber = BERBERLER.find((b) => b.id === berberId);
  if (!berber)          return res.status(404).json({ ok: false, hata: "Berber bulunamadı." });
  if (berber.pin !== pin) return res.status(401).json({ ok: false, hata: "Yanlış PIN." });
  const role  = berber.admin ? "admin" : "berber";
  const token = tokenUret({ role, berberId, ad: berber.ad });
  return res.json({ ok: true, role, berberId, ad: berber.ad, token });
});

// ---------------------------------------------------------------------------
// 4) Config — PIN alanı gizlenir
// ---------------------------------------------------------------------------
app.get("/api/config", (req, res) => {
  const berberler = BERBERLER.map(({ pin, ...rest }) => rest);
  res.json({ berberler, hizmetler: HIZMETLER, saatler: SAATLER, saatler45: SAATLER_45 });
});

// ---------------------------------------------------------------------------
// 5) Tüm randevular
// ---------------------------------------------------------------------------
app.get("/api/randevular", requireAuth, ah(async (req, res) => {
  res.json(await db.getAll());
}));

// ---------------------------------------------------------------------------
// 5b) Elle (manuel) randevu ekle — direkt onaylı olarak kaydedilir
// ---------------------------------------------------------------------------
app.post("/api/randevular", requireAuth, ah(async (req, res) => {
  const { ad, telefon, berberId, hizmetId, tarih, saat, fiyat } = req.body;
  if (!ad || !berberId || !hizmetId || !tarih || !saat)
    return res.status(400).json({ hata: "Eksik parametre." });

  const berber = BERBERLER.find((b) => b.id === berberId);
  const hizmet = HIZMETLER.find((h) => h.id === hizmetId);
  if (!berber || !hizmet) return res.status(400).json({ hata: "Geçersiz berber veya hizmet." });

  const dolu = await db.getBusySlots(berberId, tarih);
  if (dolu.includes(saat)) return res.status(409).json({ hata: "Seçilen saat dolu." });

  try {
    const kayit = await db.add({
      ad, telefon: telefon || "",
      berberId, berber: berber.ad,
      hizmetId, hizmet: hizmet.ad,
      tarih, saat,
      fiyat: typeof fiyat === "number" ? fiyat : berber.fiyat[hizmetId],
      durum: "onaylı", // elle eklenen randevu direkt onaylı
    });
    sheets.syncRandevu(kayit).catch(() => {});
    sheets.musteriKaydet(kayit).catch(() => {});
    res.status(201).json(kayit);
  } catch (e) {
    if (e.code === "SLOT_DOLU") return res.status(409).json({ hata: "Seçilen saat dolu." });
    throw e;
  }
}));

// ---------------------------------------------------------------------------
// 6) Randevu durumu güncelle + müşteriye bildir
// ---------------------------------------------------------------------------
app.post("/api/randevular/:id/durum", requireAuth, ah(async (req, res) => {
  const { id } = req.params;
  const { durum, iptalEden } = req.body;

  if (!["onaylı", "iptal", "gelmedi"].includes(durum))
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
}));

// ---------------------------------------------------------------------------
// 7) Randevu fiyatı düzenle
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/fiyat", requireAuth, ah(async (req, res) => {
  const { id } = req.params;
  const { gercekFiyat } = req.body;
  if (typeof gercekFiyat !== "number" || gercekFiyat < 0)
    return res.status(400).json({ hata: "Geçersiz fiyat." });
  const kayit = await db.updateFiyat(id, gercekFiyat);
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });
  sheets.updateRandevuDurum(kayit).catch(() => {});
  res.json(kayit);
}));

// ---------------------------------------------------------------------------
// 8) Randevu taşı (farklı tarih/saat)
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/tasi", requireAuth, ah(async (req, res) => {
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
}));

// ---------------------------------------------------------------------------
// 9) Randevu açıklaması (berber notu)
// ---------------------------------------------------------------------------
app.patch("/api/randevular/:id/aciklama", requireAuth, ah(async (req, res) => {
  const { id } = req.params;
  const { aciklama } = req.body;
  if (typeof aciklama !== "string") return res.status(400).json({ hata: "Geçersiz açıklama." });
  const kayit = await db.updateAciklama(id, aciklama.trim());
  if (!kayit) return res.status(404).json({ hata: "Randevu bulunamadı." });
  res.json(kayit);
}));

// ---------------------------------------------------------------------------
// 10) Kapalı saatler
// ---------------------------------------------------------------------------
app.get("/api/kapali-saatler", requireAuth, ah(async (req, res) => {
  res.json(await db.getKapaliSaatler());
}));

app.post("/api/kapali-saat", requireAuth, ah(async (req, res) => {
  const { berberId, tarih, saat, kapali } = req.body;
  if (!berberId || !tarih || !saat)
    return res.status(400).json({ hata: "Eksik parametre." });
  await db.setKapaliSaat(berberId, tarih, saat, kapali !== false);
  sheets.syncKapaliSaat(berberId, tarih, saat, kapali !== false).catch(() => {});
  res.json({ ok: true });
}));

// Tüm günü kapat/aç (berber izinli/hasta vb.)
app.get("/api/kapali-gunler", requireAuth, ah(async (req, res) => {
  res.json(await db.getKapaliGunler());
}));

app.post("/api/kapali-gun", requireAuth, ah(async (req, res) => {
  const { berberId, tarih, kapali } = req.body;
  if (!berberId || !tarih)
    return res.status(400).json({ hata: "Eksik parametre." });
  await db.setKapaliGun(berberId, tarih, kapali !== false);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// 11) Google Sheets yeniden senkronla
// ---------------------------------------------------------------------------
app.post("/api/sheets/resync", requireAuth, ah(async (req, res) => {
  if (!sheets.isEnabled())
    return res.status(503).json({ hata: "Google Sheets yapılandırılmamış." });
  const sonuc = await sheets.tumunuYenidenSenkronla(await db.getAll());
  res.json({ ok: true, ...sonuc });
}));

// ---------------------------------------------------------------------------
// 10) Dashboard
// ---------------------------------------------------------------------------
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.set("Cache-Control", "no-cache");
  },
}));
app.get("/dashboard", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"));
});
app.get("/", (req, res) => res.redirect("/dashboard"));

// ---------------------------------------------------------------------------
// Genel hata yakalayıcı — async route hataları buraya düşer (sunucu çökmez)
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error("API hatası:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ hata: "Sunucu hatası." });
});

// Beklenmeyen reddedilen promise'ler süreci öldürmesin (son güvenlik ağı)
process.on("unhandledRejection", (sebep) => {
  console.error("İşlenmeyen promise reddi:", sebep);
});

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
// Hatırlatma: randevudan ~1 saat önce müşteriye WhatsApp mesajı
// Her 5 dakikada kontrol eder; kalan süre <= 60 dk olunca bir kez gönderir.
// ---------------------------------------------------------------------------
function saatToDk(saat) {
  const [h, m] = saat.split(":").map(Number);
  return h * 60 + m;
}

async function hatirlatmaKontrol() {
  try {
    const now   = new Date();
    const tarih = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const simdiDk = now.getHours() * 60 + now.getMinutes();
    const liste = await db.getHatirlatilacaklar(tarih);
    const gunLabel = now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

    for (const r of liste) {
      const kalan = saatToDk(r.saat) - simdiDk;
      if (kalan > 0 && kalan <= 60) {
        await sendText(
          r.telefon,
          `⏰ *Randevu Hatırlatması!*\n\nYaklaşık 1 saat sonra randevunuz var:\n\n💈 ${r.berber}\n✂️ ${r.hizmet}\n📅 ${gunLabel} ⏰ ${r.saat}\n\nSizi bekliyoruz! 🙏`
        );
        await db.markHatirlatildi(r.id);
      }
    }
  } catch (e) {
    console.error("Hatırlatma hatası:", e.message);
  }
}

setInterval(hatirlatmaKontrol, 5 * 60 * 1000).unref();
setTimeout(hatirlatmaKontrol, 15000).unref();

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
