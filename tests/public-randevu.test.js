const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// POST /api/public/randevu — dogrulanmis telefonla randevu olusturma.
// db/sheets/email mock'lanir; dogrulama token'ini test dogrudan sunucunun
// bellek ici otp-dogrula akisi UZERINDEN degil, gercek /api/public/otp-*
// uclarini kullanarak elde eder (uctan uca, gercekci).
// Bu dosya OTP_AKTIF=true (token zorunlu) akisini test eder — OTP kapaliyken
// (varsayilan/production su an) davranis icin tests/randevu-otpsuz.test.js'e bak.
// ---------------------------------------------------------------------------
process.env.NETGSM_USERCODE = "test-user";
process.env.OTP_AKTIF = "true";

const otpKayitlari = [];
const smsGonderilenler = [];
const store = []; // randevular
let slotDoluAt = null; // { berberId, tarih, saat } -> add() SlotDoluError firlatsin

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) {
    return { sendText: async () => null, sendTemplate: async () => null };
  }
  if (req.endsWith("sheets")) {
    return {
      syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {},
      isEnabled: () => false, aylikOzetYaz: async () => {},
    };
  }
  if (req === "./sms" || req.endsWith("/sms")) {
    return {
      otpGonder: async (telefon, kod) => { smsGonderilenler.push({ telefon, kod }); return { hata: false }; },
    };
  }
  if (req === "./email" || req.endsWith("/email")) {
    const cagrilar = [];
    Module._epostaCagrilari = cagrilar; // testten erisim icin
    return {
      randevuAlindiMaili: async (r) => { cagrilar.push(["alindi", r]); return null; },
      randevuOnayMaili: async () => null, randevuIptalMaili: async () => null, randevuHatirlatmaMaili: async () => null,
    };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => [],
      add: async (r) => {
        if (slotDoluAt && r.berberId === slotDoluAt.berberId && r.tarih === slotDoluAt.tarih && r.saat === slotDoluAt.saat) {
          const e = new Error("Seçilen saat dolu."); e.code = "SLOT_DOLU"; throw e;
        }
        const kayit = { ...r, id: "kayit" + store.length, durum: r.durum || "bekliyor" };
        store.push(kayit);
        return kayit;
      },
      getAll: async () => store.slice(),
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async (telefon, kod, sonGecerlilik) => {
        otpKayitlari.push({ telefon, kod, olusturulma: Date.now(), sonGecerlilik, deneme: 0, dogrulandi: false });
      },
      otpDogrula: async (telefon, kod) => {
        const aday = [...otpKayitlari].reverse().find((k) => k.telefon === telefon && !k.dogrulandi);
        if (!aday) return { sonuc: "kod_yok" };
        if (Date.now() > aday.sonGecerlilik) return { sonuc: "suresi_gecti" };
        if (aday.kod !== kod) { aday.deneme++; return { sonuc: "yanlis" }; }
        aday.dogrulandi = true;
        return { sonuc: "basarili" };
      },
      otpSonGonderim: async (telefon) => {
        const k = otpKayitlari.filter((x) => x.telefon === telefon);
        return k.length ? k[k.length - 1].olusturulma : null;
      },
      otpBugunSayisi: async (telefon) => otpKayitlari.filter((x) => x.telefon === telefon).length,
    };
  }
  return orig.apply(this, arguments);
};

function istek(method, path, body) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {};
    const req = http.request({ host: "localhost", port: 3201, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

// Gerçek OTP uçlarını kullanarak geçerli bir doğrulama token'ı üretir
async function tokenAl(tel) {
  await istek("POST", "/api/public/otp-gonder", { telefon: tel });
  const kod = smsGonderilenler.filter((s) => s.telefon === tel).slice(-1)[0].kod;
  const r = await istek("POST", "/api/public/otp-dogrula", { telefon: tel, kod });
  return r.body.dogrulamaToken;
}

function yarinTarih() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Pazar ise bir gün daha ileri
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("gecerli token ile randevu bekliyor durumunda ve kaynak=web olarak olusur", async (t) => {
  store.length = 0; slotDoluAt = null;
  process.env.PORT = "3201";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905552220001";
  const token = await tokenAl(tel);
  assert.ok(token, "token alinabilmeli");

  const tarih = yarinTarih();
  const res = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: token, ad: "Test Musteri",
    berberId: "resul", hizmetId: "sac", tarih, saat: "10:00",
  });

  assert.strictEqual(res.status, 201, "randevu olusmali");
  assert.strictEqual(res.body.durum, "bekliyor");
  assert.strictEqual(res.body.kaynak, "web");
  assert.strictEqual(res.body.telefon, tel, "telefon token'dan alinmali, body'den degil");
});

test("gecersiz/eksik token ile 401 doner", async (t) => {
  store.length = 0; slotDoluAt = null;
  process.env.PORT = "3201";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const res = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: "gecersiz-token", ad: "Test",
    berberId: "resul", hizmetId: "sac", tarih: yarinTarih(), saat: "10:00",
  });
  assert.strictEqual(res.status, 401);
});

test("dolu slota randevu denemesi 409 doner", async (t) => {
  store.length = 0; slotDoluAt = null;
  process.env.PORT = "3201";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tarih = yarinTarih();
  slotDoluAt = { berberId: "resul", tarih, saat: "10:00" };

  const token = await tokenAl("905552220002");
  const res = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: token, ad: "Test", berberId: "resul", hizmetId: "sac", tarih, saat: "10:00",
  });
  assert.strictEqual(res.status, 409);
});

test("gecmis saate randevu denemesi 400 doner", async (t) => {
  store.length = 0; slotDoluAt = null;
  process.env.PORT = "3201";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const token = await tokenAl("905552220003");
  const bugun = new Date();
  const tarihStr = `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}-${String(bugun.getDate()).padStart(2, "0")}`;
  const res = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: token, ad: "Test", berberId: "resul", hizmetId: "sac", tarih: tarihStr, saat: "00:01",
  });
  assert.strictEqual(res.status, 400);
});

test("email bos birakilinca randevu yine olusur, bildirim atlanir", async (t) => {
  store.length = 0; slotDoluAt = null;
  process.env.PORT = "3201";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));
  Module._epostaCagrilari.length = 0;

  const token = await tokenAl("905552220004");
  const res = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: token, ad: "Test", berberId: "resul", hizmetId: "sac", tarih: yarinTarih(), saat: "11:00",
  });
  assert.strictEqual(res.status, 201);
  assert.ok(!res.body.email, "email gonderilmemisse kayitta olmamali (null/undefined)");
  assert.strictEqual(Module._epostaCagrilari.length, 0, "email bossa bildirim gonderilmemeli");
});

test("dogrulama token tek kullanimlik — ikinci istekte 401", async (t) => {
  store.length = 0; slotDoluAt = null;
  process.env.PORT = "3201";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const token = await tokenAl("905552220005");
  const tarih = yarinTarih();
  const ilk = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: token, ad: "Test", berberId: "resul", hizmetId: "sac", tarih, saat: "12:00",
  });
  assert.strictEqual(ilk.status, 201);

  const ikinci = await istek("POST", "/api/public/randevu", {
    dogrulamaToken: token, ad: "Test", berberId: "resul", hizmetId: "sac", tarih, saat: "13:00",
  });
  assert.strictEqual(ikinci.status, 401, "kullanilmis token tekrar kullanilamamali");
});
