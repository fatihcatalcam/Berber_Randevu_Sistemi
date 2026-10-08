// ---------------------------------------------------------------------------
// Netgsm SMS gönderimi — telefon doğrulama (OTP) ve web randevularında
// iptal/taşıma bildirimleri için.
//
// Netgsm'in klasik REST API'si (GET, düz metin yanıt döner — JSON değil):
//   https://api.netgsm.com.tr/sms/send/get?usercode=...&password=...&gsmno=...&message=...&msgheader=...
// Başarılı yanıt "00 <işId>" ile başlar; hata kodları (20, 30, 40, 50, 51, 70...)
// Netgsm dokümantasyonunda listelidir. Ortam değişkenleri boşsa (geliştirme /
// hesap henüz açılmadıysa) gönderim atlanır, hata olarak işaretlenir.
// ---------------------------------------------------------------------------
const axios = require("axios");

const NETGSM_URL = "https://api.netgsm.com.tr/sms/send/get";

// Panelde elle yazılan numaralar "0555 123 45 67" gibi gelebilir — 905XXXXXXXXX'e çevrilir.
function numaraDuzelt(telefon) {
  let t = String(telefon || "").replace(/\D/g, "");
  if (t.startsWith("0")) t = t.slice(1);
  if (!t.startsWith("90")) t = "90" + t;
  return /^905\d{9}$/.test(t) ? t : null;
}

async function gonder(telefon, mesaj) {
  const { NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_MSGHEADER } = process.env;
  telefon = numaraDuzelt(telefon);
  if (!telefon) return null; // numara yok/geçersiz — tekrar denemenin anlamı yok
  if (!NETGSM_USERCODE || !NETGSM_PASSWORD || !NETGSM_MSGHEADER) {
    console.warn("⚠️ NETGSM_* env değişkenleri tanımsız — SMS gönderilemedi.");
    return { hata: true, kod: "yapilandirma_yok" };
  }
  try {
    const res = await axios.get(NETGSM_URL, {
      params: {
        usercode:  NETGSM_USERCODE,
        password:  NETGSM_PASSWORD,
        gsmno:     telefon,
        message:   mesaj,
        msgheader: NETGSM_MSGHEADER,
        dil:       "TR", // Türkçe karakterler (ş, ğ, ı...) bozulmadan gitsin
      },
    });
    const yanit = String(res.data || "").trim();
    if (yanit.startsWith("00")) return { hata: false };
    console.error("Netgsm gönderim hatası, yanıt kodu:", yanit);
    return { hata: true, kod: yanit };
  } catch (err) {
    console.error("Netgsm istek hatası:", err.message);
    return { hata: true, kod: "istek_hatasi" };
  }
}

async function otpGonder(telefon, kod) {
  return gonder(telefon, `Resul Tabu Saç Atölyesi doğrulama kodunuz: ${kod}`);
}

async function randevuIptalSms(randevu, tarihStr) {
  return gonder(
    randevu.telefon,
    `Resul Tabu Saç Atölyesi: ${tarihStr} ${randevu.saat} saatindeki randevunuz iptal edildi. Yeni randevu için sitemizi ziyaret edebilirsiniz.`
  );
}

async function randevuTasindiSms(randevu, tarihStr) {
  return gonder(
    randevu.telefon,
    `Resul Tabu Saç Atölyesi: Randevunuz ${tarihStr} ${randevu.saat} saatine güncellendi. Görüşürüz!`
  );
}

async function randevuHatirlatmaSms(randevu, tarihStr) {
  return gonder(
    randevu.telefon,
    `Resul Tabu Saç Atölyesi: ${tarihStr} saat ${randevu.saat}'de randevunuz var, sizi bekliyoruz.`
  );
}

module.exports = { otpGonder, randevuIptalSms, randevuTasindiSms, randevuHatirlatmaSms };
