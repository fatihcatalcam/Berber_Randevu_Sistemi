const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Keratin (Yükleme 1650₺, Düzleştirme 1850₺, herkes için aynı): tek başına
// alınır ya da saç/sakal hizmetine eklenir; ikisi de tek dilim. Müşteri tam
// fiyatı öder, 200₺ çırak bahşişi kayıttaki fiyattan düşülür (panel/ciro 1450₺).
// Bir randevuda tek keratin olur.
// ---------------------------------------------------------------------------
delete process.env.DEMO;
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

process.env.PORT = "3222";
const { server } = require("../src/index");
const { BERBERLER } = require("../src/config");
const { gunEkle, bugunStr } = require("../src/randevu-yardimci");
test.after(() => new Promise((r) => server.close(r)));

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { ...(veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const req = http.request({ host: "localhost", port: 3222, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        let govde = b;
        try { govde = JSON.parse(b || "{}"); } catch {}
        resolve({ status: res.statusCode, body: govde });
      });
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
const SALI = sonrakiGun(2);     // Eren Salı 09:45'ten itibaren 45 dk'lık dilimler
const CARSAMBA = sonrakiGun(3); // Resul 09:00'dan itibaren 30 dk'lık dilimler
const eren = BERBERLER.find((b) => b.id === "eren");
const webRandevu = (govde) => istek("POST", "/api/public/randevu",
  { ad: "Ali Veli", telefon: "0555 334 00 02", berberId: "eren", tarih: SALI, ...govde });

test("config: keratinler hizmet kartı ve ek olarak gelir, fiyat ve not hizmette", async () => {
  const { body } = await istek("GET", "/api/config");
  const kart = body.hizmetler.find((h) => h.id === "keratin-yukleme");
  assert.strictEqual(kart.ad, "Keratin Yükleme");
  assert.strictEqual(kart.aciklama, "En kısa saç");
  assert.strictEqual(kart.fiyat, 1650);
  assert.strictEqual(kart.not, "Saç uzunluğuna göre fiyat değişiklikleri yaşanabilmektedir.");
  assert.strictEqual(body.hizmetler.find((h) => h.id === "keratin-duzlestirme").fiyat, 1850);
  assert.deepStrictEqual(body.ekler.map((e) => e.id), ["kas", "keratin-yukleme", "keratin-duzlestirme"]);
});

test("web: tek başına keratin tek dilim; kayıtta 200₺ eksik, kesinti ayrıca saklanır", async () => {
  const r = await webRandevu({ hizmetId: "keratin-yukleme", saat: "09:45" });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.hizmet, "Keratin Yükleme");
  assert.strictEqual(r.body.fiyat, 1450);
  assert.strictEqual(r.body.kesinti, 200);
  assert.strictEqual(onaySmsleri.at(-1).hizmet, "Keratin Yükleme");

  // Fiyat ustadan bağımsız: Resul'de de aynı (onun dilimi 30 dk)
  const resul = await webRandevu({ berberId: "resul", tarih: CARSAMBA, hizmetId: "keratin-duzlestirme", saat: "09:00" });
  assert.strictEqual(resul.status, 201);
  assert.strictEqual(resul.body.fiyat, 1650);
  assert.strictEqual(resul.body.kesinti, 200);
});

test("web: saç/sakala keratin eklenir, aynı dilimde; kaşla birlikte de olur", async () => {
  const r = await webRandevu({ hizmetId: "sac", ekler: ["keratin-duzlestirme"], saat: "11:15" });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.hizmet, "Saç Kesimi + Keratin Düzleştirme");
  assert.strictEqual(r.body.hizmetId, "sac");
  assert.strictEqual(r.body.fiyat, eren.fiyat.sac + 1850 - 200);
  assert.strictEqual(r.body.kesinti, 200);

  const kasli = await webRandevu({ hizmetId: "kombin", ekler: ["kas", "keratin-yukleme"], saat: "12:00" });
  assert.strictEqual(kasli.body.hizmet, "Saç + Sakal + Kaş Tasarımı + Keratin Yükleme");
  assert.strictEqual(kasli.body.fiyat, eren.fiyat.kombin + 300 + 1650 - 200);
});

// Web ucu IP başına dakikada 5 istek kabul eder; bu dosyadaki 5. web isteği bu.
// Diğer durumlar aynı doğrulamayı kullanan panel ucunda denenir.
test("web: bir randevuda iki keratin olmaz", async () => {
  const r = await webRandevu({ hizmetId: "sac", ekler: ["keratin-yukleme", "keratin-duzlestirme"], saat: "13:30" });
  assert.strictEqual(r.status, 400);
});

test("panel: elle keratin randevusunda fiyat alanı müşterinin ödediği, kayda 200₺ eksik yazılır", async () => {
  const token = (await istek("POST", "/api/auth", { berberId: "eren", pin: process.env.PIN_EREN })).body.token;
  const elle = (govde) => istek("POST", "/api/randevular", { ad: "Mehmet", berberId: "eren", tarih: SALI, ...govde }, token);

  const standart = await elle({ hizmetId: "keratin-yukleme", saat: "16:30" }); // fiyat gönderilmedi
  assert.strictEqual(standart.status, 201);
  assert.strictEqual(standart.body.fiyat, 1450);
  assert.strictEqual(standart.body.kesinti, 200);

  // Uzun saç: müşteri 2000₺ öder, ciroya 1800₺
  const uzun = await elle({ hizmetId: "sac", ekler: ["keratin-duzlestirme"], saat: "17:15", fiyat: 2000 + eren.fiyat.sac });
  assert.strictEqual(uzun.body.fiyat, 1800 + eren.fiyat.sac);

  // Keratinsiz elle randevu eskisi gibi: yazılan fiyat aynen
  const kas = await elle({ hizmetId: "sac", ekler: ["kas"], saat: "18:00", fiyat: 900 });
  assert.strictEqual(kas.body.fiyat, 900);

  // Süre uzamaz: keratinin sonraki dilimi boş
  assert.strictEqual((await elle({ hizmetId: "sakal", ekler: ["kas"], saat: "10:30" })).body.fiyat, eren.fiyat.sakal + 300);
  assert.ok(!store.at(-1).kesinti, "keratinsiz randevuda kesinti yok");

  for (const govde of [{ hizmetId: "keratin-yukleme", ekler: ["keratin-duzlestirme"] }, { hizmetId: "keratin-yukleme", ekler: ["keratin-yukleme"] }])
    assert.strictEqual((await elle({ ...govde, saat: "18:45" })).status, 400, JSON.stringify(govde));
  // Sabit müşteri keratinle tanımlanamaz
  const sabit = await istek("POST", "/api/sabit", { ad: "Mehmet", hizmetId: "keratin-yukleme", gun: 2, saat: "18:45" }, token);
  assert.strictEqual(sabit.status, 400);
});

test("llms.txt keratini fiyatı ve notuyla bir kez yazar", async () => {
  const { body } = await istek("GET", "/llms.txt");
  assert.ok(body.includes("- Keratin Yükleme (en kısa saç): 1.650 ₺, tek başına ya da saç/sakal hizmetiyle aynı randevuda. Saç uzunluğuna göre fiyat değişiklikleri yaşanabilmektedir."), body);
  assert.ok(body.includes("- Keratin Düzleştirme (kısa saç): 1.850 ₺"));
  assert.strictEqual(body.split("Keratin Yükleme").length - 1, 1, "ekler satırında tekrar yok");
  assert.ok(body.includes("- Kaş Tasarımı: 300 ₺, saç veya sakal hizmetine eklenir"));
  assert.ok(!body.includes("NaN") && !body.includes("undefined"));
});
