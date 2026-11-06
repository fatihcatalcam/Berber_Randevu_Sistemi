const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");

// ---------------------------------------------------------------------------
// Kasa defteri (/api/kasa): ciro sayfasında randevu dışı ekstra gelir (ürün
// satışı: Wax 250₺) ve giderler. Ciro şifresi ve admin tutar; ustalar göremez.
// ---------------------------------------------------------------------------
delete process.env.DEMO;

let kasa = [];
let sonId = 0;
const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => null, sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getRecentAndUpcoming: async () => [],
      kasaListe: async (ay) => kasa.filter((k) => k.tarih.startsWith(ay + "-")),
      kasaEkle: async (k) => { const kayit = { ...k, id: String(++sonId) }; kasa.push(kayit); return kayit; },
      kasaSil: async (id) => { const once = kasa.length; kasa = kasa.filter((k) => k.id !== id); return kasa.length < once; },
    };
  }
  return orig.apply(this, arguments);
};

process.env.PORT = "3223";
const { server } = require("../src/index");
test.after(() => new Promise((r) => server.close(r)));

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { ...(veri ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const req = http.request({ host: "localhost", port: 3223, path, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }));
    });
    req.on("error", reject);
    if (veri) req.write(veri);
    req.end();
  });
}

let ciro, admin, eren;
test.before(async () => {
  ciro = (await istek("POST", "/api/auth", { ciro: true, pin: "3131" })).body.token;
  admin = (await istek("POST", "/api/auth", { admin: true, pin: process.env.ADMIN_PIN })).body.token;
  eren = (await istek("POST", "/api/auth", { berberId: "eren", pin: process.env.PIN_EREN })).body.token;
  assert.ok(ciro && admin && eren);
});

const wax = { tarih: "2026-11-06", tur: "gelir", ad: "Wax", tutar: 250 };

test("ciro şifresiyle gelir/gider eklenir, aya göre listelenir, silinir", async () => {
  kasa = [];
  const gelir = await istek("POST", "/api/kasa", { ...wax, ad: "  Wax  " }, ciro);
  assert.strictEqual(gelir.status, 201);
  assert.deepStrictEqual({ ...gelir.body, id: undefined }, { ...wax, ekleyen: "Ciro", id: undefined }, "açıklama kırpılır");
  assert.strictEqual((await istek("POST", "/api/kasa", { tarih: "2026-11-07", tur: "gider", ad: "Elektrik", tutar: 1200 }, ciro)).status, 201);
  assert.strictEqual((await istek("POST", "/api/kasa", { tarih: "2026-12-01", tur: "gelir", ad: "Şampuan", tutar: 300 }, ciro)).status, 201);

  const kasim = await istek("GET", "/api/kasa?ay=2026-11", null, ciro);
  assert.strictEqual(kasim.status, 200);
  assert.deepStrictEqual(kasim.body.map((k) => k.ad), ["Wax", "Elektrik"]);

  assert.strictEqual((await istek("DELETE", "/api/kasa/" + gelir.body.id, null, ciro)).status, 200);
  assert.strictEqual((await istek("DELETE", "/api/kasa/" + gelir.body.id, null, ciro)).status, 404, "ikinci silme");
  assert.strictEqual((await istek("DELETE", "/api/kasa/abc", null, ciro)).status, 404);
  assert.deepStrictEqual((await istek("GET", "/api/kasa?ay=2026-11", null, ciro)).body.map((k) => k.ad), ["Elektrik"]);
});

test("admin de tutabilir; usta ve kimliksiz erişemez", async () => {
  const a = await istek("POST", "/api/kasa", wax, admin);
  assert.strictEqual(a.status, 201);
  assert.strictEqual(a.body.ekleyen, "Admin");
  assert.strictEqual((await istek("GET", "/api/kasa?ay=2026-11", null, admin)).status, 200);

  const once = kasa.length;
  assert.strictEqual((await istek("GET", "/api/kasa?ay=2026-11", null, eren)).status, 403);
  assert.strictEqual((await istek("POST", "/api/kasa", wax, eren)).status, 403);
  assert.strictEqual((await istek("DELETE", "/api/kasa/" + a.body.id, null, eren)).status, 403);
  assert.strictEqual((await istek("GET", "/api/kasa?ay=2026-11")).status, 401);
  assert.strictEqual((await istek("POST", "/api/kasa", wax)).status, 401);
  assert.strictEqual(kasa.length, once, "yetkisiz istek kayıt eklememeli/silmemeli");
});

test("geçersiz girişler 400", async () => {
  const once = kasa.length;
  const hatali = [
    { tur: "bahsis" }, { tur: undefined }, { ad: "   " }, { ad: "x".repeat(61) },
    { tutar: 0 }, { tutar: -5 }, { tutar: 12.5 }, { tutar: "abc" }, { tutar: undefined },
    { tarih: "2026-02-30" }, { tarih: "2026-13-01" }, { tarih: "06.11.2026" }, { tarih: undefined },
  ];
  for (const fark of hatali)
    assert.strictEqual((await istek("POST", "/api/kasa", { ...wax, ...fark }, ciro)).status, 400, JSON.stringify(fark));
  assert.strictEqual(kasa.length, once);
  for (const ay of ["", "2026-13", "2026-1", "2026-11-01", "x"])
    assert.strictEqual((await istek("GET", "/api/kasa?ay=" + ay, null, ciro)).status, 400, ay);
});

test("ciro şifresi kasa dışında yine sadece randevu listesini okur", async () => {
  assert.strictEqual((await istek("GET", "/api/randevular", null, ciro)).status, 200);
  assert.strictEqual((await istek("POST", "/api/randevular", { ad: "X", berberId: "eren", hizmetId: "sac", tarih: "2026-11-10", saat: "10:30" }, ciro)).status, 403);
  assert.strictEqual((await istek("GET", "/api/sabit", null, ciro)).status, 403);
});
