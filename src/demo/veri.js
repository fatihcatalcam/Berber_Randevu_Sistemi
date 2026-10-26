// ---------------------------------------------------------------------------
// DEMO verisi — her gece sıfırlamada yüklenen uydurma randevular.
// Tarihler bugüne göre hesaplanır: son 4 hafta geçmiş (ciro ve müşteri geçmişi
// dolu görünsün), önümüzdeki günler giderek seyrelen doluluk. Rastgelelik
// günün tarihinden tohumlanır; aynı gün aynı veri çıkar (test edilebilir).
// ---------------------------------------------------------------------------
const { BERBERLER, HIZMETLER, EKLER, berberCalismaSaatleri } = require("../config");
const { gunEkle } = require("../randevu-yardimci");

const ADLAR = ["Ahmet", "Mehmet", "Mustafa", "Ali", "Hasan", "Emre", "Burak", "Can", "Cem", "Deniz", "Efe", "Furkan",
  "Gökhan", "Halil", "İbrahim", "Kerem", "Mert", "Onur", "Oğuz", "Serkan", "Tolga", "Uğur", "Yusuf", "Barış", "Eren",
  "Arda", "Batuhan", "Doğan", "Ege", "Kaan", "Koray", "Levent", "Selim", "Sinan", "Taylan", "Umut", "Yiğit", "Ozan"];
const SOYADLAR = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk", "Arslan", "Doğan", "Koç",
  "Kurt", "Özkan", "Polat", "Aksu", "Erdem", "Güneş", "Tekin", "Bulut", "Avcı", "Uçar", "Karaca", "Duman", "Sezer"];

// Haftalık sabit müşteriler — sıfırlamadan sonra sabit kuralı olarak eklenir.
// Saatleri o ustanın o günkü çalışma saatlerinde olmalı.
const SABITLER = [
  { berberId: "okan",  ad: "Kemal Yurt",    telefon: "905550000101", hizmetId: "kombin", gun: 2, saat: "18:15" },
  { berberId: "murat", ad: "Hakan Demirci", telefon: "905550000102", hizmetId: "sac",    gun: 6, saat: "11:00" },
];

// Gün farkına göre doluluk: geçmiş dolu, ileri tarihler seyrek
function doluluk(fark) {
  if (fark < 0) return 0.7;
  return [0.65, 0.55, 0.45, 0.38, 0.3, 0.25, 0.2][fark] ?? 0.08;
}

function tohumlu(metin) {
  let h = 1779033703;
  for (const c of metin) h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
  return () => { // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoRandevulari(bugun, simdiSaat, { gecmisGun = 28, ileriGun = 13 } = {}) {
  const rnd = tohumlu(bugun);
  const sec = (dizi) => dizi[Math.floor(rnd() * dizi.length)];

  // Aynı müşteriler tekrar gelsin (müşteri geçmişi dolu görünsün)
  const musteriler = Array.from({ length: 140 }, (_, i) => ({
    ad: `${sec(ADLAR)} ${sec(SOYADLAR)}`,
    telefon: `9055500${String(1000 + i * 7).padStart(5, "0")}`,
  }));
  const hizmetSec = () => { const x = rnd(); return x < 0.5 ? "sac" : x < 0.85 ? "kombin" : "sakal"; };
  // Randevu, tarihinden 0–6 gün önce alınmış gibi; gelecekte alınmış olamaz
  // (bugün alınanlar gece yarısından hemen sonra — sıfırlama 03:00'te çalışır)
  const olusturulma = (tarih) => {
    const gun = gunEkle(tarih, -Math.floor(rnd() * 7));
    return gun < bugun ? new Date(gun + "T10:00:00").getTime() : new Date(bugun + "T00:30:00").getTime();
  };

  const randevular = [];
  for (let fark = -gecmisGun; fark <= ileriGun; fark++) {
    const tarih = gunEkle(bugun, fark);
    const haftaGunu = new Date(tarih + "T00:00:00").getDay();
    if (haftaGunu === 0) continue; // Pazar kapalı

    for (const berber of BERBERLER) {
      for (const saat of berberCalismaSaatleri(berber.id, tarih)) {
        const sabit = SABITLER.find((s) => s.berberId === berber.id && s.gun === haftaGunu && s.saat === saat);
        if (sabit && fark >= 0) continue; // ileri haftaları sabit kuralı üretir
        if (!sabit && rnd() >= doluluk(fark)) continue;

        const gecmis = fark < 0 || (fark === 0 && saat < simdiSaat);
        const x = rnd();
        const durum = gecmis ? (x < 0.9 ? "onaylı" : x < 0.96 ? "gelmedi" : "iptal") : (x < 0.96 ? "onaylı" : "iptal");
        const musteri = sabit || sec(musteriler);
        const hizmetId = sabit ? sabit.hizmetId : hizmetSec();
        const kas = !sabit && hizmetId !== "sakal" && rnd() < 0.15 ? EKLER.find((e) => e.id === "kas") : null;
        randevular.push({
          ad: musteri.ad, telefon: musteri.telefon,
          berberId: berber.id, berber: berber.ad,
          hizmetId, hizmet: HIZMETLER.find((h) => h.id === hizmetId).ad + (kas ? ` + ${kas.ad}` : ""),
          tarih, saat, fiyat: berber.fiyat[hizmetId] + (kas ? kas.fiyat : 0), durum,
          // İptallerin çoğunu müşteri siteden yapar
          iptalEden: durum === "iptal" ? (rnd() < 0.7 ? "musteri" : "berber") : null,
          kaynak: sabit ? "sabit" : rnd() < 0.6 ? "web" : "panel",
          olusturulma: olusturulma(tarih),
        });
      }
    }
  }
  return randevular;
}

module.exports = { demoRandevulari, SABITLER };
