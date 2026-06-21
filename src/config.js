// ---------------------------------------------------------------------------
// TEK DOĞRULUK KAYNAĞI
// Berber eklemek: BERBERLER dizisine yeni nesne ekle.
// PIN değiştirmek: ilgili berberin pin alanını güncelle.
// ADMIN_PIN: Railway'de ADMIN_PIN env değişkeni olarak ayarla.
// ---------------------------------------------------------------------------

const ADMIN_PIN = process.env.ADMIN_PIN || "0000"; // Railway'de env var ile değiştir!

const RESUL_FIYAT = { sac: 900, sakal: 300, kombin: 1200, cocuk: 900 };
const EKIP_FIYAT  = { sac: 650, sakal: 250, kombin: 900,  cocuk: 650 };

// tel: WhatsApp numarası (uluslararası format, + olmadan, örn: "905551234567")
// Boş bırakılırsa o berbere bildirim gönderilmez.
const BERBERLER = [
  { id: "resul",     ad: "Resul Tabu",     uzmanlik: "Saç & Sakal Tasarımı", pin: "1111", tel: null, admin: true, fiyat: RESUL_FIYAT },
  { id: "eren",      ad: "Eren Tokalak",   uzmanlik: "Saç & Sakal Tasarımı", pin: "2222", tel: null, fiyat: EKIP_FIYAT  },
  { id: "kaan",      ad: "Kaan Ekinci",    uzmanlik: "Saç & Sakal Tasarımı", pin: "3333", tel: null, fiyat: EKIP_FIYAT  },
  { id: "burak",     ad: "Burak Şahin",    uzmanlik: "Saç & Sakal Tasarımı", pin: "4444", tel: null, fiyat: EKIP_FIYAT  },
  { id: "emre",      ad: "Emre Akçam",     uzmanlik: "Saç & Sakal Tasarımı", pin: "5555", tel: null, fiyat: EKIP_FIYAT  },
  { id: "huseyin",   ad: "Hüseyin Dincer", uzmanlik: "Saç & Sakal Tasarımı", pin: "6666", tel: null, fiyat: EKIP_FIYAT  },
  { id: "mehmetali", ad: "Mehmet Ali",     uzmanlik: "Saç & Sakal Tasarımı", pin: "7777", tel: null, fiyat: EKIP_FIYAT  },
];

const HIZMETLER = [
  { id: "sac",    ad: "Saç Kesimi",   sure: "~30 dk" },
  { id: "sakal",  ad: "Sakal Tıraşı", sure: "~20 dk" },
  { id: "kombin", ad: "Saç + Sakal",  sure: "~45 dk" },
  { id: "cocuk",  ad: "Çocuk Kesimi", sure: "~25 dk" },
];

const SAATLER = (() => {
  const list = [];
  for (let dk = 9 * 60; dk < 22 * 60; dk += 30) {
    const s = String(Math.floor(dk / 60)).padStart(2, "0");
    const m = String(dk % 60).padStart(2, "0");
    list.push(`${s}:${m}`);
  }
  return list;
})();

function gelecekTarihler(kacGun = 7) {
  const sonuc = [];
  const bugun = new Date();
  for (let i = 0; sonuc.length < kacGun; i++) {
    const d = new Date(bugun);
    d.setDate(bugun.getDate() + i);
    if (d.getDay() === 0) continue; // Pazar — dükkan kapalı
    const etiket = d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
    const yil = d.getFullYear();
    const ay  = String(d.getMonth() + 1).padStart(2, "0");
    const gun = String(d.getDate()).padStart(2, "0");
    sonuc.push({ etiket, deger: `${yil}-${ay}-${gun}` });
  }
  return sonuc;
}

module.exports = { BERBERLER, HIZMETLER, SAATLER, gelecekTarihler, ADMIN_PIN };
