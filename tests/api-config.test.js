const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3199${path}`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

test("API uclari: config acik, randevular kimlik dogrulama ister", async (t) => {
  process.env.PORT = "3199";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  // /api/config herkese açık
  const cfg = await get("/api/config");
  assert.strictEqual(cfg.status, 200);
  const data = JSON.parse(cfg.body);
  assert.ok(Array.isArray(data.berberler));
  assert.ok(data.berberler.length >= 3);
  assert.strictEqual(data.hizmetler.length, 4);
  assert.strictEqual(data.saatler[0], "09:00");

  // PIN sızdırılmamalı
  assert.ok(data.berberler.every((b) => b.pin === undefined), "config PIN içermemeli");

  // /api/randevular token olmadan 401 dönmeli
  const rnd = await get("/api/randevular");
  assert.strictEqual(rnd.status, 401, "korumalı uç token istemeli");

  // /api/kapali-saatler de korunmalı
  const kap = await get("/api/kapali-saatler");
  assert.strictEqual(kap.status, 401);
});
