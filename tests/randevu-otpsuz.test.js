const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// POST /api/public/randevu — OTP_AKTIF KAPALIYKEN (varsayilan, env ayarlanmaz)
// davranisi. Netgsm hesabi kurulana kadar telefon dogrulanmadan kabul edilir.
// Ayni suredeki OTP AÇIK senaryosu icin tests/public-randevu.test.js'e bak.
// ---------------------------------------------------------------------------
delete process.env.OTP_AKTIF; // her ihtimale karsi baska testten kalmis olmasin

const store = [];

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
      getBusySlots: async () => [],
      add: async (r) => { const kayit = { ...r, id: "otpsuz" + store.length, durum: r.durum || "bekliyor" }; store.push(kayit); return kayit; },
      getAll: async () => store.slice(),
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async () => {}, otpDogrula: async () => ({ sonuc: "kod_yok" }),
      otpSonGonderim: async () => null, otpBugunSayisi: async () => 0,
    };
  }
  return orig.apply(this, arguments);
};

function post(path, body) {
  return new Promise((resolve, reject) => {
    const veri = JSON.stringify(body);
    const req = http.request(
      { host: "localhost", port: 3205, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
      }
    );
    req.on("error", reject);
    req.write(veri);
    req.end();
  });
}

function yarinTarih() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("OTP kapaliyken: telefon dogrudan (token olmadan) kabul edilir, randevu olusur", async (t) => {
  store.length = 0;
  process.env.PORT = "3205";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const res = await post("/api/public/randevu", {
    ad: "Test Musteri", telefon: "0555 123 45 67", // dogrulamaToken YOK, ham telefon formatinda
    berberId: "resul", hizmetId: "sac", tarih: yarinTarih(), saat: "10:00",
  });

  assert.strictEqual(res.status, 201, "token olmadan da randevu olusmali");
  assert.strictEqual(res.body.telefon, "905551234567", "telefon normalize edilmis olmali");
  assert.strictEqual(res.body.kaynak, "web");
  assert.strictEqual(res.body.durum, "bekliyor");
});

test("OTP kapaliyken: gecersiz telefon formati 400 doner", async (t) => {
  store.length = 0;
  process.env.PORT = "3205";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const res = await post("/api/public/randevu", {
    ad: "Test Musteri", telefon: "abc123", // gecersiz
    berberId: "resul", hizmetId: "sac", tarih: yarinTarih(), saat: "10:00",
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.hata, /telefon/i);
});

test("OTP kapaliyken: telefon hic yoksa 400 doner", async (t) => {
  store.length = 0;
  process.env.PORT = "3205";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const res = await post("/api/public/randevu", {
    ad: "Test Musteri",
    berberId: "resul", hizmetId: "sac", tarih: yarinTarih(), saat: "10:00",
  });
  assert.strictEqual(res.status, 400);
});
