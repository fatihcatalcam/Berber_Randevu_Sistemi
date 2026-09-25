const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");
const { ADMIN_PIN, BERBERLER } = require("../src/config");

// DELETE /api/randevular/:id: kimlik ister, sadece iptal edilmis randevular silinebilir.
let store = [];
const silinenler = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) return {};
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getById: async (id) => store.find((r) => r.id === id) || null,
      deleteRandevu: async (id) => {
        const i = store.findIndex((r) => r.id === id);
        if (i === -1) return null;
        silinenler.push(id);
        return store.splice(i, 1)[0];
      },
      getHatirlatilacaklar: async () => [], degisimSurumu: () => "t:0",
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
    const req = http.request({ host: "localhost", port: 3214, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

function sifirla() {
  store = []; silinenler.length = 0;
}

test("DELETE /api/randevular/:id kimlik ister, iptal olmayanı reddeder, iptal edileni siler", async (t) => {
  sifirla();
  process.env.PORT = "3214";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  store.push({ id: "aktif1", durum: "onaylı" });
  store.push({ id: "iptal1", durum: "iptal" });

  assert.strictEqual((await istek("DELETE", "/api/randevular/iptal1")).status, 401, "kimliksiz istek reddedilmeli");

  const giris = await istek("POST", "/api/auth", { berberId: BERBERLER[0].id, pin: BERBERLER[0].pin });
  const token = giris.body.token;

  const aktifSil = await istek("DELETE", "/api/randevular/aktif1", null, token);
  assert.strictEqual(aktifSil.status, 400, "iptal edilmemis randevu silinememeli");
  assert.strictEqual(store.some((r) => r.id === "aktif1"), true);

  const olmayanSil = await istek("DELETE", "/api/randevular/yok", null, token);
  assert.strictEqual(olmayanSil.status, 404);

  const iptalSil = await istek("DELETE", "/api/randevular/iptal1", null, token);
  assert.strictEqual(iptalSil.status, 200);
  assert.strictEqual(iptalSil.body.ok, true);
  assert.strictEqual(store.some((r) => r.id === "iptal1"), false, "iptal edilmis randevu gercekten silinmeli");
  assert.strictEqual(silinenler.includes("iptal1"), true);
});
