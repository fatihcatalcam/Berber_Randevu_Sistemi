const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// ---------------------------------------------------------------------------
// Bağımlılıkları mock'la: whatsapp (gönderim), db (bellek içi), sheets (no-op)
// ---------------------------------------------------------------------------
const sent = [];
const store = []; // bellek içi randevu deposu

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
      getBusySlots: async () => [],            // hep boş — çakışma yok
      add: async (r) => {
        const kayit = { ...r, id: Date.now().toString() + store.length, durum: r.durum || "bekliyor" };
        store.push(kayit);
        return kayit;
      },
      getAll: async () => store.slice(),
      getAcikGunler: async () => [],
    };
  }
  return orig.apply(this, arguments);
};

test("tam randevu akisi calisir ve kayit olusur", async () => {
  delete require.cache[require.resolve("../src/bot")];
  delete require.cache[require.resolve("../src/config")];
  const { handleMessage } = require("../src/bot");
  const TEL = "905550001122";
  store.length = 0;

  // Pazar olmayan bir gelecek tarih seç
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const tarih = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  await handleMessage(TEL, "merhaba");
  await handleMessage(TEL, "yeni_randevu");
  await handleMessage(TEL, "Test Kullanici");
  await handleMessage(TEL, "kisi_1");
  await handleMessage(TEL, "berber_resul");
  await handleMessage(TEL, "hizmet_kombin");
  await handleMessage(TEL, `tarih_${tarih}`);
  await handleMessage(TEL, "saat_10:00");
  await handleMessage(TEL, "onayla");

  assert.strictEqual(store.length, 1);
  assert.strictEqual(store[0].berber, "Resul Tabu");
  assert.strictEqual(store[0].hizmet, "Saç + Sakal");
  assert.strictEqual(store[0].fiyat, 1200); // RESUL_FIYAT.kombin
  assert.strictEqual(store[0].saat, "10:00");
  assert.strictEqual(store[0].durum, "bekliyor");
});

test("cok kisilik randevu ardisik slot icin kisiSayisi kaydeder", async () => {
  delete require.cache[require.resolve("../src/bot")];
  delete require.cache[require.resolve("../src/config")];
  const { handleMessage } = require("../src/bot");
  const TEL = "905550003344";
  store.length = 0;

  const d = new Date();
  d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const tarih = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  await handleMessage(TEL, "merhaba");
  await handleMessage(TEL, "yeni_randevu");
  await handleMessage(TEL, "Iki Kisi");
  await handleMessage(TEL, "kisi_2");
  await handleMessage(TEL, "berber_eren");
  await handleMessage(TEL, "hizmet_sac");   // 1. kişi
  await handleMessage(TEL, "hizmet_sac");   // 2. kişi
  await handleMessage(TEL, `tarih_${tarih}`);
  await handleMessage(TEL, "saat_10:30");   // eren 45dk ızgarasında geçerli dilim
  await handleMessage(TEL, "onayla");

  assert.strictEqual(store.length, 1);
  assert.strictEqual(store[0].kisiSayisi, 2);
  assert.strictEqual(store[0].saat, "10:30");
});
