const test = require("node:test");
const assert = require("node:assert");
const { gelecekTarihler } = require("../src/config");

function pad(n) { return String(n).padStart(2, "0"); }
function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Önümüzdeki ilk Pazar'ın tarihi
function sonrakiPazar() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return iso(d);
}

test("gelecekTarihler varsayilan olarak Pazar'i atlar", () => {
  const pazar = sonrakiPazar();
  const liste = gelecekTarihler(30).map((t) => t.deger); // genis pencere
  assert.ok(!liste.includes(pazar), "Pazar listede olmamali");
});

test("ozel acilan Pazar gelecekTarihler'de gorunur", () => {
  const pazar = sonrakiPazar();
  const liste = gelecekTarihler(30, [pazar]).map((t) => t.deger);
  assert.ok(liste.includes(pazar), "Ozel acilan Pazar listede olmali");
});

test("acik gun listesi bos ise davranis degismez", () => {
  const a = gelecekTarihler(7).map((t) => t.deger);
  const b = gelecekTarihler(7, []).map((t) => t.deger);
  assert.deepStrictEqual(a, b);
});
