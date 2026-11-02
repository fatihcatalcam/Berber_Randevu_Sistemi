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
  let randevuAlindi = () => {};
  window.fetch = async (...args) => {
    const res = await asilFetch(...args);
    const adres = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    if ((res.headers.get("content-type") || "").includes("json")) {
      res.clone().json().then((g) => {
        if (g && Array.isArray(g.demoSms)) g.demoSms.forEach(smsGoster);
        if (res.status === 201 && adres.endsWith("/api/public/randevu")) randevuAlindi(g);
      }).catch(() => {});
    }
    return res;
  };

  // Panel ve ciro şeridiyle aynı; müşteri sayfasında da demo olduğu baştan belli olsun
  // Sağdaki düğme demonun öbür yüzüne geçirir: müşteri sayfasından panele, panelden müşteri sayfasına
  const serit = () => yeni("div", "demo-serit",
    `<span>DEMO · <span class="demo-serit-ek">Veriler </span>her gece 0${D.sifirlamaSaati}:00'te sıfırlanır<span class="demo-serit-ek"> · Kendi dükkânın için ${instagram}</span></span>` +
    (D.sayfa === "randevu"
      ? '<a class="demo-serit-btn" href="/dashboard">Usta panelini gör →</a>'
      : '<a class="demo-serit-btn" href="/randevu-al">Müşteri sayfası →</a>'));

  // --- Çerez onayı: GA ve Clarity sadece "Kabul et"ten sonra yüklenir ---
  // Tercih bütün *.catalcamyazilim.online alt alan adlarında ortak bir çerezde
  // (portföyde verilen karar demoda da geçerli). Yerelde (localhost) domain'siz yazılır.
  const A = D.analitik || {};
  const TERCIH = "cerez-tercihi";
  const cerezAlani = A.cerezAlani && location.hostname.endsWith(A.cerezAlani) ? `; domain=.${A.cerezAlani}` : "";
  const tercihOku = () => (document.cookie.match(new RegExp(`(?:^|; )${TERCIH}=([^;]*)`)) || [])[1];
  const tercihYaz = (deger) => {
    document.cookie = `${TERCIH}=${deger}${cerezAlani}; path=/; max-age=${365 * 24 * 3600}; SameSite=Lax`;
  };
  const cerezSil = (ad) => {
    const alanlar = ["", `; domain=${location.hostname}`, cerezAlani].filter((x, i, d) => d.indexOf(x) === i);
    for (const alan of alanlar) document.cookie = `${ad}=; path=/; max-age=0${alan}`;
  };
  let olcumYuklendi = false;

  function olcumuYukle() {
    if (olcumYuklendi || !A.ga) return;
    olcumYuklendi = true;
    const gtagJs = document.createElement("script");
    gtagJs.async = true;
    gtagJs.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(A.ga)}`;
    document.head.appendChild(gtagJs);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", A.ga);

    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    const clarityJs = document.createElement("script");
    clarityJs.async = true;
    clarityJs.src = `https://www.clarity.ms/tag/${encodeURIComponent(A.clarity)}`;
    document.head.appendChild(clarityJs);
    window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
  }

  function olcumuKapat() {
    // Bu sayfada daha önce kabul edilmişse Clarity'ye de bildir; yüklü değilse hiçbir istek gitmez
    if (typeof window.clarity === "function") window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
    const adlar = document.cookie.split("; ").map((c) => c.split("=")[0]);
    for (const ad of adlar) if (ad === "_ga" || ad.startsWith("_ga_") || ad === "_clck" || ad === "_clsk") cerezSil(ad);
  }

  let bildirim = null;
  function cerezBildirimiGoster() {
    if (bildirim) return;
    bildirim = yeni("div", "demo-cerez",
      `<p>Sitenin nasıl kullanıldığını görmek için Google Analytics ve Microsoft Clarity çerezlerini kullanmak istiyorum. Clarity sayfadaki tıklamaları ve kaydırmaları kaydeder. Kabul etmezseniz hiçbir ölçüm yapılmaz.</p>
       <div class="demo-cerez-dugmeler">
         <button type="button" data-tercih="evet">Kabul et</button>
         <button type="button" data-tercih="hayir">Reddet</button>
       </div>`);
    bildirim.setAttribute("role", "dialog");
    bildirim.setAttribute("aria-label", "Çerez tercihi");
    bildirim.addEventListener("click", (e) => {
      const deger = e.target.dataset && e.target.dataset.tercih;
      if (!deger) return;
      tercihYaz(deger);
      if (deger === "evet") olcumuYukle(); else olcumuKapat();
      bildirim.remove(); bildirim = null;
      document.body.style.paddingBottom = "";
    });
    document.body.appendChild(bildirim);
    // Sayfanın son düğmeleri bildirimin altında kalmasın: o kadar boşluk bırak
    document.body.style.paddingBottom = `${bildirim.offsetHeight + 24}px`;
  }

  const tercih = tercihOku();
  if (tercih === "evet") olcumuYukle();
  else if (tercih === "hayir") olcumuKapat();
  else cerezBildirimiGoster();

  // --- Müşteri randevu sayfası ---
  if (D.sayfa === "randevu") {
    document.body.prepend(serit());
    const not = () => yeni("p", "demo-not", "Bu bir demo. Girdiğin bilgiler her gece silinir, gerçek telefon numarası yazmana gerek yok.");
    document.getElementById("bilgiHata")?.after(not());
    document.getElementById("iptalTelefonHata")?.after(not());

    // Onay ekranından, randevunun düştüğü ustanın paneline (yeni randevu vurgulu)
    const panelBtn = yeni("a", "demo-panel-btn", "Şimdi usta panelinde gör →");
    panelBtn.href = "/dashboard";
    document.querySelector("#adimBasari .basari-eylem")?.before(panelBtn);
    randevuAlindi = (r) => {
      panelBtn.href = `/dashboard?${new URLSearchParams({ usta: r.berberId, tarih: r.tarih, randevu: r.id })}`;
    };
    const basariSms = document.querySelector(".basari-sms");
    if (basariSms) basariSms.textContent = "📩 Gerçek sistemde müşteriye onay SMS'i gider (üstte gösterildi).";
    document.body.appendChild(yeni("footer", "demo-alt",
      `Bu sistemi <b>Çatalçam Yazılım</b> yaptı. Kendi dükkânın için Instagram'dan DM at: ${instagram}` +
      `<br><a href="/dashboard">Usta ve yönetici panelini gör →</a>` +
      ` · <a href="#" class="demo-cerez-ac">Çerez tercihleri</a>`));
    document.querySelector(".demo-cerez-ac").addEventListener("click", (e) => { e.preventDefault(); cerezBildirimiGoster(); });
  }

  // --- Panel ve ciro: üst şerit + şifresiz giriş (sunucu demoda PIN sormaz) ---
  if (D.sayfa === "panel" || D.sayfa === "ciro") document.body.prepend(serit());

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

    // Randevu onay ekranından gelindiyse (?usta=&tarih=&randevu=): o ustanın
    // paneli açılır, randevunun gününe gidilir, yeni randevu vurgulanır.
    // (BERBERLER, randevular, seciliTarih... panelin kendi değişkenleri)
    const q = new URLSearchParams(location.search);
    const hedef = q.get("usta") && { usta: q.get("usta"), tarih: q.get("tarih"), id: q.get("randevu") };
    let vurguId = null;
    const vurgula = (kaydir) => {
      const hucre = vurguId && document.querySelector(`.cizelge-hucre[data-id="${CSS.escape(vurguId)}"]`);
      if (!hucre) return;
      hucre.classList.add("demo-vurgu");
      if (kaydir) hucre.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    };
    const asilCizelge = window.cizelgeRender;
    window.cizelgeRender = function () { asilCizelge.apply(this, arguments); vurgula(false); };

    const bekle = async (kosul, ms = 15000) => {
      for (const bitis = Date.now() + ms; Date.now() < bitis; await new Promise((r) => setTimeout(r, 150))) {
        if (kosul()) return true;
      }
      return false;
    };

    const kayitli = (() => { try { return JSON.parse(localStorage.getItem("berberPanelAuth")); } catch { return null; } })();
    if (hedef && kayitli && kayitli.berberId !== hedef.usta) {
      localStorage.removeItem("berberPanelAuth"); // başka biri girişliyse o ustaya geç
      location.reload();
    } else if (hedef) {
      history.replaceState(null, "", location.pathname); // yenileyince tekrarlamasın
      (async () => {
        if (!kayitli) {
          if (!(await bekle(() => BERBERLER.length))) return;
          const usta = BERBERLER.find((b) => b.id === hedef.usta);
          if (!usta) return;
          window.berberSec(usta.id, usta.ad);
        }
        if (!(await bekle(() => randevular.some((r) => String(r.id) === hedef.id)))) return;
        vurguId = hedef.id;
        if (hedef.tarih) { seciliTarih = hedef.tarih; takvimAy = new Date(hedef.tarih + "T00:00:00"); }
        takvimRender(); cizelgeRender(); render();
        setTimeout(() => vurgula(true), 100);
      })();
    }
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
