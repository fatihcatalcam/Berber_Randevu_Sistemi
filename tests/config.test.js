const test = require("node:test");
const assert = require("node:assert");
const config = require("../src/config");

test("BERBERLER en az 3 berber icerir ve fiyat alanlari tam", () => {
  assert.ok(Array.isArray(config.BERBERLER));
  assert.ok(config.BERBERLER.length >= 3);
  for (const b of config.BERBERLER) {
    assert.ok(b.id && b.ad && b.uzmanlik);
    for (const h of ["sac", "sakal", "kombin", "cocuk"]) {
      assert.strictEqual(typeof b.fiyat[h], "number");
    }
  }
});

test("HIZMETLER 4 hizmet icerir", () => {
  assert.strictEqual(config.HIZMETLER.length, 4);
  assert.deepStrictEqual(
    config.HIZMETLER.map((h) => h.id),
    ["sac", "sakal", "kombin", "cocuk"]
  );
});

test("SAATLER 09:00-21:30 arasi 30dk araliklarla 26 saat", () => {
  assert.strictEqual(config.SAATLER[0], "09:00");
  assert.strictEqual(config.SAATLER[config.SAATLER.length - 1], "21:30");
  assert.strictEqual(config.SAATLER.length, 26);
});

test("gelecekTarihler(7) 7 gun dondurur, deger YYYY-MM-DD", () => {
  const t = config.gelecekTarihler(7);
  assert.strictEqual(t.length, 7);
  assert.match(t[0].deger, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(t[0].etiket.length > 0);
});

test("gelecekTarihler Pazar gunlerini atlar (dukkan kapali)", () => {
  for (const g of config.gelecekTarihler(14)) {
    const gun = new Date(g.deger + "T00:00:00").getDay();
    assert.notStrictEqual(gun, 0, `${g.deger} Pazar olmamali`);
  }
});
