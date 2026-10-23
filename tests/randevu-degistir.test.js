const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Musterinin kendi web randevusunun tarihini/saatini degistirmesi (self-servis),
// iptal edip yeniden almak yerine. POST /api/public/randevu/:id/tasi — iptal
// ile ayni dogrulama (SMS kodu + token), yeni randevu ile ayni tarih kurallari.
// ---------------------------------------------------------------------------
process.env.NETGSM_USERCODE = "test-user"; // dev-mode kisayolu yerine sms.otpGonder cagrilsin

const smsGonderilenler = [];
const tasindiSmsleri = [];
const otpKayitlari = [];
let store = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, clearRandevuCell: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./sms" || req.endsWith("/sms")) {
    return {
      otpGonder: async (telefon, kod) => { smsGonderilenler.push({ telefon, kod }); return { hata: false }; },
      randevuTasindiSms: async (r, tarihStr) => { tasindiSmsleri.push({ ...r, tarihStr }); return { hata: false }; },
      randevuIptalSms: async () => ({ hata: false }),
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
      updateTarihSaat: async (id, tarih, saat) => {
        if (store.some((r) => r.id !== id && r.berberId === store.find((x) => x.id === id).berberId && r.tarih === tarih && r.saat === saat && aktif(r))) {
          throw Object.assign(new Error("dolu"), { code: "SLOT_DOLU" });
        }
        const r = store.find((x) => x.id === id);
        Object.assign(r, { tarih, saat });
        return { ...r };
      },
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async (telefon, kod, sonGecerlilik) => { otpKayitlari.push({ telefon, kod, sonGecerlilik, dogrulandi: false }); },
      otpDogrula: async (telefon, kod) => {
        const aday = [...otpKayitlari].reverse().find((k) => k.telefon === telefon && !k.dogrulandi);
        if (!aday) return { sonuc: "kod_yok" };
        if (aday.kod !== kod) return { sonuc: "yanlis" };
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

function istek(method, path, body) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {};
    const req = http.request({ host: "localhost", port: 3217, path, method, headers }, (res) => {
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
  store = []; smsGonderilenler.length = 0; tasindiSmsleri.length = 0; otpKayitlari.length = 0;
  process.env.PORT = "3217";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));
}

async function tokenAl(tel) {
  await istek("POST", "/api/public/otp-gonder", { telefon: tel });
  const kod = smsGonderilenler.filter((s) => s.telefon === tel).slice(-1)[0].kod;
  return (await istek("POST", "/api/public/otp-dogrula", { telefon: tel, kod })).body.dogrulamaToken;
}

// Bugunden sonraki ilk `gun` haftagunu (0 = Pazar, 2 = Sali)
function sonrakiGun(gun) {
  let t = gunEkle(bugunStr(), 1);
  while (new Date(t + "T00:00:00").getDay() !== gun) t = gunEkle(t, 1);
  return t;
}

const TEL = "905553340001";
// Eren Salı 09:45'te baslar, 45 dk'lik slotlar: 09:45, 10:30, 11:15 ...
const webRandevu = (ek = {}) => ({
  id: "r1", kaynak: "web", telefon: TEL, berberId: "eren", berber: "Eren Tokalak", hizmetId: "sac", hizmet: "Saç Kesimi",
  tarih: sonrakiGun(2), saat: "10:30", durum: "onaylı", ...ek,
});

test("musteri kendi web randevusunu baska gun ve saate alir, SMS ile bilgilendirilir", async (t) => {
  await sunucu(t);
  store.push(webRandevu());
  const token = await tokenAl(TEL);
  const yeniGun = gunEkle(sonrakiGun(2), 1); // Carsamba

  const res = await istek("POST", "/api/public/randevu/r1/tasi", { dogrulamaToken: token, tarih: yeniGun, saat: "11:15" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.tarih, yeniGun);
  assert.strictEqual(res.body.saat, "11:15");
  assert.strictEqual(store[0].saat, "11:15");
  assert.strictEqual(tasindiSmsleri.length, 1, "taşındı SMS'i gitmeli");
  assert.strictEqual(tasindiSmsleri[0].saat, "11:15");
});

test("dogrulama yoksa 401, baskasinin ya da whatsapp randevusu 403", async (t) => {
  await sunucu(t);
  store.push(webRandevu(), webRandevu({ id: "r2", telefon: "905553340099" }), webRandevu({ id: "r3", kaynak: "whatsapp", saat: "11:15" }));
  const govde = { tarih: sonrakiGun(2), saat: "12:00" };

  assert.strictEqual((await istek("POST", "/api/public/randevu/r1/tasi", { ...govde, dogrulamaToken: "gecersiz" })).status, 401);
  const token = await tokenAl(TEL);
  assert.strictEqual((await istek("POST", "/api/public/randevu/r2/tasi", { ...govde, dogrulamaToken: token })).status, 403);
  assert.strictEqual((await istek("POST", "/api/public/randevu/r3/tasi", { ...govde, dogrulamaToken: token })).status, 403);
  assert.strictEqual(tasindiSmsleri.length, 0);
});

test("yeni randevudaki tarih kurallari gecerli: mesai disi, Pazar, 2 hafta, dolu, ayni saat, iptal", async (t) => {
  await sunucu(t);
  const sali = sonrakiGun(2);
  store.push(webRandevu(), webRandevu({ id: "dolu", telefon: "905553340077", saat: "11:15" }), webRandevu({ id: "r9", saat: "12:00", durum: "iptal" }));
  const token = await tokenAl(TEL);
  const tasi = (id, tarih, saat) => istek("POST", `/api/public/randevu/${id}/tasi`, { dogrulamaToken: token, tarih, saat });

  assert.strictEqual((await tasi("r1", sali, "08:00")).status, 400, "mesai dışı");
  assert.strictEqual((await tasi("r1", sali, "16:30")).status, 400, "yemek arası");
  assert.strictEqual((await tasi("r1", sonrakiGun(0), "10:30")).status, 400, "Pazar kapalı");
  assert.strictEqual((await tasi("r1", gunEkle(bugunStr(), 30), "10:30")).status, 400, "2 haftadan ileri");
  assert.strictEqual((await tasi("r1", sali, "11:15")).status, 409, "dolu saat");
  assert.strictEqual((await tasi("r1", sali, "10:30")).status, 400, "zaten bu saatte");
  assert.strictEqual((await tasi("r1", sali)).status, 400, "eksik parametre");
  assert.strictEqual((await tasi("r9", sali, "12:45")).status, 409, "iptal edilmiş randevu taşınamaz");
  assert.strictEqual(store[0].saat, "10:30", "hiçbiri randevuyu değiştirmemeli");
  assert.strictEqual(tasindiSmsleri.length, 0);
});
