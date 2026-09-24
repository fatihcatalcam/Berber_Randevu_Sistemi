const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");
const { ADMIN_PIN, BERBERLER } = require("../src/config");

// GET /api/sheets/baglanti: admin ister, GOOGLE_SHEET_ID varsa link doner.
const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) return {};
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {}, getHatirlatilacaklar: async () => [], degisimSurumu: () => "t:0",
      getAcikGunler: async () => [], getAcikSaatlerFor: async () => [], getBusySlots: async () => [],
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
    const req = http.request({ host: "localhost", port: 3213, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

test("/api/sheets/baglanti kimlik ister, admin degilse 403, GOOGLE_SHEET_ID varsa link doner", async (t) => {
  process.env.GOOGLE_SHEET_ID = "test-sheet-id-123";
  process.env.PORT = "3213";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => { delete process.env.GOOGLE_SHEET_ID; server.close(r); }));
  await new Promise((r) => setTimeout(r, 400));

  assert.strictEqual((await istek("GET", "/api/sheets/baglanti")).status, 401);

  const berberGiris = await istek("POST", "/api/auth", { berberId: BERBERLER[1].id, pin: BERBERLER[1].pin });
  const berberRes = await istek("GET", "/api/sheets/baglanti", null, berberGiris.body.token);
  assert.strictEqual(berberRes.status, 403, "admin olmayan berber goremez");

  const adminGiris = await istek("POST", "/api/auth", { admin: true, pin: ADMIN_PIN });
  const adminRes = await istek("GET", "/api/sheets/baglanti", null, adminGiris.body.token);
  assert.strictEqual(adminRes.status, 200);
  assert.strictEqual(adminRes.body.url, "https://docs.google.com/spreadsheets/d/test-sheet-id-123/edit");
});

test("/api/sheets/baglanti: GOOGLE_SHEET_ID tanimsizsa url null doner", async (t) => {
  // Bos string veriliyor (delete degil): index.js'in basindaki dotenv.config()
  // sadece TANIMSIZ degiskenleri .env'den doldurur — silinirse yerel .env'deki
  // gercek GOOGLE_SHEET_ID geri yuklenir. Bos string dotenv'i atlatir.
  process.env.GOOGLE_SHEET_ID = "";
  process.env.PORT = "3213";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => { delete process.env.GOOGLE_SHEET_ID; server.close(r); }));
  await new Promise((r) => setTimeout(r, 400));

  const adminGiris = await istek("POST", "/api/auth", { admin: true, pin: ADMIN_PIN });
  const res = await istek("GET", "/api/sheets/baglanti", null, adminGiris.body.token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.url, null);
});
