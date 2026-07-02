const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

function post(path, body) {
  return new Promise((resolve, reject) => {
    const veri = JSON.stringify(body);
    const req = http.request(
      {
        host: "localhost",
        port: 3198,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    req.on("error", reject);
    req.write(veri);
    req.end();
  });
}

test("giris siniri: 5 yanlis PIN sonrasi ayni IP kilitlenir", async (t) => {
  process.env.PORT = "3198";
  delete require.cache[require.resolve("../src/index")];
  const { server } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  // İlk 5 yanlış deneme 401 döner
  for (let i = 0; i < 5; i++) {
    const r = await post("/api/auth", { admin: true, pin: "yanlis" });
    assert.strictEqual(r.status, 401, `deneme ${i + 1} 401 olmalı`);
  }

  // 6. deneme kilitlenmiş olmalı
  const kilitli = await post("/api/auth", { admin: true, pin: "yanlis" });
  assert.strictEqual(kilitli.status, 429, "6. deneme 429 dönmeli");
  assert.match(JSON.parse(kilitli.body).hata, /deneme/i);

  // Kilitliyken doğru PIN bile reddedilmeli (kaba kuvvetin işe yaramadığının kanıtı)
  const dogruAmaKilitli = await post("/api/auth", { berberId: "resul", pin: "1111" });
  assert.strictEqual(dogruAmaKilitli.status, 429, "kilitliyken doğru PIN de 429 dönmeli");
});
