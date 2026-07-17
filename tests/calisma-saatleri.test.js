const test = require("node:test");
const assert = require("node:assert");
const {
  berberCalismaSaatleri, berberBaslangicSaati, berberNet,
} = require("../src/config");

// Belirli bir haftagününe denk gelen tarih üret (0=Pazar..6=Cmt)
function tarihGunu(hedefGun) {
  const d = new Date();
  d.setDate(d.getDate() + ((hedefGun - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const PAZARTESI = tarihGunu(1);
const SALI      = tarihGunu(2);

test("Resul: 09:00-20:00, 30dk, yemek 14:00-16:00 kapali", () => {
  const s = berberCalismaSaatleri("resul", PAZARTESI);
  assert.strictEqual(s[0], "09:00", "09:00'da baslamali");
  assert.ok(s.includes("13:30"), "13:30 acik olmali");
  // Yemek 14:00-16:00 → bu araliktaki tum slotlar kapali
  for (const y of ["14:00", "14:30", "15:00", "15:30"]) {
    assert.ok(!s.includes(y), `${y} yemek arasinda kapali olmali`);
  }
  assert.ok(s.includes("16:00"), "16:00 yemek sonrasi acik olmali");
  // Son slot 19:30 (bitis 20:00, 30dk sigar); 20:00 kendisi olmaz
  assert.strictEqual(s[s.length - 1], "19:30", "son slot 19:30 olmali");
  assert.ok(!s.includes("20:00"));
});

test("Mehmet: 09:30 baslar (15dk kaymis izgara), yemek 16:15 kapali", () => {
  const s = berberCalismaSaatleri("mehmetali", PAZARTESI);
  assert.strictEqual(s[0], "09:30", "09:30'da baslamali");
  assert.ok(!s.includes("09:00"), "09:00 baslangictan once — olmamali");
  assert.deepStrictEqual(s.slice(0, 4), ["09:30", "10:15", "11:00", "11:45"], "45dk izgara 09:30 tabanli");
  assert.ok(!s.includes("16:15"), "16:15 yemek arasi — kapali");
  assert.ok(s.includes("15:30") && s.includes("17:00"), "yemek komsulari acik");
});

test("Kaan: 10:45 baslar, oncesi kapali", () => {
  const s = berberCalismaSaatleri("kaan", PAZARTESI);
  assert.strictEqual(s[0], "10:45", "10:45'te baslamali");
  for (const e of ["09:00", "09:45", "10:30"]) {
    assert.ok(!s.includes(e), `${e} baslangictan once — olmamali`);
  }
});

test("Eren: gun bazli baslangic (Pzt 10:30, Sal 09:45)", () => {
  assert.strictEqual(berberBaslangicSaati("eren", PAZARTESI), "10:30");
  assert.strictEqual(berberBaslangicSaati("eren", SALI), "09:45");
  const pzt = berberCalismaSaatleri("eren", PAZARTESI);
  const sal = berberCalismaSaatleri("eren", SALI);
  assert.strictEqual(pzt[0], "10:30");
  assert.strictEqual(sal[0], "09:45");
  assert.ok(!pzt.includes("09:45"), "Pazartesi 09:45 acik olmamali");
});

test("berberNet: formuller dogru", () => {
  assert.strictEqual(berberNet("eren", 1000), Math.round((1000 - 100) * 0.55)); // 495
  assert.strictEqual(berberNet("kaan", 1000), Math.round((1000 - 100) * 0.60)); // 540
  assert.strictEqual(berberNet("emre", 1000), 500);                              // ciro*0.5
  assert.strictEqual(berberNet("burak", 1000), 450);                             // ciro*0.45
  assert.strictEqual(berberNet("huseyin", 1000), 450);
  assert.strictEqual(berberNet("resul", 1000), 1000);                            // patron: tam ciro
  assert.strictEqual(berberNet("eren", 50), 0, "taban altinda net negatif degil 0");
});
