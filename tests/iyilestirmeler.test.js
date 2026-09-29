const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// PIN'siz hesap, Pazar/özel açık gün, taşıma doğrulaması, iptali geri alma
// çakışması ve elle randevunun SMS'e bağlanması.
delete process.env.PIN_BURAK; // Render'da tanımlanmamış PIN'i taklit eder
process.env.RANDEVU_KAPALI = "";
process.env.RANDEVU_ACILIS_TARIHI = "2020-01-01T00:00:00+03:00";

let store = [];
let acikGunler = [];
let updateStatusHatasi = null;

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, clearRandevuCell: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }), randevuIptalSms: async () => ({ hata: false }), randevuTasindiSms: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) return { randevuOnayMaili: async () => null, randevuTasindiMaili: async () => null };
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {}, getHatirlatilacaklar: async () => [], degisimSurumu: () => "t:0",
      getAcikGunler: async () => acikGunler, getAcikSaatlerFor: async () => [],
      getBusySlots: async () => [],
      add: async (r) => { const k = { ...r, id: "r" + store.length }; store.push(k); return k; },
      getById: async (id) => store.find((r) => r.id === id) || null,
      updateStatus: async (id, durum) => {
        if (updateStatusHatasi) throw updateStatusHatasi;
        const r = store.find((x) => x.id === id); r.durum = durum; return r;
      },
      updateTarihSaat: async (id, tarih, saat) => { const r = store.find((x) => x.id === id); Object.assign(r, { tarih, saat }); return r; },
    };
  }
  return orig.apply(this, arguments);
};

const { BERBERLER } = require("../src/config");
const { gunEkle, bugunStr } = require("../src/randevu-yardimci");

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (veri) headers["Content-Length"] = Buffer.byteLength(veri);
    const req = http.request({ host: "localhost", port: 3216, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

async function sunucu(t) {
  process.env.PORT = "3216";
  delete require.cache[require.resolve("../src/index")];
  const mod = require("../src/index");
  t.after(() => new Promise((r) => mod.server.close(r)));
  await new Promise((r) => setTimeout(r, 400));
  return mod;
}

const giris = async (b) => (await istek("POST", "/api/auth", { berberId: b.id, pin: b.pin })).body.token;
function sonrakiGun(gun) { let t = gunEkle(bugunStr(), 1); while (new Date(t + "T00:00:00").getDay() !== gun) t = gunEkle(t, 1); return t; }

test("PIN'i tanimlanmamis berber hesabina hicbir PIN'le girilemez", async (t) => {
  await sunucu(t);
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "burak" })).status, 401);
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "burak", pin: "" })).status, 401);
  const eren = BERBERLER.find((b) => b.id === "eren");
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "eren", pin: eren.pin })).status, 200);
});

test("Pazar kapali; admin ozel actiysa web'de saatler gelir ve randevu alinir", async (t) => {
  store = []; acikGunler = [];
  await sunucu(t);
  const pazar = sonrakiGun(0);

  assert.deepStrictEqual((await istek("GET", `/api/public/musait-saatler?berberId=eren&tarih=${pazar}`)).body.saatler, []);
  const kapali = await istek("POST", "/api/public/randevu", { ad: "A", telefon: "05550000011", berberId: "eren", hizmetId: "sac", tarih: pazar, saat: "10:30" });
  assert.strictEqual(kapali.status, 400);

  acikGunler = [pazar, "2000-01-01"];
  assert.deepStrictEqual((await istek("GET", "/api/public/acik-gunler")).body.tarihler, [pazar], "gecmis gunler listelenmez");
  assert.ok((await istek("GET", `/api/public/musait-saatler?berberId=eren&tarih=${pazar}`)).body.saatler.length > 0);
  const acik = await istek("POST", "/api/public/randevu", { ad: "A", telefon: "05550000011", berberId: "eren", hizmetId: "sac", tarih: pazar, saat: "10:30" });
  assert.strictEqual(acik.status, 201);
});

test("elle randevu kaynak=panel ve normalize telefonla kaydolur", async (t) => {
  store = [];
  await sunucu(t);
  const token = await giris(BERBERLER.find((b) => b.id === "eren"));
  const res = await istek("POST", "/api/randevular", { ad: "B", telefon: "0555 111 22 33", berberId: "eren", hizmetId: "sac", tarih: sonrakiGun(2), saat: "09:45" }, token);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(store[0].kaynak, "panel");
  assert.strictEqual(store[0].telefon, "905551112233");
});

test("tasima: mesai disi 400; iptali geri alirken saat dolmussa 409 (500 degil)", async (t) => {
  store = [];
  await sunucu(t);
  const token = await giris(BERBERLER.find((b) => b.id === "eren"));
  const salı = sonrakiGun(2);
  store.push({ id: "x1", kaynak: "panel", telefon: "", berberId: "eren", berber: "Eren Tokalak", hizmet: "Saç Kesimi", tarih: salı, saat: "09:45", durum: "iptal" });

  assert.strictEqual((await istek("PATCH", "/api/randevular/x1/tasi", { tarih: salı, saat: "08:00" }, token)).status, 400);
  assert.strictEqual((await istek("PATCH", "/api/randevular/x1/tasi", { tarih: salı, saat: "16:30" }, token)).status, 400, "yemek arasi");
  assert.strictEqual((await istek("PATCH", "/api/randevular/x1/tasi", { tarih: salı, saat: "11:15" }, token)).status, 200);

  updateStatusHatasi = Object.assign(new Error("dolu"), { code: "SLOT_DOLU" });
  t.after(() => { updateStatusHatasi = null; });
  assert.strictEqual((await istek("POST", "/api/randevular/x1/durum", { durum: "onaylı" }, token)).status, 409);
});
