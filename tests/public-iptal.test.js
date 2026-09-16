const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Musterinin kendi web randevusunu SMS OTP ile dogrulayip iptal edebilmesi
// (self-servis). GET /api/public/randevularim + POST /api/public/randevu/:id/iptal.
// ---------------------------------------------------------------------------
process.env.NETGSM_USERCODE = "test-user"; // dev-mode kisayolunu (konsola log) atlayip gercek sms.otpGonder cagrisi yapilsin

const otpKayitlari = [];
const smsGonderilenler = [];
const smsIptalCagrilari = [];
let store = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./sms" || req.endsWith("/sms")) {
    return {
      otpGonder: async (telefon, kod) => { smsGonderilenler.push({ telefon, kod }); return { hata: false }; },
      randevuIptalSms: async (r) => { smsIptalCagrilari.push(r); return { hata: false }; },
    };
  }
  if (req === "./email" || req.endsWith("/email")) {
    return { randevuAlindiMaili: async () => null, randevuOnayMaili: async () => null, randevuIptalMaili: async () => null, randevuTasindiMaili: async () => null, randevuHatirlatmaMaili: async () => null };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => [],
      getAll: async () => store.slice(),
      getById: async (id) => store.find((r) => r.id === id) || null,
      getRandevularByTelefon: async (telefon) => store.filter((r) => r.telefon === telefon && r.kaynak === "web" && ["bekliyor", "onaylı"].includes(r.durum)),
      updateStatus: async (id, durum, iptalEden) => {
        const k = store.find((r) => r.id === id);
        if (!k) return null;
        k.durum = durum;
        if (iptalEden) k.iptalEden = iptalEden;
        return { ...k };
      },
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
      otpSonGonderim: async () => null,
      otpBugunSayisi: async () => 0,
    };
  }
  return orig.apply(this, arguments);
};

function istek(method, path, body) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {};
    const req = http.request({ host: "localhost", port: 3210, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

async function tokenAl(tel) {
  await istek("POST", "/api/public/otp-gonder", { telefon: tel });
  const kod = smsGonderilenler.filter((s) => s.telefon === tel).slice(-1)[0].kod;
  const r = await istek("POST", "/api/public/otp-dogrula", { telefon: tel, kod });
  return r.body.dogrulamaToken;
}

function yarinTarih() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sifirla() {
  store = []; otpKayitlari.length = 0; smsGonderilenler.length = 0; smsIptalCagrilari.length = 0;
}

test("gecerli token ile kendi web randevusu listelenir ve iptal edilebilir", async (t) => {
  sifirla();
  process.env.PORT = "3210";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905553330001";
  store.push({ id: "r1", kaynak: "web", telefon: tel, tarih: yarinTarih(), saat: "10:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "bekliyor" });

  const token = await tokenAl(tel);
  const liste = await istek("GET", `/api/public/randevularim?dogrulamaToken=${token}`);
  assert.strictEqual(liste.status, 200);
  assert.strictEqual(liste.body.randevular.length, 1);
  assert.strictEqual(liste.body.randevular[0].id, "r1");

  const iptal = await istek("POST", "/api/public/randevu/r1/iptal", { dogrulamaToken: token });
  assert.strictEqual(iptal.status, 200);
  assert.strictEqual(iptal.body.durum, "iptal");
  assert.strictEqual(iptal.body.iptalEden, "musteri");
  assert.strictEqual(smsIptalCagrilari.length, 1, "sms.randevuIptalSms cagrilmali");
});

test("token olmadan/gecersizse liste ve iptal 401 doner", async (t) => {
  sifirla();
  process.env.PORT = "3210";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const liste = await istek("GET", "/api/public/randevularim?dogrulamaToken=gecersiz");
  assert.strictEqual(liste.status, 401);

  const iptal = await istek("POST", "/api/public/randevu/herhangi/iptal", { dogrulamaToken: "gecersiz" });
  assert.strictEqual(iptal.status, 401);
});

test("baskasinin randevusu iptal edilemez (telefon eslesmezse 403)", async (t) => {
  sifirla();
  process.env.PORT = "3210";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  store.push({ id: "r2", kaynak: "web", telefon: "905553330099", tarih: yarinTarih(), saat: "11:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "bekliyor" });

  const token = await tokenAl("905553330002"); // farkli telefon
  const iptal = await istek("POST", "/api/public/randevu/r2/iptal", { dogrulamaToken: token });
  assert.strictEqual(iptal.status, 403);
  assert.strictEqual(smsIptalCagrilari.length, 0);
});

test("whatsapp kaynakli randevu self-servisten iptal edilemez", async (t) => {
  sifirla();
  process.env.PORT = "3210";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905553330003";
  store.push({ id: "r3", kaynak: "whatsapp", telefon: tel, tarih: yarinTarih(), saat: "12:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "bekliyor" });

  const token = await tokenAl(tel);
  const liste = await istek("GET", `/api/public/randevularim?dogrulamaToken=${token}`);
  assert.strictEqual(liste.body.randevular.length, 0, "whatsapp kaynakli randevu listede gorunmemeli");

  const iptal = await istek("POST", "/api/public/randevu/r3/iptal", { dogrulamaToken: token });
  assert.strictEqual(iptal.status, 403);
});

test("zaten iptal edilmis randevu tekrar iptal edilemez (409)", async (t) => {
  sifirla();
  process.env.PORT = "3210";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905553330004";
  store.push({ id: "r4", kaynak: "web", telefon: tel, tarih: yarinTarih(), saat: "13:00", berber: "Resul Tabu", hizmet: "Saç Kesimi", durum: "iptal" });

  const token = await tokenAl(tel);
  const iptal = await istek("POST", "/api/public/randevu/r4/iptal", { dogrulamaToken: token });
  assert.strictEqual(iptal.status, 409);
});
