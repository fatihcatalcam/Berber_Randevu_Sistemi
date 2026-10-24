// Demo arayüzü — sadece DEMO=true kurulumda sayfalara eklenir (src/demo/index.js).
// Sayfanın kendi kodundan sonra çalışır (defer); onun fonksiyonlarını kullanır.
(() => {
  const D = window.DEMO || {};
  const kacis = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const yeni = (etiket, sinif, html) => {
    const e = document.createElement(etiket);
    if (sinif) e.className = sinif;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const instagram = `<a href="https://instagram.com/${kacis(D.instagram)}" target="_blank" rel="noopener">@${kacis(D.instagram)}</a>`;

  // --- Sunucu yanıtındaki demoSms'ler: "müşteriye şu SMS giderdi" kartı ---
  let yigin;
  const telefonYaz = (t) => { const s = String(t).replace(/^90/, "0"); return `${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7, 9)} ${s.slice(9)}`; };

  function smsGoster({ telefon, mesaj }) {
    if (!yigin) {
      yigin = yeni("div", "demo-sms-yigin");
      yigin.setAttribute("aria-live", "polite");
      document.body.appendChild(yigin);
    }
    const kart = yeni("div", "demo-sms",
      `<div class="demo-sms-ust"><span>💬 SMS · ${kacis(telefonYaz(telefon))}</span><button type="button" aria-label="Kapat">×</button></div>
       <div class="demo-sms-baslik">Müşteriye şu SMS giderdi</div>
       <div class="demo-sms-metin">${kacis(mesaj)}</div>`);
    kart.querySelector("button").onclick = () => kart.remove();
    // Doğrulama kodu: tek dokunuşla açık olan kod alanına yazılsın
    const kod = (mesaj.match(/kodunuz: (\d{6})/) || [])[1];
    if (kod) {
      const b = yeni("button", "demo-sms-kod", `Kodu yaz: ${kod}`);
      b.type = "button";
      b.onclick = () => {
        const alan = [...document.querySelectorAll("#inKod, #inIptalKod")].find((i) => i.offsetParent);
        if (alan) { alan.value = kod; alan.dispatchEvent(new Event("input", { bubbles: true })); alan.focus(); }
        kart.remove();
      };
      kart.appendChild(b);
    }
    yigin.prepend(kart);
    while (yigin.children.length > 3) yigin.lastChild.remove();
  }

  const asilFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await asilFetch(...args);
    if ((res.headers.get("content-type") || "").includes("json")) {
      res.clone().json().then((g) => { if (g && Array.isArray(g.demoSms)) g.demoSms.forEach(smsGoster); }).catch(() => {});
    }
    return res;
  };

  // --- Müşteri randevu sayfası ---
  if (D.sayfa === "randevu") {
    const not = () => yeni("p", "demo-not", "Bu bir demo, girdiğin bilgiler her gece silinir.");
    document.getElementById("bilgiHata")?.after(not());
    document.getElementById("iptalTelefonHata")?.after(not());
    const basariSms = document.querySelector(".basari-sms");
    if (basariSms) basariSms.textContent = "📩 Gerçek sistemde müşteriye onay SMS'i gider (üstte gösterildi).";
    document.body.appendChild(yeni("footer", "demo-alt",
      `Bu sistemi <b>Çatalçam Yazılım</b> yaptı. Kendi dükkânın için Instagram'dan DM at: ${instagram}`));
  }

  // --- Panel ve ciro: üst şerit + şifresiz giriş (sunucu demoda PIN sormaz) ---
  if (D.sayfa === "panel" || D.sayfa === "ciro") {
    document.body.prepend(yeni("div", "demo-serit",
      `DEMO · Veriler her gece 0${D.sifirlamaSaati}:00'te sıfırlanır · Kendi dükkânın için ${instagram}`));
  }

  if (D.sayfa === "panel") {
    const asilSec = window.berberSec, asilAdmin = window.adminGirisGoster;
    window.berberSec = (id, ad) => { asilSec(id, ad); window.pinGiris(); };
    window.adminGirisGoster = () => { asilAdmin(); window.pinGiris(); };
    document.getElementById("berberKartGrid")?.before(yeni("p", "demo-giris-not",
      "<b>Demo:</b> şifre gerekmez. Usta panelini görmek için bir usta seç ya da yönetici olarak gir."));
    const ayrac = document.querySelector(".admin-divider");
    if (ayrac) ayrac.textContent = "Yönetici";
    const adminBtn = document.querySelector('button[onclick="adminGirisGoster()"]');
    if (adminBtn) adminBtn.textContent = "👑 Yönetici olarak gir";
  }

  if (D.sayfa === "ciro") {
    const pin = document.getElementById("pinInput");
    if (pin) pin.style.display = "none";
    const alt = document.querySelector(".login-kart .alt");
    if (alt) alt.textContent = "Demo: şifre gerekmez.";
    const btn = document.querySelector(".login-kart .btn");
    if (btn) btn.textContent = "Şifresiz gir";
  }
})();
