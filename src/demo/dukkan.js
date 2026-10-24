// ---------------------------------------------------------------------------
// DEMO dükkânı — sadece DEMO=true iken config.js bunu kullanır.
// Ad, usta, fiyat, adres ve telefon uydurmadır; gerçek bir işletmeye ait değildir.
// ---------------------------------------------------------------------------

const DUKKAN = {
  ad: "Örnek Berber",
  adres: "Örnek Mah. Demo Sk. No:1, İstanbul",
  telefon: "902120000000", // kullanılmayan (000) numara — "Ara" düğmesi bir yere çalmasın
  alanAdi: "randevu.catalcamyazilim.online",
  logo: "/demo/logo.svg",
  instagram: "catalcamyazilim",
};

const PATRON_FIYAT = { sac: 700, sakal: 250, kombin: 900 };
const EKIP_FIYAT   = { sac: 500, sakal: 200, kombin: 650 };

const usta = (id, ad, ek) => ({
  id, ad, uzmanlik: "Saç & Sakal Tasarımı", pin: null, tel: null, slotDk: 45, fiyat: EKIP_FIYAT, foto: null,
  net: { taban: 0, oran: 0.5 }, ...ek,
});

const BERBERLER = [
  usta("murat",  "Murat Aksoy", { admin: true, slotDk: 30, fiyat: PATRON_FIYAT, net: { taban: 0, oran: 1 },
    calisma: { baslangic: "09:30", bitis: "20:30", yemek: "14:00", yemekDk: 60 } }),
  usta("okan",   "Okan Er",     { calisma: { baslangic: "10:00", bitis: "21:00", yemek: "15:15", yemekDk: 45 } }),
  usta("serdar", "Serdar Tunç", { calisma: { baslangic: "09:45", bitis: "21:00", yemek: "16:30", yemekDk: 45 } }),
  usta("volkan", "Volkan Ateş", { calisma: { baslangic: "10:30", bitis: "21:30", yemek: "16:30", yemekDk: 45 } }),
  usta("caner",  "Caner Yalın", { calisma: { baslangic: "09:00", bitis: "20:00", yemek: "14:15", yemekDk: 45 } }),
];

module.exports = { DUKKAN, BERBERLER };
