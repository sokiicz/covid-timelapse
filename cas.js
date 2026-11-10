

import * as THREE from "three";
import { lonlat } from "./globus.js";

export const FPS = 30;
export const START = -5 / 7;
const ZACATEK = Date.UTC(2020, 0, 5);
const DEN = 86400000;
export const KLICE = ["kamera_lat", "kamera_lon", "kamera_vzdalenost", "cil_lat", "cil_lon", "cil_r", "ohnisko_mm", "hodina"];

export const hladky = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };

export function datumTydne(p) { return new Date(ZACATEK + p * 7 * DEN); }
export function tydenData(iso) { return (Date.parse(iso + "T00:00:00Z") - ZACATEK) / (7 * DEN); }

const MESICE = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                "October", "November", "December"];
export function datumEn(d) { return `${d.getUTCDate()} ${MESICE[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function datumIso(d) { return d.toISOString().slice(0, 10); }

export function deklinace(d) {
  const n = (d.getTime() - Date.UTC(2000, 0, 1, 12)) / DEN;
  const g = THREE.MathUtils.degToRad((357.529 + 0.98560028 * n) % 360);
  const q = (280.459 + 0.98564736 * n) % 360;
  const L = THREE.MathUtils.degToRad((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360);
  const e = THREE.MathUtils.degToRad(23.439 - 0.00000036 * n);
  return THREE.MathUtils.radToDeg(Math.asin(Math.sin(e) * Math.sin(L)));
}

function tempoFunkce(tempo) {
  let i = 0;
  return (p) => {
    if (p <= tempo[0].tyden) return tempo[0].s;
    while (i < tempo.length - 2 && p > tempo[i + 1].tyden) i++;
    const a = tempo[i], b = tempo[i + 1];
    if (!b || p > b.tyden) return tempo[tempo.length - 1].s;
    return a.s + (b.s - a.s) * hladky((p - a.tyden) / Math.max(b.tyden - a.tyden, 1e-6));
  };
}

export function poziceTydnu(nastaveni, T) {
  const { tempo, uvod_s, zaver_s } = nastaveni;
  const sekundNaTyden = tempoFunkce(tempo);
  const uvod = Math.round(uvod_s * FPS);
  const konec = T - 1;
  const out = [];
  let p = START, f = 1;
  while (p < konec && out.length < 60 * 60 * FPS) {
    out.push(p);
    const rozjezd = hladky((f - (uvod - 20)) / 50);
    p += rozjezd / (FPS * sekundNaTyden(p));
    f++;
  }
  out.push(konec);
  for (let i = 0; i < Math.round(zaver_s * FPS); i++) out.push(konec);
  return out;
}

export function casTydne(pozice, p) {

  for (let i = 0; i < pozice.length; i++) if (pozice[i] >= p) return i / FPS;
  return (pozice.length - 1) / FPS;
}

export function catmullRom(body, t) {
  const n = body.length;
  if (t <= body[0][0]) return body[0][1];
  if (t >= body[n - 1][0]) return body[n - 1][1];
  let i = 0;
  while (i < n - 2 && body[i + 1][0] <= t) i++;
  const p0 = body[Math.max(i - 1, 0)][1], p1 = body[i][1], p2 = body[i + 1][1], p3 = body[Math.min(i + 2, n - 1)][1];
  let u = (t - body[i][0]) / (body[i + 1][0] - body[i][0]);
  if (n === 2) u = u * u * (3 - 2 * u);
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

export function bodDrahy(draha, s) {
  const p = {};
  if (draha.length === 1) { for (const k of KLICE) p[k] = draha[0][k]; return p; }
  for (const k of KLICE) p[k] = catmullRom(draha.map((b) => [b.s, b[k] ?? 16]), s);
  return p;
}

export function pohled(p) {
  const cam = lonlat(p.kamera_lon, p.kamera_lat, p.kamera_vzdalenost);
  const cil = lonlat(p.cil_lon, p.cil_lat, p.cil_r);
  const smer = cil.clone().sub(cam).normalize();
  const camN = cam.clone().normalize();
  const odklon = THREE.MathUtils.radToDeg(smer.angleTo(camN.clone().negate()));
  const w = Math.min(Math.max((odklon - 5) / 20, 0), 1);
  const svislice = camN.clone().multiplyScalar(w).add(new THREE.Vector3(0, w === 1 ? 0 : 1 - w, 0)).normalize();
  const vpravo = smer.clone().cross(svislice).normalize();
  const nahoru = vpravo.clone().cross(smer).normalize();
  const m = new THREE.Matrix4().makeBasis(vpravo, nahoru, smer.clone().negate());
  return { cam, quat: new THREE.Quaternion().setFromRotationMatrix(m), vpravo, nahoru, smer };
}

export function smerSlunce(rezim, p, datum, v) {
  if (rezim === "kamera") {
    return v.vpravo.clone().multiplyScalar(0.35).add(v.nahoru.clone().multiplyScalar(0.2)).add(v.smer.clone()).normalize();
  }
  const w = Math.min(Math.max(p.cil_r / 0.5, 0), 1);
  const lonMisto = p.kamera_lon + (p.cil_lon - p.kamera_lon) * w;
  return lonlat(lonMisto - (p.hodina - 12) * 15, deklinace(datum), 1).normalize();
}

export const KONEC_TYDNU = 12;
const ZAVER_S_NA_TYDEN = 1.3;

export function tvarTempa(umrti, sila) {
  const T = umrti.length, sigma = 1.5;
  const hladke = umrti.map((_, w) => {
    let s = 0, v = 0;
    for (let k = -4; k <= 4; k++) {
      const j = w + k;
      if (j < 0 || j >= T) continue;
      const g = Math.exp(-(k * k) / (2 * sigma * sigma));
      s += g * umrti[j]; v += g;
    }
    return s / v;
  });
  const max = Math.max(...hladke) || 1;
  return hladke.map((x) => 1 + 4 * sila * Math.pow(x / max, 0.6));
}

function podlahaUvodu(w) {
  if (w <= 8) return 2.0;
  if (w <= 12) return 2.0 - 0.6 * hladky((w - 8) / 4);
  if (w <= 26) return 1.4;
  return 1.4 * (1 - hladky((w - 26) / 14));
}

export function autoTempo(tvar, k, minima = null) {
  const T = tvar.length;
  const out = [];
  for (let w = 0; w < T; w++) {
    let s = Math.max(k * tvar[w], podlahaUvodu(w), minima?.[w] ?? 0);
    const z = hladky((w - (T - 1 - KONEC_TYDNU - 4)) / 4);
    s += (Math.max(s, ZAVER_S_NA_TYDEN) - s) * z;
    out.push({ tyden: w, s: +s.toFixed(4) });
  }
  out.unshift({ tyden: START, s: out[0].s });
  return out;
}

const naZapad = (od, lon) => (((od - lon) % 360) + 360) % 360;

export function vychozi(zastavky = [], datumy = []) {
  const tempo = [
    { tyden: START, s: 2.0 },
    { tyden: 8, s: 2.0 },
    { tyden: 10, s: 1.4 },
    { tyden: 156, s: 1.4 },
    { tyden: 165, s: 0.7 },
    { tyden: 210, s: 0.25 },
    { tyden: 354, s: 0.25 },
  ];

  const B = (datum, kl, klo, kd, cl, clo, cr, f = 35, h = 18.5) => ({
    datum, kamera_lat: kl, kamera_lon: klo, kamera_vzdalenost: kd, cil_lat: cl, cil_lon: clo, cil_r: cr, ohnisko_mm: f, hodina: h });
  const draha = [
    B("uvod", 18, 96, 4.6, 26, 106, 0.0),
    B("uvod_konec", 19, 101, 4.3, 27, 110, 0.0),
    B("2020-01-26", 20, 108, 3.4, 30, 112, 0.3),
    B("2020-02-16", 18, 112, 2.8, 31, 113, 0.6),
    B("2020-03-01", 30, 72, 3.2, 36, 56, 0.4),
    B("2020-03-22", 30, 16, 2.7, 47, 11, 0.7),
    B("2020-04-19", 32, -22, 3.1, 42, -22, 0.5),
    B("2020-05-17", 28, -82, 3.0, 37, -92, 0.5),
    B("2020-07-19", 4, -72, 3.4, 8, -70, 0.3),
    B("2020-09-13", 14, 78, 3.2, 22, 78, 0.4),
    B("2020-11-08", 33, 16, 2.9, 48, 12, 0.6),
    B("2021-01-10", 35, -38, 3.5, 42, -48, 0.4),
    B("2021-03-28", -10, -50, 3.1, -12, -52, 0.5),
    B("2021-05-09", 17, 82, 2.9, 23, 79, 0.6),
    B("2021-07-25", -2, 110, 3.1, 0, 113, 0.5),
    B("2022-01-02", 35, -20, 4.0, 40, -25, 0.0),
    B("2022-03-20", 25, 124, 3.3, 34, 123, 0.5),
    B("2022-12-25", 22, 112, 3.1, 32, 112, 0.5),
    B("2023-07-02", 20, 40, 4.2, 20, 30, 0.0),
    B("2024-07-07", 24, -40, 4.4, 24, -50, 0.0),
    B("2025-07-06", 20, -150, 4.5, 20, -160, 0.0),
  ];

  let lon = -150;
  const zbyva = [...zastavky], poradi = [];
  while (zbyva.length) {
    zbyva.sort((a, b) => naZapad(lon, a.lon) - naZapad(lon, b.lon));
    const z = zbyva.shift();
    lon -= naZapad(lon, z.lon);
    poradi.push({ ...z, lonU: lon });
  }
  poradi.forEach((z, j) => draha.push(B(datumy[j], z.lat - 12, z.lonU + 4, 2.9, z.lat, z.lonU, 0.6)));
  const posl = poradi[poradi.length - 1];
  draha.push(posl ? B("konec", posl.lat - 4, posl.lonU - 22, 4.8, posl.lat, posl.lonU - 28, 0.0)
                  : B("konec", 18, -210, 4.8, 18, -220, 0.0));
  return { verze: 2, uvod_s: 4, zaver_s: 6, slunce: "rocni", tempo_rezim: "auto", auto: { delka_s: 300, sila: 1 },
           tempo_rucni: tempo, tempo: tempo.map((x) => ({ ...x })), draha };
}

export function casyBodu(nast, pozice) {
  const delka = (pozice.length - 1) / FPS;
  for (const b of nast.draha) {
    if (b.datum === "uvod") b.s = 0;
    else if (b.datum === "uvod_konec") b.s = nast.uvod_s;
    else if (b.datum === "konec") b.s = delka;
    else if (b.datum) b.s = casTydne(pozice, tydenData(b.datum));
  }
  nast.draha.sort((a, b) => a.s - b.s);
}
