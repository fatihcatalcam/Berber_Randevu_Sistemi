const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

test("GET /api/config berber/hizmet/saat dondurur", async () => {
  process.env.PORT = "3199";
  delete require.cache[require.resolve("../src/index")];
  require("../src/index");
  await new Promise((r) => setTimeout(r, 400));

  const data = await new Promise((resolve, reject) => {
    http.get("http://localhost:3199/api/config", (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });

  assert.ok(Array.isArray(data.berberler));
  assert.ok(data.berberler.length >= 3);
  assert.strictEqual(data.hizmetler.length, 4);
  assert.strictEqual(data.saatler[0], "09:00");
});
