const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const Module = require("module");
const { BERBERLER } = require("../src/config");

// Haftalık sabit müşteri: kural -> 8 haftalık gerçek randevu, yetki, çakışma, durdurma.
let store = [];          // randevular
let kurallar = [];       // sabit_randevular
let doluTarihler = [];   // getBusySlots bu tarihlerde 10:30'u dolu döndürür

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) return { sendText: async () => ({ hata: false }), sendTemplate: async () => null };
  if (req.endsWith("sheets")) return { syncRandevu: async () => {}, clearRandevuCell: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) return {};
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {}, getHatirlatilacaklar: async () => [], degisimSurumu: () => "t:0",
      getAcikGunler: async () => [], getAcikSaatlerFor: async () => [],
      getBusySlots: async (berberId, tarih) => (doluTarihler.includes(tarih) ? ["10:30"] : []),
      add: async (r) => { const k = { ...r, id: "r" + store.length }; store.push(k); return k; },
      sabitEkle: async (k) => { const kural = { ...k, id: kurallar.length + 1, son_uretilen: null, aktif: true }; kurallar.push(kural); return { ...kural }; },
      sabitListe: async (berberId) => kurallar.filter((k) => k.aktif && (!berberId || k.berberId === berberId)),
      sabitGetir: async (id) => kurallar.find((k) => k.id === Number(id)) || null,
      sabitSonUretilenGuncelle: async (id, tarih) => { kurallar.find((k) => k.id === id).son_uretilen = tarih; },
      sabitGelecekSil: async (id, bugun) => {
        const silinen = store.filter((r) => r.sabitId === id && r.tarih > bugun);
        store = store.filter((r) => !silinen.includes(r));
        return silinen;
      },
      sabitDurdur: async (id, bugun) => {
        kurallar.find((k) => k.id === id).aktif = false;
        const silinen = store.filter((r) => r.sabitId === id && r.tarih > bugun);
        store = store.filter((r) => !silinen.includes(r));
        return silinen;
      },
      sabitGuncelle: async (id, k, yenidenBasla) => {
        const kural = kurallar.find((x) => x.id === id);
        Object.assign(kural, k);
        if (yenidenBasla) { kural.baslangic = yenidenBasla; kural.son_uretilen = null; }
        return { ...kural };
      },
      sabitGelecekGuncelle: async (id, bugun, saat, a) => {
        const liste = store.filter((r) => r.sabitId === id && r.tarih > bugun);
        for (const r of liste) Object.assign(r, { ad: a.ad, telefon: a.telefon, hizmetId: a.hizmetId, hizmet: a.hizmet, fiyat: a.fiyat });
        return liste;
      },
    };
  }
  return orig.apply(this, arguments);
};

const { sabitTarihleri } = require("../src/randevu-yardimci");

function istek(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const veri = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (veri) headers["Content-Length"] = Buffer.byteLength(veri);
    const req = http.request({ host: "localhost", port: 3215, path, method, headers }, (res) => {
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
  process.env.PORT = "3215";
  delete require.cache[require.resolve("../src/index")];
  const mod = require("../src/index");
  t.after(() => new Promise((r) => mod.server.close(r)));
  await new Promise((r) => setTimeout(r, 400));
  return mod;
}

async function girisYap(berber) {
  return (await istek("POST", "/api/auth", { berberId: berber.id, pin: berber.pin })).body.token;
}

test("sabitTarihleri: dogru haftagunu, 56 gun ufku, baslangic ve son_uretilen sonrasi", () => {
  // 2026-10-05 Pazartesi
  const { tarihler, bitis } = sabitTarihleri({ gun: 2, baslangic: "2026-10-01" }, "2026-10-05");
  assert.strictEqual(bitis, "2026-11-30");
  assert.deepStrictEqual(tarihler, ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27",
    "2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);

  const ileri = sabitTarihleri({ gun: 2, baslangic: "2026-11-01" }, "2026-10-05");
  assert.strictEqual(ileri.tarihler[0], "2026-11-03", "baslangictan once uretilmez");

  // Ertesi gun: sadece ufka yeni giren hafta uretilir
  const ertesi = sabitTarihleri({ gun: 2, baslangic: "2026-10-01", son_uretilen: "2026-11-30" }, "2026-10-06");
  assert.deepStrictEqual(ertesi.tarihler, ["2026-12-01"]);
});

test("berber kural ekler: haftalik randevular uretilir, kendi adina kaydolur, dolu hafta atlanir, tekrar uretilmez", async (t) => {
  store = []; kurallar = [];
  const eren = BERBERLER.find((b) => b.id === "eren");
  const beklenen = sabitTarihleri({ gun: 2, baslangic: "2000-01-01" }).tarihler;
  doluTarihler = [beklenen[1]];
  const { sabitUret } = await sunucu(t);
  const token = await girisYap(eren);

  const res = await istek("POST", "/api/sabit",
    { ad: "Sabit Müşteri", telefon: "905550000001", hizmetId: "sac", gun: 2, saat: "10:30", berberId: "resul" }, token);

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.kural.berberId, "eren", "berber baskasi adina ekleyemez");
  assert.ok(res.body.atlanan.includes(beklenen[1]), "dolu hafta atlanmali");
  assert.ok(res.body.olusturulan.length >= 7);
  assert.strictEqual(store.length, res.body.olusturulan.length);
  for (const r of store) {
    assert.strictEqual(new Date(r.tarih + "T00:00:00").getDay(), 2);
    assert.strictEqual(r.saat, "10:30");
    assert.strictEqual(r.kaynak, "sabit");
    assert.strictEqual(r.sabitId, res.body.kural.id);
    assert.strictEqual(r.durum, "onaylı");
    assert.strictEqual(r.fiyat, eren.fiyat.sac);
  }

  const ikinci = await sabitUret(kurallar[0]);
  assert.strictEqual(ikinci.olusturulan.length, 0, "ayni pencere ikinci kez uretilmez");

  const liste = await istek("GET", "/api/sabit", null, token);
  assert.strictEqual(liste.body.length, 1);
});

test("gecersiz gun/saat 400, kimliksiz 401", async (t) => {
  store = []; kurallar = []; doluTarihler = [];
  await sunucu(t);
  const token = await girisYap(BERBERLER.find((b) => b.id === "eren"));

  assert.strictEqual((await istek("POST", "/api/sabit", { ad: "X", hizmetId: "sac", gun: 2, saat: "10:30" })).status, 401);
  assert.strictEqual((await istek("POST", "/api/sabit", { ad: "X", hizmetId: "sac", gun: 0, saat: "10:30" }, token)).status, 400, "Pazar olmaz");
  assert.strictEqual((await istek("POST", "/api/sabit", { ad: "X", hizmetId: "sac", gun: 2, saat: "08:00" }, token)).status, 400, "mesai disi");
  assert.strictEqual(kurallar.length, 0);
});

test("durdur: gelecek randevular silinir, baskasinin kurali durdurulamaz", async (t) => {
  store = []; kurallar = []; doluTarihler = [];
  await sunucu(t);
  const erenToken = await girisYap(BERBERLER.find((b) => b.id === "eren"));
  const kaanToken = await girisYap(BERBERLER.find((b) => b.id === "kaan"));

  const res = await istek("POST", "/api/sabit", { ad: "Sabit", hizmetId: "sac", gun: 3, saat: "11:15" }, erenToken);
  assert.strictEqual(res.status, 201);
  const id = res.body.kural.id;

  assert.strictEqual((await istek("POST", `/api/sabit/${id}/durdur`, null, kaanToken)).status, 403);
  assert.ok(store.length > 0);

  const durdur = await istek("POST", `/api/sabit/${id}/durdur`, null, erenToken);
  assert.strictEqual(durdur.status, 200);
  assert.strictEqual(store.length, 0, "gelecek sabit randevular silinmeli");
  assert.strictEqual((await istek("GET", "/api/sabit", null, erenToken)).body.length, 0);
});

test("duzenle: ad/ucret yerinde guncellenir, saat degisince gelecek haftalar yeni saatle uretilir", async (t) => {
  store = []; kurallar = []; doluTarihler = [];
  await sunucu(t);
  const erenToken = await girisYap(BERBERLER.find((b) => b.id === "eren"));
  const kaanToken = await girisYap(BERBERLER.find((b) => b.id === "kaan"));

  const res = await istek("POST", "/api/sabit", { ad: "Ali", telefon: "0555 000 00 02", hizmetId: "sac", gun: 4, saat: "10:30" }, erenToken);
  const id = res.body.kural.id;
  const adet = store.length;
  assert.strictEqual(res.body.kural.telefon, "905550000002", "telefon normalize edilmeli");

  assert.strictEqual((await istek("PUT", `/api/sabit/${id}`, { ad: "X", hizmetId: "sac", gun: 4, saat: "10:30" }, kaanToken)).status, 403);

  const ad = await istek("PUT", `/api/sabit/${id}`, { ad: "Ali Veli", hizmetId: "kombin", gun: 4, saat: "10:30", fiyat: 800 }, erenToken);
  assert.strictEqual(ad.status, 200);
  assert.strictEqual(store.length, adet, "yerinde guncelleme randevu sayisini degistirmez");
  assert.ok(store.every((r) => r.ad === "Ali Veli" && r.hizmetId === "kombin" && r.fiyat === 800));

  const saat = await istek("PUT", `/api/sabit/${id}`, { ad: "Ali Veli", hizmetId: "kombin", gun: 5, saat: "11:15", fiyat: 800 }, erenToken);
  assert.strictEqual(saat.status, 200);
  assert.ok(saat.body.olusturulan.length >= 7);
  assert.ok(store.every((r) => new Date(r.tarih + "T00:00:00").getDay() === 5 && r.saat === "11:15"),
    "eski gun/saatteki gelecek randevular silinip yenileri uretilmeli");

  assert.strictEqual((await istek("PUT", `/api/sabit/${id}`, { ad: "Ali", hizmetId: "sac", gun: 5, saat: "08:00" }, erenToken)).status, 400);
});
