// ---------------------------------------------------------------------------
// Netgsm SMS gönderimi — telefon doğrulama (OTP) kodları için.
//
// Netgsm'in klasik REST API'si (GET, düz metin yanıt döner — JSON değil):
//   https://api.netgsm.com.tr/sms/send/get?usercode=...&password=...&gsmno=...&message=...&msgheader=...
// Başarılı yanıt "00 <işId>" ile başlar; hata kodları (20, 30, 40, 50, 51, 70...)
// Netgsm dokümantasyonunda listelidir. Ortam değişkenleri boşsa (geliştirme /
// hesap henüz açılmadıysa) gönderim atlanır, hata olarak işaretlenir.
// ---------------------------------------------------------------------------
const axios = require("axios");

const NETGSM_URL = "https://api.netgsm.com.tr/sms/send/get";

async function otpGonder(telefon, kod) {
  const { NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_MSGHEADER } = process.env;
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
        message:   `Resul Tabu Saç Atölyesi doğrulama kodunuz: ${kod}`,
        msgheader: NETGSM_MSGHEADER,
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

module.exports = { otpGonder };
