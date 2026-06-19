// ---------------------------------------------------------------------------
// TEK DOĞRULUK KAYNAĞI — berber eklemek veya fiyat değiştirmek için burası
// PIN = dashboard giriş şifresi (her berber kendi PINini değiştirebilir)
// ---------------------------------------------------------------------------

const BERBERLER = [
  {
    id: "resul",
    ad: "Resul Tabu",
    uzmanlik: "Saç & Sakal Tasarımı",
    pin: "1234",
    fiyat: { sac: 900, sakal: 300, kombin: 1200, cocuk: 900 },
  },
  {
    id: "ahmet",
    ad: "Ahmet Usta",
    uzmanlik: "Klasik Tıraş & Saç",
    pin: "1111",
    fiyat: { sac: 650, sakal: 250, kombin: 900, cocuk: 650 },
  },
  {
    id: "mehmet",
    ad: "Mehmet Bey",
    uzmanlik: "Modern Kesim & Sakal",
    pin: "2222",
    fiyat: { sac: 650, sakal: 250, kombin: 900, cocuk: 650 },
  },
  {
    id: "kemal",
    ad: "Kemal Usta",
    uzmanlik: "Fade & Tasarım",
    pin: "3333",
    fiyat: { sac: 650, sakal: 250, kombin: 900, cocuk: 650 },
  },
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
    const etiket = d.toLocaleDateString("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const yil = d.getFullYear();
    const ay = String(d.getMonth() + 1).padStart(2, "0");
    const gun = String(d.getDate()).padStart(2, "0");
    sonuc.push({ etiket, deger: `${yil}-${ay}-${gun}` });
  }
  return sonuc;
}

module.exports = { BERBERLER, HIZMETLER, SAATLER, gelecekTarihler };
