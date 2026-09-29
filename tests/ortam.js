// npm test bunu her test dosyasından önce yükler (--require). PIN'ler artık
// koddan değil ortam değişkenlerinden okunduğu için testlere sahte PIN verir.
["resul", "eren", "kaan", "burak", "emre", "huseyin", "mehmetali"].forEach((id, i) => {
  process.env["PIN_" + id.toUpperCase()] ||= String(5000 + i);
});
process.env.ADMIN_PIN ||= "4999";
