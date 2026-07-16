const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// ---------------------------------------------------------------------------
// Bağımlılık mock'ları — gönderilen listeleri yakalayıp içeriğini incelemek için
// ---------------------------------------------------------------------------
const sent = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) {
    return {
      sendText:    async () => sent.push({ k: "text" }),
      sendButtons: async (to, b, btns) => sent.push({ k: "buttons", ids: btns.map((x) => x.id) }),
      sendList:    async (to, b, l, secs) => sent.push({ k: "list", rows: secs[0].rows.map((r) => r.id) }),
    };
  }
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, musteriKaydet: async () => {}, isEnabled: () => false };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      getBusySlots: async () => [],   // hiçbir slot dolu değil — eleme sadece "geçmiş" yüzünden olmalı
      add: async (r) => ({ ...r, id: "1", durum: "bekliyor" }),
      getAll: async () => [],
    };
  }
  return orig.apply(this, arguments);
};

function bugun() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Sistemi belirli bir saate sabitler (Date.now ve new Date() dahil)
function saatiSabitle(saatStr) {
  const [h, m] = saatStr.split(":").map(Number);
  const sahte = new Date();
  sahte.setHours(h, m, 0, 0);
  const GercekDate = Date;
  global.Date = class extends GercekDate {
    constructor(...args) {
      if (args.length === 0) return new GercekDate(sahte.getTime());
      return new GercekDate(...args);
    }
    static now() { return sahte.getTime(); }
  };
  return () => { global.Date = GercekDate; };
}

test("bugun icin gecmis saatler listede cikmaz", async (t) => {
  const geriAl = saatiSabitle("17:30");
  t.after(geriAl);

  delete require.cache[require.resolve("../src/bot")];
  delete require.cache[require.resolve("../src/config")];
  const { handleMessage } = require("../src/bot");
  const TEL = "905550009911";
  sent.length = 0;

  await handleMessage(TEL, "merhaba");
  await handleMessage(TEL, "yeni_randevu");
  await handleMessage(TEL, "Gecmis Testi");
  await handleMessage(TEL, "kisi_1");
  await handleMessage(TEL, "berber_resul");
  await handleMessage(TEL, "hizmet_sac");
  await handleMessage(TEL, `tarih_${bugun()}`);

  const liste = sent.filter((x) => x.k === "list").pop();
  assert.ok(liste, "saat listesi gönderilmeli");

  const saatler = liste.rows
    .filter((id) => id.startsWith("saat_") && !id.startsWith("saat_sayfa_"))
    .map((id) => id.replace("saat_", ""));

  assert.ok(saatler.length > 0, "18:00 sonrasi bos saatler kalmali");

  // 17:30 + 15dk tampon = 17:45'ten once hicbir saat onerilmemeli
  for (const s of saatler) {
    const [h, m] = s.split(":").map(Number);
    assert.ok(h * 60 + m > 17 * 60 + 45, `${s} gecmis/cok yakin — listede olmamali`);
  }
  // Sabah saatleri kesinlikle olmamali (kullanicinin bildirdigi hata)
  assert.ok(!saatler.includes("10:00"), "10:00 saat 17:30'da secilebilir olmamali");
});

test("gelecek gunlerde tum saatler acik kalir", async (t) => {
  const geriAl = saatiSabitle("17:30");
  t.after(geriAl);

  delete require.cache[require.resolve("../src/bot")];
  delete require.cache[require.resolve("../src/config")];
  const { handleMessage } = require("../src/bot");
  const TEL = "905550009922";
  sent.length = 0;

  // Pazar olmayan gelecek bir gun
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const yarin = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  await handleMessage(TEL, "merhaba");
  await handleMessage(TEL, "yeni_randevu");
  await handleMessage(TEL, "Yarin Testi");
  await handleMessage(TEL, "kisi_1");
  await handleMessage(TEL, "berber_resul");
  await handleMessage(TEL, "hizmet_sac");
  await handleMessage(TEL, `tarih_${yarin}`);

  const liste = sent.filter((x) => x.k === "list").pop();
  const saatler = liste.rows
    .filter((id) => id.startsWith("saat_") && !id.startsWith("saat_sayfa_"))
    .map((id) => id.replace("saat_", ""));

  // Yarin icin ilk slot (09:00) hala secilebilir olmali — gecmis filtresi bugune ozel
  assert.ok(saatler.includes("09:00"), "yarinin 09:00'i secilebilir olmali");
});
