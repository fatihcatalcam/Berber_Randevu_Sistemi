const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");
const { ADMIN_PIN } = require("../src/config");

// ---------------------------------------------------------------------------
// Kaynak=web randevularda iptal/tasima SMS + eposta ile bildirilir; kaynak=
// whatsapp olanlarda (veya tanimsizsa) davranis degismez, hala WhatsApp
// (sendText) kullanilir.
// ---------------------------------------------------------------------------
const whatsappCagrilari = [];
const smsIptalCagrilari = [];
const smsTasindiCagrilari = [];
const epostaIptalCagrilari = [];
const epostaTasindiCagrilari = [];
let store = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) {
    return {
      sendText: async (to, metin) => { whatsappCagrilari.push({ to, metin }); return { hata: false }; },
      sendTemplate: async () => ({ hata: false }),
    };
  }
  if (req.endsWith("sheets")) {
    return {
      syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {},
      clearRandevuCell: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {},
    };
  }
  if (req === "./sms" || req.endsWith("/sms")) {
    return {
      otpGonder: async () => ({ hata: false }),
      randevuIptalSms:   async (r) => { smsIptalCagrilari.push(r); return { hata: false }; },
      randevuTasindiSms: async (r) => { smsTasindiCagrilari.push(r); return { hata: false }; },
    };
  }
  if (req === "./email" || req.endsWith("/email")) {
    return {
      randevuAlindiMaili: async () => null,
      randevuOnayMaili:   async () => null,
      randevuIptalMaili:   async (r) => { epostaIptalCagrilari.push(r); return { hata: false }; },
      randevuTasindiMaili: async (r) => { epostaTasindiCagrilari.push(r); return { hata: false }; },
      randevuHatirlatmaMaili: async () => null,
    };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => [],
      getAll: async () => store.slice(),
      add: async (r) => ({ ...r, id: "x", durum: "bekliyor" }),
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async () => {}, otpDogrula: async () => ({ sonuc: "kod_yok" }),
      otpSonGonderim: async () => null, otpBugunSayisi: async () => 0,
      updateStatus: async (id, durum, iptalEden) => {
        const k = store.find((r) => r.id === id);
        if (!k) return null;
        k.durum = durum;
        if (iptalEden) k.iptalEden = iptalEden;
        return { ...k };
      },
      updateTarihSaat: async (id, tarih, saat) => {
        const k = store.find((r) => r.id === id);
        if (!k) return null;
        k.tarih = tarih; k.saat = saat;
        return { ...k };
      },
    };
  }
  return orig.apply(this, arguments);
};

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (veri) headers["Content-Length"] = Buffer.byteLength(veri);
    const req = http.request({ host: "localhost", port: 3204, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

async function adminToken() {
  const r = await istek("POST", "/api/auth", { admin: true, pin: ADMIN_PIN });
  return r.body.token;
}

function yarinTarih() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sifirla() {
  store = [];
  whatsappCagrilari.length = 0; smsIptalCagrilari.length = 0; smsTasindiCagrilari.length = 0;
  epostaIptalCagrilari.length = 0; epostaTasindiCagrilari.length = 0;
}

test("iptal: kaynak=web icin SMS + eposta gider, WhatsApp gitmez", async (t) => {
  sifirla();
  process.env.PORT = "3204";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  store.push({ id: "w1", kaynak: "web", telefon: "905551230001", email: "musteri@example.com",
    tarih: yarinTarih(), saat: "10:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "bekliyor" });

  const token = await adminToken();
  const res = await istek("POST", "/api/randevular/w1/durum", { durum: "iptal" }, token);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(smsIptalCagrilari.length, 1, "sms.randevuIptalSms cagrilmali");
  assert.strictEqual(epostaIptalCagrilari.length, 1, "eposta.randevuIptalMaili cagrilmali");
  assert.strictEqual(whatsappCagrilari.length, 0, "whatsapp gonderilmemeli");
});

test("iptal: kaynak=whatsapp icin hala WhatsApp kullanilir, SMS/eposta gitmez", async (t) => {
  sifirla();
  process.env.PORT = "3204";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  store.push({ id: "w2", kaynak: "whatsapp", telefon: "905551230002",
    tarih: yarinTarih(), saat: "10:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "bekliyor" });

  const token = await adminToken();
  const res = await istek("POST", "/api/randevular/w2/durum", { durum: "iptal" }, token);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(whatsappCagrilari.length, 1, "whatsapp gonderilmeli");
  assert.strictEqual(smsIptalCagrilari.length, 0);
  assert.strictEqual(epostaIptalCagrilari.length, 0);
});

test("tasima: kaynak=web icin SMS + eposta gider, WhatsApp gitmez", async (t) => {
  sifirla();
  process.env.PORT = "3204";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  store.push({ id: "w3", kaynak: "web", telefon: "905551230003", email: "musteri@example.com",
    tarih: yarinTarih(), saat: "10:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "onaylı" });

  const token = await adminToken();
  const res = await istek("PATCH", "/api/randevular/w3/tasi", { tarih: yarinTarih(), saat: "14:00" }, token);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(smsTasindiCagrilari.length, 1, "sms.randevuTasindiSms cagrilmali");
  assert.strictEqual(epostaTasindiCagrilari.length, 1, "eposta.randevuTasindiMaili cagrilmali");
  assert.strictEqual(whatsappCagrilari.length, 0, "whatsapp gonderilmemeli");
});

test("tasima: kaynak=whatsapp icin hala WhatsApp kullanilir", async (t) => {
  sifirla();
  process.env.PORT = "3204";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  store.push({ id: "w4", kaynak: "whatsapp", telefon: "905551230004",
    tarih: yarinTarih(), saat: "10:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "onaylı" });

  const token = await adminToken();
  const res = await istek("PATCH", "/api/randevular/w4/tasi", { tarih: yarinTarih(), saat: "15:00" }, token);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(whatsappCagrilari.length, 1);
  assert.strictEqual(smsTasindiCagrilari.length, 0);
  assert.strictEqual(epostaTasindiCagrilari.length, 0);
});
