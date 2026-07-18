// ---------------------------------------------------------------------------
// TEK DOĞRULUK KAYNAĞI
// Berber eklemek: BERBERLER dizisine yeni nesne ekle.
// PIN değiştirmek: ilgili berberin pin alanını güncelle.
// ADMIN_PIN: ortam değişkeni ADMIN_PIN ile override edilebilir.
//
// calisma: berberin mesai düzeni.
//   baslangic: "HH:MM"  → her gün aynı; VEYA gün bazlı { 1:"10:30", 2:"09:45", ... }
//               (JS getDay: 0=Pazar, 1=Pazartesi ... 6=Cumartesi)
//   bitis:     "HH:MM"  → son slot bu saatten önce bitmeli
//   yemek:     "HH:MM"  → yemek arasının başlangıcı (yoksa null)
//   yemekDk:   yemek arası uzunluğu (dk). Bu aralıkla çakışan slotlar kapanır.
//
// net: berberin kendi panelinde gördüğü günlük net gelir = (ciro - taban) * oran
//   Resul patron olduğu için tam ciroyu görür (taban 0, oran 1).
// ---------------------------------------------------------------------------

const ADMIN_PIN = process.env.ADMIN_PIN || "1734"; // ortam değişkeni ile override edilebilir

const RESUL_FIYAT = { sac: 900, sakal: 300, kombin: 1200, cocuk: 900 };
const EKIP_FIYAT  = { sac: 650, sakal: 250, kombin: 900,  cocuk: 650 };

// Eren dönüşümlü başlar: Pzt/Çrş/Cum 10:30, Sal/Prş/Cmt 9:45
const EREN_BASLANGIC = { 1: "10:30", 2: "09:45", 3: "10:30", 4: "09:45", 5: "10:30", 6: "09:45" };

// tel: WhatsApp numarası (uluslararası format, + olmadan, örn: "905551234567")
// Boş bırakılırsa o berbere bildirim gönderilmez.
// slotDk: bir randevu diliminin süresi (Resul 30dk, diğerleri 45dk).
const BERBERLER = [
  { id: "resul",     ad: "Resul Tabu",     uzmanlik: "Saç & Sakal Tasarımı", pin: "2278", tel: null, admin: true, slotDk: 30, fiyat: RESUL_FIYAT,
    calisma: { baslangic: "09:00", bitis: "20:00", yemek: "14:00", yemekDk: 120 }, net: { taban: 0, oran: 1 } },
  { id: "eren",      ad: "Eren Tokalak",   uzmanlik: "Saç & Sakal Tasarımı", pin: "2828", tel: null, slotDk: 45, fiyat: EKIP_FIYAT,
    calisma: { baslangic: EREN_BASLANGIC, bitis: "21:00", yemek: "16:30", yemekDk: 45 }, net: { taban: 100, oran: 0.55 } },
  { id: "kaan",      ad: "Kaan Ekinci",    uzmanlik: "Saç & Sakal Tasarımı", pin: "3436", tel: null, slotDk: 45, fiyat: EKIP_FIYAT,
    calisma: { baslangic: "10:45", bitis: "21:00", yemek: "16:00", yemekDk: 45 }, net: { taban: 100, oran: 0.60 } },
  { id: "burak",     ad: "Burak Şahin",    uzmanlik: "Saç & Sakal Tasarımı", pin: "1453", tel: null, slotDk: 45, fiyat: EKIP_FIYAT,
    calisma: { baslangic: "10:30", bitis: "20:15", yemek: "16:30", yemekDk: 45 }, net: { taban: 0, oran: 0.45 } },
  { id: "emre",      ad: "Emre Akçam",     uzmanlik: "Saç & Sakal Tasarımı", pin: "3434", tel: null, slotDk: 45, fiyat: EKIP_FIYAT,
    calisma: { baslangic: "09:30", bitis: "20:00", yemek: "16:15", yemekDk: 45 }, net: { taban: 0, oran: 0.50 } },
  { id: "huseyin",   ad: "Hüseyin Dincer", uzmanlik: "Saç & Sakal Tasarımı", pin: "2233", tel: null, slotDk: 45, fiyat: EKIP_FIYAT,
    calisma: { baslangic: "09:00", bitis: "20:00", yemek: "15:00", yemekDk: 45 }, net: { taban: 0, oran: 0.45 } },
  { id: "mehmetali", ad: "Mehmet Ali",     uzmanlik: "Saç & Sakal Tasarımı", pin: "4773", tel: null, slotDk: 45, fiyat: EKIP_FIYAT,
    calisma: { baslangic: "09:30", bitis: "20:00", yemek: "16:15", yemekDk: 45 }, net: { taban: 0, oran: 0.45 } },
];

const HIZMETLER = [
  { id: "sac",    ad: "Saç Kesimi",   sure: "~30 dk" },
  { id: "sakal",  ad: "Sakal Tıraşı", sure: "~20 dk" },
  { id: "kombin", ad: "Saç + Sakal",  sure: "~45 dk" },
  { id: "cocuk",  ad: "Çocuk Kesimi", sure: "~25 dk" },
];

// --- Saat yardımcıları ---
function saatToDk(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }
function dkToSaat(t) { return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }

function saatListesiUret(adimDk) {
  const list = [];
  for (let dk = 9 * 60; dk < 22 * 60; dk += adimDk) list.push(dkToSaat(dk));
  return list;
}

// 30dk'lık ızgara (Resul + varsayılan) ve 45dk'lık ızgara (diğer berberler).
// Not: Bunlar sabit tam ızgaralardır; çalışma saatleri berberCalismaSaatleri ile hesaplanır.
const SAATLER    = saatListesiUret(30); // 09:00 ... 21:30
const SAATLER_45 = saatListesiUret(45); // 09:00, 09:45 ...

function berber(berberId) { return BERBERLER.find((x) => x.id === berberId); }

// Bir berberin dilim süresi (dk)
function berberSlotDk(berberId) {
  const b = berber(berberId);
  return b && b.slotDk ? b.slotDk : 30;
}

// Bir berberin BELİRLİ TARİHTEKİ başlangıç saati (Eren gün bazlı değişir)
function berberBaslangicSaati(berberId, tarih) {
  const b = berber(berberId);
  const c = b && b.calisma;
  if (!c) return "09:00";
  if (typeof c.baslangic === "string") return c.baslangic;
  // gün bazlı — tarih "YYYY-MM-DD"
  const gun = tarih ? new Date(tarih + "T00:00:00").getDay() : 1;
  return c.baslangic[gun] || c.baslangic[1] || "09:00";
}

// Bir berbere ait SABİT tam ızgara (geriye dönük uyum — panel/db bazı yerlerde kullanır)
function berberSaatleri(berberId) {
  return berberSlotDk(berberId) === 45 ? SAATLER_45 : SAATLER;
}

// Bir berberin BELİRLİ TARİHTEKİ tüm slotları, yemek işaretiyle birlikte:
//   - kendi başlangıç saatinden başlar (ızgara kaydırılır)
//   - son slot bitiş saatinden önce biter
//   - yemek arasıyla çakışan slotlar { yemek: true } olarak işaretlenir
// [{ saat, yemek }]
function berberGunSlotlari(berberId, tarih) {
  const b = berber(berberId);
  const step = berberSlotDk(berberId);
  const c = b && b.calisma;
  if (!c) return berberSaatleri(berberId).map((s) => ({ saat: s, yemek: false }));

  const bas  = saatToDk(berberBaslangicSaati(berberId, tarih));
  const bit  = saatToDk(c.bitis);
  const yBas = c.yemek ? saatToDk(c.yemek) : null;
  const yBit = yBas != null ? yBas + (c.yemekDk || 45) : null;

  const slots = [];
  for (let t = bas; t + step <= bit; t += step) {
    // Yemek aralığıyla çakışıyor mu? ([t, t+step) ∩ [yBas, yBit) ≠ ∅)
    const yemek = yBas != null && t < yBit && t + step > yBas;
    slots.push({ saat: dkToSaat(t), yemek });
  }
  return slots;
}

// Randevu alınabilir slotlar. acikSaatler: o gün için özel açılmış yemek
// slotları (berber tokken yemek saatini randevuya açabilir).
function berberCalismaSaatleri(berberId, tarih, acikSaatler = []) {
  const acikSet = new Set(acikSaatler);
  return berberGunSlotlari(berberId, tarih)
    .filter((x) => !x.yemek || acikSet.has(x.saat))
    .map((x) => x.saat);
}

// Berberin günlük net gelir hesabı: (ciro - taban) * oran
function berberNet(berberId, ciro) {
  const b = berber(berberId);
  const n = (b && b.net) || { taban: 0, oran: 1 };
  const net = (ciro - n.taban) * n.oran;
  return net > 0 ? Math.round(net) : 0;
}

// acikGunler: özel açılmış tarihler (Pazar/bayram istisnası). Pazar normalde
// atlanır; ama bu listedeyse (admin "tüm günü aç" demişse) yine gösterilir.
function gelecekTarihler(kacGun = 7, acikGunler = []) {
  const acikSet = new Set(acikGunler);
  const sonuc = [];
  const bugun = new Date();
  for (let i = 0; sonuc.length < kacGun && i < 60; i++) {
    const d = new Date(bugun);
    d.setDate(bugun.getDate() + i);
    const yil = d.getFullYear();
    const ay  = String(d.getMonth() + 1).padStart(2, "0");
    const gun = String(d.getDate()).padStart(2, "0");
    const deger = `${yil}-${ay}-${gun}`;
    if (d.getDay() === 0 && !acikSet.has(deger)) continue; // Pazar — özel açık değilse kapalı
    const etiket = d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
    sonuc.push({ etiket, deger });
  }
  return sonuc;
}

module.exports = {
  BERBERLER, HIZMETLER, SAATLER, SAATLER_45,
  berberSlotDk, berberSaatleri, berberCalismaSaatleri, berberGunSlotlari,
  berberBaslangicSaati, berberNet, gelecekTarihler, ADMIN_PIN,
};
