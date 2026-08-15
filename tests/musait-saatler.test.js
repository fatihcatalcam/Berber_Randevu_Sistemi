const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// GET /api/public/musait-saatler — dolu slotlar dusulmus, calisma saatleri
// disindakiler hic gorunmez.
// ---------------------------------------------------------------------------
let doluSlotlar = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => null, sendTemplate: async () => null };
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) {
    return { randevuAlindiMaili: async () => null, randevuOnayMaili: async () => null, randevuIptalMaili: async () => null, randevuHatirlatmaMaili: async () => null };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => doluSlotlar,
      getAcikSaatlerFor: async () => [],
      getAcikGunler: async () => [],
      add: async (r) => ({ ...r, id: "1", durum: "bekliyor" }),
      getAll: async () => [],
      otpKaydet: async () => {}, otpDogrula: async () => ({ sonuc: "kod_yok" }),
      otpSonGonderim: async () => null, otpBugunSayisi: async () => 0,
    };
  }
  return orig.apply(this, arguments);
};

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3202${path}`, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    }).on("error", reject);
  });
}

function yarinTarih() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("musait-saatler: Resul icin dolu slotlar cikarilir, yemek arasi hic gorunmez", async (t) => {
  process.env.PORT = "3202";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  doluSlotlar = ["09:30", "10:00"];
  const tarih = yarinTarih();
  const res = await get(`/api/public/musait-saatler?berberId=resul&tarih=${tarih}`);

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.saatler.includes("09:00"), "09:00 bos olmali (Resul 09:00 baslar)");
  assert.ok(!res.body.saatler.includes("09:30"), "dolu slot listede olmamali");
  assert.ok(!res.body.saatler.includes("10:00"), "dolu slot listede olmamali");
  assert.ok(!res.body.saatler.includes("14:00"), "yemek arasi (14:00-16:00) hic gorunmemeli");
  assert.ok(!res.body.saatler.includes("20:00"), "mesai sonrasi (20:00) gorunmemeli");
});

test("musait-saatler: gecersiz berber icin 400 doner", async (t) => {
  process.env.PORT = "3202";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const res = await get(`/api/public/musait-saatler?berberId=yok-boyle-biri&tarih=${yarinTarih()}`);
  assert.strictEqual(res.status, 400);
});
