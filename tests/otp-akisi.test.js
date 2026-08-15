const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Bağımlılıkları mock'la: db (bellek içi OTP deposu), sms (gerçek SMS atmaz),
// whatsapp/sheets/email (no-op) — gerçek sunucu (src/index.js) ayağa kalkar.
// ---------------------------------------------------------------------------
process.env.NETGSM_USERCODE = "test-user"; // dev-mode kısayolunu atlat, gerçek sms.js yolunu test et

const otpKayitlari = []; // { telefon, kod, olusturulma, sonGecerlilik, deneme, dogrulandi }
const smsGonderilenler = [];
let smsHataVer = false;

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
      otpGonder: async (telefon, kod) => {
        smsGonderilenler.push({ telefon, kod });
        return smsHataVer ? { hata: true } : { hata: false };
      },
    };
  }
  if (req === "./email" || req.endsWith("/email")) {
    return {
      randevuAlindiMaili: async () => null, randevuOnayMaili: async () => null,
      randevuIptalMaili: async () => null, randevuHatirlatmaMaili: async () => null,
    };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => [],
      add: async (r) => ({ ...r, id: "1", durum: "bekliyor" }),
      getAll: async () => [],
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async (telefon, kod, sonGecerlilik) => {
        otpKayitlari.push({ telefon, kod, olusturulma: Date.now(), sonGecerlilik, deneme: 0, dogrulandi: false });
      },
      otpDogrula: async (telefon, kod) => {
        const aday = [...otpKayitlari].reverse().find((k) => k.telefon === telefon && !k.dogrulandi);
        if (!aday) return { sonuc: "kod_yok" };
        if (Date.now() > aday.sonGecerlilik) return { sonuc: "suresi_gecti" };
        if (aday.deneme >= 5) return { sonuc: "cok_deneme" };
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

function post(path, body) {
  return new Promise((resolve, reject) => {
    const veri = JSON.stringify(body);
    const req = http.request(
      { host: "localhost", port: 3200, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
      }
    );
    req.on("error", reject);
    req.write(veri);
    req.end();
  });
}

test("OTP akisi: gonder -> dogrula -> token", async (t) => {
  process.env.PORT = "3200";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905551110001";

  const gonder = await post("/api/public/otp-gonder", { telefon: tel });
  assert.strictEqual(gonder.status, 200, "kod gonderme basarili olmali");
  assert.strictEqual(smsGonderilenler.length, 1, "sms.otpGonder cagrilmali");
  assert.strictEqual(smsGonderilenler[0].telefon, "905551110001");

  const yanlisKod = await post("/api/public/otp-dogrula", { telefon: tel, kod: "000000" });
  assert.strictEqual(yanlisKod.status, 401, "yanlis kod 401 donmeli");

  const dogruKod = smsGonderilenler[0].kod;
  const dogrula = await post("/api/public/otp-dogrula", { telefon: tel, kod: dogruKod });
  assert.strictEqual(dogrula.status, 200, "dogru kod basarili olmali");
  assert.ok(dogrula.body.dogrulamaToken, "dogrulamaToken donmeli");
});

test("OTP akisi: 5 yanlis kod sonrasi kilitlenir", async (t) => {
  process.env.PORT = "3200";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905551110002";
  await post("/api/public/otp-gonder", { telefon: tel });

  for (let i = 0; i < 5; i++) {
    const r = await post("/api/public/otp-dogrula", { telefon: tel, kod: "999999" });
    assert.strictEqual(r.status, 401, `deneme ${i + 1} icin 401 beklenir`);
  }
  const altinci = await post("/api/public/otp-dogrula", { telefon: tel, kod: "999999" });
  assert.strictEqual(altinci.status, 429, "6. deneme kaba kuvvet korumasina takilmali");
});

test("OTP akisi: suresi gecmis kod reddedilir", async (t) => {
  process.env.PORT = "3200";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905551110003";
  await post("/api/public/otp-gonder", { telefon: tel });
  const kayit = otpKayitlari.find((k) => k.telefon === tel);
  kayit.sonGecerlilik = Date.now() - 1000; // suresi gecmis gibi isaretle

  const dogruKod = smsGonderilenler.find((s) => s.telefon === tel).kod;
  const r = await post("/api/public/otp-dogrula", { telefon: tel, kod: dogruKod });
  assert.strictEqual(r.status, 401);
  assert.match(r.body.hata, /süre/i);
});

test("OTP akisi: ayni telefona 60sn icinde ikinci gonderim engellenir", async (t) => {
  process.env.PORT = "3200";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const tel = "905551110004";
  const ilk = await post("/api/public/otp-gonder", { telefon: tel });
  assert.strictEqual(ilk.status, 200);

  const ikinci = await post("/api/public/otp-gonder", { telefon: tel });
  assert.strictEqual(ikinci.status, 429, "60sn icinde ikinci gonderim 429 donmeli");
});

test("OTP akisi: IP bazli dakikalik limit farkli telefonlar icin de gecerli", async (t) => {
  process.env.PORT = "3200";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  const sonuclar = [];
  for (let i = 0; i < 4; i++) {
    sonuclar.push(await post("/api/public/otp-gonder", { telefon: `90555111100${5 + i}` }));
  }
  assert.strictEqual(sonuclar[3].status, 429, "4. farkli telefon icin IP limiti devreye girmeli (3/dk)");
});
