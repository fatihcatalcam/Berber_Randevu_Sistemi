const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Web randevusunda iki kısıt: engelli numara (gelmeyen / trolleyen) randevu
// alamaz ve taşıyamaz; bir numara aynı güne en fazla 3 aktif randevu alabilir.
// Engelleme panelden: her usta engeller, sadece yönetici kaldırır.
// ---------------------------------------------------------------------------
delete process.env.OTP_AKTIF;
process.env.NETGSM_USERCODE = "test-user"; // taşıma için OTP kodu sms.otpGonder'den okunsun
process.env.RANDEVU_ACILIS_TARIHI = "2020-01-01T00:00:00+03:00";

let store = [];
let engelliler = new Map();
const otpKayitlari = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, clearRandevuCell: async () => {}, musteriKaydet: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./sms" || req.endsWith("/sms")) {
    return {
      otpGonder: async (telefon, kod) => { otpKayitlari.push({ telefon, kod, dogrulandi: false }); return { hata: false }; },
      randevuOnaySms: async () => ({ hata: false }), randevuTasindiSms: async () => ({ hata: false }), randevuIptalSms: async () => ({ hata: false }),
    };
  }
  if (req === "./email" || req.endsWith("/email")) {
    return { randevuOnayMaili: async () => null, randevuIptalMaili: async () => null, randevuTasindiMaili: async () => null, randevuHatirlatmaMaili: async () => null };
  }
  if (req.endsWith("/db") || req === "./db") {
    const aktif = (r) => r.durum !== "iptal";
    return {
      init: async () => {},
      getById: async (id) => { const r = store.find((x) => x.id === id); return r ? { ...r } : null; },
      getBusySlots: async (berberId, tarih) => store.filter((r) => r.berberId === berberId && r.tarih === tarih && aktif(r)).map((r) => r.saat),
      add: async (r) => { const k = { ...r, id: "r" + store.length, durum: r.durum || "bekliyor" }; store.push(k); return { ...k }; },
      updateTarihSaat: async (id, tarih, saat) => { const r = store.find((x) => x.id === id); Object.assign(r, { tarih, saat }); return { ...r }; },
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      telefonGunRandevuSayisi: async (telefon, tarih) => store.filter((r) => r.telefon === telefon && r.tarih === tarih && aktif(r)).length,
      engelliMi: async (telefon) => engelliler.has(telefon),
      engelliListe: async () => [...engelliler.values()],
      engelle: async (telefon, ad, engelleyen) => { if (!engelliler.has(telefon)) engelliler.set(telefon, { telefon, ad, engelleyen }); },
      engelKaldir: async (telefon) => engelliler.delete(telefon),
      otpKaydet: async () => {},
      otpDogrula: async (telefon, kod) => {
        const aday = [...otpKayitlari].reverse().find((k) => k.telefon === telefon && !k.dogrulandi);
        if (!aday || aday.kod !== kod) return { sonuc: "yanlis" };
        aday.dogrulandi = true;
        return { sonuc: "basarili" };
      },
      otpSonGonderim: async () => null,
      otpBugunSayisi: async () => 0,
    };
  }
  return orig.apply(this, arguments);
};

const { gunEkle, bugunStr } = require("../src/randevu-yardimci");

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { ...(veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const req = http.request({ host: "localhost", port: 3220, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

// Her test kendi sunucusuyla: IP başına istek sınırları sıfırdan başlasın
async function sunucu(t) {
  store = []; engelliler = new Map(); otpKayitlari.length = 0;
  process.env.PORT = "3220";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 300));
}

// Bugünden sonraki ilk `gun` haftagünü (0 = Pazar, 2 = Salı)
function sonrakiGun(gun) {
  let t = gunEkle(bugunStr(), 1);
  while (new Date(t + "T00:00:00").getDay() !== gun) t = gunEkle(t, 1);
  return t;
}

const TEL = "905553340001";
const SALI = sonrakiGun(2);
// Eren Salı 09:45'te başlar, 45 dk'lık slotlar: 09:45, 10:30, 11:15, 12:00, 12:45 ...
const randevuAl = (saat, tarih = SALI, telefon = "0555 334 00 01") =>
  istek("POST", "/api/public/randevu", { ad: "Ali Veli", telefon, berberId: "eren", hizmetId: "sac", tarih, saat });

const giris = async (body) => (await istek("POST", "/api/auth", body)).body.token;

test("engellenen numara web'den randevu alamaz, başka numara alır", async (t) => {
  await sunucu(t);
  engelliler.set(TEL, { telefon: TEL });
  const r = await randevuAl("10:30");
  assert.strictEqual(r.status, 403);
  assert.match(r.body.hata, /online randevu alınamıyor/);
  assert.strictEqual(store.length, 0);
  assert.strictEqual((await randevuAl("10:30", SALI, "0555 334 00 02")).status, 201);
});

test("aynı güne en fazla 3 aktif randevu; başka gün serbest", async (t) => {
  await sunucu(t);
  for (const saat of ["09:45", "10:30", "11:15"]) assert.strictEqual((await randevuAl(saat)).status, 201, saat);
  const dorduncu = await randevuAl("12:00");
  assert.strictEqual(dorduncu.status, 409);
  assert.match(dorduncu.body.hata, /aynı güne en fazla 3/);
  assert.strictEqual((await randevuAl("12:00", gunEkle(SALI, 1))).status, 201, "ertesi gün serbest");
});

test("iptal edilen randevu sayılmaz, yerine yenisi alınabilir", async (t) => {
  await sunucu(t);
  for (const saat of ["09:45", "10:30", "11:15"]) await randevuAl(saat);
  store[0].durum = "iptal";
  assert.strictEqual((await randevuAl("12:00")).status, 201);
  assert.strictEqual((await randevuAl("12:45")).status, 409);
});

test("taşıma: dolu güne 4. randevu olarak taşınamaz, aynı gün içinde saat değişir; engelli taşıyamaz", async (t) => {
  await sunucu(t);
  const CARSAMBA = gunEkle(SALI, 1);
  for (const saat of ["09:45", "10:30", "11:15"]) await randevuAl(saat);
  await randevuAl("11:15", CARSAMBA); // id r3

  await istek("POST", "/api/public/otp-gonder", { telefon: TEL });
  const kod = otpKayitlari.at(-1).kod;
  const { dogrulamaToken } = (await istek("POST", "/api/public/otp-dogrula", { telefon: TEL, kod })).body;
  const tasi = (id, tarih, saat) => istek("POST", `/api/public/randevu/${id}/tasi`, { dogrulamaToken, tarih, saat });

  assert.strictEqual((await tasi("r3", SALI, "12:00")).status, 409, "Salı'da zaten 3 randevu var");
  assert.strictEqual((await tasi("r0", SALI, "12:45")).status, 200, "aynı gün içinde saat değişimi serbest");
  engelliler.set(TEL, { telefon: TEL });
  assert.strictEqual((await tasi("r3", CARSAMBA, "12:00")).status, 403, "engelli numara taşıyamaz");
});

test("panel: her usta engeller, sadece yönetici kaldırır", async (t) => {
  await sunucu(t);
  assert.strictEqual((await istek("POST", "/api/engelli", { telefon: TEL })).status, 401);
  const usta = await giris({ berberId: "eren", pin: process.env.PIN_EREN });
  const admin = await giris({ admin: true, pin: process.env.ADMIN_PIN });

  assert.strictEqual((await istek("POST", "/api/engelli", { telefon: "123" }, usta)).status, 400);
  const e = await istek("POST", "/api/engelli", { telefon: "0555 334 00 01", ad: "Ali Veli" }, usta);
  assert.strictEqual(e.status, 201);
  assert.deepStrictEqual(engelliler.get(TEL), { telefon: TEL, ad: "Ali Veli", engelleyen: "Eren Tokalak" });
  assert.strictEqual((await istek("GET", "/api/engelli", null, usta)).body.length, 1);

  assert.strictEqual((await istek("DELETE", `/api/engelli/${TEL}`, null, usta)).status, 403);
  assert.strictEqual((await istek("DELETE", `/api/engelli/${TEL}`, null, admin)).status, 200);
  assert.strictEqual(engelliler.size, 0);
  assert.strictEqual((await istek("DELETE", `/api/engelli/${TEL}`, null, admin)).status, 404);
});
