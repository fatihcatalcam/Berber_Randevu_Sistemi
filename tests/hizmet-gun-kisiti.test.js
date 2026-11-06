const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Ustanın bazı günler almadığı hizmet (config kapaliHizmet): Burak cumartesi
// günleri sadece sakal randevusu almaz; saç + sakal, saç ve diğer günler olur.
// Diğer ustalar etkilenmez. Panelden elle girilen randevu serbesttir.
// ---------------------------------------------------------------------------
delete process.env.DEMO;
delete process.env.OTP_AKTIF;
process.env.RANDEVU_ACILIS_TARIHI = "2020-01-01T00:00:00+03:00";

const store = [];
const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => null, sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, musteriKaydet: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { randevuOnaySms: async () => ({ hata: false }) };
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

process.env.PORT = "3224";
const { server } = require("../src/index");
const { hizmetGunKisiti } = require("../src/config");
const { gunEkle, bugunStr } = require("../src/randevu-yardimci");
test.after(() => new Promise((r) => server.close(r)));

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { ...(veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const req = http.request({ host: "localhost", port: 3224, path, method, headers }, (res) => {
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
const CUMARTESI = sonrakiGun(6), CUMA = sonrakiGun(5);
// Burak 10:30'dan itibaren 45 dk'lık dilimler: 10:30, 11:15, 12:00, 12:45 ...
const web = (govde) => istek("POST", "/api/public/randevu",
  { ad: "Ali Veli", telefon: "0555 334 00 07", berberId: "burak", tarih: CUMARTESI, ...govde });

test("config: kural sadece Burak + sakal + cumartesi için", () => {
  assert.strictEqual(hizmetGunKisiti("burak", "sakal", CUMARTESI),
    "Burak Şahin cumartesi günleri sadece sakal tıraşı randevusu almıyor. Başka bir hizmet ya da gün seçebilirsiniz.");
  assert.strictEqual(hizmetGunKisiti("burak", "kombin", CUMARTESI), null);
  assert.strictEqual(hizmetGunKisiti("burak", "sac", CUMARTESI), null);
  assert.strictEqual(hizmetGunKisiti("burak", "sakal", CUMA), null);
  for (const usta of ["resul", "eren", "kaan", "emre", "mehmetali"])
    assert.strictEqual(hizmetGunKisiti(usta, "sakal", CUMARTESI), null, usta);
});

test("/api/config kuralı randevu sayfasına verir (tarih listesinde o gün kapalı görünür)", async () => {
  const { body } = await istek("GET", "/api/config");
  assert.deepStrictEqual(body.berberler.find((b) => b.id === "burak").kapaliHizmet, { 6: ["sakal"] });
  assert.ok(body.berberler.filter((b) => b.id !== "burak").every((b) => !b.kapaliHizmet));
});

// Web ucu IP başına dakikada 5 istek kabul eder: bu dosyada tam 5 web isteği var.
test("web: Burak'tan cumartesi sadece sakal alınmaz (kaş ekli de), saç + sakal alınır", async () => {
  const sakal = await web({ hizmetId: "sakal", saat: "10:30" });
  assert.strictEqual(sakal.status, 400);
  assert.match(sakal.body.hata, /cumartesi günleri sadece sakal tıraşı/);
  assert.strictEqual((await web({ hizmetId: "sakal", ekler: ["kas"], saat: "10:30" })).status, 400);
  assert.strictEqual(store.length, 0, "reddedilen randevu kaydedilmemeli");

  const kombin = await web({ hizmetId: "kombin", saat: "10:30" });
  assert.strictEqual(kombin.status, 201);
  assert.strictEqual(kombin.body.hizmet, "Saç + Sakal");
});

test("web: Burak'tan cuma sakal, Eren'den cumartesi sakal alınır", async () => {
  assert.strictEqual((await web({ tarih: CUMA, hizmetId: "sakal", saat: "11:15" })).status, 201);
  assert.strictEqual((await web({ berberId: "eren", hizmetId: "sakal", saat: "10:30" })).status, 201);
});

test("panel: Burak kendisi cumartesiye sakal randevusu yazabilir", async () => {
  const token = (await istek("POST", "/api/auth", { berberId: "burak", pin: process.env.PIN_BURAK })).body.token;
  const r = await istek("POST", "/api/randevular", { ad: "Mehmet", berberId: "burak", hizmetId: "sakal", tarih: CUMARTESI, saat: "12:00" }, token);
  assert.strictEqual(r.status, 201);
});
