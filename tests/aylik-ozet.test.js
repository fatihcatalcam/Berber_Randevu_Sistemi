const test = require("node:test");
const assert = require("node:assert");
const sheets = require("../src/sheets");

test("aylikOzetHesapla: ay bazli ciro, sayi ve berber kirilimi", () => {
  const randevular = [
    { tarih: "2026-07-01", durum: "onaylı", berberId: "eren", fiyat: 1000 },
    { tarih: "2026-07-15", durum: "onaylı", berberId: "eren", fiyat: 900, gercekFiyat: 800 },
    { tarih: "2026-07-20", durum: "onaylı", berberId: "kaan", fiyat: 650 },
    { tarih: "2026-07-05", durum: "iptal",  berberId: "eren", fiyat: 1000 }, // sayılmaz
    { tarih: "2026-07-08", durum: "gelmedi", berberId: "kaan", fiyat: 650 }, // sayılmaz
    { tarih: "2026-08-02", durum: "onaylı", berberId: "kaan", fiyat: 650 },
  ];
  const ozet = sheets.aylikOzetHesapla(randevular);

  assert.strictEqual(ozet.length, 2, "iki ay olmalı");
  const temmuz = ozet[0], agustos = ozet[1];

  assert.strictEqual(temmuz.ay, "2026-07");
  assert.strictEqual(temmuz.sayi, 3, "Temmuz'da 3 onaylı randevu");
  assert.strictEqual(temmuz.ciro, 1000 + 800 + 650, "gercekFiyat varsa o kullanılır"); // 2450
  assert.strictEqual(temmuz.berber.eren, 2);
  assert.strictEqual(temmuz.berber.kaan, 1);

  assert.strictEqual(agustos.ay, "2026-08");
  assert.strictEqual(agustos.sayi, 1);
  assert.strictEqual(agustos.ciro, 650);
});

test("aylikOzetHesapla: bos/gecersiz girisleri yok sayar", () => {
  assert.deepStrictEqual(sheets.aylikOzetHesapla([]), []);
  assert.deepStrictEqual(sheets.aylikOzetHesapla(null), []);
  const ozet = sheets.aylikOzetHesapla([
    { tarih: "", durum: "onaylı", berberId: "eren", fiyat: 100 },
    { durum: "onaylı", berberId: "eren", fiyat: 100 },
  ]);
  assert.deepStrictEqual(ozet, [], "tarihsiz kayitlar aya girmez");
});

test("aylikOzetYaz: sheets kapaliyken sessizce gecer (hata firlatmaz)", async () => {
  await assert.doesNotReject(() => sheets.aylikOzetYaz([{ tarih: "2026-07-01", durum: "onaylı", berberId: "eren", fiyat: 100 }]));
});
