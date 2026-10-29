const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// DEMO ayarı olmayan (gerçek) kurulum demo değişikliklerinden etkilenmemeli:
// sayfalar Resul Tabu ve analitikle gelir, PIN'siz giriş yok, demo adresleri
// yok, veri silen demo fonksiyonu çalışmaz, SMS Netgsm'e gider.
// ---------------------------------------------------------------------------
delete process.env.DEMO;
process.env.NETGSM_USERCODE = "u";
process.env.NETGSM_PASSWORD = "p";
process.env.NETGSM_MSGHEADER = "h";

const axiosCagrilari = [];
const orig = Module._load;
Module._load = function (req) {
  if (req === "axios") return { get: async (...a) => { axiosCagrilari.push(a); return { data: "00 1" }; } };
  if (req.endsWith("whatsapp")) return { sendText: async () => null, sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  return orig.apply(this, arguments);
};

process.env.PORT = "3219";
const { server } = require("../src/index");
const db = require("../src/db");
const sms = require("../src/sms");
test.after(() => new Promise((r) => server.close(r)));

function istek(method, path, body) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {};
    const req = http.request({ host: "localhost", port: 3219, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

test("sayfalar gerçek dükkânla ve analitikle gelir, demo eki yok", async () => {
  const { status, body } = await istek("GET", "/randevu-al/");
  assert.strictEqual(status, 200);
  assert.ok(body.includes("Resul Tabu Saç Atölyesi") && body.includes("googletagmanager"));
  assert.ok(!body.includes("/demo/demo.js") && !body.includes("noindex"));
  // "Randevu sistemi: Çatalçam Yazılım" satırı sunucunun gönderdiği HTML'de (JS ile sonradan değil)
  assert.ok(body.includes('Randevu sistemi: <a href="https://www.catalcamyazilim.online/?utm_source=resultabu&amp;utm_medium=referral&amp;utm_campaign=imza" target="_blank" rel="noopener">Çatalçam Yazılım</a>'));
  assert.ok(!(await istek("GET", "/dashboard")).body.includes("catalcamyazilim"), "panelde imza yok");
  assert.ok(!(await istek("GET", "/dashboard")).body.includes("/demo/"));
  assert.strictEqual((await istek("GET", "/saglik")).status, 404);
  assert.strictEqual((await istek("GET", "/demo/demo.js")).status, 404);
});

test("PIN'siz giriş reddedilir", async () => {
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "eren", pin: "" })).status, 401);
  assert.strictEqual((await istek("POST", "/api/auth", { admin: true })).status, 401);
  assert.strictEqual((await istek("POST", "/api/auth", { ciro: true, pin: "" })).status, 401);
  assert.strictEqual((await istek("POST", "/api/auth", { berberId: "eren", pin: process.env.PIN_EREN })).status, 200);
});

test("demo sıfırlama gerçek kurulumda çalışmaz", async () => {
  await assert.rejects(db.demoSifirla([], "2026-10-24"), /DEMO=true/);
  await assert.rejects(db.demoSonSifirlama(), /DEMO=true/);
});

test("SMS Netgsm'e gider, metinde gerçek dükkân ve adres", async () => {
  const sonuc = await sms.randevuOnaySms({ telefon: "905553340001", saat: "10:30", berber: "Eren Tokalak", hizmet: "Saç Kesimi" }, "26 Ekim Pazartesi");
  assert.deepStrictEqual(sonuc, { hata: false });
  assert.strictEqual(axiosCagrilari.length, 1);
  assert.strictEqual(axiosCagrilari[0][1].params.message,
    "Resul Tabu Saç Atölyesi: Randevunuz alındı. 26 Ekim Pazartesi 10:30, Eren Tokalak, Saç Kesimi. İptal için: randevu.resultabu.com");
});

test("robots.txt, sitemap.xml ve llms.txt gerçek dükkânla gelir", async () => {
  const robots = await istek("GET", "/robots.txt");
  assert.ok(robots.body.includes("Disallow: /dashboard\nDisallow: /api/"));
  assert.ok(robots.body.includes("Sitemap: https://randevu.resultabu.com/sitemap.xml"));
  const harita = await istek("GET", "/sitemap.xml");
  assert.ok(harita.body.includes("<loc>https://randevu.resultabu.com/randevu-al</loc>"));
  const llms = await istek("GET", "/llms.txt");
  assert.strictEqual(llms.status, 200);
  assert.ok(llms.body.startsWith("# Resul Tabu Saç Atölyesi"));
  assert.ok(llms.body.includes("Kaş Tasarımı: 300 ₺") && llms.body.includes("Resul Tabu (dükkân sahibi)"));
  console.log(llms.body);
});
