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

  // Selamlama → her adımda sıfırla
  if (s.adim === "baslangic" || SELAMLAR.includes(kucuk)) {
    s = resetSession(telefon);
    await sendButtons(
      telefon,
      "Merhaba! Berber Randevu Sistemi'ne hoş geldiniz.\n\nNe yapmak istersiniz?",
      [
        { id: "yeni_randevu",    title: "📅 Randevu Al" },
        { id: "randevu_sorgula", title: "🔍 Randevum" },
      ]
    );
    s.adim = "menu";
    return;
  }

  switch (s.adim) {
    case "menu":              return adimMenu(telefon, ham, s);
    case "ad_bekle":          return adimAd(telefon, ham, s);
    case "kisi_sayisi_bekle": return adimKisiSayisi(telefon, ham, s);
    case "berber_bekle":      return adimBerber(telefon, ham, s);
    case "kisi_hizmet_bekle": return adimKisiHizmet(telefon, ham, s);
    case "tarih_bekle":       return adimTarih(telefon, ham, s);
    case "saat_bekle":        return adimSaat(telefon, ham, s);
    case "onay_bekle":        return adimOnay(telefon, ham, s);
    case "iptal_sec_bekle":   return adimIptalSec(telefon, ham, s);
    case "iptal_onay_bekle":  return adimIptalOnay(telefon, ham, s);
    default:                  return bilinmeyen(telefon);
  }
}

// ---------------------------------------------------------------------------
// Adım: menu
// ---------------------------------------------------------------------------
async function adimMenu(telefon, metin, s) {
  if (metin === "yeni_randevu") {
    await sendText(telefon, "Lütfen *ad ve soyadınızı* yazın:");
    s.adim = "ad_bekle";
    return;
  }

  if (metin === "randevu_sorgula") {
    const kayitlar = db.getAll().filter((r) => r.telefon === telefon).slice(0, 5);

    if (kayitlar.length === 0) {
      await sendText(
        telefon,
        "Kayıtlı randevunuz bulunamadı. Yeni randevu için *merhaba* yazabilirsiniz."
      );
      resetSession(telefon);
      return;
    }

    const satirlar = kayitlar
      .map((r) => {
        const tarih = new Date(r.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
          weekday: "long", day: "numeric", month: "long",
        });
        return (
          `🔖 No: ${r.id.slice(-6)}\n` +
          `💈 ${r.berber} — ${r.hizmet}\n` +
          `📅 ${tarih} ⏰ ${r.saat}\n` +
          `📌 Durum: ${durumEtiketi(r.durum)}`
        );
      })
      .join("\n\n———————————\n\n");

    await sendText(telefon, `*Randevularınız:*\n\n${satirlar}`);

    const aktifler = kayitlar.filter((r) => r.durum !== "iptal");
    if (aktifler.length > 0) {
      await sendButtons(telefon, "Randevunuzu iptal etmek ister misiniz?", [
        { id: "iptal_istiyorum", title: "❌ Randevu İptal" },
        { id: "ana_menu",        title: "🏠 Ana Menü" },
      ]);
      s.adim = "iptal_sec_bekle";
    } else {
      resetSession(telefon);
    }
    return;
  }

  return bilinmeyen(telefon);
}

// ---------------------------------------------------------------------------
// Adım: ad_bekle
// ---------------------------------------------------------------------------
async function adimAd(telefon, metin, s) {
  if (metin.length < 3) {
    await sendText(telefon, "Lütfen geçerli bir ad soyad girin (en az 3 karakter).");
    return;
  }

  s.veri.ad = metin;
  s.veri.telefon = telefon;

  await sendButtons(
    telefon,
    `Teşekkürler ${metin}! 💈\n\nKaç kişi için randevu almak istiyorsunuz?`,
    [
      { id: "kisi_1", title: "1 Kişi" },
      { id: "kisi_2", title: "2 Kişi" },
      { id: "kisi_3", title: "3 Kişi" },
    ]
  );
  s.adim = "kisi_sayisi_bekle";
}

// ---------------------------------------------------------------------------
// Adım: kisi_sayisi_bekle
// ---------------------------------------------------------------------------
async function adimKisiSayisi(telefon, metin, s) {
  const sayiMap = { kisi_1: 1, kisi_2: 2, kisi_3: 3 };
  const sayi = sayiMap[metin];
  if (!sayi) return bilinmeyen(telefon);

  s.veri.kisiSayisi = sayi;
  s.veri.kisiler = [];

  const rows = BERBERLER.map((b) => ({
    id: `berber_${b.id}`,
    title: b.ad,
    description: b.uzmanlik,
  }));

  await sendList(
    telefon,
    `${sayi} kişi için randevu. 💈\n\nHangi berberle randevu almak istersiniz?`,
    "Berber Seç",
    [{ title: "Berberler", rows }]
  );
  s.adim = "berber_bekle";
}

// ---------------------------------------------------------------------------
// Adım: berber_bekle
// ---------------------------------------------------------------------------
async function adimBerber(telefon, metin, s) {
  if (!metin.startsWith("berber_")) return bilinmeyen(telefon);

  const berberId = metin.replace("berber_", "");
  const berber = bul(BERBERLER, berberId);
  if (!berber) return bilinmeyen(telefon);

  s.veri.berberId = berber.id;
  s.veri.berber = berber.ad;

  return hizmetSor(telefon, s, 0);
}

// --- Hizmet listesi gönder (kişi bazlı) ---
async function hizmetSor(telefon, s, kisiIndex) {
  const berber = bul(BERBERLER, s.veri.berberId);
  const kisiSayisi = s.veri.kisiSayisi || 1;
  const prefix = kisiSayisi > 1 ? `${kisiIndex + 1}. kişi için ` : "";

  const rows = HIZMETLER.map((h) => ({
    id: `hizmet_${h.id}`,
    title: h.ad,
    description: `${h.sure} • ${berber.fiyat[h.id]}₺`,
  }));

  await sendList(
    telefon,
    `*${berber.ad}* (${berber.uzmanlik})\n\n${prefix}Hangi hizmeti istersiniz?`,
    "Hizmet Seç",
    [{ title: "Hizmetler", rows }]
  );
  s.veri.kisiIndex = kisiIndex;
  s.adim = "kisi_hizmet_bekle";
}

// ---------------------------------------------------------------------------
// Adım: kisi_hizmet_bekle
// ---------------------------------------------------------------------------
async function adimKisiHizmet(telefon, metin, s) {
  if (!metin.startsWith("hizmet_")) return bilinmeyen(telefon);

  const hizmetId = metin.replace("hizmet_", "");
  const hizmet = bul(HIZMETLER, hizmetId);
  if (!hizmet) return bilinmeyen(telefon);

  const berber = bul(BERBERLER, s.veri.berberId);
  const fiyat = berber.fiyat[hizmetId];

  s.veri.kisiler.push({ hizmetId, hizmet: hizmet.ad, fiyat });

  const sonrakiIndex = s.veri.kisiler.length;
  const kisiSayisi = s.veri.kisiSayisi || 1;

  if (sonrakiIndex < kisiSayisi) {
    return hizmetSor(telefon, s, sonrakiIndex);
  }

  // Tüm kişilerin hizmetleri seçildi
  s.veri.hizmetId = s.veri.kisiler[0].hizmetId;
  s.veri.hizmet   = s.veri.kisiler.map((k) => k.hizmet).join(" + ");
  s.veri.fiyat    = s.veri.kisiler.reduce((sum, k) => sum + k.fiyat, 0);

  return tarihListesiGonder(telefon, s);
}

// ---------------------------------------------------------------------------
// Tarih listesi
// ---------------------------------------------------------------------------
async function tarihListesiGonder(telefon, s) {
  const rows = gelecekTarihler(7).map((t) => ({
    id: `tarih_${t.deger}`,
    title: t.etiket.length > 24 ? t.etiket.slice(0, 24) : t.etiket,
  }));

  await sendList(telefon, "Hangi gün için randevu almak istersiniz?", "Tarih Seç", [
    { title: "Önümüzdeki 7 gün", rows },
  ]);
  s.adim = "tarih_bekle";
}

// ---------------------------------------------------------------------------
// Adım: tarih_bekle
// ---------------------------------------------------------------------------
async function adimTarih(telefon, metin, s) {
  if (!metin.startsWith("tarih_")) return bilinmeyen(telefon);

  const tarih = metin.replace("tarih_", "");
  s.veri.tarih = tarih;

  const dolu = db.getBusySlots(s.veri.berberId, tarih);
  const bos  = SAATLER.filter((saat) => !dolu.includes(saat));

  if (bos.length === 0) {
    await sendText(telefon, "😔 Bu gün için boş saat kalmamış. Lütfen başka bir gün seçin.");
    return tarihListesiGonder(telefon, s);
  }

  const rows = bos.slice(0, 10).map((saat) => ({ id: `saat_${saat}`, title: saat }));

  await sendList(telefon, "Uygun saatlerden birini seçin:", "Saat Seç", [
    { title: "Boş saatler", rows },
  ]);
  s.adim = "saat_bekle";
}

// ---------------------------------------------------------------------------
// Adım: saat_bekle
// ---------------------------------------------------------------------------
async function adimSaat(telefon, metin, s) {
  if (!metin.startsWith("saat_")) return bilinmeyen(telefon);

  const saat = metin.replace("saat_", "");
  s.veri.saat = saat;

  const kisiler    = s.veri.kisiler;
  const kisiSayisi = s.veri.kisiSayisi || 1;
  const toplamFiyat = s.veri.fiyat;

  const tarih = new Date(s.veri.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long", day: "numeric", month: "long",
  });

  let hizmetSatiri;
  if (kisiSayisi > 1) {
    hizmetSatiri = kisiler.map((k, i) => `  ${i + 1}. kişi: ${k.hizmet} (${k.fiyat}₺)`).join("\n");
  } else {
    hizmetSatiri = kisiler[0].hizmet;
  }

  const ozet =
    "*Randevu Özeti*\n\n" +
    `👤 Ad: ${s.veri.ad}\n` +
    `💈 Berber: ${s.veri.berber}\n` +
    (kisiSayisi > 1
      ? `👥 Kişi sayısı: ${kisiSayisi}\n✂️ Hizmetler:\n${hizmetSatiri}\n`
      : `✂️ Hizmet: ${hizmetSatiri}\n`) +
    `📅 Tarih: ${tarih}\n` +
    `⏰ Saat: ${saat}\n` +
    `💰 Toplam Ücret: ${toplamFiyat}₺\n\n` +
    "Onaylıyor musunuz?";

  await sendButtons(telefon, ozet, [
    { id: "onayla",   title: "✅ Onayla" },
    { id: "iptal_et", title: "❌ İptal" },
  ]);
  s.adim = "onay_bekle";
}

// ---------------------------------------------------------------------------
// Adım: onay_bekle
// ---------------------------------------------------------------------------
async function adimOnay(telefon, metin, s) {
  if (metin === "onayla") {
    const kisiler    = s.veri.kisiler;
    const kisiSayisi = s.veri.kisiSayisi || 1;

    const kayit = db.add({
      ad:       s.veri.ad,
      telefon:  s.veri.telefon,
      berberId: s.veri.berberId,
      berber:   s.veri.berber,
      hizmetId: kisiler[0].hizmetId,
      hizmet:   s.veri.hizmet,
      tarih:    s.veri.tarih,
      saat:     s.veri.saat,
      fiyat:    s.veri.fiyat,
      kisiSayisi: kisiSayisi > 1 ? kisiSayisi : undefined,
      kisiler:    kisiSayisi > 1 ? kisiler    : undefined,
    });

    sheets.syncRandevu(kayit).catch(() => {});

    const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
      weekday: "long", day: "numeric", month: "long",
    });

    const hizmetBilgi = kisiSayisi > 1
      ? `${kisiSayisi} kişi: ${kisiler.map((k) => k.hizmet).join(", ")}`
      : kayit.hizmet;

    await sendText(
      telefon,
      "🎉 *Randevunuz alındı!*\n\n" +
        `🔖 Randevu No: *${kayit.id.slice(-6)}*\n` +
        `💈 ${kayit.berber}\n` +
        `✂️ ${hizmetBilgi}\n` +
        `📅 ${tarih} ⏰ ${kayit.saat}\n` +
        `💰 Toplam: ${kayit.fiyat}₺\n\n` +
        "Randevunuz berber onayına gönderildi. Onaylandığında size haber vereceğiz. Teşekkürler! 🙏"
    );
    resetSession(telefon);
    return;
  }

  if (metin === "iptal_et") {
    await sendButtons(
      telefon,
      "Randevu işlemi iptal edildi. ❌\n\nYeni randevu oluşturmak ister misiniz?",
      [{ id: "yeni_randevu", title: "📅 Yeni Randevu" }]
    );
    s.adim = "menu";
    return;
  }

  return bilinmeyen(telefon);
}

// ---------------------------------------------------------------------------
// Adım: iptal_sec_bekle (müşteri iptali — randevu seçimi)
// ---------------------------------------------------------------------------
async function adimIptalSec(telefon, metin, s) {
  if (metin === "ana_menu") {
    resetSession(telefon);
    return bilinmeyen(telefon);
  }

  if (metin === "iptal_istiyorum") {
    const aktifler = db.getAll()
      .filter((r) => r.telefon === telefon && r.durum !== "iptal")
      .slice(0, 10);

    if (aktifler.length === 0) {
      await sendText(telefon, "İptal edilecek aktif randevunuz bulunmuyor.");
      resetSession(telefon);
      return;
    }

    const rows = aktifler.map((r) => {
      const tarih = new Date(r.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
        day: "numeric", month: "long",
      });
      return {
        id:          `iptal_sec_${r.id}`,
        title:       `${tarih} ${r.saat}`,
        description: `${r.berber} — ${r.hizmet}`,
      };
    });

    await sendList(telefon, "Hangi randevuyu iptal etmek istiyorsunuz?", "Randevu Seç", [
      { title: "Aktif Randevular", rows },
    ]);
    // adim "iptal_sec_bekle" olarak kalır
    return;
  }

  if (metin.startsWith("iptal_sec_")) {
    const randevuId = metin.replace("iptal_sec_", "");
    const kayit = db.getAll().find((r) => r.id === randevuId);
    if (!kayit) {
      await sendText(telefon, "Randevu bulunamadı.");
      resetSession(telefon);
      return;
    }

    s.veri.iptalId = randevuId;

    const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
      weekday: "long", day: "numeric", month: "long",
    });

    await sendButtons(
      telefon,
      `*Randevu İptal Onayı*\n\n💈 ${kayit.berber} — ${kayit.hizmet}\n📅 ${tarih} ⏰ ${kayit.saat}\n\nBu randevuyu iptal etmek istediğinize emin misiniz?`,
      [
        { id: "iptal_onayla", title: "✅ Evet, İptal Et" },
        { id: "iptal_vazgec", title: "❌ Hayır, Vazgeç" },
      ]
    );
    s.adim = "iptal_onay_bekle";
    return;
  }

  return bilinmeyen(telefon);
}

// ---------------------------------------------------------------------------
// Adım: iptal_onay_bekle
// ---------------------------------------------------------------------------
async function adimIptalOnay(telefon, metin, s) {
  if (metin === "iptal_onayla") {
    const kayit = db.updateStatus(s.veri.iptalId, "iptal", "musteri");
    if (!kayit) {
      await sendText(telefon, "Randevu bulunamadı veya zaten iptal edilmiş.");
      resetSession(telefon);
      return;
    }

    sheets.updateRandevuDurum(kayit).catch(() => {});

    const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
      weekday: "long", day: "numeric", month: "long",
    });

    await sendText(
      telefon,
      "✅ *Randevunuz iptal edildi.*\n\n" +
        `💈 ${kayit.berber} — ${kayit.hizmet}\n` +
        `📅 ${tarih} ⏰ ${kayit.saat}\n\n` +
        "Yeni randevu için *merhaba* yazabilirsiniz."
    );

    // Opsiyonel: barbere WhatsApp bildirimi (env: BERBER_BILDIRIM_TEL)
    const bildirimTel = process.env.BERBER_BILDIRIM_TEL;
    if (bildirimTel) {
      const { sendText: st } = require("./whatsapp");
      st(bildirimTel,
        `🔴 *Randevu İptali*\n\n👤 ${kayit.ad} randevusunu iptal etti.\n` +
        `💈 ${kayit.berber} — ${kayit.hizmet}\n📅 ${tarih} ⏰ ${kayit.saat}`
      ).catch(() => {});
    }

    resetSession(telefon);
    return;
  }

  if (metin === "iptal_vazgec") {
    await sendText(
      telefon,
      "İptal vazgeçildi. Randevunuz aktif kaldı. 👍\n\nBaşka bir şey için *merhaba* yazabilirsiniz."
    );
    resetSession(telefon);
    return;
  }

  return bilinmeyen(telefon);
}

// ---------------------------------------------------------------------------
// Yardımcı: bilinmeyen mesaj
// ---------------------------------------------------------------------------
async function bilinmeyen(telefon) {
  await sendButtons(telefon, "Anlayamadım. 🤔 Lütfen aşağıdaki seçeneklerden birini kullanın:", [
    { id: "yeni_randevu",    title: "📅 Randevu Al" },
    { id: "randevu_sorgula", title: "🔍 Randevum" },
  ]);
  const s = getSession(telefon);
  s.adim = "menu";
}

function durumEtiketi(durum) {
  if (durum === "onaylı") return "✅ Onaylandı";
  if (durum === "iptal")  return "❌ İptal";
  return "⏳ Bekliyor";
}

module.exports = { handleMessage };
