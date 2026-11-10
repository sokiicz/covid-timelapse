

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { lonlat, materialZeme, materialAtmosfera, sloupy, kotouce, vesmir, slunceKotouc } from "./globus.js";
import { FPS, START, KLICE, KONEC_TYDNU, hladky, datumTydne, datumEn, datumIso, tydenData, poziceTydnu, casyBodu,
         bodDrahy, pohled, smerSlunce, deklinace, vychozi, tvarTempa, autoTempo } from "./cas.js";
import { vytvorZvuk, zacatkyVln } from "./zvuk.js";

const $ = (id) => document.getElementById(id);
const ULOZISTE = "covid-prostredi-v2";

const MALO_POHYBU = matchMedia("(prefers-reduced-motion: reduce)").matches;
const stav = (text) => { $("stav").textContent = text; };
const cislo = (n) => Math.round(n).toLocaleString("en-US");
const omez = (x, a, b) => Math.min(Math.max(x, a), b);
const zabal = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

const CELKEM = 12;
let hotovo = 0;
function krok(x) {
  hotovo++;
  $("nacitani-pruh").style.width = `${(hotovo / CELKEM) * 100}%`;
  $("nacitani-text").textContent = hotovo < 3 ? "Fetching data" : "Loading satellite imagery";
  return x;
}
let pevnaHlaska = false;
const chyba = (e) => {
  if (!$("nacitani") || pevnaHlaska) return;
  $("nacitani-text").textContent = `Could not load the globe (${e?.message ?? e}). Try reloading the page or another browser.`;
  $("nacitani-pruh").style.background = "#888";
};

window.addEventListener("unhandledrejection", (e) => chyba(e.reason));
window.addEventListener("error", (e) => chyba(e.error ?? e.message));

if (!document.createElement("canvas").getContext("webgl2")) {
  $("nacitani-text").textContent = "This globe needs WebGL 2. Try an up-to-date browser, or turn on hardware acceleration.";
  $("nacitani-pruh").style.background = "#888";
  pevnaHlaska = true;
  throw new Error("WebGL 2 is not available");
}

const nactiBin = (u, prevod) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u} ${r.status}`); return r.arrayBuffer(); })
  .then((b) => krok(prevod(b)));

function zFloat16(buf) {
  const tab = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const z = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    tab[h] = e === 0 ? z * f * 2 ** -24 : e === 31 ? (f ? NaN : z * Infinity) : z * (1 + f / 1024) * 2 ** (e - 15);
  }
  const u = new Uint16Array(buf), out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = tab[u[i]];
  return out;
}

function zInt32(buf) {
  const a = new Int32Array(buf), out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === -2147483648 ? NaN : a[i];
  return out;
}
const [meta, DATA, STAT, OPATRENI, OCKOVANI, OCK] = await Promise.all([
  fetch("data/meta.json").then((r) => r.json()).then(krok), nactiBin("data/data.bin", zFloat16), nactiBin("data/stat.bin", zInt32),
  fetch("data/opatreni.json").then((r) => r.json()).then(krok), nactiBin("data/ockovani.bin", (b) => new Float32Array(b)),
  fetch("data/ockovani.json").then((r) => r.json()).then(krok)]);
const T = meta.tydny.length, SIRKA = meta.sirka;
if (DATA.length !== T * SIRKA * 4 || STAT.length !== T * SIRKA * 2 || OCKOVANI.length !== T * 256 * 3) throw new Error("data do not match meta.json");

const UDALOSTI = await fetch("data/udalosti.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);

const POZNAMKY = await fetch("data/poznamky.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);

const KUM = new Float64Array(T * SIRKA * 2);
for (let i = 0; i < SIRKA; i++) {
  for (let k = 0; k < 2; k++) {
    let s = 0;
    for (let w = 0; w < T; w++) {
      const v = STAT[(w * SIRKA + i) * 2 + k];
      if (!Number.isNaN(v)) s += v;
      KUM[(w * SIRKA + i) * 2 + k] = s;
    }
  }
}
const statV = (i, w, k) => { const v = STAT[(w * SIRKA + i) * 2 + k]; return Number.isNaN(v) ? null : v; };
const ZEME = meta.zeme;
const zemePodle = new Map(ZEME.map((z) => [z.i, z]));
const oblastPodle = new Map(meta.oblasti.map((o) => [o.i, o]));
const rodic = (i) => (i >= 256 ? oblastPodle.get(i)?.zeme ?? 0 : i);

const bezDat = (i) => { const z = rodic(i); return z > 0 && KUM[((T - 1) * SIRKA + z) * 2] === 0 && KUM[((T - 1) * SIRKA + z) * 2 + 1] === 0; };

const INFO = new Float32Array(SIRKA * 4);
for (let i = 1; i < SIRKA; i++) { INFO[i * 4] = rodic(i); INFO[i * 4 + 1] = bezDat(i) ? 1 : 0; }

const ockV = (z, w, k) => { const v = OCKOVANI[(w * 256 + z) * 3 + k]; return Number.isNaN(v) ? null : v; };
const OP_KONEC = meta.tydny.findIndex((d) => d > OPATRENI.do);
const PRISNOST = new Float32Array(T * SIRKA).fill(-1);
for (const [klic, zmeny] of Object.entries(OPATRENI.oblasti)) {
  const i = +klic;
  let k = 0, s = -1;
  for (let w = 0; w < T; w++) {
    while (k < zmeny.length && zmeny[k][0] <= w) { s = zmeny[k][1]; k++; }
    PRISNOST[w * SIRKA + i] = w >= OP_KONEC ? -1 : s;
  }
}
const prisnostV = (i, w) => { const s = PRISNOST[w * SIRKA + i]; return s >= 0 ? s : i >= 256 && PRISNOST[w * SIRKA + rodic(i)] >= 0 ? PRISNOST[w * SIRKA + rodic(i)] : null; };

const VRSTVY = new Float32Array(T * SIRKA * 4);
for (let w = 0; w < T; w++) {
  for (let i = 1; i < SIRKA; i++) {
    const z = rodic(i), o = (w * SIRKA + i) * 4, ock = z > 0 && z < 256 ? ockV(z, w, 0) : null, pr = prisnostV(i, w);
    VRSTVY[o] = ock == null ? -1 : ock / 100;
    VRSTVY[o + 1] = pr == null ? -1 : pr / 100;
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const platno = renderer.domElement;

platno.setAttribute("role", "img");
platno.setAttribute("aria-label", "3D globe showing weekly COVID-19 cases and deaths reported to WHO. Click a country for its figures as text.");
$("ramec").prepend(platno);

const MALE = renderer.capabilities.maxTextureSize < 8192 || (navigator.deviceMemory ?? 8) <= 4
  || (matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900);
if (MALE) renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
const sada = (soubor) => (MALE ? soubor.replace(/\.(jpg|png)$/, "_4k.$1") : soubor);
const nacitac = new THREE.TextureLoader();
const nacti = (soubor, barvy, nastav = {}) => new Promise((ok, spatne) => nacitac.load("data/" + soubor, (t) => {
  t.colorSpace = barvy ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  Object.assign(t, nastav);
  t.needsUpdate = true;
  ok(krok(t));
}, undefined, () => spatne(new Error(soubor))));
const aniso = renderer.capabilities.getMaxAnisotropy();
const [den, noc, id, masky, hustota, hvezdy] = await Promise.all([
  nacti(sada("den.jpg"), true, { anisotropy: aniso }),
  nacti(sada("noc.jpg"), true, { anisotropy: aniso }),
  nacti(sada("id.png"), false, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }),
  nacti(sada("masky.png"), false, { anisotropy: aniso }),
  nacti("hustota.png", false),
  nacti("hvezdy.jpg", true, { generateMipmaps: false, minFilter: THREE.LinearFilter }),
]);
const dataTex = new THREE.DataTexture(DATA, SIRKA, T, THREE.RGBAFormat, THREE.FloatType);
dataTex.minFilter = dataTex.magFilter = THREE.NearestFilter;
dataTex.needsUpdate = true;
const infoTex = new THREE.DataTexture(INFO, SIRKA, 1, THREE.RGBAFormat, THREE.FloatType);
infoTex.minFilter = infoTex.magFilter = THREE.NearestFilter;
infoTex.needsUpdate = true;
const vrstvyTex = new THREE.DataTexture(VRSTVY, SIRKA, T, THREE.RGBAFormat, THREE.FloatType);
vrstvyTex.minFilter = vrstvyTex.magFilter = THREE.NearestFilter;
vrstvyTex.needsUpdate = true;
const SOUHRN = new Float32Array(SIRKA * 4).fill(-1);
const souhrnTex = new THREE.DataTexture(SOUHRN, SIRKA, 1, THREE.RGBAFormat, THREE.FloatType);
souhrnTex.minFilter = souhrnTex.magFilter = THREE.NearestFilter;
souhrnTex.needsUpdate = true;

const scene = new THREE.Scene();
const kamera = new THREE.PerspectiveCamera(30, 16 / 9, 0.01, 200);
kamera.filmGauge = 36;

const matZeme = materialZeme({ den, noc, id, masky, hustota, info: infoTex, vrstvy: vrstvyTex, souhrn: souhrnTex }, dataTex, T, SIRKA);
const zemeMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), matZeme);
scene.add(zemeMesh);
const matAtm = materialAtmosfera(1.03);
scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.03, 256, 128), matAtm));
scene.add(vesmir(hvezdy));
const slunce = slunceKotouc();
scene.add(slunce);
const msloupy = sloupy(ZEME.length), mkotouce = kotouce(ZEME.length);
scene.add(msloupy, mkotouce);
const PATY = ZEME.map((z) => lonlat(z.lon, z.lat, 1.0008));
const OSY = PATY.map((p) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize()));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, kamera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.45, 0.55, 0.9));
composer.addPass(new OutputPass());

const pickRT = new THREE.WebGLRenderTarget(1, 1);
const pickMat = new THREE.ShaderMaterial({
  uniforms: { tId: { value: id }, tMasky: { value: masky }, uUv: { value: new THREE.Vector2() } },
  vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",

  fragmentShader: `uniform sampler2D tId, tMasky; uniform vec2 uUv;
    void main() { gl_FragColor = vec4(texture2D(tId, uUv).rg, texture2D(tMasky, uUv).b, 1.0); }`,
});
const pickScena = new THREE.Scene();
const pickMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pickMat);
pickMesh.frustumCulled = false;
pickScena.add(pickMesh);
const pickKamera = new THREE.Camera();
const pix = new Uint8Array(4);
function ctiOblast(uv) {
  pickMat.uniforms.uUv.value.copy(uv);
  const puvodni = renderer.getRenderTarget();
  renderer.setRenderTarget(pickRT);
  renderer.render(pickScena, pickKamera);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pix);
  renderer.setRenderTarget(puvodni);
  return { idx: pix[0] + 256 * pix[1], pevnina: pix[2] > 127 };
}

const uhel = (a, b) => THREE.MathUtils.radToDeg(lonlat(a.lon, a.lat).angleTo(lonlat(b.lon, b.lat)));
const OD_KONCE = T - KONEC_TYDNU;
const ZASTAVKY = [];
for (const x of ZEME.map((z) => {
  let s = 0;
  for (let w = OD_KONCE; w < T; w++) s += statV(z.i, w, 0) ?? 0;
  return { z, s };
}).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)) {
  if (ZASTAVKY.every((y) => uhel(x.z, y) > 20)) ZASTAVKY.push({ lat: x.z.lat, lon: x.z.lon, nazev: x.z.nazev });
  if (ZASTAVKY.length === 3) break;
}
const DATUMY_ZASTAVEK = [0, 4, 8].map((d) => meta.tydny[Math.min(T - 1, OD_KONCE + d)]);
const vychoziNastaveni = () => vychozi(ZASTAVKY, DATUMY_ZASTAVEK);

let nast, pozice, delka;
let t = 0, hraje = false, rychlost = 1, studio = false;
let volna = null;
let prechod = null;
const setrv = { lon: 0, lat: 0, kam: true, cil: true };
let vyber = null;
let kartaKlic = null;
let sirkaR = 1, vyskaR = 1;
const zvuk = vytvorZvuk();

const vrstvy = { pripady: true, umrti: true, ockovani: false, opatreni: false, nehlasi: true, bezdat: true, udalosti: true };
const cilVrstev = new THREE.Vector4(1, 0, 0, 1);
function nastavVrstvu(klic, zap) {
  vrstvy[klic] = zap;

  if (zap && klic === "ockovani") vrstvy.pripady = false;
  if (zap && klic === "pripady") vrstvy.ockovani = false;
  cilVrstev.set(+vrstvy.pripady, +vrstvy.ockovani, +vrstvy.opatreni, +vrstvy.nehlasi);
  matZeme.uniforms.uTecky.value = +vrstvy.bezdat;
  for (const el of document.querySelectorAll("#legenda .leg")) el.setAttribute("aria-pressed", String(!!vrstvy[el.dataset.v]));
  for (const k of Object.keys(vrstvy)) document.body.classList.toggle(`v-${k}`, vrstvy[k]);
  if (!vrstvy.udalosti) skryjUdalost(); else kresliSeznamUdalosti();
  zebricekKlic = null;
}
for (const el of document.querySelectorAll("#legenda .leg")) {
  el.onclick = () => { nastavVrstvu(el.dataset.v, !vrstvy[el.dataset.v]); zvuk.efekt("vyber"); };
}

let skupina = null;
let zebricekKlic = null, zebricekMetrika = "celkem";
const intenzitaZ = (rada) => { const max = Math.max(...rada) || 1; return rada.map((x) => Math.pow(x / max, 0.6)); };

let intenzitaRada = intenzitaZ(meta.svet.umrti_obraz), vlny = zacatkyVln(meta.svet.umrti_obraz);

const DOPLNENI = new Map(meta.doplneni.map((x) => [`${x.i}|${x.w}|${x.k}`, x]));
const ROZLOZENO = new Map(meta.rozlozeno.map(([i, w, k, n]) => [`${i}|${w}|${k}`, n]));

const TYDNY_DOPLNENI = new Set(meta.doplneni.filter((x) => x.k === 1).map((x) => x.w));
const umrtiObraz = (i, w) => DATA[(w * SIRKA + i) * 4 + 1] * meta.dmax;
const populace = (i) => (i >= 256 ? oblastPodle.get(i)?.populace : zemePodle.get(i)?.populace) || 0;
const nazevOblasti = (i) => (i >= 256 ? oblastPodle.get(i)?.nazev : zemePodle.get(i)?.nazev) ?? "Unknown";

function nastavSkupinu(nazev, clenove) {
  if (!clenove || !clenove.size) {
    skupina = null;
    for (let i = 0; i < SIRKA; i++) INFO[i * 4 + 2] = 0;
    matZeme.uniforms.uSkupina.value = 0;
    intenzitaRada = intenzitaZ(meta.svet.umrti_obraz); vlny = zacatkyVln(meta.svet.umrti_obraz);
  } else {
    const zeme = [...clenove].filter((i) => i < 256);
    const regiony = [...clenove].filter((i) => i >= 256 && !clenove.has(rodic(i)));
    const smrti = zeme.length > 0;
    const umrti = new Array(T).fill(0), celkem = new Array(T).fill(0);
    const pripady = new Array(T).fill(0), pripCelkem = new Array(T).fill(0), obraz = new Array(T).fill(0);
    let lmax = 0.5, maxU = 1;
    for (let w = 0; w < T; w++) {
      for (const i of zeme) {
        umrti[w] += statV(i, w, 1) ?? 0; celkem[w] += KUM[(w * SIRKA + i) * 2 + 1];
        pripady[w] += statV(i, w, 0) ?? 0; pripCelkem[w] += KUM[(w * SIRKA + i) * 2];
        obraz[w] += umrtiObraz(i, w);
        maxU = Math.max(maxU, umrtiObraz(i, w));
      }
      for (const i of regiony) { pripady[w] += statV(i, w, 0) ?? 0; pripCelkem[w] += KUM[(w * SIRKA + i) * 2]; }
      for (const i of clenove) lmax = Math.max(lmax, DATA[(w * SIRKA + i) * 4] * 4.7);
    }
    skupina = { nazev, clenove, zeme, smrti, umrti, celkem, pripady, pripCelkem, maxU, rada: smrti ? obraz : pripady };
    for (let i = 0; i < SIRKA; i++) INFO[i * 4 + 2] = clenove.has(i) || clenove.has(rodic(i)) ? 1 : 0;
    matZeme.uniforms.uSkupina.value = 1;
    matZeme.uniforms.uSkLog.value.set(Math.max(lmax - 2.2, 0), lmax);
    intenzitaRada = intenzitaZ(skupina.rada); vlny = zacatkyVln(skupina.rada);
  }
  infoTex.needsUpdate = true;
  zebricekKlic = null;
  document.body.classList.toggle("skupina", !!skupina);
  $("b-skupina-text").textContent = skupina ? skupina.nazev : "World";
  $("z-nazev-skupiny").textContent = skupina?.nazev ?? "";
  $("h-kicker").textContent = skupina ? `COVID-19 · ${skupina.nazev}` : "COVID-19 worldwide";
  $("h-k1").textContent = !skupina || skupina.smrti ? "Reported deaths, total" : "Reported cases, total";
  $("h-k2").textContent = !skupina || skupina.smrti ? "Deaths this week" : "Cases this week";
  if (pozice) kresliOsu();
}

function letNadSkupinu() {
  if (!skupina) { zpetNaProhlidku(); return; }
  const body = [...skupina.clenove].map((i) => zemePodle.get(rodic(i))).filter(Boolean);
  if (!body.length) return;
  const s = new THREE.Vector3();
  for (const z of body) s.add(lonlat(z.lon, z.lat));
  s.normalize();
  let rozptyl = 0;
  for (const z of body) rozptyl = Math.max(rozptyl, THREE.MathUtils.radToDeg(s.angleTo(lonlat(z.lon, z.lat))));
  letNa(THREE.MathUtils.radToDeg(Math.asin(s.y)), THREE.MathUtils.radToDeg(Math.atan2(-s.z, s.x)),
        omez(1.9 + rozptyl / 16, 2.1, 4.6));
}

function nactiNastaveni(n) {
  nast = n;
  for (const b of nast.draha) if (b.datum && /^\d{4}-/.test(b.datum) && b.tyden == null) b.tyden = tydenData(b.datum);
  prepocitej();
}

function minimaUdalosti() {
  const m = new Float32Array(T), pocet = new Map();
  for (const u of UD) pocet.set(u.w, (pocet.get(u.w) ?? 0) + 1);
  for (const [w, n] of pocet) {
    const s = 1.0 + 1.4 * n;
    for (const [d, f] of [[-1, 0.5], [0, 1], [1, 0.5]]) if (w + d >= 0 && w + d < T) m[w + d] = Math.max(m[w + d], s * f);
  }
  return m;
}
function nastavAutoTempo() {
  const tvar = tvarTempa(meta.svet.umrti_obraz, nast.auto.sila), minima = minimaUdalosti();
  const delkaPro = (k) => { nast.tempo = autoTempo(tvar, k, minima); return (poziceTydnu(nast, T).length - 1) / FPS; };
  let lo = 0.02, hi = 3;
  for (let i = 0; i < 18; i++) { const k = (lo + hi) / 2; if (delkaPro(k) > nast.auto.delka_s) hi = k; else lo = k; }
  delkaPro((lo + hi) / 2);
}

function prepocitej() {
  if (nast.tempo_rezim === "auto") nastavAutoTempo();
  else nast.tempo = nast.tempo_rucni.map((x) => ({ ...x }));
  nast.tempo.sort((a, b) => a.tyden - b.tyden);
  pozice = poziceTydnu(nast, T);
  delka = (pozice.length - 1) / FPS;
  for (const b of nast.draha) if (b.tyden != null) b.datum = datumIso(datumTydne(b.tyden));
  casyBodu(nast, pozice);
  for (const b of nast.draha) if (b.tyden != null) b.s = casTydneBodu(b.tyden);
  nast.draha.sort((a, b) => a.s - b.s);
  t = Math.min(t, delka);
  kresliOsu();
  vyplnStudio();
  ulozMistne();
}

function casTydneBodu(tyden) {
  for (let i = 0; i < pozice.length; i++) if (pozice[i] >= tyden) return i / FPS;
  return delka;
}
const tydenVCase = (s) => pozice[Math.min(Math.max(Math.round(s * FPS), 0), pozice.length - 1)];

function ulozMistne() { if (!MISTNI) return; try { localStorage.setItem(ULOZISTE, JSON.stringify(nast)); } catch (e) {  } }

function hodnota(idx, p, kanal) {
  const q = omez(p, 0, T - 1), t0 = Math.floor(q), t1 = Math.min(t0 + 1, T - 1), a = q - t0;
  return DATA[(t0 * SIRKA + idx) * 4 + kanal] * (1 - a) + DATA[(t1 * SIRKA + idx) * 4 + kanal] * a;
}
function pripadyVCase(idx, p) {
  if (p < 0) return 0;
  const q = Math.min(p, T - 1), t0 = Math.floor(q), t1 = Math.min(t0 + 1, T - 1), a = q - t0;
  return (statV(idx, t0, 0) ?? 0) * (1 - a) + (statV(idx, t1, 0) ?? 0) * a;
}
function svet(rada, p) {
  if (p < 0) return 0;
  const q = Math.min(p, T - 1), t0 = Math.floor(q), t1 = Math.min(t0 + 1, T - 1), a = q - t0;
  return rada[t0] * (1 - a) + rada[t1] * a;
}

const tydenCisel = (p) => omez(Math.floor(p), 0, T - 1);
const zaTyden = (rada, p) => (p < 0 ? 0 : rada[tydenCisel(p)]);

function smichej(a, b, x) {
  const o = { ...b };
  for (const k of [...KLICE, "slunceLon"]) o[k] = k.endsWith("_lon") || k === "slunceLon" ? a[k] + zabal(b[k] - a[k]) * x : a[k] + (b[k] - a[k]) * x;
  return o;
}

function slunceLonZaberu(z) {
  const w = omez(z.cil_r / 0.5, 0, 1);
  return z.kamera_lon + (z.cil_lon - z.kamera_lon) * w - (z.hodina - 12) * 15;
}

function zaberVCase(s) {
  let cil = volna;
  if (!cil) { cil = bodDrahy(nast.draha, s); cil.slunceLon = slunceLonZaberu(cil); }
  else if (studio) cil.slunceLon = slunceLonZaberu(cil);
  if (prechod) {
    const a = hladky((performance.now() - prechod.start) / prechod.trvani);
    if (a < 1) return smichej(prechod.od, cil, a);
    prechod = null;
  }
  return cil;
}
function zacniVolnou() {
  if (volna) return;
  volna = { ...zaberVCase(t) };
  volna.cilVzd = volna.kamera_vzdalenost;
  prechod = null;
  document.body.classList.add("volna");
  skryjNapovedu();
}
function zpetNaProhlidku() {
  if (!volna) return;
  zvuk.efekt("let");
  prechod = { od: { ...zaberVCase(t) }, start: performance.now(), trvani: MALO_POHYBU ? 1 : 1800 };
  volna = null;
  setrv.lon = setrv.lat = 0;
  document.body.classList.remove("volna");
}
function letNa(lat, lon, vzdalenost) {
  const od = { ...zaberVCase(t) };
  const vzd = vzdalenost ?? Math.min(od.kamera_vzdalenost, 2.3);
  zvuk.efekt("let");
  skryjNapovedu();
  volna = { ...od, kamera_lat: lat, kamera_lon: od.kamera_lon + zabal(lon - od.kamera_lon), kamera_vzdalenost: vzd,
            cil_lat: lat, cil_lon: od.cil_lon + zabal(lon - od.cil_lon), cil_r: 0, cilVzd: vzd };
  prechod = { od, start: performance.now(), trvani: MALO_POHYBU ? 1 : 1600 };
  setrv.lon = setrv.lat = 0;
  document.body.classList.add("volna");
}

function ohniskoOkna() {
  const a = sirkaR / vyskaR, v = 16 / 9;
  if (a > v) return v / a;
  if (a < 1) return Math.max(a, 0.55);
  return 1;
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Vector3();
function snimek() {
  const f = Math.min(Math.round(t * FPS), pozice.length - 1);
  const p = pozice[f];
  const z = zaberVCase(t);
  const v = pohled(z);
  kamera.position.copy(v.cam);
  kamera.quaternion.copy(v.quat);
  kamera.setFocalLength(z.ohnisko_mm * ohniskoOkna());
  kamera.updateMatrixWorld();
  const datum = datumTydne(p);
  const ks = nast.slunce === "rocni" ? lonlat(z.slunceLon, deklinace(datum), 1).normalize() : smerSlunce(nast.slunce, z, datum, v);
  matZeme.uniforms.uSlunce.value.copy(ks);
  matAtm.uniforms.uSlunce.value.copy(ks);
  matZeme.uniforms.uRadek.value = Math.max(p, 0);
  matZeme.uniforms.uCas.value = f / FPS;
  matZeme.uniforms.uVyber.value = vyber && vyber.idx > 0 ? (vyber.zeme ? rodic(vyber.idx) : vyber.idx) : -1;
  matZeme.uniforms.uVyberZeme.value = vyber?.zeme ? 1 : 0;
  matZeme.uniforms.uPuls.value = performance.now() / 1000;
  slunce.position.copy(ks).multiplyScalar(80);

  const tl = 0.0017 * Math.max(1, z.kamera_vzdalenost / 1.6);
  const sloupyZap = vrstvy.umrti && !souhrn;
  const kandidati = [];

  const prahU = skupina ? Math.max(5, skupina.maxU * 0.05) : 300, prahP = skupina ? 20 : 100;
  ZEME.forEach((zz, i) => {
    const clen = !skupina || skupina.clenove.has(zz.i);
    let g = clen ? hodnota(zz.i, p, 1) : 0;
    const umrti = g * meta.dmax;
    if (skupina) g = (umrti / skupina.maxU) * 0.3;

    const zadu = !studio && _q.copy(PATY[i]).normalize().dot(_v.copy(kamera.position).sub(PATY[i]).normalize()) < 0.0;
    const vidi = g > 0.0004 && sloupyZap && !zadu;
    _s.set(vidi ? tl : 0, vidi ? g : 0, vidi ? tl : 0);
    _m.compose(PATY[i], OSY[i], _s);
    msloupy.setMatrixAt(i, _m);
    const r = Math.sqrt(Math.max(g, 0)) * 0.08;
    _s.set(vidi ? r : 0, 1, vidi ? r : 0);
    _m.compose(PATY[i], OSY[i], _s);
    mkotouce.setMatrixAt(i, _m);

    const wc = tydenCisel(p);
    const pripady = clen && p >= 0 ? statV(zz.i, wc, 0) ?? 0 : 0;
    const umrtiTxt = clen && p >= 0 ? statV(zz.i, wc, 1) : null;
    const smrt = vrstvy.umrti && umrti >= prahU && umrtiTxt != null;
    if (smrt || (vrstvy.pripady && pripady >= prahP)) {
      kandidati.push({ i, nazev: zz.nazev, umrti: smrt ? umrtiTxt : umrti, pripady, g, smrt, doplneni: smrt && DOPLNENI.has(`${zz.i}|${wc}|1`) });
    }
  });
  msloupy.instanceMatrix.needsUpdate = mkotouce.instanceMatrix.needsUpdate = true;
  if (souhrn) kandidatiSouhrnu(kandidati);
  $("popisky").innerHTML = popisky(kandidati);

  $("h-den").textContent = datumEn(datumTydne(Math.max(p, START)));
  const [rCelkem, rTyden] = !skupina ? [meta.svet.celkem, meta.svet.umrti]
    : skupina.smrti ? [skupina.celkem, skupina.umrti] : [skupina.pripCelkem, skupina.pripady];
  $("h-celkem").textContent = cislo(zaTyden(rCelkem, p));
  $("h-tyden").textContent = cislo(zaTyden(rTyden, p));
  const wc = tydenCisel(p);
  $("h-tyden-pozn").textContent = p < 0 ? "" : skupina
    ? `${skupina.zeme.filter((i) => statV(i, wc, 0) != null || statV(i, wc, 1) != null).length} of ${skupina.zeme.length} reported this week`
    : `${meta.svet.hlasi[wc]} countries and territories reported this week${TYDNY_DOPLNENI.has(wc) ? ", incl. one-off jumps in reported deaths" : ""}`;
  $("h-podnadpis").textContent = p < 0 ? "Reported to WHO, weekly totals" : `Reported to WHO, week ending ${datumKr(meta.tydny[wc])}`;

  $("h-nadumrti").hidden = !!skupina || p < 0 || meta.tydny[wc] < "2022-05-08";
  if (vrstvy.ockovani) {
    const o = ockSkupiny(p);
    $("h-ock").textContent = o == null ? "No data" : `${o.toFixed(1)}%`;

    $("h-ock-pozn").textContent = p >= 0 && meta.tydny[tydenCisel(p)] > OCK.do ? `Last data ${mesicRok(OCK.do)}` : "";
  }
  aktualizujKartu(p);
  aktualizujUdalost(p);
  aktualizujZebricek(p);
  aktualizujOsu(p);
  if (studio && (!hraje || volna)) vyplnPole(z);
}

const PREKAZKY = ["h-vlevo", "h-vpravo", "udalost", "ud-seznam", "legenda", "karta", "zebricek", "skupiny", "zvuk-pop", "souhrn", "fakta"];
function plochyPrekazek() {
  const r0 = $("ramec").getBoundingClientRect();
  return PREKAZKY.map((id) => $(id)).filter((el) => el && el.offsetParent !== null && getComputedStyle(el).opacity !== "0")
    .map((el) => { const r = el.getBoundingClientRect(); return { x: r.left - r0.left - 6, y: r.top - r0.top - 6, w: r.width + 12, h: r.height + 12 }; });
}
const prekryva = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function popisky(kandidati) {
  kandidati.sort((a, b) => b.smrt - a.smrt || b.umrti - a.umrti || b.pripady - a.pripady);
  const umistene = [], prekazky = kandidati.length ? plochyPrekazek() : [];
  for (const k of kandidati) {
    if (umistene.length >= (skupina ? 6 : 4)) break;
    const smrt = k.smrt;
    if (!smrt && umistene.filter((u) => u.smrt).length >= 2) continue;
    const pata = PATY[k.i];
    _q.copy(pata).normalize();
    if (_q.dot(_v.copy(kamera.position).sub(pata).normalize()) < 0.08) continue;
    const bod = _q.clone().multiplyScalar(1.0008 + (smrt ? k.g : 0)).project(kamera);
    if (bod.z > 1 || Math.abs(bod.x) > 0.95 || Math.abs(bod.y) > 0.95) continue;
    const x = (bod.x + 1) / 2 * sirkaR, y = (1 - bod.y) / 2 * vyskaR;
    const box = { x: x + 10, y: y - 38, w: 175, h: 40 };
    if (box.x + box.w > sirkaR - 4 || box.y < 4) continue;
    if (umistene.some((u) => prekryva(box, u.box)) || prekazky.some((pl) => prekryva(box, pl))) continue;
    umistene.push({ box, smrt, html: `<div class="popisek" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${esc(k.nazev)}<span>${
      k.text ? esc(k.text) : smrt ? `${cislo(k.umrti)} deaths this week${k.doplneni ? ", incl. one-off jump" : ""}` : `${cislo(k.pripady)} cases this week`}</span></div>` });
  }
  return umistene.map((u) => u.html).join("");
}

function infoVyberu() {
  const obl = !vyber.zeme && vyber.idx >= 256 ? oblastPodle.get(vyber.idx) : null;
  return { obl, zem: zemePodle.get(rodic(vyber.idx)) };
}

function opatreniV(i, w) {
  const z = OPATRENI.oblasti[String(i)];
  if (!z) return undefined;
  let lo = 0, hi = z.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (z[m][0] <= w) { r = m; lo = m + 1; } else hi = m - 1; }
  return r < 0 || z[r][1] === -1 ? null : z[r];
}

const TEXTY_OPATRENI = [
  [null, "Schools: closing recommended or open with major changes", "Schools closed (some levels)", "Schools closed (all levels)"],
  [null, "Workplaces: closing or working from home recommended", "Workplaces closed (some sectors)", "Workplaces closed (all but essential)"],
  [null, "Cancelling public events recommended", "Public events cancelled"],
  [null, "Very large gatherings limited (over 1,000 people)", "Gatherings limited (101 to 1,000 people)", "Gatherings limited (11 to 100 people)", "Gatherings limited to 10 people"],
  [null, "Closing or reducing public transport recommended", "Public transport closed (required)"],
  [null, "Staying at home recommended", "Stay-at-home order with exceptions", "Strict stay-at-home order"],
  [null, "Internal travel discouraged", "Internal travel restricted"],
  [null, "Arrivals screened", "Quarantine for arrivals", "Arrivals banned from some regions", "Arrivals banned from all regions or borders closed"],
  [null, "Testing only for some people with symptoms", "Testing for anyone with symptoms", "Open public testing"],
  [null, "Limited contact tracing", "Comprehensive contact tracing"],
  [null, "Masks recommended", "Masks required in some public spaces", "Masks required in all public spaces", "Masks required outside the home"],
  [null, "Vaccines for one priority group", "Vaccines for two priority groups", "Vaccines for all vulnerable groups", "Vaccines for vulnerable groups and more", "Vaccines available to everyone"],
];
const PORADI_OPATRENI = [5, 1, 0, 3, 2, 4, 6, 7, 10, 8, 9, 11];

function htmlOpatreni(obl, zem, w, pred) {
  if (pred || !zem) return "";
  let e = obl ? opatreniV(obl.i, w) : undefined, kde = obl?.nazev;
  if (e === undefined) { e = opatreniV(zem.i, w); kde = zem.nazev; }
  let telo;
  if (e === undefined) telo = `<p class="pozn-k">No data on measures for ${esc(zem.nazev)}.</p>`;
  else if (w >= OP_KONEC) telo = `<p class="pozn-k">Tracking of measures ended on 31 December 2022.</p>`;
  else if (!e) telo = `<p class="pozn-k">No data on measures this week.</p>`;
  else {
    const polozky = PORADI_OPATRENI.map((k) => {
      const v = e[2 + k], uroven = v >> 1, text = TEXTY_OPATRENI[k][uroven];
      return text ? `<li>${text}${v & 1 ? ` <em>some areas</em>` : ""}</li>` : "";
    }).join("");
    telo = `<div class="prisnost"><div class="prisnost-pruh"><i style="width:${e[1]}%"></i></div><span>Stringency ${e[1]} / 100</span></div>
      ${polozky ? `<ul class="opatreni">${polozky}</ul>` : `<p class="pozn-k">No restrictions in force.</p>`}`;
  }
  return `<div class="oddil"><div class="kicker">Measures in ${esc(kde)}</div>${telo}
    <p class="zdroj-k">Oxford COVID-19 Government Response Tracker</p></div>`;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const umrtiNaMilion = (i, w) => (populace(i) > 0 ? (KUM[(w * SIRKA + i) * 2 + 1] / populace(i)) * 1e6 : null);
function htmlSrovnani(zem, w, pred) {
  if (pred || !zem || bezDat(zem.i) || !(populace(zem.i) > 0)) return "";
  const vSkupine = skupina && skupina.zeme.includes(zem.i) && skupina.zeme.length >= 3;
  const ref = (vSkupine ? skupina.zeme.map((i) => zemePodle.get(i)) : ZEME.filter((z) => z.kontinent === zem.kontinent))
    .filter((z) => z && z.populace >= 1e6 && !bezDat(z.i));
  const nazevRef = esc(vSkupine ? skupina.nazev : zem.kontinent);
  const hodnoty = ref.map((z) => umrtiNaMilion(z.i, w)).filter((x) => x != null);
  const ja = umrtiNaMilion(zem.i, w), med = median(hodnoty);
  if (ja == null || hodnoty.length < 3 || med <= 0) return "";
  const r = ja / med;
  const vztah = r >= 1.15 ? `${r.toFixed(1)}× the ${nazevRef} median` : r <= 0.87 ? `${r.toFixed(1)}× the ${nazevRef} median`
    : `close to the ${nazevRef} median`;
  const poradi = hodnoty.filter((x) => x > ja).length + 1;
  return `<div class="oddil"><div class="kicker">How it compares</div>
    <p class="srovnani"><b>${cislo(ja)}</b> reported deaths per million so far, ${vztah} (${cislo(med)}).
    ${zem.populace >= 1e6 ? `Rank ${poradi} of ${hodnoty.length + (ref.some((z) => z.i === zem.i) ? 0 : 1)} in ${nazevRef}, 1 = most deaths per million.` : ""}</p>
    <p class="zdroj-k">Reported figures depend on how much each country tested and reported.</p></div>`;
}

const datumKr = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const tydenIndex = (iso) => { const w = meta.tydny.findIndex((d) => d >= iso); return w < 0 ? T - 1 : w; };

function ockSkupiny(p) {
  if (p < 0) return null;
  const w0 = Math.floor(p), w1 = Math.min(w0 + 1, T - 1), f = p - w0;
  const v = (z) => { const a = ockV(z, w0, 0), b = ockV(z, w1, 0); return a == null ? null : b == null ? a : a + (b - a) * f; };
  if (!skupina) return v(0);
  let s = 0, n = 0;
  for (const i of skupina.zeme) { const x = v(i), pop = populace(i); if (x != null && pop > 0) { s += x * pop; n += pop; } }
  return n > 0 ? s / n : null;
}
const procento = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
function htmlOckovani(zem, w, pred, obl) {
  if (pred || !zem || bezDat(zem.i)) return "";
  const info = OCK.zeme[zem.kod];
  const hlava = `<div class="oddil"><div class="kicker">${obl ? `Vaccination in ${esc(zem.nazev)}` : "Vaccination"}</div>`;
  const zdroj = `<p class="zdroj-k">Our World in Data${info?.zdroj ? `, from ${esc(info.zdroj)}` : ""}</p></div>`;
  if (!info) return `${hlava}<p class="pozn-k">No vaccination data for ${esc(zem.nazev)}.</p>${zdroj}`;
  const d = meta.tydny[w];
  const p1 = ockV(zem.i, w, 0), p2 = ockV(zem.i, w, 1), b = ockV(zem.i, w, 2);
  const zacatek = info.prvni ? `First doses reported ${datumKr(info.prvni)}.` : `Figures available from ${datumKr(info.data_od)}.`;
  if ((info.prvni && d < info.prvni) || p1 == null) {
    return `${hlava}<p class="pozn-k">${info.prvni && d < info.prvni ? "Vaccination had not started yet." : "No figures for this week."} ${zacatek}</p>${zdroj}`;
  }
  const radek = (nazev, v, pod = "", format = procento) => (v == null ? "" : `<div class="ock-radek"><span>${nazev}${pod ? ` <small>${pod}</small>` : ""}</span>
    <div class="ock-pruh"><i style="width:${Math.min(v, 100)}%"></i></div><b>${format(v)}</b></div>`);
  const pozn = [zacatek];
  if (info.polovina && d >= info.polovina) pozn.push(`Half the population had a first dose by ${datumKr(info.polovina)}.`);
  if (info.posledni && d > info.posledni) pozn.push(`As last reported on ${datumKr(info.posledni)}.`);
  if (p1 > 100) pozn.push("Shares can exceed 100%, for example when doses are also given to non-residents.");
  return `${hlava}<div class="ock">${radek("At least one dose", p1)}${radek("Completed primary series", p2)}${
    b > 0 ? radek("Booster doses", b, "per 100 people", (v) => (v < 10 ? v.toFixed(1) : Math.round(v))) : ""}</div><p class="pozn-k">${pozn.join(" ")}</p>
    ${info.vakciny ? `<p class="zdroj-k">Vaccines used: ${esc(info.vakciny)}</p>` : ""}${zdroj}`;
}

const klicovaDataCache = new Map();
function klicovaData(zem) {
  if (klicovaDataCache.has(zem.i)) return klicovaDataCache.get(zem.i);
  const out = [], i = zem.i;
  const tyden = (w) => `week ending ${datumKr(meta.tydny[w])}`;
  const prvni = (k) => { for (let w = 0; w < T; w++) if (KUM[(w * SIRKA + i) * 2 + k] > 0) return w; return -1; };
  const wp = prvni(0), wu = prvni(1);

  if (wp >= 0) out.push({ w: wp, text: "First cases in the WHO data", kdy: tyden(wp) });
  if (wu >= 0) out.push({ w: wu, text: "First deaths in the WHO data", kdy: tyden(wu) });
  const zm = OPATRENI.oblasti[String(i)], c6 = OPATRENI.ukazatele.indexOf("C6M");
  const doma = zm?.find((e) => e[1] !== -1 && e[2 + c6] >> 1 >= 2);
  if (doma) out.push({ w: doma[0], text: doma[2 + c6] & 1 ? "First stay-at-home order (some areas)" : "First stay-at-home order", kdy: `in force by ${datumKr(meta.tydny[doma[0]])}` });

  let wMax = -1, uMax = 0;
  for (let w = 0; w < T; w++) {
    const u = statV(i, w, 1) ?? 0;

    if (u > uMax && !DOPLNENI.has(`${i}|${w}|1`) && !ROZLOZENO.has(`${i}|${w}|1`)) { uMax = u; wMax = w; }
  }
  if (wMax >= 0) out.push({ w: wMax, text: `Deadliest week reported: ${cislo(uMax)} deaths`, kdy: tyden(wMax) });
  for (const x of meta.doplneni) {
    if (x.i === i && x.k === 1) out.push({ w: x.w, text: `One-off jump in reported deaths: ${cislo(x.hlaseno)}, probably earlier deaths added at once`, kdy: tyden(x.w) });
  }
  const o = OCK.zeme[zem.kod];
  if (o?.prvni) out.push({ w: tydenIndex(o.prvni), text: "First vaccine doses reported", kdy: datumKr(o.prvni) });
  if (o?.polovina) out.push({ w: tydenIndex(o.polovina), text: "Half the population had a first dose", kdy: `around ${datumKr(o.polovina)}` });

  if (DATA[((T - 1) * SIRKA + i) * 4 + 2] > 0.5) {
    let wPosl = -1;
    for (let w = T - 1; w >= 0; w--) if (statV(i, w, 0) != null || statV(i, w, 1) != null) { wPosl = w; break; }
    if (wPosl >= 0) out.push({ w: wPosl, text: "Last weekly report to WHO", kdy: tyden(wPosl) });
  }
  out.sort((a, b) => a.w - b.w);
  klicovaDataCache.set(i, out);
  return out;
}
function htmlKlicovaData(zem, w, pred) {
  if (!zem || bezDat(zem.i)) return "";
  const data = klicovaData(zem);
  if (!data.length) return "";
  return `<div class="oddil"><div class="kicker">Key dates</div><ol class="klicova">${data.map((x) =>
    `<li class="${!pred && x.w <= w ? "probehlo" : ""}"><span>${x.text}</span><small>${x.kdy}</small></li>`).join("")}</ol>
    <p class="zdroj-k">From WHO data (revised over time), Oxford COVID-19 Government Response Tracker and Our World in Data</p></div>`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const odkazyNa = (ids) => (ids?.length ? `<sup>${ids.join(", ")}</sup>` : "");

const httpsUrl = (u) => (/^https:\/\//i.test(String(u ?? "")) ? esc(u) : "#");
const rozsahObdobi = (o) => {
  const a = mesicRok(o.od), b = mesicRok(o.do);
  return a.slice(-4) === b.slice(-4) ? (a === b ? a : `${a.slice(0, -5)} to ${b}`) : `${a} to ${b}`;
};
let kontextKlic = null, zdrojeOtevrene = false;
function obdobiPoznamky(n, w, pred) {
  if (pred) return -1;
  const d = meta.tydny[w];
  return n.obdobi.findIndex((o) => o.od <= d && d <= o.do);
}
function htmlKontext(n, zem, iObd, obl) {
  const o = iObd >= 0 ? n.obdobi[iObd] : null;
  const zdroje = n.zdroje.map((z) => `<li><a href="${httpsUrl(z.url)}" target="_blank" rel="noopener noreferrer">${esc(z.nazev)}</a>
    <small>${esc(z.vydavatel)}${z.rok ? `, ${z.rok}` : ""}</small></li>`).join("");
  return `<div class="oddil kontext"><div class="kicker">${obl ? `${esc(zem.nazev)}: ` : ""}What research points to</div>
    ${o ? `<p class="kontext-ted"><span>${rozsahObdobi(o)}</span>${esc(o.text)}${odkazyNa(o.zdroje)}</p>` : ""}
    <p class="srovnani">${esc(n.souhrn)}${odkazyNa(n.souhrn_zdroje)}</p>
    ${n.vyhrada ? `<p class="pozn-k">${esc(n.vyhrada)}${odkazyNa(n.vyhrada_zdroje)}</p>` : ""}
    <details${zdrojeOtevrene ? " open" : ""}><summary>Sources (${n.zdroje.length})</summary><ol>${zdroje}</ol></details>
    <p class="zdroj-k">${POZNAMKY.stav === "reviewed"

      ? "Written with AI assistance from the sources below, compared with them by a second AI pass and read by a person. Source pages may have changed since."
      : "Draft. Written with AI assistance. Each sentence was compared with its source by a second AI pass; a human review is still pending. Source pages may have changed since."}</p></div>`;
}
function aktualizujKontext(zem, w, pred, obl) {
  const n = zem && !bezDat(zem.i) ? POZNAMKY?.zeme?.[zem.kod] : null;
  const iObd = n ? obdobiPoznamky(n, w, pred) : -1;
  const klic = n ? `${zem.kod}|${iObd}|${obl ? 1 : 0}` : "";
  if (klic === kontextKlic) return;
  kontextKlic = klic;
  $("k-kontext").innerHTML = n ? htmlKontext(n, zem, iObd, obl) : "";
}
$("k-kontext").addEventListener("toggle", (e) => { if (e.target.tagName === "DETAILS") zdrojeOtevrene = e.target.open; }, true);

const pole = (nazev, h, pod = "", prazdne = "No data") => `<div><span>${nazev}</span>${h == null ? `<b class="zadna">${prazdne}</b>` : `<b>${cislo(h)}</b>`}${
  pod ? `<small>${pod}</small>` : ""}</div>`;
const mesicRok = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const naMilion = (h, pop) => (h != null && pop > 0 ? `${((h / pop) * 1e6).toLocaleString("en-US", { maximumFractionDigits: (h / pop) * 1e6 < 10 ? 1 : 0 })} per million` : "");

function otevriKartu(idx, lat, lon, zeme = false) {
  vyber = { idx, lat, lon, zeme };
  kartaKlic = kontextKlic = null;
  $("karta").hidden = false;
  $("k-graf").hidden = $("k-akce").hidden = idx === 0;
  if (idx > 0) kresliGrafKarty();
  skryjNapovedu();
  zvuk.efekt("otevrit");
  kresliSeznamUdalosti();
}
function zavriKartu() {
  if (vyber) zvuk.efekt("zavrit");
  vyber = null;
  $("karta").hidden = true;
  kresliSeznamUdalosti();
}

function aktualizujKartu(p) {
  if (!vyber) return;
  const w = tydenCisel(p);
  const klic = p < 0 ? -1 : w;
  if (klic === kartaKlic) return;
  kartaKlic = klic;
  if (vyber.idx === 0) {
    $("k-kicker").textContent = "No data";
    $("k-nazev").textContent = "No data for this territory";
    $("k-tyden").textContent = "";
    $("k-tip").textContent = "";
    $("k-znak").textContent = "";
    $("k-obsah").innerHTML = `<p class="srovnani">This territory has no separate figures in the WHO data, so the globe shows it in grey with fine dots.</p>`;
    aktualizujKontext(null);
    return;
  }
  const { obl, zem } = infoVyberu();
  const maRegion = vyber.idx >= 256;
  $("k-kicker").textContent = obl ? `Region · ${zem?.nazev ?? ""}` : "Country";
  $("k-nazev").textContent = obl ? obl.nazev : (zem?.nazev ?? "Unknown");
  $("k-tyden").textContent = p < 0 ? "Before the first reports to WHO" : `Week ending ${datumEn(new Date(meta.tydny[w] + "T00:00:00Z"))}`;
  $("k-tip").textContent = !maRegion ? "" : obl ? `Click again to see all of ${zem?.nazev ?? "the country"}` :
    `Click again to see ${nazevOblasti(vyber.idx)} only`;
  const nic = zem && bezDat(zem.i);
  const stavZeme = zem ? DATA[(w * SIRKA + zem.i) * 4 + 2] : 0;
  $("k-znak").textContent = nic ? "No data: no cases or deaths in the WHO data" : p < 0 ? "" :
    stavZeme > 0.5 ? "No weekly reports to WHO for over 12 weeks" : (zem && KUM[(w * SIRKA + zem.i) * 2] === 0 ? "No cases reported yet" : "");
  const ww = Math.max(w, 0), pred = p < 0;
  const hz = (k) => (nic ? null : pred || !zem ? 0 : statV(zem.i, ww, k));
  const kz = (k) => (nic ? null : pred || !zem ? 0 : KUM[(ww * SIRKA + zem.i) * 2 + k]);

  const poznTydne = (k) => {
    if (!zem || pred || nic) return naMilion(hz(k), zem?.populace);
    if (DOPLNENI.has(`${zem.i}|${ww}|${k}`)) return `a one-off jump in the report, probably earlier ${k ? "deaths" : "cases"} added at once`;
    if (hz(k) != null && hz(k) < 0) return "a correction by WHO to earlier figures";
    const n = ROZLOZENO.get(`${zem.i}|${ww}|${k}`);
    if (n && hz(k) != null) return `one report for about ${n} weeks`;
    return naMilion(hz(k), zem?.populace);
  };
  const prazdne = nic ? "No data" : "No report";
  let html = "";
  if (obl) {
    const hr = pred ? null : statV(obl.i, ww, 0);
    html += `<div class="mrizka">${pole("Cases this week", pred ? 0 : hr, naMilion(hr, obl.populace), "No regional data")}${
      pole("Total cases", pred ? 0 : KUM[(ww * SIRKA + obl.i) * 2], obl.od ? `Regional data since ${mesicRok(obl.od)}` : "")}</div>`;
    html += `<div class="oddil"><div class="kicker">${esc(zem?.nazev ?? "Country")}</div>`;
  }
  html += `<div class="mrizka">${pole("Cases this week", hz(0), poznTydne(0), prazdne)}${
    pole("Deaths this week", hz(1), poznTydne(1), prazdne)}${pole("Total cases", kz(0))}${
    pole("Total deaths", kz(1), naMilion(kz(1), zem?.populace))}</div>`;
  if (obl) html += "</div>";
  if (souhrn) html = htmlPoradi(zem) + html;
  html += htmlOpatreni(obl, zem, ww, pred) + htmlOckovani(zem, ww, pred, obl) + (obl ? "" : htmlSrovnani(zem, ww, pred))
    + htmlKlicovaData(zem, ww, pred);
  $("k-obsah").innerHTML = html;
  aktualizujKontext(zem, ww, pred, obl);
  $("k-graf-znacka").style.left = `${(ww / (T - 1)) * 100}%`;
}

function kresliGrafKarty() {
  if (!vyber || vyber.idx === 0) return;
  const { obl, zem } = infoVyberu();
  const smrti = !obl && zem && KUM[((T - 1) * SIRKA + zem.i) * 2 + 1] > 0;
  const i = obl ? obl.i : zem?.i ?? 0, k = smrti ? 1 : 0;
  $("k-graf-nazev").textContent = obl ? "Weekly cases in the region" : smrti ? "Weekly deaths" : "Weekly cases";
  const c = $("k-graf-platno"), W = c.clientWidth || 294, H = 54, dpr = Math.min(devicePixelRatio, 2);
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);

  const rada = Array.from({ length: T }, (_, w) => (k === 1 && i < 256 ? umrtiObraz(i, w) : statV(i, w, k)));
  const max = Math.max(1, ...rada.map((x) => x ?? 0));
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, smrti ? "rgba(235,240,255,0.9)" : "rgba(255,95,60,0.95)");
  gr.addColorStop(1, smrti ? "rgba(235,240,255,0.12)" : "rgba(255,60,40,0.15)");
  g.fillStyle = gr;
  const bw = W / T;
  rada.forEach((x, w) => {
    if (x == null) { g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(w * bw, H - 2, Math.max(bw - 0.2, 0.6), 2); g.fillStyle = gr; return; }
    const h = Math.max((x / max) * (H - 2), x > 0 ? 1 : 0);
    g.fillRect(w * bw, H - h, Math.max(bw - 0.2, 0.6), h);
  });
}

const xTydne = (p) => omez(p / (T - 1), 0, 1);
function kresliOsu() {
  const osa = $("osa"), W = Math.max(osa.clientWidth, 50), H = 30, dpr = Math.min(devicePixelRatio, 2);
  const rada = skupina ? skupina.rada : meta.svet.umrti_obraz;
  const maxU = Math.max(...rada) || 1;
  for (const [cid, jas] of [["graf", false], ["graf2", true]]) {
    const c = $(cid);
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x++) {
      const u = svet(rada, (x / W) * (T - 1)) / maxU;
      g.lineTo(x, H - 1 - Math.pow(u, 0.7) * (H - 3));
    }
    g.lineTo(W, H);
    g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, jas ? "rgba(255,112,72,1)" : "rgba(255,255,255,0.26)");
    gr.addColorStop(1, jas ? "rgba(255,60,40,0.28)" : "rgba(255,255,255,0.06)");
    g.fillStyle = gr;
    g.fill();
  }
  const roky = [];
  let minule = -1e9;
  for (let r = 2020; r <= 2026; r++) {
    const x = xTydne(tydenData(`${r}-01-01`));
    const popis = x * W - minule >= 34;
    if (popis) minule = x * W;
    roky.push(`<i style="left:${x * 100}%">${popis ? `<b>${r}</b>` : ""}</i>`);
  }
  $("roky").innerHTML = roky.join("");
  $("klice").innerHTML = nast.draha.map((b, i) =>
    `<i data-i="${i}" title="Keyframe ${b.datum ?? ""} at ${b.s.toFixed(1)} s" style="left:${xTydne(b.tyden ?? tydenVCase(b.s)) * 100}%"></i>`).join("");
  for (const el of $("klice").querySelectorAll("i")) {
    el.onpointerdown = (e) => { e.stopPropagation(); t = nast.draha[+el.dataset.i].s; zpetNaProhlidku(); };
  }
  $("osa").setAttribute("aria-valuemax", delka.toFixed(0));
  kresliUdalostiNaOse();
}

const TYPY_UD = {
  who:      { nazev: "WHO decision",           barva: "#b79cff" },
  varianta: { nazev: "New variant",            barva: "#ff6fae" },
  vakcina:  { nazev: "Vaccines and treatment", barva: "#5fe3c0" },
  opatreni: { nazev: "Measures",               barva: "#6aa8ff" },
  pocet:    { nazev: "Death toll",             barva: "#ff8a5c" },
  milnik:   { nazev: "Milestone",              barva: "#ffd27a" },
};

const POCET_UMRTI = /^who_deaths_[0-9]+m$|^excess_deaths$/;
const typUdalosti = (u) => u.id === "dexamethasone" ? "vakcina" : POCET_UMRTI.test(u.id) ? "pocet" : TYPY_UD[u.druh] ? u.druh : "milnik";
const UD = (UDALOSTI?.udalosti ?? []).map((u) => ({ ...u, w: tydenIndex(u.datum), typ: typUdalosti(u) }));
let udAktivni = null, udOd = 0, udDo = 0, udFronta = [];

const UD_SEZNAM_MAX = 5, UD_SEZNAM_S = 40;
let udSeznam = [];
function pridejDoSeznamu(u) {
  udSeznam = [{ u, do: performance.now() / 1000 + UD_SEZNAM_S }, ...udSeznam.filter((x) => x.u !== u)].slice(0, UD_SEZNAM_MAX);
  kresliSeznamUdalosti();
}
function kresliSeznamUdalosti() {
  const el = $("ud-seznam");
  el.hidden = !udSeznam.length || !vrstvy.udalosti || !!vyber;
  $("ud-seznam-polozky").innerHTML = udSeznam.map(({ u }, i) => `<li><button type="button" class="ud-polozka${u === udAktivni ? " ted" : ""}"
    data-i="${i}" style="--ud:${TYPY_UD[u.typ].barva}"><span class="ud-typ">${TYPY_UD[u.typ].nazev} · ${datumKr(u.datum)}</span>
    <span class="ud-nazev">${esc(u.titulek)}</span></button></li>`).join("");
  for (const b of el.querySelectorAll(".ud-polozka")) {
    b.onclick = () => { const x = udSeznam[+b.dataset.i]; if (x) { x.do = performance.now() / 1000 + UD_SEZNAM_S; ukazUdalost(x.u, 8, false); } };
  }
}
let udSeznamKontrola = 0;
function aktualizujSeznamUdalosti(ted) {
  if (!hraje || ted - udSeznamKontrola < 0.5) return;
  udSeznamKontrola = ted;
  const pred = udSeznam.length;
  udSeznam = udSeznam.filter((x) => x.do > ted || x.u === udAktivni);
  if (udSeznam.length !== pred) kresliSeznamUdalosti();
}
function ukazUdalost(u, trvani = 6, doSeznamu = true) {
  udAktivni = u; udOd = performance.now() / 1000; udDo = udOd + trvani;
  const typ = TYPY_UD[u.typ];
  $("udalost").style.setProperty("--ud", typ.barva);
  $("udalost-bod").style.setProperty("--ud", typ.barva);
  $("ud-typ").textContent = typ.nazev;
  $("ud-datum").textContent = datumKr(u.datum);
  $("ud-titulek").textContent = u.titulek;
  $("ud-detail").textContent = u.detail ?? "";
  const z = u.zdroje?.[0];

  const puvod = u.vypocet ? "Computed from the WHO data" : UDALOSTI?.stav === "reviewed" ? "" : "AI-assisted draft, human review pending";
  $("ud-zdroj").innerHTML = (z ? `Source: <a href="${httpsUrl(z.url)}" target="_blank" rel="noopener noreferrer">${esc(z.vydavatel)}</a>` : "")
    + (puvod ? `<span> · ${puvod}</span>` : "");
  $("udalost").classList.add("videt");
  if (doSeznamu) { pridejDoSeznamu(u); if (hraje) zvuk.efekt(`ud-${u.typ}`); }
  else kresliSeznamUdalosti();
}
function skryjUdalost() {
  udAktivni = null; udFronta = [];
  $("udalost").classList.remove("videt");
  $("udalost-bod").hidden = true;
  kresliSeznamUdalosti();
}

function aktualizujUdalost(p) {
  if (!vrstvy.udalosti || !UD.length) return;
  const w = Math.round(p), ted = performance.now() / 1000;
  aktualizujSeznamUdalosti(ted);
  if (!hraje && !udAktivni) { const u = UD.find((x) => x.w === w); if (u) ukazUdalost(u, 0.5, false); }

  if (udAktivni && (ted > udDo || (hraje && udFronta.length && ted - udOd > 3.5)) && (hraje || w !== udAktivni.w)) {
    udAktivni = null;
    $("udalost").classList.remove("videt");
    kresliSeznamUdalosti();
    while (udFronta.length && Math.floor(p) - udFronta[0].w > 6) udFronta.shift();
    if (udFronta.length) ukazUdalost(udFronta.shift(), 4.5);
  }
  const bod = $("udalost-bod"), m = udAktivni?.misto;
  if (m) {
    const pata = lonlat(m.lon, m.lat, 1.001);
    if (_q.copy(pata).normalize().dot(_v.copy(kamera.position).sub(pata).normalize()) > 0.05) {
      const s = pata.project(kamera);
      bod.style.left = `${((s.x + 1) / 2) * sirkaR}px`;
      bod.style.top = `${((1 - s.y) / 2) * vyskaR}px`;
      bod.firstElementChild.textContent = m.nazev;
      bod.hidden = false;
      return;
    }
  }
  bod.hidden = true;
}

function projdiUdalosti(minuly, tyden) {
  if (tyden < minuly || tyden - minuly > 3) {
    udFronta = [];
    if (udSeznam.length) { udSeznam = []; kresliSeznamUdalosti(); }
  }
  if (!vrstvy.udalosti || tyden <= minuly || tyden - minuly > 3) return;
  for (const u of UD.filter((x) => x.w > minuly && x.w <= tyden)) {
    if (!udAktivni) ukazUdalost(u); else udFronta.push(u);
  }
}
function kresliUdalostiNaOse() {
  $("ud-znacky").innerHTML = UD.map((u) => `<i style="left:${xTydne(u.w) * 100}%;--ud:${TYPY_UD[u.typ].barva}"></i>`).join("");
}

function udalostNaOse(e) {
  const r = $("osa").getBoundingClientRect();
  let nej = null, vzd = 7;
  UD.forEach((u) => { const d = Math.abs(r.left + xTydne(u.w) * r.width - e.clientX); if (d < vzd) { vzd = d; nej = u; } });
  return vrstvy.udalosti ? nej : null;
}
const mmss =(s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

const METRIKY = {
  pripady: { nazev: "Weekly cases per million", hodnota: (i, w) => { const v = statV(i, w, 0); return v == null || !populace(i) ? null : (v / populace(i)) * 1e6; } },
  umrti: { nazev: "Weekly deaths per million", hodnota: (i, w) => { const v = i < 256 ? statV(i, w, 1) : null; return v == null || !populace(i) ? null : (v / populace(i)) * 1e6; } },
  celkem: { nazev: "Total deaths per million", hodnota: (i, w) => (i < 256 ? umrtiNaMilion(i, w) : null) },
  ockovani: { nazev: "People with at least one vaccine dose, % of population", hodnota: (i, w) => (i < 256 ? ockV(i, w, 0) : null), format: procento },
  opatreni: { nazev: "Stringency of measures, 0 to 100 (to the end of 2022)", hodnota: (i, w) => prisnostV(i, w), format: (v) => `${Math.round(v)}` },
};
const VYSKA_RADKU = 30;
function aktualizujZebricek(p) {
  if (!skupina) return;
  const w = tydenCisel(p), klic = `${p < 0 ? -1 : w}|${zebricekMetrika}|${skupina.nazev}|${skupina.clenove.size}`;
  if (klic === zebricekKlic) return;
  const novy = !zebricekKlic || !zebricekKlic.endsWith(`|${skupina.nazev}|${skupina.clenove.size}`) || !zebricekKlic.includes(`|${zebricekMetrika}|`);
  zebricekKlic = klic;
  const m = METRIKY[zebricekMetrika];
  const radky = [...skupina.clenove].map((i) => ({ i, v: p < 0 || bezDat(i) ? null : m.hodnota(i, w) }))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || nazevOblasti(a.i).localeCompare(nazevOblasti(b.i)));
  const max = Math.max(1e-9, ...radky.map((r) => r.v ?? 0));
  const seznam = $("z-seznam");
  if (novy) {
    seznam.innerHTML = radky.map((r) => `<button type="button" class="z-radek" data-i="${r.i}"><span class="z-poradi"></span>
      <span class="z-nazev">${esc(nazevOblasti(r.i))}${r.i >= 256 ? ` <em>${esc(zemePodle.get(rodic(r.i))?.kod ?? "")}</em>` : ""}</span>
      <span class="z-pruh"><i></i></span><span class="z-hodnota"></span></button>`).join("");
    for (const el of seznam.querySelectorAll(".z-radek")) {
      el.onclick = () => {
        const i = +el.dataset.i, z = zemePodle.get(rodic(i));
        otevriKartu(i, z?.lat ?? 0, z?.lon ?? 0, false);
        if (z) letNa(z.lat, z.lon);
      };
    }
    seznam.style.height = `${radky.length * VYSKA_RADKU}px`;
    $("z-metrika-nazev").textContent = m.nazev;
  }
  const prvky = new Map([...seznam.querySelectorAll(".z-radek")].map((el) => [+el.dataset.i, el]));
  radky.forEach((r, k) => {
    const el = prvky.get(r.i);
    if (!el) return;
    el.style.transform = `translateY(${k * VYSKA_RADKU}px)`;
    el.querySelector(".z-poradi").textContent = r.v == null ? "" : k + 1;
    el.querySelector(".z-pruh i").style.width = `${r.v == null ? 0 : Math.max((r.v / max) * 100, r.v > 0 ? 1.5 : 0)}%`;
    el.querySelector(".z-hodnota").textContent = r.v == null ? "n/a" : m.format ? m.format(r.v) : r.v < 10 ? r.v.toFixed(1) : cislo(r.v);
    el.classList.toggle("vybrany", !!vyber && (vyber.idx === r.i || (vyber.zeme && rodic(vyber.idx) === r.i)));
  });
}
function aktualizujOsu(p) {
  const r = `${xTydne(Math.max(p, 0)) * 100}%`;
  $("prubeh").style.width = r;
  $("hlava").style.left = r;
  $("l-cas").textContent = `${mmss(t)} / ${mmss(delka)}`;
  $("osa").setAttribute("aria-valuenow", t.toFixed(0));
  $("osa").setAttribute("aria-valuetext", datumEn(datumTydne(Math.max(p, START))));
}
let tahOsy = false;
const podilOsy = (e) => { const r = $("osa").getBoundingClientRect(); return omez((e.clientX - r.left) / r.width, 0, 1); };
const casZOsy = (e) => casTydneBodu(podilOsy(e) * (T - 1));

const krokTydne = (n) => { t = casTydneBodu(omez(tydenCisel(tydenVCase(t)) + n, 0, T - 1)); };
$("osa").addEventListener("pointerdown", (e) => {
  try { $("osa").setPointerCapture(e.pointerId); } catch (chybaZachyceni) {  }
  tahOsy = true;
  $("osa").classList.add("tahne");
  t = casZOsy(e);
});
$("osa").addEventListener("pointermove", (e) => {
  const f = podilOsy(e), u = udalostNaOse(e);
  $("tip").textContent = u ? `${datumKr(u.datum)} · ${TYPY_UD[u.typ].nazev}: ${u.titulek}` : `Week ending ${datumKr(meta.tydny[Math.round(f * (T - 1))])}`;
  $("tip").style.left = `${f * 100}%`;
  if (tahOsy) t = casZOsy(e);
});
const pustOsu = () => { tahOsy = false; $("osa").classList.remove("tahne"); };
$("osa").addEventListener("pointerup", pustOsu);
$("osa").addEventListener("pointercancel", pustOsu);
$("osa").addEventListener("keydown", (e) => {
  if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
    e.preventDefault(); e.stopPropagation();
    krokTydne((e.code === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 4 : 1));
  }
});

function velikost() {
  const sc = $("scena").getBoundingClientRect();
  let w = sc.width, h = sc.height;
  if (studio && $("p-ramec").checked) {
    const volnoW = sc.width - 40, volnoH = sc.height - 20 - 96;
    w = volnoW; h = (w * 9) / 16;
    if (h > volnoH) { h = volnoH; w = (h * 16) / 9; }
  }
  w = Math.max(Math.floor(w), 50); h = Math.max(Math.floor(h), 50);
  sirkaR = w; vyskaR = h;
  $("ramec").style.width = `${w}px`;
  $("ramec").style.height = `${h}px`;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  kamera.aspect = w / h;
  kamera.updateProjectionMatrix();
  if ($("zony")) $("zony").style.transform = `scale(${w / 1920})`;
  if (pozice) { kresliOsu(); if (vyber) kresliGrafKarty(); }
}
new ResizeObserver(velikost).observe($("scena"));

let posledni = performance.now(), minulyTyden = -1, posledniKresba = 0, aktivniDo = 0;

for (const udalost of ["pointermove", "pointerdown", "wheel", "keydown", "touchstart", "resize"]) {
  window.addEventListener(udalost, () => { aktivniDo = performance.now() + 1500; }, { passive: true, capture: true });
}
function smycka(ted) {
  const dt = Math.min((ted - posledni) / 1000, 0.1);
  posledni = ted;
  const klid = !hraje && !tahOsy && !tah && !prechod && !studio && !vyber && ted > aktivniDo
    && Math.abs(setrv.lon) + Math.abs(setrv.lat) <= 0.05
    && !(volna && volna.cilVzd != null && Math.abs(volna.cilVzd - volna.kamera_vzdalenost) > 1e-3)
    && Math.abs(matZeme.uniforms.uVrstvy.value.x - cilVrstev.x) + Math.abs(matZeme.uniforms.uVrstvy.value.y - cilVrstev.y)
      + Math.abs(matZeme.uniforms.uVrstvy.value.z - cilVrstev.z) + Math.abs(matZeme.uniforms.uVrstvy.value.w - cilVrstev.w) < 1e-3
    && Math.abs(matZeme.uniforms.uSouhrn.value - (souhrn ? 1 : 0)) < 1e-3;
  if (klid && ted - posledniKresba < 500) { requestAnimationFrame(smycka); return; }
  posledniKresba = ted;
  if (hraje && !tahOsy) {
    t += dt * rychlost;
    if (t >= delka) { t = delka; prepniHrani(false); ukazKonec(); }
  }
  aktualizujOdkaz(ted);
  if (souhrn && (hraje || tahOsy || t < delka - 0.01)) vypniSouhrn();
  aktualizujKonecPilulku();

  if (volna && !tah) {
    if (Math.abs(setrv.lon) + Math.abs(setrv.lat) > 0.05) {
      posun(setrv.lon * dt, setrv.lat * dt, setrv.kam, setrv.cil);
      const utlum = Math.exp(-dt * 3.2);
      setrv.lon *= utlum; setrv.lat *= utlum;
    }
  }
  if (volna && volna.cilVzd != null) volna.kamera_vzdalenost += (volna.cilVzd - volna.kamera_vzdalenost) * (1 - Math.exp(-dt * 9));
  snimek();

  const p = tydenVCase(t), tyden = Math.floor(p);
  if (zvuk.bezi) {
    zvuk.krok(p < 0 ? 0 : svet(intenzitaRada, p), hraje && !tahOsy, t >= delka - nast.zaver_s - 2);
    if (hraje && !tahOsy && tyden > minulyTyden && tyden - minulyTyden <= 3 && vlny.some((v) => v > minulyTyden && v <= tyden)) zvuk.efekt("vlna");
  }
  if (hraje && !tahOsy) projdiUdalosti(minulyTyden, tyden);
  minulyTyden = tyden;
  matZeme.uniforms.uVrstvy.value.lerp(cilVrstev, 1 - Math.exp(-dt * 7));
  const uS = matZeme.uniforms.uSouhrn;
  uS.value += ((souhrn ? 1 : 0) - uS.value) * (1 - Math.exp(-dt * 6));
  if (Math.abs(uS.value - (souhrn ? 1 : 0)) < 1e-3) uS.value = souhrn ? 1 : 0;
  if (!$("p-bloom") || $("p-bloom").checked) composer.render();
  else renderer.render(scene, kamera);
  requestAnimationFrame(smycka);
}

const IKONA_HRAT = `<svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7l-10.2-6.4A1 1 0 0 0 8 5.6z" fill="currentColor"/></svg>`;
const IKONA_PAUZA = `<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>`;
function prepniHrani(ano = !hraje) {
  hraje = ano;
  if (ano) skryjKarty();
  if (hraje && t >= delka - 0.01) t = 0;
  $("b-hrat").innerHTML = hraje ? IKONA_PAUZA : IKONA_HRAT;
  $("b-hrat").setAttribute("aria-label", hraje ? "Pause" : "Play");
  $("b-hrat").title = hraje ? "Pause (Space)" : "Play (Space)";
}
$("b-hrat").onclick = () => prepniHrani();
const RYCHLOSTI = [1, 2, 4, 0.5];
$("b-rychlost").onclick = () => {
  rychlost = RYCHLOSTI[(RYCHLOSTI.indexOf(rychlost) + 1) % RYCHLOSTI.length];
  $("b-rychlost").textContent = `${rychlost === 0.5 ? "½" : rychlost}×`;
};
const celaObrazovka = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
$("b-full").onclick = celaObrazovka;
$("b-prohlidka").onclick = zpetNaProhlidku;
$("k-zavrit").onclick = zavriKartu;
$("k-let").onclick = () => { if (vyber) letNa(vyber.lat, vyber.lon); };

const IKONA_ZVUK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/></svg>`;
const IKONA_TICHO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`;

function kresliZvuk() {
  const ticho = zvuk.ztlumeno || (zvuk.hlasitost("hudba") === 0 && zvuk.hlasitost("efekty") === 0);
  $("b-zvuk").innerHTML = ticho ? IKONA_TICHO : IKONA_ZVUK;
  $("b-zvuk").setAttribute("aria-label", ticho ? "Sound settings, sound off" : "Sound settings");
  $("b-zvuk").title = "Music and sounds (M mutes all)";
  for (const k of ["hudba", "efekty"]) {
    const x = Math.round(zvuk.hlasitost(k) * 100);
    $(`zv-${k}`).value = x;
    $(`zv-${k}-h`).textContent = `${x}%`;
    $(`zv-${k}`).disabled = zvuk.ztlumeno;
  }
  $("zv-ticho").textContent = zvuk.ztlumeno ? "Turn sound on (M)" : "Mute all (M)";
}
function prepniZvukPop(ano = $("zvuk-pop").hidden) {
  $("zvuk-pop").hidden = !ano;
  $("b-zvuk").setAttribute("aria-expanded", String(ano));
  if (ano) { kresliZvuk(); $("zv-hudba").focus(); }
}
$("b-zvuk").onclick = () => { zvuk.spust(); prepniZvukPop(); };
$("zv-ticho").onclick = () => { zvuk.spust(); zvuk.prepniZtlumeni(); kresliZvuk(); kresliZvukKarty(); };
for (const k of ["hudba", "efekty"]) {
  $(`zv-${k}`).oninput = (e) => {
    zvuk.spust();
    zvuk.nastavHlasitost(k, e.target.value / 100);
    kresliZvuk();
    if (k === "efekty") zvuk.efekt("vyber");
  };
}
kresliZvuk();
nastavVrstvu("pripady", true);

function prepniInfo(ano = $("info").hidden) {
  $("info").hidden = !ano;
  $("b-info").setAttribute("aria-expanded", String(ano));
  if (ano) { zavriKartu(); $("info-zavrit").focus(); }
}
$("b-info").onclick = () => prepniInfo();
$("info-zavrit").onclick = () => prepniInfo(false);
$("leg-info").onclick = () => { document.body.classList.remove("vrstvy-otevrene"); prepniInfo(true); };

function prepniHledani(ano = $("hledat-pop").hidden) {
  $("hledat-pop").hidden = !ano;
  $("b-hledat").setAttribute("aria-expanded", String(ano));
  if (ano) { skryjKarty(); $("hl-pole").value = ""; kresliHledani(); $("hl-pole").focus(); }
}
function kresliHledani() {
  const q = $("hl-pole").value.trim().toLowerCase();
  const sedi = (s) => !q || s.toLowerCase().includes(q);
  const zeme = ZEME.filter((z) => !bezDat(z.i) && sedi(z.nazev)).sort((a, b) => a.nazev.localeCompare(b.nazev));
  const obl = q.length >= 2 ? meta.oblasti.filter((o) => sedi(o.nazev)).slice(0, 25) : [];
  const radek = (i, nazev, pod) => `<button type="button" class="hl-radek" data-i="${i}"><span>${esc(nazev)}</span>${pod ? `<em>${esc(pod)}</em>` : ""}</button>`;
  $("hl-vysledky").innerHTML = (zeme.map((z) => radek(z.i, z.nazev, z.kontinent)).join("")
    + obl.map((o) => radek(o.i, o.nazev, `Region · ${zemePodle.get(o.zeme)?.nazev ?? ""}`)).join(""))
    || `<p class="pozn-k" style="padding:0 14px">Nothing matches “${esc($("hl-pole").value)}”.</p>`;
  for (const el of $("hl-vysledky").querySelectorAll(".hl-radek")) el.onclick = () => vyberMisto(+el.dataset.i);
}
function vyberMisto(i) {
  const z = zemePodle.get(rodic(i));
  prepniHledani(false);
  if (!z) return;
  otevriKartu(i, z.lat, z.lon, i < 256);
  letNa(z.lat, z.lon);
}
$("b-hledat").onclick = () => prepniHledani();
$("hl-pole").oninput = kresliHledani;
$("hl-pole").onkeydown = (e) => {
  if (e.code === "Enter") { const prvni = $("hl-vysledky").querySelector(".hl-radek"); if (prvni) vyberMisto(+prvni.dataset.i); }
  if (e.code === "Escape") { prepniHledani(false); $("b-hledat").focus(); }
};

function skryjKarty() {
  const vKarte = document.activeElement?.closest?.("#uvod-karta, #konec-karta");
  $("uvod-karta").hidden = true; $("konec-karta").hidden = true;
  if (vKarte) $("b-hrat").focus({ preventScroll: true });
}

const DOTYK = matchMedia("(pointer: coarse)").matches;
if (DOTYK) $("napoveda").innerHTML = "<span><kbd>Drag</kbd> to explore · <kbd>Pinch</kbd> to zoom · <kbd>Tap</kbd> a country for details · Music plays, the speaker button sets music and sounds</span>";

function kresliZvukKarty() {
  $("u-zvuk").textContent = zvuk.ztlumeno
    ? (DOTYK ? "Music off · tap here to turn it on" : "Music off · press M or click here to turn it on")
    : (DOTYK ? "Music starts with your first tap · tap here to mute" : "Music starts with your first click or key press · press M or click here to mute");
}
function ukazKonec() {
  const w = T - 1, w0 = Math.max(0, T - 12), hlasi = meta.svet.hlasi;
  $("konec-kicker").textContent = `End of the data, ${datumKr(meta.tydny[w])}`;
  $("konec-umrti").textContent = cislo(meta.svet.celkem[w]);
  const prumer = Math.round(hlasi.slice(w0).reduce((a, b) => a + b, 0) / (T - w0));
  $("konec-hlasi").textContent = `About ${prumer} countries and territories still reported each week, down from ${Math.max(...hlasi)} at the peak`;
  $("konec-karta").hidden = false;
  $("k2-souhrn").focus({ preventScroll: true });
}
$("u-hrat").onclick = () => { skryjKarty(); prepniHrani(true); };
$("u-hledat").onclick = () => { skryjKarty(); prepniHledani(true); };
$("u-sam").onclick = () => skryjKarty();
$("u-zvuk").onclick = () => { zvuk.spust(); zvuk.prepniZtlumeni(); kresliZvuk(); kresliZvukKarty(); };
$("konec-zavrit").onclick = () => skryjKarty();
$("k2-hledat").onclick = () => { skryjKarty(); prepniHledani(true); };
$("k2-porovnat").onclick = () => { skryjKarty(); prepniSkupiny(true); };
$("k2-znovu").onclick = () => { skryjKarty(); t = 0; prepniHrani(true); };
$("k2-souhrn").onclick = () => zapniSouhrn();
$("k2-fakta").onclick = () => { skryjKarty(); prepniFakta(true); };

const POSL = T - 1;
const MILION = 1e6;
const zemeSDaty = ZEME.filter((z) => !bezDat(z.i) && z.populace > 0);
const poradiVZeme = new Map(ZEME.map((z, k) => [z.i, k]));

const vrcholOck = new Map(ZEME.map((z) => {
  let m = null;
  for (let w = 0; w < T; w++) { const v = ockV(z.i, w, 0); if (v != null && (m == null || v > m)) m = v; }
  return [z.i, m];
}));

const prisnostZeme = new Map(ZEME.map((z) => {
  let s = 0, n = 0, prisne = 0;
  for (let w = 0; w < OP_KONEC; w++) { const v = PRISNOST[w * SIRKA + z.i]; if (v >= 0) { s += v; n++; if (v >= 70) prisne++; } }
  return [z.i, n ? { prumer: s / n, prisne } : null];
}));
const SOUHRNY = {
  umrti: { nazev: "Reported deaths per million", kratce: "deaths per million",
    hodnota: (i) => umrtiNaMilion(i, POSL), format: (v) => cislo(v), stupnice: "odm", barvy: ["#2a0508", "#c4141c", "#ffb27a"],
    pozn: "Reported to WHO over the whole period. Depends on testing and on how each country counted deaths." },
  pripady: { nazev: "Reported cases per million", kratce: "cases per million",
    hodnota: (i) => (populace(i) ? (KUM[(POSL * SIRKA + i) * 2] / populace(i)) * MILION : null),
    format: (v) => cislo(v), stupnice: "log", barvy: ["#1d0e02", "#c25a0c", "#ffe08a"],
    pozn: "Reported to WHO. Shows how much a country tested and reported as much as how many people were infected." },
  ockovani: { nazev: "Highest share with at least one vaccine dose", kratce: "with a first dose",
    hodnota: (i) => { const v = vrcholOck.get(i); return v == null ? null : Math.min(v, 100); },
    format: procento, stupnice: "lin", rozsah: [0, 100], barvy: ["#03181b", "#0b8d8e", "#9ff5dc"],
    pozn: "Our World in Data, to August 2024. Shares above 100% (for example when doses are also given to non-residents) count as 100%." },
  opatreni: { nazev: "Average stringency of measures, 2020 to 2022", kratce: "average stringency",
    hodnota: (i) => prisnostZeme.get(i)?.prumer ?? null, format: (v) => `${Math.round(v)} of 100`, stupnice: "lin", rozsah: [0, 80],
    barvy: ["#050b22", "#2f62d8", "#bcd4ff"],
    pozn: "Oxford COVID-19 Government Response Tracker, stringency index 0 to 100, averaged over every week to the end of 2022." },
};

function stupniceSouhrnu(m) {
  const velke = zemeSDaty.filter((z) => z.populace >= MILION).map((z) => m.hodnota(z.i)).filter((v) => v != null);
  const [min, max] = m.rozsah ?? [0, Math.max(...velke)];
  const f = m.stupnice === "odm" ? Math.sqrt : m.stupnice === "log" ? (x) => Math.log10(1 + x) : (x) => x;
  const fi = m.stupnice === "odm" ? (y) => y * y : m.stupnice === "log" ? (y) => 10 ** y - 1 : (y) => y;
  const presah = zemeSDaty.some((z) => (m.hodnota(z.i) ?? 0) > max);
  return { min, max, presah, na01: (v) => Math.min(Math.max((f(v) - f(min)) / (f(max) - f(min) || 1), 0), 1),
           z01: (x) => fi(f(min) + x * (f(max) - f(min))) };
}
let souhrn = null;
function nastavSouhrn(klic) {
  const m = SOUHRNY[klic], st = stupniceSouhrnu(m);
  for (let i = 1; i < SIRKA; i++) {
    const z = rodic(i), v = z > 0 && !bezDat(z) ? m.hodnota(z) : null;
    SOUHRN[i * 4] = v == null ? -1 : st.na01(v);
  }
  souhrnTex.needsUpdate = true;
  m.barvy.forEach((b, k) => matZeme.uniforms[`uSouhrnC${k}`].value.set(b));
  souhrn = klic;
  kartaKlic = null;
  kresliSouhrn(st);
}
const seznamZemi = (radky, m) => radky.map(({ z, v }) => `<li><button type="button" class="f-zeme" data-i="${z.i}"><span>${esc(z.nazev)}</span>
  <b>${m.format(v)}</b></button></li>`).join("");
function zebricekSouhrnu(m, nad, n, vzestupne = false) {
  return zemeSDaty.filter((z) => z.populace >= nad).map((z) => ({ z, v: m.hodnota(z.i) })).filter((x) => x.v != null)
    .sort((a, b) => (vzestupne ? a.v - b.v : b.v - a.v)).slice(0, n);
}
function kresliSouhrn(st) {
  const m = SOUHRNY[souhrn];
  $("sh-obdobi").textContent = `Totals, ${datumKr("2019-12-31")} to ${datumKr(meta.tydny[POSL])}`;
  $("sh-nadpis").textContent = m.nazev;
  for (const b of $("sh-volby").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.s === souhrn));
  $("sh-stupnice").style.background = `linear-gradient(90deg, ${m.barvy.join(", ")})`;
  $("sh-min").textContent = m.format(st.min);
  $("sh-stred").textContent = m.format(st.z01(0.5));
  $("sh-max").textContent = `${m.format(st.max)}${st.presah ? " or more" : ""}`;
  $("sh-pozn").textContent = m.pozn;
  $("sh-nejvys").innerHTML = seznamZemi(zebricekSouhrnu(m, MILION, 5), m);
  $("sh-nejniz").innerHTML = seznamZemi(zebricekSouhrnu(m, 10 * MILION, 5, true), m);
  for (const b of $("souhrn").querySelectorAll(".f-zeme")) b.onclick = () => vyberMisto(+b.dataset.i);
}
function zapniSouhrn(klic = souhrn ?? "umrti") {
  skryjKarty();
  prepniFakta(false, false);
  if (hraje) prepniHrani(false);
  t = delka;
  nastavSouhrn(klic);
  document.body.classList.add("souhrn");
  $("souhrn").hidden = false;
  $("sh-volby").querySelector(`[data-s="${klic}"]`).focus({ preventScroll: true });
  zvuk.efekt("vyber");
}
function vypniSouhrn() {
  if (!souhrn) return;
  souhrn = null;
  kartaKlic = null;
  document.body.classList.remove("souhrn");
  $("souhrn").hidden = true;
}

function kandidatiSouhrnu(kandidati) {
  const m = SOUHRNY[souhrn];
  kandidati.length = 0;
  for (const { z, v } of zebricekSouhrnu(m, MILION, 40)) {
    kandidati.push({ i: poradiVZeme.get(z.i), nazev: z.nazev, umrti: v, pripady: 0, g: 0, smrt: true, text: `${m.format(v)} ${m.kratce}` });
  }
}
function htmlPoradi(zem) {
  const m = SOUHRNY[souhrn], v = zem && !bezDat(zem.i) ? m.hodnota(zem.i) : null;
  if (v == null) return "";
  const srovnani = zebricekSouhrnu(m, MILION, Infinity);
  const misto = srovnani.filter((x) => x.v > v).length + 1;
  return `<div class="oddil poradi"><div class="kicker">${esc(m.nazev)}</div><p><b>${m.format(v)}</b>${zem.populace >= MILION
    ? `<span>Rank ${misto} of ${srovnani.length} countries with over 1 million people</span>` : ""}</p></div>`;
}
for (const b of $("sh-volby").querySelectorAll("button")) b.onclick = () => { nastavSouhrn(b.dataset.s); zvuk.efekt("vyber"); };
$("sh-zpet").onclick = () => { vypniSouhrn(); $("b-hrat").focus(); };
$("sh-fakta").onclick = () => prepniFakta(true);

let faktaHotova = false, faktaOdkud = null;
function prepniFakta(ano = $("fakta").hidden, vratitFokus = true) {
  if (ano && !faktaHotova) { $("fakta-obsah").innerHTML = htmlFakta(); faktaHotova = true; navazFakta(); }
  const bylo = !$("fakta").hidden;
  $("fakta").hidden = !ano;
  if (ano) {
    if (!bylo) faktaOdkud = document.activeElement;
    skryjKarty(); zavriKartu(); prepniInfo(false); $("fakta-zavrit").focus();
  } else if (bylo && vratitFokus) {
    const kam = faktaOdkud?.isConnected && faktaOdkud.offsetParent !== null ? faktaOdkud : $("b-hrat");
    kam.focus({ preventScroll: true });
  }
}
function navazFakta() {
  for (const b of $("fakta").querySelectorAll(".f-zeme")) b.onclick = () => { prepniFakta(false, false); vyberMisto(+b.dataset.i); };
  for (const b of $("fakta").querySelectorAll(".f-ukaz")) b.onclick = () => zapniSouhrn(b.dataset.s);
}
function htmlFakta() {
  const W = POSL, konec = datumKr(meta.tydny[W]), U = meta.svet.umrti, UO = meta.svet.umrti_obraz;
  const celkemP = zemeSDaty.reduce((s, z) => s + KUM[(W * SIRKA + z.i) * 2], 0);
  const w21 = meta.tydny.findLastIndex((d) => d <= "2021-12-31"), do2021 = meta.svet.celkem[w21];
  const hlasiMax = Math.max(...meta.svet.hlasi), wHlasi = meta.svet.hlasi.indexOf(hlasiMax);
  const w0 = Math.max(0, T - 12), hlasiKonec = Math.round(meta.svet.hlasi.slice(w0).reduce((a, b) => a + b, 0) / (T - w0));
  const nikdy = ZEME.filter((z) => bezDat(z.i)).map((z) => z.nazev).sort();

  const nejTyden = (ws) => ws.reduce((a, w) => (UO[w] > UO[a] ? w : a), ws[0]);
  const wMax = nejTyden([...Array(T).keys()]);
  const roky = [...new Set(meta.tydny.map((d) => d.slice(0, 4)))].map((r) => {
    const w = nejTyden(meta.tydny.map((d, i) => (d.startsWith(r) ? i : -1)).filter((i) => i >= 0));
    return `<li><span>${r}: week ending ${datumKr(meta.tydny[w])}</span><b>${cislo(U[w])}${TYDNY_DOPLNENI.has(w) ? "*" : ""}</b></li>`;
  }).join("");
  const S = SOUHRNY, radky = (m, nad, n, vz) => seznamZemi(zebricekSouhrnu(m, nad, n, vz), m);
  const absolutne = { format: (v) => cislo(v) };
  const nejvicUmrti = zemeSDaty.map((z) => ({ z, v: KUM[(W * SIRKA + z.i) * 2 + 1] })).sort((a, b) => b.v - a.v).slice(0, 10);
  const polovina = Object.entries(OCK.zeme).filter(([k, o]) => o.polovina && zemePodle.get(ZEME.find((z) => z.kod === k)?.i)?.populace >= MILION)
    .sort((a, b) => a[1].polovina.localeCompare(b[1].polovina)).slice(0, 5)
    .map(([k, o]) => ({ z: ZEME.find((z) => z.kod === k), v: o.polovina }));

  let wOck = 0;
  for (let w = 0; w < T && meta.tydny[w] <= OCK.do; w++) if (ockV(0, w, 0) != null) wOck = w;
  const prisne = { format: (v) => `${v} weeks` };
  const nejdelePrisne = zemeSDaty.filter((z) => z.populace >= MILION && prisnostZeme.get(z.i))
    .map((z) => ({ z, v: prisnostZeme.get(z.i).prisne })).sort((a, b) => b.v - a.v).slice(0, 5);
  const poznamky = Object.keys(POZNAMKY?.zeme ?? {}).map((k) => ZEME.find((z) => z.kod === k)).filter(Boolean)
    .sort((a, b) => a.nazev.localeCompare(b.nazev));
  const oddil = (nadpis, obsah, otevreny = false) => `<details${otevreny ? " open" : ""}><summary>${nadpis}</summary><div class="f-obsah">${obsah}</div></details>`;
  return [
    oddil("The whole period in numbers", `<ul class="f-cisla">
      <li><b>${cislo(meta.svet.celkem[W])}</b> deaths reported to WHO from ${datumKr("2019-12-31")} to ${konec}.</li>
      <li><b>14.9 million</b> excess deaths estimated by WHO for 2020 and 2021 alone (range 13.3 to 16.6 million), about
        ${(14.9e6 / do2021).toFixed(1)} times the ${(do2021 / 1e6).toFixed(2)} million reported for those two years.</li>
      <li><b>${cislo(celkemP)}</b> cases reported. Many infections were never tested or reported.</li>
      <li><b>${hlasiMax}</b> countries and territories reported in the week ending ${datumKr(meta.tydny[wHlasi])}, the most at any time.
        In the last 12 weeks of the data, about <b>${hlasiKonec}</b> still reported each week.</li>
      ${nikdy.length ? `<li>No cases or deaths at all in the WHO data: ${nikdy.map(esc).join(" and ")}.</li>` : ""}
    </ul>`, true),
    oddil("The deadliest weeks", `<p>The deadliest week worldwide was the week ending <b>${datumKr(meta.tydny[wMax])}</b>, with
      <b>${cislo(U[wMax])}</b> deaths reported.</p>
      <div class="kicker">Deadliest week of each year</div><ul class="f-seznam">${roky}</ul>
      <p class="pozn-k">Deaths reported to WHO worldwide. Later years also reflect that fewer countries reported.
      ${roky.includes("*") ? "* The week includes one-off jumps, when a country added earlier deaths at once." : ""}</p>`),
    oddil("Highest reported deaths per million", `<ol class="f-seznam">${radky(S.umrti, MILION, 10)}</ol>
      <p class="pozn-k">Countries with over 1 million people. Countries that counted deaths thoroughly can rank high; reported
      figures are not the same as the true toll.</p>${`<button type="button" class="tl f-ukaz" data-s="umrti">Show on the globe</button>`}`),
    oddil("Most deaths reported", `<ol class="f-seznam">${seznamZemi(nejvicUmrti, absolutne)}</ol>
      <p class="pozn-k">Total deaths reported to WHO. Large countries lead this list partly because of their size.</p>`),
    oddil("Lowest reported deaths per million", `<ol class="f-seznam">${radky(S.umrti, 10 * MILION, 10, true)}</ol>
      <p class="pozn-k">Countries with over 10 million people. Low figures can reflect real differences as well as limited
      testing, counting and reporting.</p>`),
    oddil("Vaccination", `<p>Worldwide, <b>${procento(ockV(0, wOck, 0))}</b> of people had at least one dose by
      ${mesicRok(OCK.do)}.</p>
      <div class="kicker">Highest share with a first dose</div><ol class="f-seznam">${radky(S.ockovani, MILION, 5)}</ol>
      <div class="kicker">Lowest share, countries with over 10 million people</div><ol class="f-seznam">${radky(S.ockovani, 10 * MILION, 5, true)}</ol>
      <div class="kicker">First to reach half the population with a first dose</div>
      <ol class="f-seznam">${seznamZemi(polovina, { format: (v) => `around ${datumKr(v)}` })}</ol>
      <p class="pozn-k">Our World in Data. Countries with over 1 million people unless stated. Shares above 100% (for example
      when doses are also given to non-residents) count as 100%. Countries tied at 100% are listed in no particular order.</p>
      <p class="pozn-k">Low shares can reflect limited supply, access or reporting as well as people’s choices. Where a country
      stopped reporting, the last reported value is used.</p><button type="button" class="tl f-ukaz" data-s="ockovani">Show on the globe</button>`),
    oddil("Measures", `<div class="kicker">Highest average stringency, 2020 to 2022</div><ol class="f-seznam">${radky(S.opatreni, MILION, 5)}</ol>
      <div class="kicker">Longest under strict measures (index 70 or more)</div><ol class="f-seznam">${seznamZemi(nejdelePrisne, prisne)}</ol>
      <div class="kicker">Lowest average stringency, countries with over 10 million people</div>
      <ol class="f-seznam">${radky(S.opatreni, 10 * MILION, 5, true)}</ol>
      <p class="pozn-k">Oxford COVID-19 Government Response Tracker, stringency index 0 to 100, to the end of 2022. The index
      measures how strict the rules were, not how well they worked.</p><button type="button" class="tl f-ukaz" data-s="opatreni">Show on the globe</button>`),
    poznamky.length ? oddil("Country notes: what research points to", `<p>Notes with sources for ${poznamky.length} countries. Click one to
      open it on the globe.</p><p class="pozn-k">Written with AI assistance from the published sources and read by a person. Each
      country window shows its sources and caveats.</p><ul class="f-poznamky">${poznamky.map((z) => `<li><button type="button" class="f-zeme" data-i="${z.i}">
      <span>${esc(z.nazev)}</span></button><p>${esc(POZNAMKY.zeme[z.kod].souhrn)}</p></li>`).join("")}</ul>`) : "",
    `<p class="pozn-k f-zdroje">The numbers are computed from the data on this globe. The country notes are written, not computed.
      Sources and licences: the “i” button.</p>`,
  ].join("");
}
$("fakta-zavrit").onclick = () => prepniFakta(false);
$("kp-souhrn").onclick = () => zapniSouhrn();
$("kp-fakta").onclick = () => prepniFakta(true);

let konecPilulka = false;
function aktualizujKonecPilulku() {
  const ano = !hraje && t >= delka - 0.01 && !souhrn && $("konec-karta").hidden && $("fakta").hidden && !vyber;
  if (ano !== konecPilulka) { konecPilulka = ano; $("konec-pilulka").hidden = !ano; }
}

function odkaz() {
  const p = tydenVCase(t), casti = [];
  if (p >= 0) casti.push(`d=${meta.tydny[tydenCisel(p)]}`);
  if (vyber && vyber.idx > 0) {
    if (vyber.idx >= 256 && !vyber.zeme) casti.push(`r=${vyber.idx}`);
    else casti.push(`c=${zemePodle.get(rodic(vyber.idx))?.kod ?? ""}`);
  }
  return casti.length ? `#${casti.join("&")}` : "";
}
let posledniOdkaz = null, posledniKontrolaOdkazu = 0;
function aktualizujOdkaz(ted) {
  if (hraje || ted - posledniKontrolaOdkazu < 500) return;
  posledniKontrolaOdkazu = ted;
  const h = odkaz();
  if (h !== posledniOdkaz) { posledniOdkaz = h; history.replaceState(null, "", location.pathname + location.search + h); }
}
function ctiOdkaz() {
  const h = new URLSearchParams(location.hash.slice(1));
  const d = h.get("d"), c = h.get("c"), r = Number(h.get("r"));
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) t = casTydneBodu(tydenIndex(d));
  const z = c ? ZEME.find((x) => x.kod === c.toUpperCase()) : null;
  if (r && oblastPodle.has(r)) { const zz = zemePodle.get(rodic(r)); if (zz) { otevriKartu(r, zz.lat, zz.lon, false); letNa(zz.lat, zz.lon); } }
  else if (z) { otevriKartu(z.i, z.lat, z.lon, true); letNa(z.lat, z.lon); }
  return !!(d || z || r);
}
$("k-odkaz").onclick = async () => {
  const url = location.origin + location.pathname + location.search + odkaz();
  try { await navigator.clipboard.writeText(url); $("k-odkaz").textContent = "Link copied"; }
  catch (e) { prompt("Copy this link:", url); }
  setTimeout(() => { $("k-odkaz").textContent = "Copy link"; }, 2000);
};
$("b-vrstvy").onclick = () => {
  const otevreno = document.body.classList.toggle("vrstvy-otevrene");
  $("b-vrstvy").setAttribute("aria-expanded", String(otevreno));
};

window.addEventListener("pointerdown", () => zvuk.spust(), { capture: true });
window.addEventListener("keydown", (e) => { if (["Space", "Enter", "NumpadEnter", "KeyM"].includes(e.code)) zvuk.spust(); }, { capture: true });

const kody = (...k) => new Set(ZEME.filter((z) => k.includes(z.kod)).map((z) => z.i));
const naKontinentu = (n) => new Set(ZEME.filter((z) => z.kontinent === n).map((z) => z.i));
const PREDVOLBY = [
  ["World", () => null],
  ["Europe", () => naKontinentu("Europe")], ["Asia", () => naKontinentu("Asia")], ["Africa", () => naKontinentu("Africa")],
  ["North America", () => naKontinentu("North America")], ["South America", () => naKontinentu("South America")],
  ["Oceania", () => naKontinentu("Oceania")],
  ["Czechia and neighbours", () => kody("CZ", "SK", "PL", "DE", "AT")], ["Visegrád Group", () => kody("CZ", "SK", "PL", "HU")],
  ["Nordic countries", () => kody("DK", "FI", "IS", "NO", "SE")], ["G7", () => kody("CA", "FR", "DE", "IT", "JP", "GB", "US")],
];
const PODOBLASTI = [...new Set(ZEME.map((z) => z.podoblast).filter(Boolean))].sort();
let vybrane = new Set(), nazevVyberu = "World", skupinaZmenena = false;

function pouzijVyber(nazev, mnozina, letet = true) {
  vybrane = new Set(mnozina ?? []);
  nazevVyberu = vybrane.size ? nazev : "World";
  nastavSkupinu(nazevVyberu, vybrane.size ? vybrane : null);
  kresliSeznamSkupin();
  if (letet) letNadSkupinu();
}
function vlastniNazev() {
  const n = [...vybrane].map(nazevOblasti);
  return n.length <= 3 ? n.join(", ") : `${n.slice(0, 2).join(", ")} and ${n.length - 2} more`;
}
$("sk-predvolby").innerHTML = PREDVOLBY.map(([n], k) => `<button type="button" class="cip" data-k="${k}">${n}</button>`).join("") +
  `<select id="sk-podoblast" class="cip" aria-label="UN subregion"><option value="">UN subregion…</option>${
    PODOBLASTI.map((n) => `<option>${n}</option>`).join("")}</select>`;
for (const el of $("sk-predvolby").querySelectorAll("button.cip")) {
  el.onclick = () => { const [n, f] = PREDVOLBY[+el.dataset.k]; pouzijVyber(n, f()); zvuk.efekt("vyber"); };
}
$("sk-podoblast").onchange = (e) => {
  const n = e.target.value;
  if (!n) return;
  pouzijVyber(n, new Set(ZEME.filter((z) => z.podoblast === n).map((z) => z.i)));
  e.target.value = "";
};
const KONTINENTY = ["Europe", "Asia", "Africa", "North America", "South America", "Oceania"];
function kresliSeznamSkupin() {
  const hledat = $("sk-hledat").value.trim().toLowerCase();
  const sedi = (s) => !hledat || s.toLowerCase().includes(hledat);
  const radek = (i, nazev, pod = "") => `<label class="sk-radek"><input type="checkbox" data-i="${i}" ${vybrane.has(i) ? "checked" : ""}>
    <span>${esc(nazev)}${pod ? ` <em>${esc(pod)}</em>` : ""}</span></label>`;
  let html = "";
  for (const k of KONTINENTY) {
    const zeme = ZEME.filter((z) => z.kontinent === k && sedi(z.nazev)).sort((a, b) => a.nazev.localeCompare(b.nazev));
    if (zeme.length) html += `<div class="sk-skupina">${k}</div>` + zeme.map((z) => radek(z.i, z.nazev)).join("");
  }
  if (hledat.length >= 2) {
    const obl = meta.oblasti.filter((o) => sedi(o.nazev)).slice(0, 40);
    if (obl.length) html += `<div class="sk-skupina">Regions</div>` + obl.map((o) => radek(o.i, o.nazev, zemePodle.get(o.zeme)?.nazev ?? "")).join("");
  }
  $("sk-seznam").innerHTML = html || `<p class="pozn-k">Nothing matches “${esc($("sk-hledat").value)}”.</p>`;
  for (const el of $("sk-seznam").querySelectorAll("input")) {
    el.onchange = () => {
      const i = +el.dataset.i;
      if (el.checked) vybrane.add(i); else vybrane.delete(i);
      nazevVyberu = vybrane.size ? vlastniNazev() : "World";
      nastavSkupinu(nazevVyberu, vybrane.size ? new Set(vybrane) : null);
      $("sk-pocet").textContent = vybrane.size ? `${vybrane.size} selected` : "World";
      skupinaZmenena = true;
      zvuk.efekt("vyber");
    };
  }
  $("sk-pocet").textContent = vybrane.size ? `${vybrane.size} selected` : "World";
  for (const el of $("sk-predvolby").querySelectorAll("button.cip")) el.classList.toggle("aktivni", el.textContent === nazevVyberu);
}
$("sk-hledat").oninput = kresliSeznamSkupin;
function prepniSkupiny(ano = $("skupiny").hidden) {
  $("skupiny").hidden = !ano;
  $("b-skupina").setAttribute("aria-expanded", String(ano));
  if (ano) { kresliSeznamSkupin(); $("sk-hledat").focus(); skryjNapovedu(); }
  else if (skupinaZmenena) { if (vybrane.size) letNadSkupinu(); else zpetNaProhlidku(); }
  skupinaZmenena = false;
}
$("b-skupina").onclick = () => prepniSkupiny();
$("sk-hotovo").onclick = () => prepniSkupiny(false);
$("sk-vymazat").onclick = () => { pouzijVyber("World", null, false); zpetNaProhlidku(); };
$("z-zavrit").onclick = () => { pouzijVyber("World", null, false); zpetNaProhlidku(); };
for (const el of document.querySelectorAll("#z-metriky button")) {
  el.onclick = () => {
    zebricekMetrika = el.dataset.m;
    zebricekKlic = null;
    for (const b of document.querySelectorAll("#z-metriky button")) b.classList.toggle("aktivni", b === el);
  };
}
document.addEventListener("pointerdown", (e) => {
  if (!$("skupiny").hidden && !$("skupiny").contains(e.target) && !$("b-skupina").contains(e.target)) prepniSkupiny(false);
  if (!$("zvuk-pop").hidden && !$("zvuk-pop").contains(e.target) && !$("b-zvuk").contains(e.target)) prepniZvukPop(false);
});

let napovedaPryc = false;
function skryjNapovedu() {
  if (napovedaPryc) return;
  napovedaPryc = true;
  $("napoveda").classList.add("skryt");
}
setTimeout(skryjNapovedu, 9000);

const ukazatele = new Map();
let tah = null, stisk = null, stipnuti = null;
function posun(dLon, dLat, kam, cil) {
  if (kam) { volna.kamera_lon -= dLon; volna.kamera_lat = omez(volna.kamera_lat + dLat, -85, 85); }
  if (cil) { volna.cil_lon -= dLon; volna.cil_lat = omez(volna.cil_lat + dLat, -85, 85); }
}
platno.addEventListener("pointerdown", (e) => {
  try { platno.setPointerCapture(e.pointerId); } catch (chybaZachyceni) {  }
  ukazatele.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ukazatele.size === 1) {
    stisk = { x: e.clientX, y: e.clientY, cas: performance.now(), pohyb: false };
    tah = { x: e.clientX, y: e.clientY, cas: performance.now(), kam: !(studio && e.ctrlKey), cil: !(studio && e.shiftKey) };
    setrv.lon = setrv.lat = 0;
  } else if (ukazatele.size === 2) {
    const [a, b] = [...ukazatele.values()];
    zacniVolnou();
    stipnuti = { d: Math.hypot(a.x - b.x, a.y - b.y), vzd: volna.cilVzd };
    tah = null; stisk = null;
  }
});
platno.addEventListener("pointermove", (e) => {
  if (!ukazatele.has(e.pointerId)) return;
  ukazatele.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (stipnuti && ukazatele.size === 2) {
    const [a, b] = [...ukazatele.values()];
    volna.cilVzd = omez(stipnuti.vzd * (stipnuti.d / Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)), 1.3, 9);
    return;
  }
  if (!tah) return;
  if (stisk && !stisk.pohyb) {
    if (Math.hypot(e.clientX - stisk.x, e.clientY - stisk.y) < 5) return;
    stisk.pohyb = true;
    zacniVolnou();
    $("ramec").classList.add("tahne");
  }
  const k = (55 * Math.max(volna.kamera_vzdalenost - 1, 0.3)) / vyskaR;
  const dLon = (e.clientX - tah.x) * k, dLat = (e.clientY - tah.y) * k;
  const ted = performance.now(), dt = Math.max((ted - tah.cas) / 1000, 0.004);
  posun(dLon, dLat, tah.kam, tah.cil);
  setrv.lon = omez(setrv.lon * 0.6 + (dLon / dt) * 0.4, -120, 120);
  setrv.lat = omez(setrv.lat * 0.6 + (dLat / dt) * 0.4, -120, 120);
  setrv.kam = tah.kam; setrv.cil = tah.cil;
  tah.x = e.clientX; tah.y = e.clientY; tah.cas = ted;
});
function pust(e) {
  ukazatele.delete(e.pointerId);
  if (stisk && !stisk.pohyb && e.type === "pointerup" && performance.now() - stisk.cas < 500) klik(e);
  if (tah && performance.now() - tah.cas > 80) setrv.lon = setrv.lat = 0;
  if (ukazatele.size < 2) stipnuti = null;
  if (ukazatele.size === 0) { tah = null; stisk = null; $("ramec").classList.remove("tahne"); }
}
platno.addEventListener("pointerup", pust);
platno.addEventListener("pointercancel", pust);
platno.addEventListener("wheel", (e) => {
  e.preventDefault();
  zacniVolnou();
  if (studio && e.altKey) volna.ohnisko_mm = omez(volna.ohnisko_mm - Math.sign(e.deltaY) * 2, 14, 120);
  else volna.cilVzd = omez(volna.cilVzd * Math.exp(omez(e.deltaY, -120, 120) * 0.0016), 1.3, 9);
}, { passive: false });

const paprsek = new THREE.Raycaster(), ndc = new THREE.Vector2();
function klik(e) {
  const r = platno.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  paprsek.setFromCamera(ndc, kamera);
  const zasah = paprsek.intersectObject(zemeMesh, false)[0];
  if (!zasah) { zavriKartu(); return; }
  const { idx, pevnina } = ctiOblast(zasah.uv);
  const n = zasah.point.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(n.y)), lon = THREE.MathUtils.radToDeg(Math.atan2(-n.z, n.x));
  if (!idx || (!zemePodle.has(idx) && !oblastPodle.has(idx))) {
    if (pevnina) otevriKartu(0, lat, lon); else zavriKartu();
    return;
  }

  if (vyber && vyber.idx >= 256 && idx >= 256 && rodic(vyber.idx) === rodic(idx)) {
    if (vyber.zeme) { vyber.idx = idx; vyber.zeme = false; } else vyber.zeme = true;
    kartaKlic = null;
    kresliGrafKarty();
    zvuk.efekt("vyber");
    return;
  }
  otevriKartu(idx, lat, lon);
}

const MISTNI = false;
$("l-cas").hidden = true;
function prepniStudio() {}
function vyplnStudio() {}
function vyplnPole() {}
function ulozBod() {}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !$("skupiny").hidden) { prepniSkupiny(false); $("b-skupina").focus(); return; }
  if (e.code === "Escape" && !$("info").hidden) { prepniInfo(false); $("b-info").focus(); return; }
  if (e.code === "Escape" && !$("hledat-pop").hidden) { prepniHledani(false); $("b-hledat").focus(); return; }
  if (e.code === "Escape" && !$("zvuk-pop").hidden) { prepniZvukPop(false); $("b-zvuk").focus(); return; }
  if (e.code === "Escape" && !$("fakta").hidden) { prepniFakta(false); return; }
  if (e.code === "Escape" && souhrn && !vyber) { vypniSouhrn(); $("b-hrat").focus(); return; }
  if (e.code === "Escape" && (!$("uvod-karta").hidden || !$("konec-karta").hidden)) { skryjKarty(); return; }

  if (e.code === "KeyM" && (e.target.type === "range" || !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName))) {
    zvuk.prepniZtlumeni(); kresliZvuk(); kresliZvukKarty(); return;
  }
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.code === "KeyI") { prepniInfo(); return; }
  if (e.code === "Space" && e.target.tagName !== "BUTTON") { e.preventDefault(); prepniHrani(); }
  else if (e.code === "ArrowRight") krokTydne(e.shiftKey ? 4 : 1);
  else if (e.code === "ArrowLeft") krokTydne(e.shiftKey ? -4 : -1);
  else if (e.code === "Slash") { e.preventDefault(); prepniHledani(true); }
  else if (e.code === "KeyF") celaObrazovka();
  else if (e.code === "KeyK" && studio) ulozBod();
  else if (e.code === "Escape") { if (vyber) zavriKartu(); else zpetNaProhlidku(); }
});

let zacatek = null;
try { const r = await fetch("draha.json"); if (r.ok) zacatek = await r.json(); } catch (e) {  }
if (zacatek?.verze !== 2 && MISTNI) { try { zacatek = JSON.parse(localStorage.getItem(ULOZISTE)); } catch (e) { zacatek = null; } }
if (zacatek?.verze !== 2 || !zacatek.draha) zacatek = vychoziNastaveni();
delete zacatek.pozice_tydnu;
nactiNastaveni(zacatek);
prepniHrani(false);

if (!ctiOdkaz()) { $("uvod-karta").hidden = false; kresliZvukKarty(); $("u-hrat").focus({ preventScroll: true }); }
velikost();
requestAnimationFrame((ted) => { posledni = ted; smycka(ted); });
setTimeout(() => $("nacitani").classList.add("hotovo"), 150);
setTimeout(() => $("nacitani").remove(), 1300);

if (MISTNI || new URLSearchParams(location.search).has("ladeni")) window.__prostredi = { get t() { return t; }, set t(x) { t = x; }, get nast() { return nast; }, get delka() { return delka; },
  get volna() { return volna; }, get vyber() { return vyber; }, get hraje() { return hraje; }, prepniHrani, renderer, kamera,
  matZeme, scene, composer, snimek, ctiOblast, otevriKartu, zpetNaProhlidku, prepniStudio, ZASTAVKY, pozice: () => pozice,
  zvuk, get skupina() { return skupina; }, get vlny() { return vlny; }, vrstvy, nastavVrstvu, cilVrstev, UD, ukazUdalost, projdiUdalosti, ukazKonec, prepniHledani, vyberMisto, odkaz, smycka };
