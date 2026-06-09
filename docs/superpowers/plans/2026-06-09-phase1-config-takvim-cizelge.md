# Phase 1: config.js Refactor + Dashboard Takvim/Çizelge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Berber/hizmet/saat sabitlerini tek bir `config.js`'e taşımak ve dashboard'a aylık takvim + günlük çizelge (saat × berber ızgara) görünümü eklemek.

**Architecture:** `src/config.js` tek doğruluk kaynağı olur; `bot.js` ve `index.js` oradan okur. Yeni `GET /api/config` endpoint'i frontend'e berber/saat listesini verir. Dashboard, mevcut `/api/randevular` verisini takvim + ızgara olarak render eder. Hiçbir dış bağımlılık (Google) yok — Phase 1 tek başına çalışır ve test edilir.

**Tech Stack:** Node.js, Express, `node:test` (yerleşik test koşucusu), vanilla JS dashboard.

---

## File Structure

- **Create:** `src/config.js` — BERBERLER, HIZMETLER, SAATLER, gelecekTarihler() (tek kaynak)
- **Create:** `tests/config.test.js` — config saf fonksiyon testleri
- **Create:** `tests/api-config.test.js` — `GET /api/config` endpoint testi
- **Modify:** `src/bot.js` — sabitleri config'ten import et (kod tekrarını kaldır)
- **Modify:** `src/index.js` — `GET /api/config` ekle
- **Modify:** `dashboard/index.html` — takvim + çizelge görünümü
- **Modify:** `package.json` — `test` script ekle

---

## Task 1: package.json'a test script ekle

**Files:**
- Modify: `package.json`

- [ ] **Step 1: test script ekle**

`scripts` bloğunu şu hale getir:

```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Çalıştığını doğrula (henüz test yok)**

Run: `npm test`
Expected: "tests 0" benzeri çıktı, hata yok (exit 0). Test dosyası olmadığı için "0 tests" normaldir.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: node:test test script ekle"
```

---

## Task 2: src/config.js oluştur (tek doğruluk kaynağı)

**Files:**
- Create: `src/config.js`
- Test: `tests/config.test.js`

- [ ] **Step 1: Failing test yaz**

`tests/config.test.js`:

```js
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

test("SAATLER 09:00-17:30 arasi 30dk araliklarla 18 saat", () => {
  assert.strictEqual(config.SAATLER[0], "09:00");
  assert.strictEqual(config.SAATLER[config.SAATLER.length - 1], "17:30");
  assert.strictEqual(config.SAATLER.length, 18);
});

test("gelecekTarihler(7) 7 gun dondurur, deger YYYY-MM-DD", () => {
  const t = config.gelecekTarihler(7);
  assert.strictEqual(t.length, 7);
  assert.match(t[0].deger, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(t[0].etiket.length > 0);
});
```

- [ ] **Step 2: Test'in başarısız olduğunu doğrula**

Run: `node --test tests/config.test.js`
Expected: FAIL — "Cannot find module '../src/config'"

- [ ] **Step 3: src/config.js'i yaz**

`src/config.js`:

```js
// ---------------------------------------------------------------------------
// TEK DOĞRULUK KAYNAĞI
// Berber eklemek için: BERBERLER dizisine yeni nesne ekle (id benzersiz olsun,
// fiyat içinde 4 hizmetin de fiyatı olsun). bot, dashboard ve çizelge otomatik
// bu listeyi kullanır. Başka hiçbir yeri değiştirmene gerek yok.
// ---------------------------------------------------------------------------

const BERBERLER = [
  { id: "ahmet",  ad: "Ahmet Usta",  uzmanlik: "Klasik Tıraş & Saç",   fiyat: { sac: 150, sakal: 100, kombin: 220, cocuk: 100 } },
  { id: "mehmet", ad: "Mehmet Bey",  uzmanlik: "Modern Kesim & Sakal", fiyat: { sac: 160, sakal: 110, kombin: 240, cocuk: 100 } },
  { id: "kemal",  ad: "Kemal Usta",  uzmanlik: "Fade & Tasarım",       fiyat: { sac: 180, sakal: 120, kombin: 270, cocuk: 120 } },
  // PLACEHOLDER — gerçek berberleri buraya ekle (8-9 berber):
  // { id: "berber4", ad: "Berber 4", uzmanlik: "...", fiyat: { sac: 150, sakal: 100, kombin: 220, cocuk: 100 } },
];

const HIZMETLER = [
  { id: "sac",    ad: "Saç Kesimi",   sure: "~30 dk" },
  { id: "sakal",  ad: "Sakal Tıraşı", sure: "~20 dk" },
  { id: "kombin", ad: "Saç + Sakal",  sure: "~45 dk" },
  { id: "cocuk",  ad: "Çocuk Kesimi", sure: "~25 dk" },
];

const SAATLER = (() => {
  const list = [];
  for (let dk = 9 * 60; dk < 18 * 60; dk += 30) {
    const s = String(Math.floor(dk / 60)).padStart(2, "0");
    const m = String(dk % 60).padStart(2, "0");
    list.push(`${s}:${m}`);
  }
  return list;
})();

function gelecekTarihler(kacGun = 7) {
  const sonuc = [];
  const bugun = new Date();
  for (let i = 0; i < kacGun; i++) {
    const d = new Date(bugun);
    d.setDate(bugun.getDate() + i);
    const etiket = d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
    const yil = d.getFullYear();
    const ay = String(d.getMonth() + 1).padStart(2, "0");
    const gun = String(d.getDate()).padStart(2, "0");
    sonuc.push({ etiket, deger: `${yil}-${ay}-${gun}` });
  }
  return sonuc;
}

module.exports = { BERBERLER, HIZMETLER, SAATLER, gelecekTarihler };
```

- [ ] **Step 4: Test'in geçtiğini doğrula**

Run: `node --test tests/config.test.js`
Expected: PASS — 4 test geçer

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: berber/hizmet/saat sabitlerini config.js'e tasi"
```

---

## Task 3: bot.js'i config.js kullanacak şekilde refactor et

**Files:**
- Modify: `src/bot.js`

- [ ] **Step 1: bot.js'in başındaki sabit tanımlarını sil, import ekle**

`src/bot.js` içinde `const db = require("./db");` satırının altına ekle:

```js
const { BERBERLER, HIZMETLER, SAATLER, gelecekTarihler } = require("./config");
```

Sonra `bot.js` içindeki şu blokları **tamamen sil** (artık config'ten geliyor):
- `const BERBERLER = [ ... ];` (tüm dizi)
- `const HIZMETLER = [ ... ];` (tüm dizi)
- `const SAATLER = (() => { ... })();` (IIFE bloğu)
- `function gelecekTarihler(kacGun = 7) { ... }` (tüm fonksiyon)

Dosyanın geri kalanı (sessions, handleMessage, adım fonksiyonları) **aynen kalır** — zaten bu isimleri kullanıyor.

- [ ] **Step 2: Mevcut bot akış testini çalıştır (regresyon)**

`tests/bot-flow.test.js` oluştur:

```js
const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// whatsapp modülünü mock'la
const orig = Module._load;
const sent = [];
Module._load = function (req) {
  if (req.endsWith("whatsapp")) {
    return {
      sendText: async () => sent.push({ k: "text" }),
      sendButtons: async (to, b, btns) => sent.push({ k: "buttons", ids: btns.map((x) => x.id) }),
      sendList: async (to, b, l, secs) => sent.push({ k: "list", rows: secs[0].rows.map((r) => r.id) }),
    };
  }
  return orig.apply(this, arguments);
};

const fs = require("fs");
const path = require("path");
const DB = path.join(__dirname, "..", "data", "randevular.json");

test("tam randevu akisi calisir ve kayit olusur", async () => {
  const yedek = fs.existsSync(DB) ? fs.readFileSync(DB, "utf8") : "[]";
  fs.writeFileSync(DB, "[]");
  delete require.cache[require.resolve("../src/db")];
  delete require.cache[require.resolve("../src/bot")];
  delete require.cache[require.resolve("../src/config")];
  const db = require("../src/db");
  const { handleMessage } = require("../src/bot");
  const TEL = "905550001122";

  await handleMessage(TEL, "merhaba");
  await handleMessage(TEL, "yeni_randevu");
  await handleMessage(TEL, "Test Kullanici");
  await handleMessage(TEL, "berber_kemal");
  await handleMessage(TEL, "hizmet_kombin");
  const d = new Date();
  const bugun = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await handleMessage(TEL, `tarih_${bugun}`);
  await handleMessage(TEL, "saat_10:00");
  await handleMessage(TEL, "onayla");

  const all = db.getAll();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].berber, "Kemal Usta");
  assert.strictEqual(all[0].fiyat, 270);
  assert.strictEqual(all[0].durum, "bekliyor");

  fs.writeFileSync(DB, yedek); // geri yükle
});
```

Run: `node --test tests/bot-flow.test.js`
Expected: PASS — akış config refactor sonrası bozulmadı

- [ ] **Step 3: Commit**

```bash
git add src/bot.js tests/bot-flow.test.js
git commit -m "refactor: bot.js sabitlerini config.js'ten al"
```

---

## Task 4: GET /api/config endpoint ekle

**Files:**
- Modify: `src/index.js`
- Test: `tests/api-config.test.js`

- [ ] **Step 1: Failing test yaz**

`tests/api-config.test.js`:

```js
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
```

- [ ] **Step 2: Test'in başarısız olduğunu doğrula**

Run: `node --test tests/api-config.test.js`
Expected: FAIL — 404 döner, JSON.parse hata verir veya berberler undefined

- [ ] **Step 3: index.js'e endpoint ekle**

`src/index.js` içinde `require("./bot")` satırının yanına config import ekle:

```js
const { BERBERLER, HIZMETLER, SAATLER } = require("./config");
```

`GET /api/randevular` endpoint'inin hemen üstüne ekle:

```js
// Berber/hizmet/saat listesi (dashboard çizelgesi için)
app.get("/api/config", (req, res) => {
  res.json({ berberler: BERBERLER, hizmetler: HIZMETLER, saatler: SAATLER });
});
```

- [ ] **Step 4: Test'in geçtiğini doğrula**

Run: `node --test tests/api-config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/api-config.test.js
git commit -m "feat: GET /api/config endpoint ekle"
```

---

## Task 5: Dashboard — aylık takvim widget'ı

**Files:**
- Modify: `dashboard/index.html`

Not: Dashboard vanilla JS olduğundan testler tarayıcıda manuel doğrulanır (Step'lerde
açık doğrulama adımları var).

- [ ] **Step 1: Takvim HTML/CSS/JS ekle**

`dashboard/index.html` içinde `<div class="wrap">` açıldıktan ve istatistik kartlarından
**sonra**, filtre satırının **üstüne** şu bloğu ekle:

```html
  <div class="takvim-kutu" style="background:var(--kart);border:1px solid var(--cizgi);border-radius:14px;padding:16px;margin-bottom:18px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <button id="ayOnceki" class="durum-btn">‹</button>
      <strong id="ayBaslik" style="font-size:16px;"></strong>
      <button id="aySonraki" class="durum-btn">›</button>
    </div>
    <div id="takvimGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;"></div>
  </div>
```

Sayfanın `<script>` bloğunun başına (mevcut `let randevular = [];` yanına) ekle:

```js
  let seciliTarih = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();
  let takvimAy = new Date(); // gösterilen ay
```

Aynı `<script>` içine takvim render fonksiyonunu ekle:

```js
  const GUNLER = ["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"];
  function takvimRender() {
    const yil = takvimAy.getFullYear(), ay = takvimAy.getMonth();
    document.getElementById("ayBaslik").textContent =
      takvimAy.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

    // gün başlıkları
    const grid = document.getElementById("takvimGrid");
    grid.innerHTML = "";
    GUNLER.forEach((g) => {
      const el = document.createElement("div");
      el.textContent = g;
      el.style.cssText = "text-align:center;font-size:11px;color:var(--soluk);font-weight:700;padding:4px;";
      grid.appendChild(el);
    });

    // ayın ilk gününün haftadaki yeri (Pzt=0)
    const ilk = new Date(yil, ay, 1);
    let basOfset = (ilk.getDay() + 6) % 7;
    for (let i = 0; i < basOfset; i++) grid.appendChild(document.createElement("div"));

    const gunSayisi = new Date(yil, ay + 1, 0).getDate();
    for (let g = 1; g <= gunSayisi; g++) {
      const deger = `${yil}-${String(ay+1).padStart(2,"0")}-${String(g).padStart(2,"0")}`;
      const adet = randevular.filter((r) => r.tarih === deger && r.durum !== "iptal").length;
      const hucre = document.createElement("button");
      hucre.className = "takvim-gun";
      hucre.style.cssText =
        "position:relative;padding:10px 4px;border:1px solid var(--cizgi);border-radius:8px;background:#fff;cursor:pointer;font-size:14px;" +
        (deger === seciliTarih ? "outline:2px solid var(--yesil2);background:#ecfdf5;" : "");
      hucre.textContent = g;
      if (adet > 0) {
        const rozet = document.createElement("span");
        rozet.textContent = adet;
        rozet.style.cssText = "position:absolute;top:2px;right:4px;background:var(--yesil1);color:#fff;font-size:10px;font-weight:700;border-radius:10px;padding:0 5px;";
        hucre.appendChild(rozet);
      }
      hucre.addEventListener("click", () => { seciliTarih = deger; takvimRender(); render(); });
      grid.appendChild(hucre);
    }
  }
  document.getElementById("ayOnceki").addEventListener("click", () => { takvimAy.setMonth(takvimAy.getMonth()-1); takvimRender(); });
  document.getElementById("aySonraki").addEventListener("click", () => { takvimAy.setMonth(takvimAy.getMonth()+1); takvimRender(); });
```

`veriCek()` fonksiyonunun içinde `render();` çağrısının hemen üstüne `takvimRender();` ekle.

- [ ] **Step 2: Tarayıcıda doğrula**

Run: `npm start` → tarayıcıda `http://localhost:3000/dashboard`
Expected: Aylık takvim görünür; randevulu günlerde sayı rozeti var; bugün vurgulu;
‹ › ile ay değişir; bir güne tıklayınca o gün seçili (yeşil) olur.

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: dashboard aylik takvim widget"
```

---

## Task 6: Dashboard — günlük çizelge (saat × berber ızgara)

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: Çizelge konteyneri ekle**

`dashboard/index.html` içinde mevcut `.tablo-kutu` div'inin **üstüne** ekle:

```html
  <div class="cizelge-kutu" style="background:var(--kart);border:1px solid var(--cizgi);border-radius:14px;padding:16px;margin-bottom:18px;overflow-x:auto;">
    <h3 id="cizelgeBaslik" style="margin-bottom:12px;font-size:16px;"></h3>
    <div id="cizelge"></div>
  </div>
```

- [ ] **Step 2: Config'i çek ve çizelgeyi render et**

`<script>` başına ekle:

```js
  let BERBERLER = [], SAATLER = [];
  async function configCek() {
    try {
      const res = await fetch("/api/config");
      const c = await res.json();
      BERBERLER = c.berberler; SAATLER = c.saatler;
    } catch (e) {}
  }
```

Çizelge render fonksiyonu ekle:

```js
  const DURUM_RENK = {
    bekliyor: { bg: "#fef9c3", fg: "#713f12" },
    "onaylı": { bg: "#d1fae5", fg: "#065f46" },
    iptal:    { bg: "#fee2e2", fg: "#991b1b" },
  };
  function cizelgeRender() {
    const baslik = document.getElementById("cizelgeBaslik");
    baslik.textContent = new Date(seciliTarih + "T00:00:00")
      .toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " — Günlük Çizelge";

    const gunRand = randevular.filter((r) => r.tarih === seciliTarih);
    // [saat][berberId] = randevu (iptal değilse öncelik aktif olana)
    const harita = {};
    gunRand.forEach((r) => {
      const key = r.saat + "|" + r.berberId;
      if (!harita[key] || harita[key].durum === "iptal") harita[key] = r;
    });

    let html = '<table style="width:100%;border-collapse:collapse;min-width:600px;"><thead><tr>';
    html += '<th style="padding:8px;border:1px solid var(--cizgi);background:#f9fafb;font-size:12px;">Saat</th>';
    BERBERLER.forEach((b) => {
      html += `<th style="padding:8px;border:1px solid var(--cizgi);background:#f9fafb;font-size:12px;">${kacis(b.ad)}</th>`;
    });
    html += "</tr></thead><tbody>";

    SAATLER.forEach((saat) => {
      html += `<tr><td style="padding:8px;border:1px solid var(--cizgi);font-weight:700;font-size:13px;background:#fafafa;">${saat}</td>`;
      BERBERLER.forEach((b) => {
        const r = harita[saat + "|" + b.id];
        if (r) {
          const renk = DURUM_RENK[r.durum] || DURUM_RENK.bekliyor;
          const etiket = r.durum === "iptal"
            ? `${kacis(r.ad)} — İPTAL (${r.iptalEden === "musteri" ? "müşteri" : "berber"})`
            : kacis(r.ad);
          html += `<td class="cizelge-hucre" data-id="${r.id}" style="padding:8px;border:1px solid var(--cizgi);background:${renk.bg};color:${renk.fg};font-size:12px;cursor:pointer;">${etiket}</td>`;
        } else {
          html += '<td style="padding:8px;border:1px solid var(--cizgi);"></td>';
        }
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    document.getElementById("cizelge").innerHTML = html;

    document.querySelectorAll(".cizelge-hucre").forEach((td) => {
      td.addEventListener("click", () => hucreMenu(td.dataset.id));
    });
  }
```

Not: `r.iptalEden` alanı Phase 3'te gelir; o gelene kadar `undefined` olur ve
"(berber)" gösterilir — sorun değil, geriye dönük uyumlu.

`veriCek()` içinde `takvimRender();` satırının yanına `cizelgeRender();` ekle.
Sayfa açılışındaki `veriCek();` çağrısından **önce** `await configCek();` yapılması için,
en alttaki başlatma bloğunu şuna çevir:

```js
  (async () => {
    await configCek();
    veriCek();
    setInterval(veriCek, 10000);
  })();
```

- [ ] **Step 3: Tarayıcıda doğrula**

Run: `npm start` → `http://localhost:3000/dashboard`
Expected: Seçili günün çizelgesi görünür; satırlar saatler, sütunlar berberler;
dolu hücreler müşteri adı + duruma göre renkli (sarı/yeşil/kırmızı); takvimde başka
güne tıklayınca çizelge o güne geçer.

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: dashboard gunluk cizelge (saat x berber izgara)"
```

---

## Task 7: Çizelge hücresine tıklayınca onayla/iptal menüsü

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: Basit popup menüsü ekle**

`<script>` içine ekle (mevcut `durumDegistir` fonksiyonunu kullanır):

```js
  function hucreMenu(id) {
    const r = randevular.find((x) => x.id === id);
    if (!r) return;
    const tarih = new Date(r.tarih + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    const mesaj = `${r.ad}\n${r.berber} — ${r.hizmet}\n${tarih} ${r.saat} — ${r.fiyat}₺\nDurum: ${durumYazi(r.durum)}\n\nOnayla = Tamam, İptal = Vazgeç`;
    // basit yaklaşım: confirm tabanlı; Tamam=onayla, ikinci confirm=iptal
    if (confirm(mesaj + "\n\n[Tamam] Onayla")) {
      durumDegistir(id, "onaylı");
    } else if (confirm(`${r.ad} randevusunu İPTAL etmek istiyor musun?`)) {
      durumDegistir(id, "iptal");
    }
  }
```

Not: Bu MVP için `confirm()` tabanlı. Phase 2/3'te gerçek bir modal'a yükseltilebilir.

- [ ] **Step 2: Tarayıcıda doğrula**

Run: `npm start` → çizelgede bir hücreye tıkla
Expected: Randevu detayı popup'ı çıkar; Tamam → onaylı (yeşil olur); Vazgeç sonra
ikinci onay → iptal (kırmızı olur). Değişiklik hem çizelgeye hem takvim rozetine yansır.

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: cizelge hucre tikla onayla/iptal menusu"
```

---

## Task 8: Tüm test paketini çalıştır + Phase 1 kapanış

**Files:** yok (doğrulama)

- [ ] **Step 1: Tüm testler**

Run: `npm test`
Expected: config.test.js, bot-flow.test.js, api-config.test.js hepsi PASS

- [ ] **Step 2: Manuel uçtan uca**

Run: `npm start`
- Dashboard açılır, takvim + çizelge görünür
- Güne tıklama çizelgeyi değiştirir
- Hücre tıklama onayla/iptal çalışır
- 10 sn otomatik yenileme bozulmamış

- [ ] **Step 3: data/randevular.json temizliği**

Test sırasında oluşan kayıt varsa `data/randevular.json`'u `[]` yap (gerçek veri değilse).

---

## Self-Review Notu

- **Spec kapsamı (Phase 1):** config.js refactor ✓ (Task 2-3), GET /api/config ✓ (Task 4),
  takvim ✓ (Task 5), çizelge ızgara ✓ (Task 6), hücre onayla/iptal ✓ (Task 7).
  Sheets, arşivleyici, müşteri iptali → Phase 2 & 3 (ayrı plan).
- **Geriye dönük uyum:** `r.iptalEden` alanı Phase 3'te gelir; çizelge bunu `undefined`
  iken "(berber)" göstererek tolere eder.
- **Tip tutarlılığı:** `seciliTarih`, `BERBERLER`, `SAATLER` global'leri Task 5-6'da
  tutarlı kullanılıyor; `durumDegistir`, `durumYazi`, `kacis` mevcut fonksiyonlar.
