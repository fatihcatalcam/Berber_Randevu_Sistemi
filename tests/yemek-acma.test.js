const test = require("node:test");
const assert = require("node:assert");
const { berberCalismaSaatleri, berberGunSlotlari } = require("../src/config");

const PZT = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

test("berberGunSlotlari yemek slotunu isaretler ama listeden atmaz", () => {
  const slotlar = berberGunSlotlari("huseyin", PZT);
  const yemekler = slotlar.filter((x) => x.yemek).map((x) => x.saat);
  assert.deepStrictEqual(yemekler, ["15:00"], "Huseyin yemegi 15:00");
  assert.ok(slotlar.some((x) => x.saat === "15:00"), "yemek slotu listede kalmali (panel gostersin)");
});

test("yemek slotu varsayilan olarak randevuya kapali", () => {
  const acik = berberCalismaSaatleri("huseyin", PZT);
  assert.ok(!acik.includes("15:00"), "yemek slotu normalde secilemez");
});

test("acik saat verilince yemek slotu randevuya acilir", () => {
  const acik = berberCalismaSaatleri("huseyin", PZT, ["15:00"]);
  assert.ok(acik.includes("15:00"), "acilan yemek slotu secilebilir olmali");
});

test("alakasiz bir acik saat baska slotu etkilemez", () => {
  const varsayilan = berberCalismaSaatleri("huseyin", PZT);
  const acik = berberCalismaSaatleri("huseyin", PZT, ["03:00"]);
  assert.deepStrictEqual(acik, varsayilan, "gecersiz/alakasiz acik saat listeyi degistirmemeli");
});

test("Resul'un 4 slotluk yemegi tek tek acilabilir", () => {
  const hepsi = berberGunSlotlari("resul", PZT).filter((x) => x.yemek).map((x) => x.saat);
  assert.deepStrictEqual(hepsi, ["14:00", "14:30", "15:00", "15:30"]);
  const acik = berberCalismaSaatleri("resul", PZT, ["15:00"]);
  assert.ok(acik.includes("15:00"), "sadece acilan slot gelir");
  assert.ok(!acik.includes("14:00"), "digerleri kapali kalir");
});
