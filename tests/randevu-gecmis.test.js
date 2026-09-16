const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");
const { ADMIN_PIN } = require("../src/config");

// ---------------------------------------------------------------------------
// GET /api/randevular artik db.getRecentAndUpcoming (sinirli pencere) kullanir,
// tum gecmis icin degil. Musteri Gecmisi paneli ayri bir uctan (db.getMusteriGecmisi)
// tam gecmisi ceker. Bu dosya iki uc noktanin dogru db fonksiyonunu cagirdigini
// ve "sinirli akis" ile "tam gecmis"in birbirine karismadigini dogrular.
// ---------------------------------------------------------------------------
let recentCagrildi = 0;
let gecmisCagrilari = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) {
    return { randevuAlindiMaili: async () => null, randevuOnayMaili: async () => null, randevuIptalMaili: async () => null, randevuTasindiMaili: async () => null, randevuHatirlatmaMaili: async () => null };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => [],
      getAll: async () => { throw new Error("getAll cagrilmamali — canli akis getRecentAndUpcoming kullanmali"); },
      getRecentAndUpcoming: async () => { recentCagrildi++; return [{ id: "r1", tarih: "2026-01-01", durum: "bekliyor" }]; },
      getMusteriGecmisi: async (telefon, ad) => { gecmisCagrilari.push({ telefon, ad }); return [{ id: "eski1", tarih: "2020-01-01" }, { id: "eski2", tarih: "2021-06-15" }]; },
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async () => {}, otpDogrula: async () => ({ sonuc: "kod_yok" }),
      otpSonGonderim: async () => null, otpBugunSayisi: async () => 0,
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
    const req = http.request({ host: "localhost", port: 3211, path, method, headers }, (res) => {
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

test("GET /api/randevular getRecentAndUpcoming kullanir, tum gecmisi cekmez", async (t) => {
  recentCagrildi = 0; gecmisCagrilari = [];
  process.env.PORT = "3211";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const token = await adminToken();
  const res = await istek("GET", "/api/randevular", null, token);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(recentCagrildi, 1, "getRecentAndUpcoming cagrilmali");
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].id, "r1");
});

test("GET /api/randevular/gecmis telefonla musterinin tam gecmisini doner", async (t) => {
  recentCagrildi = 0; gecmisCagrilari = [];
  process.env.PORT = "3211";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const token = await adminToken();
  const res = await istek("GET", "/api/randevular/gecmis?telefon=905551112233", null, token);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 2, "eski yillara ait kayitlar da donmeli");
  assert.strictEqual(gecmisCagrilari.length, 1);
  assert.strictEqual(gecmisCagrilari[0].telefon, "905551112233");
});

test("GET /api/randevular/gecmis telefon/ad yoksa 400 doner", async (t) => {
  process.env.PORT = "3211";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const token = await adminToken();
  const res = await istek("GET", "/api/randevular/gecmis", null, token);
  assert.strictEqual(res.status, 400);
});

test("GET /api/randevular ve /api/randevular/gecmis kimlik dogrulama ister", async (t) => {
  process.env.PORT = "3211";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const r1 = await istek("GET", "/api/randevular");
  assert.strictEqual(r1.status, 401);
  const r2 = await istek("GET", "/api/randevular/gecmis?telefon=905550000000");
  assert.strictEqual(r2.status, 401);
});
