"use strict";
/* v1 bleibt unverändert. Nur nach erfolgreichem lokalen Schreiben wird der neue Stand angezeigt. */
const KEY = "druckmarkt-handy-v2", OLD = "druckmarkt-handy-v1";
const MAX_FILE = 4 * 1024 * 1024, MAX_PHOTOS = 3 * 1024 * 1024;
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eur = x => Number(x || 0).toLocaleString("de-AT", {style:"currency",currency:"EUR"});
const dat = d => d ? new Date(d + "T12:00:00").toLocaleDateString("de-AT", {weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"}) : "";
const zeit = m => dat(m.datum) + (m.datum_bis && m.datum_bis !== m.datum ? " – " + dat(m.datum_bis) : "");
const id = x => String(x);
const key = x => "markt:" + id(x);
let D = {maerkte:{}}, legacy = {}, raw = null, storageError = "", legacyError = "";
let aktiv = null, produkt = null, suche = "", selectedPosition = null;
function istObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function load() {
  try {
    raw = localStorage.getItem(KEY);
    if (raw !== null) { const parsed = JSON.parse(raw); if (!istObj(parsed) || !istObj(parsed.maerkte)) throw Error("Unbekanntes Speicherformat"); D = parsed; }
  } catch (e) { storageError = "Lokaler v2-Speicher ist nicht lesbar. Es wird nichts überschrieben. " + e.message; }
  try { const s = localStorage.getItem(OLD); if (s !== null) { const v = JSON.parse(s); if (!istObj(v) || !istObj(v.maerkte)) throw Error("Unbekanntes Speicherformat"); legacy = v.maerkte; } }
  catch (e) { legacyError = "Alte lokale Daten sind nicht lesbar und bleiben unverändert. " + e.message; }
}
function commit(change) {
  if (storageError) { alert(storageError); return false; }
  try {
    if (localStorage.getItem(KEY) !== raw) throw Error("Der lokale Stand wurde in einem anderen Fenster geändert. Bitte neu laden und zuvor ein Ergebnis exportieren.");
    const copy = JSON.parse(JSON.stringify(D));
    change(copy);
    const next = JSON.stringify(copy);
    localStorage.setItem(KEY, next);
    raw = next; D = copy; return true;
  } catch (e) { alert("Nicht gespeichert. Die Änderung wurde zurückgenommen. Bitte Speicherplatz prüfen oder ein Ergebnis exportieren.\n\n" + (e.message || e.name)); return false; }
}
let tt; function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("an"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("an"), 2200); }
function summen(mk) { return (mk.positionen || []).reduce((s,p) => ({stk:s.stk + Number(p.verkauft || 0), ums:s.ums + Number(p.verkauft || 0) * Number(p.preis || 0)}), {stk:0,ums:0}); }
function current() { return aktiv && D.maerkte[aktiv]; }
function validId(x) { return typeof x === "string" && x.trim() !== "" && x.length <= 200 && !/[\x00-\x1f]/.test(x); }
// Die PC-Validierung begrenzt alle Stückzahlen (auch Besucher/Kunden) auf 1 Milliarde.
function nat(x) { return Number.isSafeInteger(x) && x >= 0 && x <= 1000000000; }
function validExportId(x) { return validId(x); }
function validateMarktInfo(m) {
  for (const f of ["besucher", "kunden"]) if (m[f] != null && m[f] !== "" && !nat(m[f])) throw Error(f + ": Bitte eine nichtnegative ganze Zahl bis 1.000.000.000 eingeben.");
  if (m.temperatur != null && m.temperatur !== "" && (typeof m.temperatur !== "number" || !Number.isFinite(m.temperatur) || m.temperatur < -100 || m.temperatur > 100)) throw Error("Temperatur muss zwischen −100 und 100 °C liegen.");
  for (const [f,limit] of [["wetter",500],["notiz",5000]]) if (m[f] != null && (typeof m[f] !== "string" || m[f].length > limit)) throw Error(f + " darf höchstens " + limit + " Zeichen enthalten.");
}
function isDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false; const d = new Date(s + "T12:00:00Z"); return !isNaN(d) && d.toISOString().slice(0,10) === s; }
function days(m) { const a = new Date(m.datum + "T12:00:00Z"), end = m.datum_bis || m.datum, result = []; while (a.toISOString().slice(0,10) <= end && result.length < 367) { result.push(a.toISOString().slice(0,10)); a.setUTCDate(a.getUTCDate()+1); } return result; }
function localToday() { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); }
function defaultDay(m) { const all = days(m), today = localToday(); return all.includes(today) ? today : all[0]; }
function totalDays(rows, positionId) { return rows.filter(t => id(t.position_id) === id(positionId)).reduce((n,t) => n + t.anzahl,0); }
function dayCount(mk,pid,day) { const row = mk.tage.find(t => id(t.position_id) === id(pid) && t.datum === day); return row ? row.anzahl : 0; }
function canonical(x) { if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]"; if (istObj(x)) return "{" + Object.keys(x).sort().map(k => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}"; return JSON.stringify(x); }
async function fingerprint(j) {
  if (!globalThis.crypto || !crypto.subtle) throw Error("Dateivergleich nicht verfügbar. Die App über HTTPS oder localhost öffnen.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(j)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,"0")).join("");
}
function validate(j) {
  if (!istObj(j) || j.typ !== "druckmarkt-markt" || j.version !== 2 || !istObj(j.markt) || !validId(j.markt.id) || !Array.isArray(j.positionen) || !Array.isArray(j.tage) || !istObj(j.fotos)) throw Error("Erwartet wird eine Marktdatei im Protokoll Version 2.");
  if (!validExportId(j.export_id)) throw Error("Die Export-ID fehlt oder ist ungültig. Bitte den Markt mit der aktuellen PC-Version erneut exportieren.");
  validateMarktInfo(j.markt);
  if (!isDate(j.markt.datum) || (j.markt.datum_bis && (!isDate(j.markt.datum_bis) || j.markt.datum_bis < j.markt.datum))) throw Error("Der Marktzeitraum ist ungültig.");
  if (days(j.markt).length > 366 || (j.markt.datum_bis && days(j.markt).at(-1) !== j.markt.datum_bis)) throw Error("Der Marktzeitraum darf höchstens 366 Tage umfassen.");
  const ids = new Set(), productIds = new Set();
  for (const p of j.positionen) {
    if (!istObj(p) || !validId(p.id) || !validId(p.produkt_id) || ids.has(id(p.id))) throw Error("Positionen benötigen eindeutige IDs und eine Produkt-ID.");
    if (typeof p.produkt !== "string" || (p.variante != null && typeof p.variante !== "string") || !nat(p.mitgenommen) || !nat(p.verkauft) || (p.preis != null && (typeof p.preis !== "number" || !Number.isFinite(p.preis) || p.preis < 0))) throw Error("Eine Position enthält ungültige Angaben zu Produkt, Bestand, Verkauf oder Preis.");
    ids.add(id(p.id)); productIds.add(id(p.produkt_id));
  }
  const pairs = new Set();
  for (const t of j.tage) {
    if (!istObj(t) || !validId(t.position_id) || !ids.has(id(t.position_id)) || !isDate(t.datum) || t.datum < j.markt.datum || t.datum > (j.markt.datum_bis || j.markt.datum) || !nat(t.anzahl)) throw Error("Ein Tageseintrag ist ungültig oder verweist auf eine unbekannte Position.");
    const pair = JSON.stringify([id(t.position_id),t.datum]); if (pairs.has(pair)) throw Error("Doppelte Position/Datum-Einträge sind nicht erlaubt."); pairs.add(pair);
  }
  for (const p of j.positionen) if (!Number.isSafeInteger(totalDays(j.tage,p.id)) || totalDays(j.tage,p.id) > p.verkauft) throw Error("Die Tagessumme einer Position übersteigt ihren Gesamtverkauf. Bitte die Datei am PC prüfen.");
  let photoSize = 0;
  for (const [pid, photo] of Object.entries(j.fotos)) {
    if (!productIds.has(pid)) throw Error("Ein Foto verweist auf eine unbekannte Produkt-ID.");
    if (typeof photo !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/i.test(photo)) throw Error("Ein Produktbild ist kein gültiges PNG-, JPEG- oder WebP-Thumbnail.");
    photoSize += photo.length; if (photoSize > MAX_PHOTOS) throw Error("Die Produktbilder sind zu groß. Bitte am PC kleinere Thumbnails exportieren.");
  }
}
function basisText(mk,j) {
  const old = new Map(mk.basis_positionen.map(p => [id(p.id),p.verkauft]));
  let changed = 0; for (const p of j.positionen) if (!old.has(id(p.id)) || old.get(id(p.id)) !== p.verkauft) changed++;
  for (const p of mk.basis_positionen) if (!j.positionen.some(q => id(q.id) === id(p.id))) changed++;
  const sortRows = rows => canonical(rows.map(t => ({position_id:id(t.position_id),datum:t.datum,anzahl:t.anzahl})).sort((a,b) => JSON.stringify([a.position_id,a.datum]).localeCompare(JSON.stringify([b.position_id,b.datum]))));
  return `${changed} Positionsstände abweichend; Tageseinträge ${sortRows(mk.basis_tage) === sortRows(j.tage) ? "gleich" : "abweichend"}.`;
}
async function importFile(file) {
  if (file.size > MAX_FILE) { alert("Datei zu groß (maximal 4 MB). Am PC kleinere Produkt-Thumbnails exportieren. Nichts wurde geändert."); return; }
  try {
    const j = JSON.parse(await file.text()); validate(j); const hash = await fingerprint(j), k = key(j.markt.id), old = D.maerkte[k];
    if (old) {
      const same = old.datei_hash === hash;
      if (!confirm(`Dieser Markt ist bereits lokal gespeichert. Die neue Datei hat ${same ? "denselben vollständigen Exportstand" : "einen ANDEREN vollständigen Exportstand"}. ${basisText(old,j)}\n\nErneutes Laden ERSETZT alle lokalen Verkäufe, Tageskorrekturen, Marktinfos und Fotos dieses v2-Marktes durch die Daten der neuen Datei. Zuerst das bisherige Ergebnis exportieren und am PC erfolgreich übernehmen!\n\nWirklich ersetzen?`)) return;
    } else if (Object.values(legacy).some(x => x && x.markt && id(x.markt.id) === id(j.markt.id))) {
      if (!confirm("Zu diesem Markt gibt es alte lokale v1-Daten. Sie bleiben unverändert und separat exportierbar. Der neue v2-Markt übernimmt diese Änderungen nicht. Das alte v1-Ergebnis sichern; zur Übernahme ist eine alte PC-Version erforderlich, die aktuelle PC-Version akzeptiert v1 nicht. Trotzdem zusätzlich laden?")) return;
    }
    const p = j.positionen.map(x => ({...x})), t = j.tage.map(x => ({position_id:x.position_id,datum:x.datum,anzahl:x.anzahl}));
    const mk = {export_id:j.export_id,markt:{...j.markt},positionen:p,fotos:{...j.fotos},tage:t,basis_positionen:p.map(x => ({id:x.id,verkauft:x.verkauft})),basis_tage:t.map(x => ({...x})),datei_hash:hash,tag:defaultDay(j.markt),wetterListe:Array.isArray(j.wetterListe) ? j.wetterListe.filter(x => typeof x === "string" && x.length <= 500) : [],geladen:new Date().toISOString()};
    if (!commit(d => { d.maerkte[k] = mk; })) return;
    aktiv = k; produkt = null; selectedPosition = null; suche = ""; zeigen(); window.scrollTo(0,0); toast("Markt gespeichert");
  } catch (e) { alert("Marktdatei nicht geladen. Es wurde nichts geändert.\n\n" + (e.message || e)); }
}
function result(mk, old) {
  if (old) { const m = mk.markt; return {typ:"druckmarkt-ergebnis",version:1,exportiert:new Date().toISOString(),markt:{id:m.id,name:m.name,besucher:m.besucher ?? null,kunden:m.kunden ?? null,wetter:m.wetter || "",temperatur:m.temperatur ?? null,notiz:m.notiz || ""},positionen:mk.positionen.map(p => ({id:p.id,produkt:p.produkt,variante:p.variante,verkauft:p.verkauft}))}; }
  return {typ:"druckmarkt-ergebnis",version:2,export_id:mk.export_id,markt:{...mk.markt},positionen:mk.positionen.map(p => ({id:p.id,verkauft:p.verkauft})),tage:mk.tage.map(t => ({position_id:t.position_id,datum:t.datum,anzahl:t.anzahl})),basis_positionen:mk.basis_positionen.map(p => ({...p})),basis_tage:mk.basis_tage.map(t => ({...t}))};
}
async function teilen(mk, old = false) {
  try {
    if (old && !confirm("Dieses v1-Ergebnis kann NICHT mit der aktuellen PC-Version eingelesen werden. Dafür ist eine alte PC-Version erforderlich. Trotzdem als Sicherung exportieren?")) return;
    if (!old) {
      validateMarktInfo(mk.markt);
      if (!validExportId(mk.export_id) && !confirm("Diesem vor dem Update gespeicherten Markt fehlt die Export-ID. Das Ergebnis lässt sich mit der aktuellen PC-Version nicht einlesen. Als Sicherung trotzdem exportieren? Lokale Daten nicht löschen; erst eine geeignete alte PC-Version zur Übernahme verwenden.")) return;
    }
    const name = `Ergebnis_${String(mk.markt.name || "Markt").normalize("NFKD").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"_").slice(0,40) || "Markt"}_${mk.markt.datum || ""}.json`;
    const file = new File([JSON.stringify(result(mk,old),null,2)],name,{type:"application/json"});
    if (navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file],title:name});
    else { const url = URL.createObjectURL(file), a = document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),30000); }
    toast("Datei zum Sichern bereitgestellt");
  } catch (e) { if (e.name !== "AbortError") alert("Export fehlgeschlagen: " + e.message); }
}
const COLOR = [["dunkelblau","#163c72"],["hellblau","#91cbe9"],["dunkelgrün","#205440"],["hellgrün","#9acb76"],["pink","#ed6ba6"],["magenta","#cf278d"],["schwarz","#222222"],["weiß","#fafafa"],["weiss","#fafafa"],["grau","#9099a0"],["silber","#bec8cf"],["gold","#d0a637"],["braun","#81513a"],["orange","#ed831f"],["gelb","#f0d33d"],["türkis","#37b5b2"],["turkis","#37b5b2"],["blau","#2877bc"],["grün","#4c9e51"],["gruen","#4c9e51"],["rot","#ca3e3e"],["lila","#875db1"],["violett","#875db1"],["beige","#d8c9aa"],["transparent","#dce8eb"]];
function palette(text) { const s = String(text || "").toLowerCase(), hits = []; let remaining = s; for (const [name,color] of COLOR) if (remaining.includes(name)) { hits.push(color); remaining = remaining.replaceAll(name, " "); } return hits.length ? hits.map(c => `<span class="farbpunkt" style="background:${c}"></span>`).join("") : `<span class="farbpunkt unbekannt" aria-hidden="true"></span>`; }
function image(mk,p) { const foto = mk.fotos[id(p.produkt_id)]; return foto ? `<img class="produktbild" src="${esc(foto)}" alt="" loading="lazy">` : `<div class="produktbild platzhalter" aria-hidden="true"><span>3D</span></div>`; }
function groups(mk) { const map = new Map(); for (const p of mk.positionen) { const k=id(p.produkt_id); if (!map.has(k)) map.set(k,[]); map.get(k).push(p); } return [...map.values()]; }
function info(mk) { const m=mk.markt; return `<h2>Markt-Infos</h2><div class="panel"><div class="zweier"><label>Besucher (geschätzt, 0 bis 1.000.000.000)<input data-feld="besucher" type="number" min="0" max="1000000000" step="1" inputmode="numeric" value="${esc(m.besucher ?? "")}"></label><label>Temperatur (−100 bis 100 °C)<input data-feld="temperatur" inputmode="decimal" value="${esc(m.temperatur ?? "")}"></label></div><label>Wetter (max. 500 Zeichen)<select data-feld="wetter"><option value=""></option>${(mk.wetterListe || []).concat(m.wetter && !(mk.wetterListe || []).includes(m.wetter) ? [m.wetter] : []).map(w=>`<option value="${esc(w)}" ${w===m.wetter?"selected":""}>${esc(w)}</option>`).join("")}</select></label><label>Notiz vom Markttag (max. 5000 Zeichen)<textarea data-feld="notiz" maxlength="5000" placeholder="Was lief gut, was wurde nachgefragt?">${esc(m.notiz)}</textarea></label></div>`; }
function vListe() {
 const ms=Object.entries(D.maerkte).sort((a,b)=>(b[1].markt.datum||"").localeCompare(a[1].markt.datum||""));
 const olds=Object.entries(legacy).filter(([,m])=>m && m.markt && Array.isArray(m.positionen));
 return `<header><div class="row"><div class="mark"></div><h1>Druckmarkt – Markttag</h1></div><div class="sub">Offline-Verkauf auf dem iPad · App-Version 3</div></header><main>${storageError?`<p class="warnung" role="alert">${esc(storageError)}</p>`:""}${legacyError?`<p class="warnung" role="alert">${esc(legacyError)}</p>`:""}<h2>Lokale Märkte</h2>${ms.length?ms.map(([k,mk])=>{const s=summen(mk);return `<button class="marktzeile" data-oeffnen="${esc(k)}"><span><strong>${esc(mk.markt.name)}</strong><small>${esc(zeit(mk.markt))}${mk.markt.ort?", "+esc(mk.markt.ort):""}<br>${s.stk} verkauft · ${eur(s.ums)}</small></span><b aria-hidden="true">›</b></button>`}).join(""):`<div class="panel">Noch kein Markt geladen. Eine v2-Marktdatei vom PC auswählen.</div>`}${olds.length?`<h2>Alte lokale Märkte (v1)</h2><p class="hinweis">Diese Daten bleiben unverändert. Das v1-Ergebnis sichern: Zur Übernahme ist eine alte PC-Version erforderlich; die aktuelle PC-Version akzeptiert v1 nicht. Eine v2-Datei wird getrennt geladen.</p>${olds.map(([k,mk])=>`<div class="card"><div class="info"><div class="name">${esc(mk.markt.name)}</div><div class="var">${esc(zeit(mk.markt))} · ${summen(mk).stk} verkauft</div></div><button class="mini" data-legacy="${esc(k)}">v1 exportieren</button></div>`).join("")}`:""}<h2>Erstinstallation und Offlineprobe</h2><div class="panel anleitung"><p class="warnung"><strong>Offline nur verwenden, wenn die App vorher installiert und im Flugmodus erfolgreich getestet wurde.</strong> Vor der Übernahme am PC iPadOS-Browserdaten niemals löschen und die App nicht entfernen: Lokale Märkte und Fotos können sonst verloren gehen.</p><ol><li>Diese App über HTTPS (oder localhost) in Safari öffnen, nicht direkt als Datei.</li><li>Teilen → „Zum Home-Bildschirm“ wählen. Die App vom Home-Bildschirm öffnen; Speicher ist dort getrennt von Safari.</li><li>Bei Internetverbindung eine v2-Marktdatei laden und warten, bis sie angezeigt wird.</li><li>Flugmodus einschalten, die installierte App schließen und wieder öffnen. Markt öffnen und eine Teständerung speichern, wieder rückgängig machen und Ergebnis exportieren. Erst danach offline am Markt verwenden.</li></ol><p>iPadOS kann lokale Daten entfernen. Ergebnisse regelmäßig in „Dateien“ sichern und am PC übernehmen. Ein Ergebnis enthält keine Produktfotos; diese bleiben am PC bzw. in der geladenen Marktdatei.</p><p><strong>Zwischenimport und weiterzählen:</strong> Ergebnis sichern und erfolgreich am PC übernehmen. Anschließend am PC einen neuen Markt-Export erstellen und diese neue Datei auf dem iPad laden. Erst nach bestätigter Übernahme den alten lokalen Markt ersetzen; danach auf dem neuen Stand weiterzählen. Die im neuen Export enthaltenen Produktfotos werden angezeigt; nach dem Laden prüfen, ob alle benötigten Fotos vorhanden sind.</p><p><strong>App-Update:</strong> Bei Internetverbindung installierte App öffnen und kurz warten; das Update wird im Hintergrund geladen. App schließen und erneut vom Home-Bildschirm öffnen; in der Marktliste muss „App-Version 3“ stehen. Falls nicht, bei Internetverbindung warten und erneut öffnen. Danach Offlineprobe im Flugmodus wiederholen. Keine Browserdaten löschen; vorher Ergebnisse sichern und am PC übernehmen.</p><p id="sw-status">Offline-Bereitschaft wird geprüft …</p></div></main><div class="fuss"><button class="btn" data-akt="laden">Marktdatei laden</button></div>`;
}
function vMarkt(mk) {
 const m=mk.markt,s=summen(mk), list=groups(mk), q=suche.toLocaleLowerCase();
 const products=list.filter(g=>!q || g.some(p=>(p.produkt+" "+(p.variante||"")+" "+(p.kategorie||"")).toLocaleLowerCase().includes(q)));
 const group=produkt===null?null:list.find(g=>id(g[0].produkt_id)===produkt);
 return `<header><div class="row"><button class="back" data-akt="zurueck" aria-label="${group?"Zur Produktgalerie":"Zur Marktliste"}">‹</button><div style="flex:1;min-width:0"><h1>${esc(group?group[0].produkt:m.name)}</h1><div class="sub">${esc(zeit(m))}${m.ort?", "+esc(m.ort):""}</div></div></div><div class="stats"><div class="stat"><b>${eur(s.ums)}</b><span>Umsatz gesamt</span></div><div class="stat"><b>${s.stk}</b><span>Stück gesamt</span></div><div class="stat kunden"><div><b>${esc(m.kunden || 0)}</b><span>Käufer</span></div><button data-akt="kunde-" aria-label="Einen Käufer abziehen">−</button><button class="plus" data-akt="kunde+" aria-label="Einen Käufer zählen">+</button></div></div></header><main><div class="tagleiste"><label for="tag">Aktiver Markttag</label><select id="tag" aria-label="Aktiver Markttag">${days(m).map(d=>`<option value="${d}" ${d===mk.tag?"selected":""}>${esc(dat(d))}</option>`).join("")}</select></div>${group ? vProdukt(mk,group) : `<div class="galeriekopf"><div><h2>Produkte</h2><p>Produkt auswählen, dann Variante und Menge.</p></div><span>${list.length} Produkte</span></div><input class="suche" id="suche" type="search" placeholder="Produkt oder Variante suchen" value="${esc(suche)}"><div class="galerie">${products.map(g=>{let count=g.reduce((n,p)=>n+p.verkauft,0); return `<button class="produktkarte" data-produkt="${esc(id(g[0].produkt_id))}">${image(mk,g[0])}<span class="produkttext"><strong>${esc(g[0].produkt)}</strong><small>${g.length} ${g.length===1?"Variante":"Varianten"} · ${count} verkauft</small></span></button>`}).join("")}</div>${products.length?"":`<p class="hinweis">Keine passenden Produkte gefunden.</p>`}${info(mk)}<h2>Ergebnis sichern</h2><p class="hinweis">Ergebnis als Datei sichern und am PC einlesen. Zum Weiterzählen nach einem Zwischenimport am PC einen neuen Markt-Export erstellen und auf dem iPad laden. Erst nach bestätigter Übernahme den lokalen Markt ersetzen. iPadOS-Browserdaten bis zur Übernahme niemals löschen.</p><button class="btn danger" data-akt="entfernen">Diesen v2-Markt vom iPad entfernen</button>`}</main><div class="fuss"><button class="btn" data-akt="teilen">Ergebnis teilen</button></div>`;
}
function vProdukt(mk,g) {
 const selected=g.find(p=>id(p.id)===selectedPosition);
 return `<div class="produktdetail">${image(mk,g[0])}<div><h2>${esc(g[0].produkt)}</h2><p>${esc(g[0].kategorie || "Produkt")}</p><p>Variante für ${esc(dat(mk.tag))} auswählen.</p></div></div><div class="varianten">${g.map(p=>{const n=dayCount(mk,p.id,mk.tag), rest=p.mitgenommen-p.verkauft; return `<button class="variante ${selected && id(selected.id)===id(p.id)?"gewaehlt":""}" data-position="${esc(id(p.id))}" aria-pressed="${selected && id(selected.id)===id(p.id)?"true":"false"}"><span class="palette" aria-hidden="true">${palette(p.variante)}</span><span class="vartext"><strong>${esc(p.variante || "Ohne Variante")}</strong><small>${eur(p.preis)} · heute ${n} · gesamt ${p.verkauft} · ${rest<0?`${-rest} über Bestand`:`${rest} verfügbar`}</small></span><span aria-hidden="true">›</span></button>`}).join("")}</div>${selected?vMenge(mk,selected):`<p class="hinweis">Eine Variante auswählen, um Verkäufe zu erfassen oder zu korrigieren.</p>`}`;
}
function vMenge(mk,p) { const n=dayCount(mk,p.id,mk.tag), rest=p.mitgenommen-p.verkauft; return `<section class="menge" aria-labelledby="mengetitel"><h2 id="mengetitel">${esc(p.variante || "Ohne Variante")} korrigieren</h2><p>Gespeichert für ${esc(dat(mk.tag))}: <strong>${n} Stück</strong>. Gesamt: ${p.verkauft} Stück.</p><label for="menge">Neue Anzahl für diesen Tag</label><div class="mengesteuerung"><button type="button" data-akt="menge-" aria-label="Menge verringern">−</button><input type="number" id="menge" min="0" step="1" inputmode="numeric" value="${n}"><button type="button" data-akt="menge+" aria-label="Menge erhöhen">+</button></div><p class="hinweis">${rest<0?`Bereits ${-rest} über dem Bestand. Nur Korrekturen nach unten sind möglich.`:`Noch ${rest} Stück verfügbar.`} Nur diesem Tag zugeordnete Verkäufe können hier zurückgenommen werden. Ältere, nicht zugeordnete Verkäufe bleiben unverändert.</p><button class="btn" data-akt="speichern">Tagesanzahl speichern</button></section>`; }
function zeigen() { const app=$("#app"); const mk=current(); if (!mk) { aktiv=null; app.innerHTML=vListe(); swStatus(); } else app.innerHTML=vMarkt(mk); }
let swReady=false, swText="Offline-Bereitschaft noch nicht bestätigt.";
function swStatus() { const el=$("#sw-status"); if (el) el.textContent=swText; }
function setupSW() { if (!("serviceWorker" in navigator)) { swText="Service Worker nicht verfügbar. Offlinebetrieb nicht gesichert."; swStatus(); return; } navigator.serviceWorker.register("sw.js").then(async reg => { await navigator.serviceWorker.ready; swReady=!!navigator.serviceWorker.controller; swText=swReady?"Offline-Caching aktiv. Offlinebetrieb erst nach erfolgreicher Flugmodusprobe verwenden.":"Offline-App installiert. App schließen und neu öffnen, dann Offlineprobe durchführen."; swStatus(); reg.update().catch(()=>{}); }).catch(e=>{swText="Offline-App konnte nicht installiert werden: "+e.message;swStatus();}); navigator.serviceWorker.addEventListener("controllerchange",()=>{swReady=true;swText="Offline-Caching aktiv. Offlinebetrieb erst nach erfolgreicher Flugmodusprobe verwenden.";swStatus();}); }
$("#datei").addEventListener("change",e=>{const f=e.target.files[0];e.target.value="";if(f) importFile(f);});
document.addEventListener("click",e=>{
 const t=e.target.closest("[data-akt],[data-oeffnen],[data-produkt],[data-position],[data-legacy]"); if(!t)return;
 if(t.hasAttribute("data-legacy")){const m=legacy[t.dataset.legacy];if(m)teilen(m,true);return;}
 if(t.hasAttribute("data-oeffnen")){aktiv=t.dataset.oeffnen;produkt=null;selectedPosition=null;suche="";zeigen();window.scrollTo(0,0);return;}
 const mk=current();
 if(t.hasAttribute("data-produkt")){produkt=t.dataset.produkt;selectedPosition=null;zeigen();window.scrollTo(0,0);return;}
 if(t.hasAttribute("data-position")){selectedPosition=t.dataset.position;zeigen();document.querySelector("#mengetitel")?.scrollIntoView({block:"nearest"});return;}
 switch(t.dataset.akt){
 case "laden":$("#datei").click();break;
 case "zurueck":if(produkt!==null){produkt=null;selectedPosition=null;}else aktiv=null;zeigen();window.scrollTo(0,0);break;
 case "kunde+":case "kunde-":{const delta=t.dataset.akt==="kunde+"?1:-1; if(commit(d=>{const m=d.maerkte[aktiv].markt,n=Number(m.kunden||0);if(!nat(n)||!nat(Math.max(0,n+delta)))throw Error("Ungültige Käuferzahl.");m.kunden=Math.max(0,n+delta);})){zeigen();}break;}
 case "menge+":case "menge-":{const f=$("#menge"),n=Number(f.value);if(!nat(n)){alert("Bitte eine ganze, nicht negative Anzahl eingeben.");return;}const next=Math.max(0,n+(t.dataset.akt==="menge+"?1:-1));if(!nat(next)){alert("Höchstens 1.000.000.000 Stück sind erlaubt.");return;}f.value=String(next);break;}
 case "speichern":{const f=$("#menge"),n=Number(f.value), p=mk.positionen.find(x=>id(x.id)===selectedPosition);if(!p || f.value.trim()==="" || !nat(n)){alert("Bitte eine ganze, nicht negative Anzahl eingeben.");return;} const before=dayCount(mk,p.id,mk.tag), total=p.verkauft+n-before;if(!nat(total) || (n>before && total>p.mitgenommen)){alert("Anzahl nicht möglich: Der verfügbare Bestand wird überschritten oder die Gesamtzahl wäre ungültig.");return;} if(commit(d=>{const m=d.maerkte[aktiv],pos=m.positionen.find(x=>id(x.id)===selectedPosition),row=m.tage.find(x=>id(x.position_id)===selectedPosition && x.datum===m.tag);if(row)row.anzahl=n;else if(n>0)m.tage.push({position_id:pos.id,datum:m.tag,anzahl:n});const base=m.basis_positionen.find(x=>id(x.id)===selectedPosition);pos.verkauft=base.verkauft+totalDays(m.tage,pos.id)-totalDays(m.basis_tage,pos.id);if(!nat(pos.verkauft))throw Error("Ungültige Gesamtzahl.");})){zeigen();toast("Tagesanzahl gespeichert");}else zeigen();break;}
 case "teilen":teilen(mk);break;
 case "entfernen":if(confirm(`„${mk.markt.name}“, alle lokalen v2-Änderungen und Produktfotos endgültig entfernen? Vorher das Ergebnis exportieren und am PC übernehmen; die Marktdatei mit Fotos sichern. Alte v1-Daten bleiben erhalten.`)){if(commit(d=>{delete d.maerkte[aktiv];})){aktiv=null;produkt=null;selectedPosition=null;zeigen();}}break;
 }
});
document.addEventListener("change",e=>{const mk=current();if(!mk)return;if(e.target.id==="tag"){const day=e.target.value;if(!days(mk.markt).includes(day))return;if(commit(d=>{d.maerkte[aktiv].tag=day;})){selectedPosition=null;zeigen();}else zeigen();return;}const f=e.target.dataset.feld;if(!["besucher","temperatur","wetter","notiz"].includes(f))return;let v=e.target.value.trim();try{if(["besucher","temperatur"].includes(f)){if(e.target.validity && e.target.validity.badInput)throw Error("Bitte eine gültige Zahl eingeben.");v=v!==""?Number(v.replace(",",".")):null;}validateMarktInfo({...mk.markt,[f]:v});}catch(err){alert(err.message);zeigen();return;}if(commit(d=>{d.maerkte[aktiv].markt[f]=v;}))toast("Marktinfo gespeichert");else zeigen();});
document.addEventListener("input",e=>{if(e.target.id!=="suche")return;suche=e.target.value;zeigen();const el=$("#suche");el.focus();el.setSelectionRange(el.value.length,el.value.length);});
load();zeigen();setupSW();
