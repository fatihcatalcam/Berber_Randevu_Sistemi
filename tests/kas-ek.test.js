const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Hizmete ek (Kaş Tasarımı, herkes için 300₺): ayrı randevu değil; seçilen
// hizmetin adına ve fiyatına eklenir. Tek başına alınamaz, süreyi uzatmaz.
// ---------------------------------------------------------------------------
delete process.env.OTP_AKTIF;
process.env.RANDEVU_ACILIS_TARIHI = "2020-01-01T00:00:00+03:00";

const store = [];
const onaySmsleri = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => null, sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, musteriKaydet: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { randevuOnaySms: async (r) => { onaySmsleri.push(r); return { hata: false }; } };
  if (req === "./email" || req.endsWith("/email")) return { randevuOnayMaili: async () => null };
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async (berberId, tarih) => store.filter((r) => r.berberId === berberId && r.tarih === tarih).map((r) => r.saat),
      add: async (r) => { const k = { ...r, id: "k" + store.length, durum: r.durum || "bekliyor" }; store.push(k); return k; },
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      engelliMi: async () => false,
      telefonGunRandevuSayisi: async () => 0,
    };
  }
  return orig.apply(this, arguments);
};

process.env.PORT = "3221";
const { server } = require("../src/index");
const { BERBERLER } = require("../src/config");
const { gunEkle, bugunStr } = require("../src/randevu-yardimci");
test.after(() => new Promise((r) => server.close(r)));

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { ...(veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const req = http.request({ host: "localhost", port: 3221, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

function sonrakiGun(gun) {
  let t = gunEkle(bugunStr(), 1);
  while (new Date(t + "T00:00:00").getDay() !== gun) t = gunEkle(t, 1);
  return t;
}
const SALI = sonrakiGun(2); // Eren Salı 09:45'ten itibaren 45 dk'lık slotlar
const eren = BERBERLER.find((b) => b.id === "eren");
const webRandevu = (ek) => istek("POST", "/api/public/randevu",
  { ad: "Ali Veli", telefon: "0555 334 00 01", berberId: "eren", tarih: SALI, ...ek });

test("config ekleri verir: Kaş Tasarımı 300₺", async () => {
  const { body } = await istek("GET", "/api/config");
  assert.deepStrictEqual(body.ekler, [{ id: "kas", ad: "Kaş Tasarımı", fiyat: 300 }]);
});

test("web: kaş eklenince hizmet adı ve fiyatı birleşir, onay SMS'i birleşik adla gider", async () => {
  const r = await webRandevu({ hizmetId: "kombin", ekler: ["kas"], saat: "09:45" });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.hizmet, "Saç + Sakal + Kaş Tasarımı");
  assert.strictEqual(r.body.hizmetId, "kombin");
  assert.strictEqual(r.body.fiyat, eren.fiyat.kombin + 300);
  assert.strictEqual(onaySmsleri.at(-1).hizmet, "Saç + Sakal + Kaş Tasarımı");

  const sade = await webRandevu({ hizmetId: "sac", saat: "10:30" });
  assert.strictEqual(sade.body.hizmet, "Saç Kesimi");
  assert.strictEqual(sade.body.fiyat, eren.fiyat.sac);
});

test("web: bilinmeyen ek 400, kaş tek başına hizmet değil", async () => {
  assert.strictEqual((await webRandevu({ hizmetId: "sac", ekler: ["masaj"], saat: "11:15" })).status, 400);
  assert.strictEqual((await webRandevu({ hizmetId: "kas", saat: "11:15" })).status, 400);
});

test("panel: elle randevuda kaş eklenir, fiyat panelden gelir", async () => {
  const token = (await istek("POST", "/api/auth", { berberId: "eren", pin: process.env.PIN_EREN })).body.token;
  const r = await istek("POST", "/api/randevular",
    { ad: "Mehmet", berberId: "eren", hizmetId: "sac", ekler: ["kas"], tarih: SALI, saat: "12:00", fiyat: 900 }, token);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.hizmet, "Saç Kesimi + Kaş Tasarımı");
  assert.strictEqual(r.body.fiyat, 900);
});
