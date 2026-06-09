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
