const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");
const { ADMIN_PIN } = require("../src/config");

// GET /api/versiyon: kimlik ister, DB'ye gitmeden db.degisimSurumu() doner.
let surumNo = 0;
const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) return {};
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getHatirlatilacaklar: async () => [],
      degisimSurumu: () => "t:" + surumNo,
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
    const req = http.request({ host: "localhost", port: 3212, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

test("/api/versiyon kimlik ister ve surum degisince yeni deger doner", async (t) => {
  process.env.PORT = "3212";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  assert.strictEqual((await istek("GET", "/api/versiyon")).status, 401);

  const giris = await istek("POST", "/api/auth", { admin: true, pin: ADMIN_PIN });
  const token = giris.body.token;
  const a = await istek("GET", "/api/versiyon", null, token);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.body.surum, "t:0");
  surumNo++;
  const b = await istek("GET", "/api/versiyon", null, token);
  assert.strictEqual(b.body.surum, "t:1");
});
