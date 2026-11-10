

const NOTA = (n) => 440 * Math.pow(2, (n - 69) / 12);

const AKORDY = [[50, 57, 64, 65], [46, 53, 57, 62], [48, 55, 57, 64], [50, 55, 58, 69]];
const NAPJATE = [[50, 57, 63, 65], [46, 53, 57, 59], [48, 55, 56, 63], [50, 55, 58, 63]];

const ZAVER = [50, 57, 62, 64];

export function vytvorZvuk() {
  let ctx = null, hlavni, hudba, efekty, filtrPlochy, filtrBordun, bordunZisk, hlasy = [], sum;
  let ztlumeno = false, hraje = false, intenzita = 0, konec = false;
  let akord = 0, dalsiAkord = 0, dalsiTep = 0, dalsiZvon = 0;
  try { ztlumeno = localStorage.getItem("covid-zvuk-ztlumeno") === "1"; } catch (e) {  }

  function dozvuk(delka = 4.5, utlum = 2.6) {
    const n = Math.floor(ctx.sampleRate * delka), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let k = 0; k < 2; k++) {
      const d = b.getChannelData(k);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, utlum);
    }
    const c = ctx.createConvolver();
    c.buffer = b;
    return c;
  }

  function spust() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const komp = ctx.createDynamicsCompressor();
    komp.threshold.value = -18; komp.ratio.value = 3;
    hlavni = ctx.createGain();
    hlavni.gain.value = ztlumeno ? 0 : 0.8;
    komp.connect(hlavni).connect(ctx.destination);
    const ozvena = dozvuk();
    const mokry = ctx.createGain();
    mokry.gain.value = 0.6;
    ozvena.connect(mokry).connect(komp);
    hudba = ctx.createGain(); hudba.gain.value = 0;
    hudba.connect(komp); hudba.connect(ozvena);
    efekty = ctx.createGain(); efekty.gain.value = 0.9;
    efekty.connect(komp); efekty.connect(ozvena);

    filtrBordun = ctx.createBiquadFilter();
    filtrBordun.type = "lowpass"; filtrBordun.frequency.value = 220; filtrBordun.Q.value = 0.7;
    bordunZisk = ctx.createGain(); bordunZisk.gain.value = 0.05;
    filtrBordun.connect(bordunZisk).connect(hudba);
    for (const [n, lad] of [[26, -6], [38, 5], [45, -3]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth"; o.frequency.value = NOTA(n); o.detune.value = lad;
      const g = ctx.createGain(); g.gain.value = n === 45 ? 0.35 : 0.6;
      o.connect(g).connect(filtrBordun);
      o.start();
    }

    filtrPlochy = ctx.createBiquadFilter();
    filtrPlochy.type = "lowpass"; filtrPlochy.frequency.value = 1400; filtrPlochy.Q.value = 0.5;
    filtrPlochy.connect(hudba);
    hlasy = AKORDY[0].map((n) => {
      const g = ctx.createGain(); g.gain.value = 0.045;
      g.connect(filtrPlochy);
      const osc = [-7, 7].map((lad) => {
        const o = ctx.createOscillator();
        o.type = "triangle"; o.frequency.value = NOTA(n); o.detune.value = lad;
        o.connect(g); o.start();
        return o;
      });
      return { g, osc };
    });

    sum = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = sum.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    dalsiAkord = ctx.currentTime + 0.5;
  }

  function nastavAkord(noty, cas) {
    hlasy.forEach((h, i) => h.osc.forEach((o) => o.frequency.setTargetAtTime(NOTA(noty[i]), cas, 1.2)));
  }

  function tep(cas, sila) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(72, cas);
    o.frequency.exponentialRampToValueAtTime(42, cas + 0.25);
    g.gain.setValueAtTime(0.0001, cas);
    g.gain.exponentialRampToValueAtTime(0.18 * sila + 0.0001, cas + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, cas + 0.6);
    o.connect(g).connect(hudba);
    o.start(cas); o.stop(cas + 0.7);
  }

  function zvon(cas, n, sila = 0.05) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = NOTA(n);
    g.gain.setValueAtTime(0.0001, cas);
    g.gain.exponentialRampToValueAtTime(sila, cas + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, cas + 3.2);
    o.connect(g).connect(hudba);
    o.start(cas); o.stop(cas + 3.4);
  }

  function sumovyOblouk(cas, delka, f0, f1, f2, sila, cil) {
    const s = ctx.createBufferSource(); s.buffer = sum; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, cas);
    f.frequency.exponentialRampToValueAtTime(f1, cas + delka * 0.45);
    f.frequency.exponentialRampToValueAtTime(f2, cas + delka);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, cas);
    g.gain.exponentialRampToValueAtTime(sila, cas + delka * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, cas + delka);
    s.connect(f).connect(g).connect(cil);
    s.start(cas); s.stop(cas + delka + 0.05);
  }

  function krok(i, hrajeTed, naKonci) {
    if (!ctx) return;
    intenzita += (i - intenzita) * 0.03;
    const ted = ctx.currentTime;
    if (hrajeTed !== hraje) {
      hraje = hrajeTed;
      hudba.gain.setTargetAtTime(hraje ? 0.9 : 0, ted, hraje ? 0.8 : 0.5);
    }
    if (naKonci !== konec) {
      konec = naKonci;
      if (konec) nastavAkord(ZAVER, ted);
    }
    filtrPlochy.frequency.setTargetAtTime(2200 - 1500 * intenzita, ted, 0.5);
    filtrBordun.frequency.setTargetAtTime(160 + 380 * intenzita, ted, 0.5);
    bordunZisk.gain.setTargetAtTime(0.035 + 0.07 * intenzita, ted, 0.5);
    if (!hraje) return;
    if (!konec && ted >= dalsiAkord) {
      akord = (akord + 1) % AKORDY.length;
      nastavAkord(intenzita > 0.55 ? NAPJATE[akord] : AKORDY[akord], ted);
      dalsiAkord = ted + 7.5;
    }
    if (intenzita > 0.18 && !konec && ted >= dalsiTep) {
      tep(ted + 0.02, Math.min(1, (intenzita - 0.18) * 1.4));
      dalsiTep = ted + 1.35 - 0.45 * intenzita;
    }
    if ((intenzita < 0.35 || konec) && ted >= dalsiZvon) {
      const noty = konec ? ZAVER : AKORDY[akord];
      zvon(ted, noty[Math.floor(Math.random() * 4)] + 24, konec ? 0.04 : 0.03);
      dalsiZvon = ted + 2.5 + Math.random() * 4;
    }
  }

  function efekt(typ) {
    if (!ctx || ztlumeno) return;
    const ted = ctx.currentTime;
    if (typ === "vlna") {
      sumovyOblouk(ted, 4.5, 140, 520, 180, 0.12, efekty);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(36.7, ted);
      o.frequency.linearRampToValueAtTime(55, ted + 2.5);
      g.gain.setValueAtTime(0.0001, ted);
      g.gain.exponentialRampToValueAtTime(0.22, ted + 1.8);
      g.gain.exponentialRampToValueAtTime(0.0001, ted + 4.8);
      o.connect(g).connect(efekty);
      o.start(ted); o.stop(ted + 5);
    } else if (typ === "let") {
      sumovyOblouk(ted, 1.1, 300, 1600, 500, 0.06, efekty);
    } else {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      const f = typ === "zavrit" ? 620 : typ === "vyber" ? 980 : 1240;
      o.frequency.setValueAtTime(f, ted);
      o.frequency.exponentialRampToValueAtTime(f * 0.75, ted + 0.08);
      g.gain.setValueAtTime(0.0001, ted);
      g.gain.exponentialRampToValueAtTime(0.05, ted + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, ted + 0.12);
      o.connect(g).connect(efekty);
      o.start(ted); o.stop(ted + 0.15);
    }
  }

  function prepniZtlumeni(ano = !ztlumeno) {
    ztlumeno = ano;
    try { localStorage.setItem("covid-zvuk-ztlumeno", ztlumeno ? "1" : "0"); } catch (e) {  }
    if (ctx) hlavni.gain.setTargetAtTime(ztlumeno ? 0 : 0.8, ctx.currentTime, 0.15);
    return ztlumeno;
  }

  return { spust, krok, efekt, prepniZtlumeni, get ztlumeno() { return ztlumeno; }, get bezi() { return !!ctx; } };
}

export function zacatkyVln(rada) {
  const T = rada.length, s = rada.map((_, w) => {
    let a = 0, v = 0;
    for (let k = -2; k <= 2; k++) { const j = w + k; if (j >= 0 && j < T) { const g = Math.exp(-(k * k) / 4.5); a += g * rada[j]; v += g; } }
    return a / v;
  });
  const max = Math.max(...s) || 1, out = [];

  const nastup = s.findIndex((x) => x >= 0.08 * max);
  if (nastup >= 0) out.push(nastup);
  for (let w = 1; w < T - 6; w++) {
    if (w <= nastup) continue;
    let minimum = true;
    for (let k = -3; k <= 3; k++) if (k && w + k >= 0 && w + k < T && s[w + k] < s[w]) minimum = false;
    if (!minimum) continue;
    const vrchol = Math.max(...s.slice(w + 1, w + 7));
    if (vrchol >= s[w] * 1.5 && vrchol - s[w] >= 0.08 * max && (!out.length || w - out[out.length - 1] >= 8)) out.push(w + 1);
  }
  return out;
}
