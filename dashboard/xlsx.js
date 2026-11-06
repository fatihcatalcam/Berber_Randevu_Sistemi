// Bağımlılıksız küçük .xlsx yazıcı (ciro sayfasının "Excel'e aktar" düğmesi için).
// Birden çok sayfa, kalın başlık, ₺ ve % biçimi, sütun genişliği ve sabit başlık
// satırı destekler. Zip sıkıştırmasız (store) yazılır; Excel, LibreOffice ve
// Google Sheets açar.
//
//   const blob = xlsxOlustur([{ ad: "Özet", satirlar: [["Başlık", ...], [...]], genislik: [20, 12] }]);
//   Hücre: sayı, metin, null ya da { v, s } — s: "kalin" | "para" | "kalinPara" | "yuzde"
(function () {
  const STIL = { kalin: 1, para: 2, kalinPara: 3, yuzde: 4 };

  const kacis = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function sutunHarfi(i) {
    let s = "";
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function hucreXml(hucre, ref, baslikSatiri) {
    const nesne = hucre !== null && typeof hucre === "object";
    const v = nesne ? hucre.v : hucre;
    if (v === null || v === undefined || v === "") return "";
    const stil = STIL[nesne ? hucre.s : baslikSatiri ? "kalin" : ""] || 0;
    const s = stil ? ` s="${stil}"` : "";
    if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${kacis(v)}</t></is></c>`;
  }

  function sayfaXml(sayfa) {
    const cols = (sayfa.genislik || []).map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const satirlar = sayfa.satirlar.map((satir, r) =>
      `<row r="${r + 1}">${satir.map((h, c) => hucreXml(h, sutunHarfi(c) + (r + 1), r === 0)).join("")}</row>`).join("");
    const sabit = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      sabit + (cols ? `<cols>${cols}</cols>` : "") + `<sheetData>${satirlar}</sheetData></worksheet>`;
  }

  const STILLER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0 &quot;₺&quot;"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs></styleSheet>';

  // Sayfa adı: en fazla 31 karakter, []:*?/\ olamaz
  const sayfaAdi = (ad) => kacis(String(ad).replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31));

  function dosyalar(sayfalar) {
    const tur = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    return [
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sayfalar.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        '</Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${tur}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${tur}"><sheets>` +
        sayfalar.map((s, i) => `<sheet name="${sayfaAdi(s.ad)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        '</sheets></workbook>'],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sayfalar.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${tur}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sayfalar.length + 1}" Type="${tur}/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", STILLER],
      ...sayfalar.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sayfaXml(s)]),
    ];
  }

  // --- Sıkıştırmasız zip ---
  const CRC = new Uint32Array(256).map((_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(girdiler) {
    const enc = new TextEncoder();
    const d = new Date();
    const saat = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const tarih = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parcalar = [], merkez = [];
    let ofset = 0;
    for (const [ad, icerik] of girdiler) {
      const adB = enc.encode(ad), veri = enc.encode(icerik), crc = crc32(veri);
      const yerel = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, saat, 2], [12, tarih, 2],
       [14, crc, 4], [18, veri.length, 4], [22, veri.length, 4], [26, adB.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => n === 4 ? yerel.setUint32(o, v, true) : yerel.setUint16(o, v, true));
      const mk = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, saat, 2], [14, tarih, 2],
       [16, crc, 4], [20, veri.length, 4], [24, veri.length, 4], [28, adB.length, 2], [30, 0, 2], [32, 0, 2],
       [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, ofset, 4]]
        .forEach(([o, v, n]) => n === 4 ? mk.setUint32(o, v, true) : mk.setUint16(o, v, true));
      parcalar.push(yerel, adB, veri);
      merkez.push(mk, adB);
      ofset += 30 + adB.length + veri.length;
    }
    const merkezBoyut = merkez.reduce((t, p) => t + p.byteLength, 0);
    const son = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, girdiler.length, 2], [10, girdiler.length, 2],
     [12, merkezBoyut, 4], [16, ofset, 4], [20, 0, 2]]
      .forEach(([o, v, n]) => n === 4 ? son.setUint32(o, v, true) : son.setUint16(o, v, true));
    return new Blob([...parcalar, ...merkez, son], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  window.xlsxOlustur = (sayfalar) => zip(dosyalar(sayfalar));
})();
