const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// ---------------------------------------------------------------------------
// Regresyon testi — 17 Temmuz 2026 gecesi yasanan cokme:
//   "Unhandled 'error' event ... Client.idleListener (pg-pool/index.js:62)"
// Neon bostaki baglantiyi dusurunce pg, pool uzerinde 'error' olayi yayar.
// Dinleyici yoksa Node sureci oldurur ve sunucu coker. Bu test dinleyicinin
// bagli oldugunu ve hatayi yutup surece zarar vermedigini dogrular.
// ---------------------------------------------------------------------------

let sahtePool = null;

const orig = Module._load;
Module._load = function (req) {
  if (req === "pg") {
    return {
      Pool: class SahtePool {
        constructor(cfg) {
          this.cfg = cfg;
          this.dinleyiciler = {};
          sahtePool = this;
        }
        on(olay, fn) {
          (this.dinleyiciler[olay] = this.dinleyiciler[olay] || []).push(fn);
          return this;
        }
        async query() { return { rows: [] }; }
      },
    };
  }
  return orig.apply(this, arguments);
};

test("pool 'error' dinleyicisi bagli — bostaki baglanti dusunce sunucu cokmez", () => {
  process.env.DATABASE_URL = "postgresql://kullanici:sifre@ornek.neon.tech:5432/db";
  delete require.cache[require.resolve("../src/db")];
  require("../src/db");

  assert.ok(sahtePool, "DATABASE_URL varken Pool olusturulmali");

  const dinleyiciler = sahtePool.dinleyiciler.error;
  assert.ok(
    dinleyiciler && dinleyiciler.length > 0,
    "pool.on('error') kayitli OLMALI — yoksa bostaki baglanti hatasi sureci oldurur"
  );

  // Gercek cokme senaryosunu taklit et: bostaki istemci ECONNABORTED aliyor.
  // Dinleyici hatayi yutmali, tekrar firlatmamali.
  const gercekHata = Object.assign(new Error("read ECONNABORTED"), {
    code: "ECONNABORTED",
    errno: -103,
    syscall: "read",
  });
  assert.doesNotThrow(
    () => dinleyiciler.forEach((fn) => fn(gercekHata)),
    "dinleyici hatayi yutmali, yeniden firlatmamali"
  );
});

test("pool Neon icin ayarlanmis — bosta bekleyen baglanti birakilmaz", () => {
  assert.ok(sahtePool, "onceki test Pool'u olusturmus olmali");
  const cfg = sahtePool.cfg;
  assert.ok(cfg.idleTimeoutMillis > 0, "idleTimeoutMillis ayarlanmali");
  assert.strictEqual(cfg.keepAlive, true, "keepAlive acik olmali");
  assert.ok(cfg.connectionTimeoutMillis > 0, "connectionTimeoutMillis ayarlanmali");
});
