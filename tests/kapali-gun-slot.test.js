const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// Kapalı gün, berberin O GÜNKÜ tüm slotlarını kapatmalı. Eskiden sabit 09:00
// ızgarası kullanılıyordu; 09:30/10:45'te başlayan berberlerin (Kaan, Emre,
// Mehmet Ali) saatleri ona denk gelmediği için web'den yine randevu alınabiliyordu.
process.env.DATABASE_URL = "postgres://sahte";
const orig = Module._load;
Module._load = function (req) {
  if (req === "pg") {
    return {
      Pool: class {
        on() {}
        async query(sql) {
          if (sql.includes("FROM kapali_gunler WHERE")) return { rows: [{ "?column?": 1 }] };
          if (sql.includes("FROM kapali_gunler")) return { rows: [{ berber_id: "kaan", tarih: "2026-10-06" }] };
          return { rows: [] };
        }
      },
    };
  }
  return orig.apply(this, arguments);
};

const db = require("../src/db");
const { BERBERLER, berberGunSlotlari, berberCalismaSaatleri } = require("../src/config");

test("kapali gunde her berberin o gunku butun calisma saatleri dolu sayilir", async () => {
  for (const b of BERBERLER) {
    const dolu = await db.getBusySlots(b.id, "2026-10-06");
    const acikKalan = berberCalismaSaatleri(b.id, "2026-10-06").filter((s) => !dolu.includes(s));
    assert.deepStrictEqual(acikKalan, [], `${b.id} kapali gunde acik slot birakmamali`);
  }
});

test("panelin kapali saat haritasi da kapali gunu o berberin kendi slotlarina genisletir", async () => {
  const harita = await db.getKapaliSaatler();
  const beklenen = berberGunSlotlari("kaan", "2026-10-06").map((x) => x.saat);
  assert.deepStrictEqual(harita.kaan["2026-10-06"], beklenen);
});
