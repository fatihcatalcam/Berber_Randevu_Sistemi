const db = require("./db");
const { BERBERLER, HIZMETLER, SAATLER, gelecekTarihler } = require("./config");
const { sendText, sendButtons, sendList } = require("./whatsapp");
const sheets = require("./sheets");

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function bul(arr, id) {
  return arr.find((x) => x.id === id);
}

// ---------------------------------------------------------------------------
// Oturum yönetimi
// ---------------------------------------------------------------------------

const sessions = {};

function resetSession(telefon) {
  sessions[telefon] = { adim: "baslangic", veri: {} };
  return sessions[telefon];
}

function getSession(telefon) {
  if (!sessions[telefon]) resetSession(telefon);
  return sessions[telefon];
}

// ---------------------------------------------------------------------------
// Konuşma akışı
// ---------------------------------------------------------------------------

const SELAMLAR = ["merhaba", "selam", "başla", "basla", "hi", "hello"];

async function handleMessage(telefon, metin) {
  const ham = (metin || "").trim();
  const kucuk = ham.toLowerCase();
  let s = getSession(telefon);

  // Selamlama / baştan başlatma her adımda çalışır
  if (s.adim === "baslangic" || SELAMLAR.includes(kucuk)) {
    s = resetSession(telefon);
    await sendButtons(
      telefon,
      "Merhaba! Berber Randevu Sistemi'ne hoş geldiniz.\n\nNe yapmak istersiniz?",
      [
        { id: "yeni_randevu", title: "📅 Randevu Al" },
        { id: "randevu_sorgula", title: "🔍 Randevum" },
      ]
    );
    s.adim = "menu";
    return;
  }

  switch (s.adim) {
    case "menu":
      return adimMenu(telefon, ham, s);
    case "ad_bekle":
      return adimAd(telefon, ham, s);
    case "berber_bekle":
      return adimBerber(telefon, ham, s);
    case "hizmet_bekle":
      return adimHizmet(telefon, ham, s);
    case "tarih_bekle":
      return adimTarih(telefon, ham, s);
    case "saat_bekle":
      return adimSaat(telefon, ham, s);
    case "onay_bekle":
      return adimOnay(telefon, ham, s);
    default:
      return bilinmeyen(telefon);
  }
}

// --- Adım: menu -----------------------------------------------------------
async function adimMenu(telefon, metin, s) {
  if (metin === "yeni_randevu") {
    await sendText(telefon, "Lütfen *ad ve soyadınızı* yazın:");
    s.adim = "ad_bekle";
    return;
  }

  if (metin === "randevu_sorgula") {
    const kayitlar = db
      .getAll()
      .filter((r) => r.telefon === telefon)
      .slice(0, 5);

    if (kayitlar.length === 0) {
      await sendText(
        telefon,
        "Kayıtlı randevunuz bulunamadı. Yeni randevu için *merhaba* yazabilirsiniz."
      );
    } else {
      const satirlar = kayitlar
        .map((r) => {
          const tarih = new Date(r.tarih + "T00:00:00").toLocaleDateString(
            "tr-TR",
            { weekday: "long", day: "numeric", month: "long" }
          );
          return (
            `🔖 No: ${r.id.slice(-6)}\n` +
            `💈 ${r.berber} — ${r.hizmet}\n` +
            `📅 ${tarih} ⏰ ${r.saat}\n` +
            `📌 Durum: ${durumEtiketi(r.durum)}`
          );
        })
        .join("\n\n———————————\n\n");

      await sendText(telefon, `*Randevularınız:*\n\n${satirlar}`);
    }
    resetSession(telefon);
    return;
  }

  return bilinmeyen(telefon);
}

// --- Adım: ad_bekle -------------------------------------------------------
async function adimAd(telefon, metin, s) {
  if (metin.length < 3) {
    await sendText(telefon, "Lütfen geçerli bir ad soyad girin (en az 3 karakter).");
    return;
  }

  s.veri.ad = metin;
  s.veri.telefon = telefon;

  await sendButtons(
    telefon,
    `Teşekkürler ${metin}! 💈\n\nHangi berberle randevu almak istersiniz?`,
    BERBERLER.map((b) => ({
      id: `berber_${b.id}`,
      title: b.ad,
    }))
  );
  s.adim = "berber_bekle";
}

// --- Adım: berber_bekle ---------------------------------------------------
async function adimBerber(telefon, metin, s) {
  if (!metin.startsWith("berber_")) return bilinmeyen(telefon);

  const berberId = metin.replace("berber_", "");
  const berber = bul(BERBERLER, berberId);
  if (!berber) return bilinmeyen(telefon);

  s.veri.berberId = berber.id;
  s.veri.berber = berber.ad;

  const rows = HIZMETLER.map((h) => ({
    id: `hizmet_${h.id}`,
    title: h.ad,
    description: `${h.sure} • ${berber.fiyat[h.id]}₺`,
  }));

  await sendList(
    telefon,
    `*${berber.ad}* (${berber.uzmanlik})\n\nHangi hizmeti istersiniz?`,
    "Hizmet Seç",
    [{ title: "Hizmetler", rows }]
  );
  s.adim = "hizmet_bekle";
}

// --- Adım: hizmet_bekle ---------------------------------------------------
async function adimHizmet(telefon, metin, s) {
  if (!metin.startsWith("hizmet_")) return bilinmeyen(telefon);

  const hizmetId = metin.replace("hizmet_", "");
  const hizmet = bul(HIZMETLER, hizmetId);
  if (!hizmet) return bilinmeyen(telefon);

  s.veri.hizmetId = hizmet.id;
  s.veri.hizmet = hizmet.ad;

  return tarihListesiGonder(telefon, s);
}

async function tarihListesiGonder(telefon, s) {
  const rows = gelecekTarihler(7).map((t) => ({
    id: `tarih_${t.deger}`,
    title: t.etiket.length > 24 ? t.etiket.slice(0, 24) : t.etiket,
  }));

  await sendList(
    telefon,
    "Hangi gün için randevu almak istersiniz?",
    "Tarih Seç",
    [{ title: "Önümüzdeki 7 gün", rows }]
  );
  s.adim = "tarih_bekle";
}

// --- Adım: tarih_bekle ----------------------------------------------------
async function adimTarih(telefon, metin, s) {
  if (!metin.startsWith("tarih_")) return bilinmeyen(telefon);

  const tarih = metin.replace("tarih_", "");
  s.veri.tarih = tarih;

  const dolu = db.getBusySlots(s.veri.berberId, tarih);
  const bos = SAATLER.filter((saat) => !dolu.includes(saat));

  if (bos.length === 0) {
    await sendText(
      telefon,
      "😔 Bu gün için boş saat kalmamış. Lütfen başka bir gün seçin."
    );
    return tarihListesiGonder(telefon, s);
  }

  const rows = bos.slice(0, 10).map((saat) => ({
    id: `saat_${saat}`,
    title: saat,
  }));

  await sendList(
    telefon,
    "Uygun saatlerden birini seçin:",
    "Saat Seç",
    [{ title: "Boş saatler", rows }]
  );
  s.adim = "saat_bekle";
}

// --- Adım: saat_bekle -----------------------------------------------------
async function adimSaat(telefon, metin, s) {
  if (!metin.startsWith("saat_")) return bilinmeyen(telefon);

  const saat = metin.replace("saat_", "");
  s.veri.saat = saat;

  const berber = bul(BERBERLER, s.veri.berberId);
  const fiyat = berber.fiyat[s.veri.hizmetId];
  s.veri.fiyat = fiyat;

  const tarih = new Date(s.veri.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const ozet =
    "*Randevu Özeti*\n\n" +
    `👤 Ad: ${s.veri.ad}\n` +
    `💈 Berber: ${s.veri.berber}\n` +
    `✂️ Hizmet: ${s.veri.hizmet}\n` +
    `📅 Tarih: ${tarih}\n` +
    `⏰ Saat: ${saat}\n` +
    `💰 Ücret: ${fiyat}₺\n\n` +
    "Onaylıyor musunuz?";

  await sendButtons(telefon, ozet, [
    { id: "onayla", title: "✅ Onayla" },
    { id: "iptal_et", title: "❌ İptal" },
  ]);
  s.adim = "onay_bekle";
}

// --- Adım: onay_bekle -----------------------------------------------------
async function adimOnay(telefon, metin, s) {
  if (metin === "onayla") {
    const kayit = db.add({
      ad: s.veri.ad,
      telefon: s.veri.telefon,
      berberId: s.veri.berberId,
      berber: s.veri.berber,
      hizmetId: s.veri.hizmetId,
      hizmet: s.veri.hizmet,
      tarih: s.veri.tarih,
      saat: s.veri.saat,
      fiyat: s.veri.fiyat,
    });

    // Google Sheets'e canlı yaz (fire-and-forget — hata bot'u durdurmaz)
    sheets.syncRandevu(kayit).catch(() => {});

    const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString(
      "tr-TR",
      { weekday: "long", day: "numeric", month: "long" }
    );

    await sendText(
      telefon,
      "🎉 *Randevunuz alındı!*\n\n" +
        `🔖 Randevu No: *${kayit.id.slice(-6)}*\n` +
        `💈 ${kayit.berber} — ${kayit.hizmet}\n` +
        `📅 ${tarih} ⏰ ${kayit.saat}\n\n` +
        "Randevunuz berber onayına gönderildi. Onaylandığında size haber vereceğiz. Teşekkürler! 🙏"
    );
    resetSession(telefon);
    return;
  }

  if (metin === "iptal_et") {
    await sendButtons(
      telefon,
      "Randevu işlemi iptal edildi. ❌\n\nDilerseniz yeni bir randevu oluşturabilirsiniz.",
      [{ id: "yeni_randevu", title: "📅 Yeni Randevu" }]
    );
    s.adim = "menu";
    return;
  }

  return bilinmeyen(telefon);
}

// --- Yardımcı: bilinmeyen mesaj -------------------------------------------
async function bilinmeyen(telefon) {
  await sendButtons(
    telefon,
    "Anlayamadım. 🤔 Lütfen aşağıdaki seçeneklerden birini kullanın:",
    [
      { id: "yeni_randevu", title: "📅 Randevu Al" },
      { id: "randevu_sorgula", title: "🔍 Randevum" },
    ]
  );
  const s = getSession(telefon);
  s.adim = "menu";
}

function durumEtiketi(durum) {
  if (durum === "onaylı") return "✅ Onaylandı";
  if (durum === "iptal") return "❌ İptal";
  return "⏳ Bekliyor";
}

module.exports = { handleMessage };
