const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// whatsapp modülünü mock'la
const orig = Module._load;
const sent = [];
Module._load = function (req) {
  if (req.endsWith("whatsapp")) {
    return {
      sendText: async () => sent.push({ k: "text" }),
      sendButtons: async (to, b, btns) => sent.push({ k: "buttons", ids: btns.map((x) => x.id) }),
      sendList: async (to, b, l, secs) => sent.push({ k: "list", rows: secs[0].rows.map((r) => r.id) }),
    };
  }
  return orig.apply(this, arguments);
};

const fs = require("fs");
const path = require("path");
const DB = path.join(__dirname, "..", "data", "randevular.json");

test("tam randevu akisi calisir ve kayit olusur", async () => {
  const yedek = fs.existsSync(DB) ? fs.readFileSync(DB, "utf8") : "[]";
  fs.writeFileSync(DB, "[]");
  delete require.cache[require.resolve("../src/db")];
  delete require.cache[require.resolve("../src/bot")];
  delete require.cache[require.resolve("../src/config")];
  const db = require("../src/db");
  const { handleMessage } = require("../src/bot");
  const TEL = "905550001122";

  await handleMessage(TEL, "merhaba");
  await handleMessage(TEL, "yeni_randevu");
  await handleMessage(TEL, "Test Kullanici");
  await handleMessage(TEL, "berber_kemal");
  await handleMessage(TEL, "hizmet_kombin");
  const d = new Date();
  const bugun = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await handleMessage(TEL, `tarih_${bugun}`);
  await handleMessage(TEL, "saat_10:00");
  await handleMessage(TEL, "onayla");

  const all = db.getAll();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].berber, "Kemal Usta");
  assert.strictEqual(all[0].fiyat, 270);
  assert.strictEqual(all[0].durum, "bekliyor");

  fs.writeFileSync(DB, yedek); // geri yükle
});
