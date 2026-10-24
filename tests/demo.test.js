const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// DEMO=true kurulumu (randevu.catalcamyazilim.online): Örnek Berber sayfaları,
// SMS gönderilmeden yanıtta "demoSms" olarak dönmesi, şifresiz giriş ve
// açılışta demo verisinin yüklenmesi. sms.js gerçek modül; axios'a hiç
// istek gitmemeli. Gerçek kurulumun aynı kalması: tests/demo-kapali.test.js
// ---------------------------------------------------------------------------
process.env.DEMO = "true";
process.env.NETGSM_USERCODE = "olmamali"; // ayarlı olsa bile demo SMS göndermez
process.env.NETGSM_PASSWORD = "olmamali";
process.env.NETGSM_MSGHEADER = "olmamali";
process.env.OTP_AKTIF = "true";
process.env.RANDEVU_ACILIS_TARIHI = "2020-01-01T00:00:00+03:00";

const axiosCagrilari = [];
const store = [];
const otpKayitlari = [];
const sifirlamalar = [];
const sabitKurallari = [];

const orig = Module._load;
Module._load = function (req) {
  if (req === "axios") return { get: async (...a) => { axiosCagrilari.push(a); return { data: "00 1" }; } };
  if (req.endsWith("whatsapp")) return { sendText: async () => null, sendTemplate: async () => null };
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, musteriKaydet: async () => {}, clearRandevuCell: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./email" || req.endsWith("/email")) {
    return { randevuOnayMaili: async () => null, randevuIptalMaili: async () => null, randevuTasindiMaili: async () => null, randevuHatirlatmaMaili: async () => null };
  }
  if (req.endsWith("/db") || req === "../db" || req === "./db") {
    return {
      init: async () => {},
      degisimSurumu: () => "1",
      getBusySlots: async (berberId, tarih) => store.filter((r) => r.berberId === berberId && r.tarih === tarih).map((r) => r.saat),
      add: async (r) => { const k = { ...r, id: "k" + store.length, durum: r.durum || "bekliyor" }; store.push(k); return k; },
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      engelliMi: async () => false,
      telefonGunRandevuSayisi: async () => 0,
      otpKaydet: async (telefon, kod) => { otpKayitlari.push({ telefon, kod, dogrulandi: false }); },
      otpDogrula: async (telefon, kod) => {
        const aday = [...otpKayitlari].reverse().find((k) => k.telefon === telefon && !k.dogrulandi);
        if (!aday || aday.kod !== kod) return { sonuc: "yanlis" };
        aday.dogrulandi = true;
        return { sonuc: "basarili" };
      },
      otpSonGonderim: async () => null,
      otpBugunSayisi: async () => 0,
      demoSonSifirlama: async () => null,
      demoSifirla: async (randevular, gun) => { sifirlamalar.push({ randevular, gun }); },
      sabitEkle: async (k) => { const kural = { ...k, id: sabitKurallari.length + 1 }; sabitKurallari.push(kural); return kural; },
      sabitSonUretilenGuncelle: async () => {},
      sabitListe: async () => sabitKurallari,
    };
  }
  return orig.apply(this, arguments);
};

process.env.PORT = "3218";
const { server } = require("../src/index");
const { demoRandevulari, SABITLER } = require("../src/demo/veri");
const { bugunStr, gunEkle } = require("../src/randevu-yardimci");
test.after(() => new Promise((r) => server.close(r)));

function istek(method, path, body) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {};
    const req = http.request({ host: "localhost", port: 3218, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        let govde = b;
        try { govde = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, body: govde });
      });
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

test("sayfalar Örnek Berber olarak gelir: Resul Tabu, analitik ve gerçek telefon yok", async () => {
  for (const yol of ["/randevu-al", "/randevu-al/index.html", "/dashboard", "/dashboard/ciro"]) {
    const { status, body } = await istek("GET", yol);
    assert.strictEqual(status, 200, yol);
    assert.ok(body.includes("Örnek Berber"), `${yol}: demo adı`);
    assert.ok(!body.includes("Resul"), `${yol}: Resul geçmemeli`);
    assert.ok(!body.includes("googletagmanager") && !body.includes("clarity.ms"), `${yol}: analitik yok`);
    assert.ok(!body.includes("905359116681") && !body.includes("logo.jpg"), `${yol}: gerçek telefon/logo yok`);
    assert.ok(body.includes('/demo/demo.js') && body.includes('content="noindex"'), `${yol}: demo arayüzü`);
  }
  assert.strictEqual((await istek("GET", "/saglik")).body, "ok");
  assert.strictEqual((await istek("GET", "/demo/logo.svg")).status, 200);
});

test("config demo ustalarını verir", async () => {
  const { body } = await istek("GET", "/api/config");
  assert.deepStrictEqual(body.berberler.map((b) => b.id), ["murat", "okan", "serdar", "volkan", "caner"]);
});

test("SMS gönderilmez; kod ve onay mesajı yanıtta demoSms olarak döner", async () => {
  const tel = "905553340001";
  const kodYaniti = await istek("POST", "/api/public/otp-gonder", { telefon: "0555 334 00 01" });
  assert.strictEqual(kodYaniti.status, 200);
  const [sms] = kodYaniti.body.demoSms;
  assert.strictEqual(sms.telefon, tel);
  const kod = sms.mesaj.match(/Örnek Berber doğrulama kodunuz: (\d{6})/)[1];
  assert.strictEqual(kod, otpKayitlari.at(-1).kod);

  const { body: { dogrulamaToken } } = await istek("POST", "/api/public/otp-dogrula", { telefon: tel, kod });
  let tarih = gunEkle(bugunStr(), 1);
  if (new Date(tarih + "T00:00:00").getDay() === 0) tarih = gunEkle(tarih, 1);
  const r = await istek("POST", "/api/public/randevu", { dogrulamaToken, ad: "Demo Ziyaretçi", berberId: "okan", hizmetId: "sac", tarih, saat: "12:15" });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.demoSms.length, 1);
  assert.match(r.body.demoSms[0].mesaj, /^Örnek Berber: Randevunuz alındı\. .* 12:15, Okan Er, Saç Kesimi\. İptal için: randevu\.catalcamyazilim\.online$/);
  assert.strictEqual(axiosCagrilari.length, 0, "Netgsm'e istek gitmemeli");
});

test("panel ve ciro girişi şifresiz", async () => {
  const usta = await istek("POST", "/api/auth", { berberId: "okan", pin: "" });
  assert.strictEqual(usta.body.role, "berber");
  assert.ok(usta.body.token);
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "murat" })).body.role, "admin"); // dükkân sahibi
  assert.strictEqual((await istek("POST", "/api/auth", { admin: true })).body.role, "admin");
  assert.strictEqual((await istek("POST", "/api/auth", { ciro: true })).body.role, "ciro");
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "resul" })).status, 404);
});

test("açılışta demo verisi yüklenir ve sabit müşteriler eklenir", async () => {
  for (let i = 0; i < 20 && !sabitKurallari.length; i++) await bekle(100);
  assert.strictEqual(sifirlamalar.length, 1);
  assert.ok(sifirlamalar[0].randevular.length > 300, `yeterince randevu: ${sifirlamalar[0].randevular.length}`);
  assert.strictEqual(sabitKurallari.length, SABITLER.length);
  assert.ok(store.some((r) => r.kaynak === "sabit" && r.ad === "Kemal Yurt"), "sabit randevular üretildi");
});

test("demo randevuları: aynı gün aynı veri, Pazar yok, çift randevu yok, sabit saatler boş", () => {
  const bugun = "2026-10-21"; // Çarşamba
  const a = demoRandevulari(bugun, "14:00");
  assert.deepStrictEqual(demoRandevulari(bugun, "14:00"), a, "aynı tohum aynı veri");
  assert.ok(a.every((r) => new Date(r.tarih + "T00:00:00").getDay() !== 0), "Pazar yok");
  const anahtarlar = a.map((r) => `${r.berberId}|${r.tarih}|${r.saat}`);
  assert.strictEqual(new Set(anahtarlar).size, anahtarlar.length, "çift randevu yok");
  assert.ok(a.filter((r) => r.tarih > bugun || (r.tarih === bugun && r.saat >= "14:00")).every((r) => r.durum !== "gelmedi"), "ileride gelmedi yok");
  assert.ok(!a.some((r) => r.tarih >= bugun && r.berberId === "okan" && r.saat === "18:15" && new Date(r.tarih + "T00:00:00").getDay() === 2), "sabit saat boş");
  assert.ok(a.some((r) => r.tarih < bugun && r.ad === "Kemal Yurt"), "sabit müşterinin geçmişi var");
  assert.ok(a.every((r) => r.olusturulma <= Date.now()));
});
