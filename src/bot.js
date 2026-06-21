const db = require("./db");
const { BERBERLER, HIZMETLER, SAATLER, gelecekTarihler } = require("./config");
const { sendText, sendButtons, sendList } = require("./whatsapp");
const sheets = require("./sheets");

function bul(arr, id) {
  return arr.find((x) => x.id === id);
}

// Saat string'ine dakika ekler: "10:00" + 60 → "11:00"
function slotEkle(saat, dk) {
  const [h, m] = saat.split(":").map(Number);
  const t = h * 60 + m + dk;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Oturum yönetimi (bellek içi)
// ---------------------------------------------------------------------------
const sessions = {};

function resetSession(telefon) {
  sessions[telefon] = { adim: "baslangic", veri: {} };
  return sessions[telefon];
}

function getSession(telefon) {
  if (!sessions[telefon]) resetSession(telefon);
  sessions[telefon].sonAktif = Date.now();
  return sessions[telefon];
}

// Atıl oturumları periyodik temizle (bellek sızıntısını önler)
const OTURUM_OMUR_MS = 30 * 60 * 1000; // 30 dk
setInterval(() => {
  const simdi = Date.now();
  for (const tel of Object.keys(sessions)) {
    if (simdi - (sessions[tel].sonAktif || 0) > OTURUM_OMUR_MS) delete sessions[tel];
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Ana yönlendirici
// ---------------------------------------------------------------------------
const SELAMLAR = ["merhaba", "selam", "başla", "basla", "hi", "hello"];

async function handleMessage(telefon, metin) {
  const ham   = (metin || "").trim();
  const kucuk = ham.toLowerCase();
  let s = getSession(telefon);

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
    const kayitlar = (await db.getAll()).filter((r) => r.telefon === telefon).slice(0, 5);

    if (kayitlar.length === 0) {
      await sendText(telefon, "Kayıtlı randevunuz bulunamadı. Yeni randevu için *merhaba* yazabilirsiniz.");
      resetSession(telefon);
      return;
    }

    const satirlar = kayitlar.map((r) => {
      const tarih = new Date(r.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
        weekday: "long", day: "numeric", month: "long",
      });
      return (
        `🔖 No: ${r.id.slice(-6)}\n` +
        `💈 ${r.berber} — ${r.hizmet}\n` +
        `📅 ${tarih} ⏰ ${r.saat}\n` +
        `📌 Durum: ${durumEtiketi(r.durum)}`
      );
    }).join("\n\n———————————\n\n");

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
  s.veri.ad      = metin;
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
  const sayi    = sayiMap[metin];
  if (!sayi) return bilinmeyen(telefon);

  s.veri.kisiSayisi = sayi;
  s.veri.kisiler    = [];

  const rows = BERBERLER.map((b) => ({
    id:          `berber_${b.id}`,
    title:       b.ad,
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
  const berber   = bul(BERBERLER, berberId);
  if (!berber) return bilinmeyen(telefon);

  s.veri.berberId = berber.id;
  s.veri.berber   = berber.ad;

  return hizmetSor(telefon, s, 0);
}

async function hizmetSor(telefon, s, kisiIndex) {
  const berber    = bul(BERBERLER, s.veri.berberId);
  const kisiSayisi = s.veri.kisiSayisi || 1;
  const prefix    = kisiSayisi > 1 ? `${kisiIndex + 1}. kişi için ` : "";

  const rows = HIZMETLER.map((h) => ({
    id:          `hizmet_${h.id}`,
    title:       h.ad,
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
  const hizmet   = bul(HIZMETLER, hizmetId);
  if (!hizmet) return bilinmeyen(telefon);

  const berber = bul(BERBERLER, s.veri.berberId);
  s.veri.kisiler.push({ hizmetId, hizmet: hizmet.ad, fiyat: berber.fiyat[hizmetId] });

  const sonrakiIndex = s.veri.kisiler.length;
  if (sonrakiIndex < (s.veri.kisiSayisi || 1)) return hizmetSor(telefon, s, sonrakiIndex);

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
    id:    `tarih_${t.deger}`,
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

  const dolu = await db.getBusySlots(s.veri.berberId, tarih);
  const kisiSayisi = s.veri.kisiSayisi || 1;
  const bos = SAATLER.filter((saat) => {
    const idx = SAATLER.indexOf(saat);
    for (let i = 0; i < kisiSayisi; i++) {
      if (idx + i >= SAATLER.length) return false;
      if (dolu.includes(SAATLER[idx + i])) return false;
    }
    return true;
  });

  if (bos.length === 0) {
    const mesaj = kisiSayisi > 1
      ? `😔 Bu gün için ${kisiSayisi} kişilik ardışık boş saat kalmamış. Lütfen başka bir gün seçin.`
      : "😔 Bu gün için boş saat kalmamış. Lütfen başka bir gün seçin.";
    await sendText(telefon, mesaj);
    return tarihListesiGonder(telefon, s);
  }

  s.veri.bosSlotlar = bos;
  return saatListesiGonder(telefon, s, 0);
}

// WhatsApp liste max 10 satır — büyük saat aralığı için sayfalama (9 slot + "devam")
async function saatListesiGonder(telefon, s, sayfa) {
  const bos   = s.veri.bosSlotlar;
  const baslangic = sayfa * 9;
  const dilim = bos.slice(baslangic, baslangic + 9);
  const sonSayfa  = baslangic + 9 >= bos.length;

  const rows = dilim.map((saat) => ({ id: `saat_${saat}`, title: saat }));
  if (!sonSayfa) {
    rows.push({ id: `saat_sayfa_${sayfa + 1}`, title: "▶ Daha fazla saat..." });
  }

  const toplamBos = bos.length;
  const gosterilen = Math.min(baslangic + 9, toplamBos);
  const baslik = toplamBos > 9
    ? `Boş saatler (${baslangic + 1}–${gosterilen} / ${toplamBos})`
    : "Boş saatler";

  await sendList(telefon, "Uygun saatlerden birini seçin:", "Saat Seç", [
    { title: baslik, rows },
  ]);
  s.veri.saatSayfa = sayfa;
  s.adim = "saat_bekle";
}

// ---------------------------------------------------------------------------
// Adım: saat_bekle
// ---------------------------------------------------------------------------
async function adimSaat(telefon, metin, s) {
  if (!metin.startsWith("saat_")) return bilinmeyen(telefon);

  // Sayfa değişimi (▶ Daha fazla saat...)
  if (metin.startsWith("saat_sayfa_")) {
    const sayfa = parseInt(metin.replace("saat_sayfa_", ""), 10);
    return saatListesiGonder(telefon, s, sayfa);
  }

  const saat      = metin.replace("saat_", "");
  s.veri.saat     = saat;
  const kisiler   = s.veri.kisiler;
  const kisiSayisi = s.veri.kisiSayisi || 1;

  const tarih = new Date(s.veri.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long", day: "numeric", month: "long",
  });

  const hizmetSatiri = kisiSayisi > 1
    ? kisiler.map((k, i) => `  ${i + 1}. kişi: ${k.hizmet} (${k.fiyat}₺)`).join("\n")
    : kisiler[0].hizmet;

  const saatStr = kisiSayisi > 1
    ? `${saat} – ${slotEkle(saat, kisiSayisi * 30)} (${kisiSayisi} slot, her biri 30 dk)`
    : saat;

  const ozet =
    "*Randevu Özeti*\n\n" +
    `👤 Ad: ${s.veri.ad}\n` +
    `💈 Berber: ${s.veri.berber}\n` +
    (kisiSayisi > 1
      ? `👥 Kişi sayısı: ${kisiSayisi}\n✂️ Hizmetler:\n${hizmetSatiri}\n`
      : `✂️ Hizmet: ${hizmetSatiri}\n`) +
    `📅 Tarih: ${tarih}\n⏰ Saat: ${saatStr}\n💰 Toplam: ${s.veri.fiyat}₺\n\nOnaylıyor musunuz?`;

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

    // Onay anında slotları yeniden kontrol et (çift rezervasyon koruması)
    const dolu = await db.getBusySlots(s.veri.berberId, s.veri.tarih);
    const baslangicIdx = SAATLER.indexOf(s.veri.saat);
    let cakisma = baslangicIdx === -1;
    for (let i = 0; i < kisiSayisi && !cakisma; i++) {
      const slot = SAATLER[baslangicIdx + i];
      if (!slot || dolu.includes(slot)) cakisma = true;
    }
    if (cakisma) {
      await sendText(telefon, "😔 Maalesef bu saat az önce doldu. Lütfen başka bir saat seçin.");
      return adimTarih(telefon, `tarih_${s.veri.tarih}`, s);
    }

    let kayit;
    try {
      kayit = await db.add({
        ad:        s.veri.ad,
        telefon:   s.veri.telefon,
        berberId:  s.veri.berberId,
        berber:    s.veri.berber,
        hizmetId:  kisiler[0].hizmetId,
        hizmet:    s.veri.hizmet,
        tarih:     s.veri.tarih,
        saat:      s.veri.saat,
        fiyat:     s.veri.fiyat,
        kisiSayisi: kisiSayisi > 1 ? kisiSayisi : undefined,
        kisiler:    kisiSayisi > 1 ? kisiler    : undefined,
      });
    } catch (e) {
      if (e.code === "SLOT_DOLU") {
        await sendText(telefon, "😔 Maalesef bu saat az önce doldu. Lütfen başka bir saat seçin.");
        return adimTarih(telefon, `tarih_${s.veri.tarih}`, s);
      }
      throw e;
    }

    sheets.syncRandevu(kayit).catch(() => {});

    const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
      weekday: "long", day: "numeric", month: "long",
    });

    const kayitKisiSayisi = kisiSayisi > 1 ? kisiSayisi : null;
    const saatStr = kayitKisiSayisi
      ? `${kayit.saat} – ${slotEkle(kayit.saat, kayitKisiSayisi * 30)}`
      : kayit.saat;

    // Berbere bildirim
    const berberObj = bul(BERBERLER, kayit.berberId);
    if (berberObj && berberObj.tel) {
      sendText(
        berberObj.tel,
        `🔔 *Yeni Randevu!*\n\n👤 ${kayit.ad}\n✂️ ${kayit.hizmet}\n` +
        `📅 ${tarih} ⏰ ${saatStr}\n💰 ${kayit.fiyat}₺`
      ).catch(() => {});
    }

    await sendText(
      telefon,
      "🎉 *Randevunuz alındı!*\n\n" +
        `🔖 Randevu No: *${kayit.id.slice(-6)}*\n` +
        `💈 ${kayit.berber}\n✂️ ${kayit.hizmet}\n` +
        `📅 ${tarih} ⏰ ${saatStr}\n💰 Toplam: ${kayit.fiyat}₺\n\n` +
        "Randevunuz berber onayına gönderildi. Onaylandığında size haber vereceğiz. Teşekkürler! 🙏"
    );
    resetSession(telefon);
    return;
  }

  if (metin === "iptal_et") {
    await sendButtons(telefon, "Randevu işlemi iptal edildi. ❌\n\nYeni randevu oluşturmak ister misiniz?", [
      { id: "yeni_randevu", title: "📅 Yeni Randevu" },
    ]);
    s.adim = "menu";
    return;
  }

  return bilinmeyen(telefon);
}

// ---------------------------------------------------------------------------
// Adım: iptal_sec_bekle
// ---------------------------------------------------------------------------
async function adimIptalSec(telefon, metin, s) {
  if (metin === "ana_menu") { resetSession(telefon); return bilinmeyen(telefon); }

  if (metin === "iptal_istiyorum") {
    const aktifler = (await db.getAll())
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
      return { id: `iptal_sec_${r.id}`, title: `${tarih} ${r.saat}`, description: `${r.berber} — ${r.hizmet}` };
    });

    await sendList(telefon, "Hangi randevuyu iptal etmek istiyorsunuz?", "Randevu Seç", [
      { title: "Aktif Randevular", rows },
    ]);
    return;
  }

  if (metin.startsWith("iptal_sec_")) {
    const randevuId = metin.replace("iptal_sec_", "");
    const kayit     = (await db.getAll()).find((r) => r.id === randevuId);
    if (!kayit) { await sendText(telefon, "Randevu bulunamadı."); resetSession(telefon); return; }

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
    const kayit = await db.updateStatus(s.veri.iptalId, "iptal", "musteri");
    if (!kayit) { await sendText(telefon, "Randevu bulunamadı veya zaten iptal edilmiş."); resetSession(telefon); return; }

    sheets.updateRandevuDurum(kayit).catch(() => {});

    const tarih = new Date(kayit.tarih + "T00:00:00").toLocaleDateString("tr-TR", {
      weekday: "long", day: "numeric", month: "long",
    });

    await sendText(
      telefon,
      "✅ *Randevunuz iptal edildi.*\n\n" +
        `💈 ${kayit.berber} — ${kayit.hizmet}\n📅 ${tarih} ⏰ ${kayit.saat}\n\n` +
        "Yeni randevu için *merhaba* yazabilirsiniz."
    );

    const bildirimTel = process.env.BERBER_BILDIRIM_TEL;
    if (bildirimTel) {
      sendText(
        bildirimTel,
        `🔴 *Randevu İptali*\n\n👤 ${kayit.ad} randevusunu iptal etti.\n` +
        `💈 ${kayit.berber} — ${kayit.hizmet}\n📅 ${tarih} ⏰ ${kayit.saat}`
      ).catch(() => {});
    }

    resetSession(telefon);
    return;
  }

  if (metin === "iptal_vazgec") {
    await sendText(telefon, "İptal vazgeçildi. Randevunuz aktif kaldı. 👍\n\nBaşka bir şey için *merhaba* yazabilirsiniz.");
    resetSession(telefon);
    return;
  }

  return bilinmeyen(telefon);
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
async function bilinmeyen(telefon) {
  await sendButtons(telefon, "Anlayamadım. 🤔 Lütfen aşağıdaki seçeneklerden birini kullanın:", [
    { id: "yeni_randevu",    title: "📅 Randevu Al" },
    { id: "randevu_sorgula", title: "🔍 Randevum" },
  ]);
  getSession(telefon).adim = "menu";
}

function durumEtiketi(durum) {
  if (durum === "onaylı") return "✅ Onaylandı";
  if (durum === "iptal")  return "❌ İptal";
  return "⏳ Bekliyor";
}

module.exports = { handleMessage };
