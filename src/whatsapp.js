const axios = require("axios");

const API_VERSION = "v19.0";

function baseUrl() {
  return `https://graph.facebook.com/${API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function send(payload) {
  try {
    const res = await axios.post(baseUrl(), payload, { headers: headers() });
    return res.data;
  } catch (err) {
    const detay = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error("WhatsApp gönderim hatası:", detay);
    return null;
  }
}

// 1) Düz metin mesajı
async function sendText(to, text) {
  if (!to) return null; // telefonsuz (elle eklenen) randevuda gönderme
  return send({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

// 2) Buton mesajı (max 3 buton)
async function sendButtons(to, bodyText, buttons) {
  const reply = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: b.id, title: b.title.slice(0, 20) },
  }));

  return send({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: { buttons: reply },
    },
  });
}

// 3) Liste mesajı (tarih / saat seçimi için, max 10 satır)
async function sendList(to, bodyText, buttonLabel, sections) {
  return send({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel.slice(0, 20),
        sections,
      },
    },
  });
}

module.exports = { sendText, sendButtons, sendList };
