const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// ---------------------------------------------------------------------------
// hatirlatmaKontrol(): kaynak==="web" ise e-posta, kaynak==="whatsapp"/tanimsiz
// ise WhatsApp mesaji gonderilmeli. hatirlatmaKontrol export edilmis (module.exports)
// oldugu icin dogrudan cagirip zamanlayiciyi (5dk) beklemeye gerek yok.
// ---------------------------------------------------------------------------
const whatsappCagrilari = [];
const epostaCagrilari = [];
let hatirlatilacaklar = [];
const markHatirlatildiCagrilari = [];

const orig = Module._load;
Module._load = function (req) {
  if (req.endsWith("whatsapp")) {
    return {
      sendText: async (to, metin) => { whatsappCagrilari.push({ to, metin }); return { hata: false }; },
      sendTemplate: async () => ({ hata: false }),
    };
  }
  if (req.endsWith("sheets")) {
    return { syncRandevu: async () => {}, musteriKaydet: async () => {}, updateRandevuDurum: async () => {}, isEnabled: () => false, aylikOzetYaz: async () => {} };
  }
  if (req === "./sms" || req.endsWith("/sms")) return { otpGonder: async () => ({ hata: false }) };
  if (req === "./email" || req.endsWith("/email")) {
    return {
      randevuAlindiMaili: async () => null,
      randevuOnayMaili: async () => null,
      randevuIptalMaili: async () => null,
      randevuHatirlatmaMaili: async (r) => { epostaCagrilari.push(r); return { hata: false }; },
    };
  }
  if (req.endsWith("/db") || req === "./db") {
    return {
      init: async () => {},
      getBusySlots: async () => [],
      add: async (r) => ({ ...r, id: "1", durum: "bekliyor" }),
      getAll: async () => [],
      getAcikGunler: async () => [],
      getAcikSaatlerFor: async () => [],
      otpKaydet: async () => {}, otpDogrula: async () => ({ sonuc: "kod_yok" }),
      otpSonGonderim: async () => null, otpBugunSayisi: async () => 0,
      getHatirlatilacaklar: async () => hatirlatilacaklar,
      markHatirlatildi: async (id) => markHatirlatildiCagrilari.push(id),
    };
  }
  return orig.apply(this, arguments);
};

// Randevu saatini "şimdiden 30dk sonrası" yapar (hatirlatma penceresi: 0-60dk)
function otuzDkSonra() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

test("hatirlatmaKontrol: kaynak=web icin eposta, whatsapp cagrilmaz", async (t) => {
  process.env.PORT = "3203";
  delete require.cache[require.resolve("../src/index")];
  const { server, hatirlatmaKontrol } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  whatsappCagrilari.length = 0; epostaCagrilari.length = 0; markHatirlatildiCagrilari.length = 0;
  hatirlatilacaklar = [{ id: "r1", kaynak: "web", saat: otuzDkSonra(), berber: "Resul Tabu", hizmet: "Saç Kesimi", telefon: "905550001111", email: "test@example.com" }];

  await hatirlatmaKontrol();

  assert.strictEqual(epostaCagrilari.length, 1, "eposta modulu cagrilmali");
  assert.strictEqual(whatsappCagrilari.length, 0, "whatsapp cagrilmamali");
  assert.deepStrictEqual(markHatirlatildiCagrilari, ["r1"]);
});

test("hatirlatmaKontrol: kaynak=whatsapp icin WhatsApp, eposta cagrilmaz", async (t) => {
  process.env.PORT = "3203";
  delete require.cache[require.resolve("../src/index")];
  const { server, hatirlatmaKontrol } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  whatsappCagrilari.length = 0; epostaCagrilari.length = 0; markHatirlatildiCagrilari.length = 0;
  hatirlatilacaklar = [{ id: "r2", kaynak: "whatsapp", saat: otuzDkSonra(), berber: "Eren Tokalak", hizmet: "Saç Kesimi", telefon: "905550002222" }];

  await hatirlatmaKontrol();

  assert.strictEqual(whatsappCagrilari.length, 1, "whatsapp modulu cagrilmali");
  assert.strictEqual(epostaCagrilari.length, 0, "eposta cagrilmamali");
  assert.deepStrictEqual(markHatirlatildiCagrilari, ["r2"]);
});

test("hatirlatmaKontrol: kaynak tanimsiz (eski kayit) icin de WhatsApp kullanilir", async (t) => {
  process.env.PORT = "3203";
  delete require.cache[require.resolve("../src/index")];
  const { server, hatirlatmaKontrol } = require("../src/index");
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => setTimeout(r, 400));

  whatsappCagrilari.length = 0; epostaCagrilari.length = 0; markHatirlatildiCagrilari.length = 0;
  hatirlatilacaklar = [{ id: "r3", saat: otuzDkSonra(), berber: "Kaan Ekinci", hizmet: "Saç Kesimi", telefon: "905550003333" }];

  await hatirlatmaKontrol();

  assert.strictEqual(whatsappCagrilari.length, 1);
  assert.strictEqual(epostaCagrilari.length, 0);
});
