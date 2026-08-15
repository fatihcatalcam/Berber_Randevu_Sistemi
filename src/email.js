// ---------------------------------------------------------------------------
// Resend ile e-posta bildirimleri — web sitesinden randevu alan müşterilere
// (WhatsApp mesajı gönderilemediği için onay/hatırlatma buradan gider).
// RESEND_API_KEY tanımsızsa (geliştirme / hesap henüz açılmadıysa) sessizce
// atlanır — src/whatsapp.js'teki sendText'in `to` boşsa null dönme davranışıyla
// simetrik: çağıran taraf ekstra kontrol yapmak zorunda kalmaz.
// ---------------------------------------------------------------------------
const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function gonder(to, subject, html) {
  if (!resend || !to) return null;
  try {
    const res = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    if (res.error) {
      console.error("Resend gönderim hatası:", res.error.message || res.error);
      return { hata: true };
    }
    return { hata: false };
  } catch (err) {
    console.error("Resend istek hatası:", err.message);
    return { hata: true };
  }
}

function taban(icerik) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;">
    <h2 style="color:#075E54;">Resul Tabu Saç Atölyesi</h2>
    ${icerik}
    <p style="color:#6b7280;font-size:13px;margin-top:24px;">Bu e-posta randevu sisteminden otomatik gönderilmiştir.</p>
  </div>`;
}

async function randevuAlindiMaili(randevu, tarihStr) {
  return gonder(
    randevu.email,
    "Randevunuz alındı",
    taban(`
      <p>Merhaba ${randevu.ad},</p>
      <p>Randevu talebiniz alındı, ustamızın onayına gönderildi. Onaylandığında ayrıca bilgilendirileceksiniz.</p>
      <p>💈 Usta: <strong>${randevu.berber}</strong><br>
      ✂️ Hizmet: ${randevu.hizmet}<br>
      📅 Tarih: ${tarihStr}<br>⏰ Saat: ${randevu.saat}</p>
    `)
  );
}

async function randevuOnayMaili(randevu, tarihStr) {
  return gonder(
    randevu.email,
    "Randevunuz onaylandı",
    taban(`
      <p>Merhaba ${randevu.ad},</p>
      <p>✅ Randevunuz onaylandı!</p>
      <p>💈 Usta: <strong>${randevu.berber}</strong><br>
      ✂️ Hizmet: ${randevu.hizmet}<br>
      📅 Tarih: ${tarihStr}<br>⏰ Saat: ${randevu.saat}</p>
      <p>Sizi bekliyoruz! 🙏</p>
    `)
  );
}

async function randevuTasindiMaili(randevu, tarihStr) {
  return gonder(
    randevu.email,
    "Randevunuz güncellendi",
    taban(`
      <p>Merhaba ${randevu.ad},</p>
      <p>📅 Randevunuz yeni bir tarih/saate alındı.</p>
      <p>💈 Usta: <strong>${randevu.berber}</strong><br>
      ✂️ Hizmet: ${randevu.hizmet}<br>
      📅 Yeni Tarih: ${tarihStr}<br>⏰ Yeni Saat: ${randevu.saat}</p>
      <p>Görüşürüz! 🙏</p>
    `)
  );
}

async function randevuIptalMaili(randevu, tarihStr) {
  return gonder(
    randevu.email,
    "Randevunuz iptal edildi",
    taban(`
      <p>Merhaba ${randevu.ad},</p>
      <p>❌ Randevunuz iptal edildi.</p>
      <p>💈 Usta: <strong>${randevu.berber}</strong><br>
      📅 Tarih: ${tarihStr}<br>⏰ Saat: ${randevu.saat}</p>
      <p>Yeni randevu için web sitemizden tekrar randevu alabilirsiniz.</p>
    `)
  );
}

async function randevuHatirlatmaMaili(randevu, tarihStr) {
  return gonder(
    randevu.email,
    "Randevu Hatırlatması",
    taban(`
      <p>Merhaba ${randevu.ad},</p>
      <p>⏰ Yaklaşık 1 saat sonra randevunuz var:</p>
      <p>💈 Usta: <strong>${randevu.berber}</strong><br>
      ✂️ Hizmet: ${randevu.hizmet}<br>
      📅 Tarih: ${tarihStr}<br>⏰ Saat: ${randevu.saat}</p>
      <p>Sizi bekliyoruz! 🙏</p>
    `)
  );
}

module.exports = { randevuAlindiMaili, randevuOnayMaili, randevuTasindiMaili, randevuIptalMaili, randevuHatirlatmaMaili };
