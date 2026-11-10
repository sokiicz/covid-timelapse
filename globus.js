

import * as THREE from "three";

export function lonlat(lon, lat, r = 1) {
  const lo = THREE.MathUtils.degToRad(lon), la = THREE.MathUtils.degToRad(lat);
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

const GLSL_UV =  `
vec2 uvHvezdy(vec3 p) {
  vec3 s = normalize(p);
  return vec2(atan(s.z, s.x) / 6.28318530718 + 0.5, asin(clamp(s.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
}`;

const GLSL_RAMPA =  `
vec3 rampaZar(float t) {
  const int N = 7;
  float p[7] = float[7](0.0, 0.064, 0.22, 0.43, 0.64, 0.85, 1.0);
  vec3 c[7] = vec3[7](vec3(0.0), vec3(0.05, 0.0, 0.002), vec3(0.2, 0.003, 0.004), vec3(0.6, 0.015, 0.012),
                      vec3(1.0, 0.04, 0.02), vec3(1.0, 0.13, 0.05), vec3(1.0, 0.3, 0.12));
  t = clamp(t, 0.0, 1.0);
  for (int i = 0; i < N - 1; i++) {
    if (t <= p[i + 1]) return mix(c[i], c[i + 1], (t - p[i]) / (p[i + 1] - p[i]));
  }
  return c[N - 1];
}
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sum3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

export function materialZeme(tex, dataTex, T, sirka) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDen: { value: tex.den }, tNoc: { value: tex.noc }, tId: { value: tex.id }, tMasky: { value: tex.masky },
      tHustota: { value: tex.hustota }, tData: { value: dataTex },
      uRadek: { value: 0 }, uT: { value: T }, uSirka: { value: sirka },
      uSlunce: { value: new THREE.Vector3(1, 0, 0) }, uCas: { value: 0 },
      uSvetlo: { value: 4.5 }, uOkoli: { value: 0.09 },

      uVyber: { value: -1 }, uVyberZeme: { value: 0 }, uPuls: { value: 0 },
      uSkupina: { value: 0 }, uSkLog: { value: new THREE.Vector2(0, 4.7) }, tInfo: { value: tex.info },

      tVrstvy: { value: tex.vrstvy }, uVrstvy: { value: new THREE.Vector4(1, 0, 0, 1) }, uTecky: { value: 1 },
    },
    vertexShader:  `
      varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main() {
        vObj = position; vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader:  `
      precision highp float;
      uniform sampler2D tDen, tNoc, tId, tMasky, tHustota, tData, tInfo, tVrstvy;
      uniform float uRadek, uT, uSirka, uCas, uSvetlo, uOkoli, uVyber, uVyberZeme, uPuls, uSkupina, uTecky;
      uniform vec2 uSkLog;
      uniform vec4 uVrstvy;
      uniform vec3 uSlunce;
      varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      ${GLSL_RAMPA}
      vec4 data(int idx) {
        float poz = clamp(uRadek, 0.0, uT - 1.0);
        int t0 = int(floor(poz)); int t1 = min(t0 + 1, int(uT) - 1);
        return mix(texelFetch(tData, ivec2(idx, t0), 0), texelFetch(tData, ivec2(idx, t1), 0), fract(poz));
      }
      vec4 vrstvy(int idx) {
        float poz = clamp(uRadek, 0.0, uT - 1.0);
        int t0 = int(floor(poz)); int t1 = min(t0 + 1, int(uT) - 1);
        vec4 a = texelFetch(tVrstvy, ivec2(idx, t0), 0), b = texelFetch(tVrstvy, ivec2(idx, t1), 0);

        return vec4(min(a.r, b.r) < 0.0 ? (fract(poz) < 0.5 ? a.r : b.r) : mix(a.r, b.r, fract(poz)),
                    min(a.g, b.g) < 0.0 ? (fract(poz) < 0.5 ? a.g : b.g) : mix(a.g, b.g, fract(poz)), 0.0, 0.0);
      }

      vec3 rampaOck(float x) {
        vec3 c0 = vec3(0.01, 0.04, 0.05), c1 = vec3(0.02, 0.22, 0.26), c2 = vec3(0.04, 0.55, 0.56), c3 = vec3(0.42, 0.95, 0.82);
        return x < 0.25 ? mix(c0, c1, x / 0.25) : x < 0.6 ? mix(c1, c2, (x - 0.25) / 0.35) : mix(c2, c3, min((x - 0.6) / 0.3, 1.0));
      }
      int idZ(vec4 c) { return int(round(c.r * 255.0) + 256.0 * round(c.g * 255.0)); }

      float klicVyberu(int i) { return i <= 0 ? -1.0 : (uVyberZeme > 0.5 ? texelFetch(tInfo, ivec2(i, 0), 0).r : float(i)); }
      void main() {
        vec2 uv = vUv;
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec4 idc = texture2D(tId, uv);
        int idx = idZ(idc);
        float jeZeme = idx > 0 ? 1.0 : 0.0;
        vec4 d = idx > 0 ? data(idx) : vec4(0.0);
        vec4 info = idx > 0 ? texelFetch(tInfo, ivec2(idx, 0), 0) : vec4(0.0);
        vec4 vr = idx > 0 ? vrstvy(idx) : vec4(-1.0);
        float pripady = d.r * jeZeme * uVrstvy.x, nehlasi = d.b * jeZeme * uVrstvy.w;

        float opatreni = smoothstep(0.3, 0.95, max(vr.g, 0.0)) * jeZeme * uVrstvy.z;
        float ockovani = clamp(vr.r, 0.0, 1.0), maOck = (vr.r >= 0.0 ? 1.0 : 0.0) * jeZeme * uVrstvy.y;
        vec3 masky = texture2D(tMasky, uv).rgb;

        float bezDat = (idx > 0 ? info.g : step(0.5, masky.b)) * uTecky;

        float mimo = 0.0;
        if (uSkupina > 0.5) {
          mimo = idx > 0 ? 1.0 - info.b : step(0.5, masky.b);
          pripady = clamp((d.r * 4.7 - uSkLog.x) / max(uSkLog.y - uSkLog.x, 0.1), 0.0, 1.0) * jeZeme * (1.0 - mimo) * uVrstvy.x;
          opatreni *= 1.0 - mimo; maOck *= 1.0 - mimo;
        }
        float lDot = dot(N, uSlunce);
        float nocF = clamp((0.12 - lDot) * 4.0, 0.0, 1.0);

        vec3 den = texture2D(tDen, uv).rgb;
        float seda = dot(den, vec3(0.2126, 0.7152, 0.0722));
        den = mix(den, vec3(seda), nehlasi * 0.85);
        den = mix(den, vec3(seda) * 0.75, bezDat * 0.85);
        float drsnost = 0.32 + masky.b * 0.55;
        vec3 H = normalize(uSlunce + V);

        float lesk = pow(max(dot(N, H), 0.0), 60.0) * (1.0 - masky.b) * 0.05;
        vec3 slunceBarva = vec3(1.0, 0.96, 0.9) * uSvetlo;
        vec3 povrch = den * slunceBarva * max(lDot, 0.0) / 3.14159 + slunceBarva * lesk * max(lDot, 0.0)
                    + den * uOkoli * vec3(0.55, 0.72, 1.0);

        vec3 noc = texture2D(tNoc, uv).rgb * vec3(0.85, 0.9, 1.0);
        vec3 mesta = noc * noc * nocF * 2.5;

        float chveni = 0.8 + 0.4 * sum3(vObj * 45.0 + vec3(uCas * 0.6));
        float hust = texture2D(tHustota, uv).r;
        float osidleni = 0.12 + pow(hust, 1.4) * 1.8;
        vec3 zar = rampaZar(pripady) * pow(pripady, 1.6) * 3.4 * chveni * osidleni;

        povrch *= 1.0 - 0.72 * uVrstvy.y;
        mesta *= 1.0 - 0.8 * uVrstvy.y;
        vec3 ockVypln = rampaOck(ockovani) * (0.3 + 0.9 * ockovani) * maOck;

        float hran = (masky.r * (0.08 + opatreni * 2.5) + masky.g * (0.05 + opatreni * 0.3)) * jeZeme;
        vec3 hranice = vec3(0.35, 0.62, 1.0) * hran;
        vec3 opatreniVypln = vec3(0.25, 0.45, 1.0) * pow(opatreni, 1.5) * 0.28;

        float jeVyber = (uVyber > 0.0 && abs(klicVyberu(idx) - uVyber) < 0.5) ? 1.0 : 0.0;
        if (uVyber > 0.0 && jeVyber < 0.5) { zar *= 0.8; ockVypln *= 0.8; }
        if (jeVyber > 0.5) {
          vec2 o = fwidth(uv) * 2.2;
          o.x = min(o.x, 0.01);
          float okraj = 0.0;
          vec2 smery[4] = vec2[4](vec2(o.x, 0.0), vec2(-o.x, 0.0), vec2(0.0, o.y), vec2(0.0, -o.y));
          for (int k = 0; k < 4; k++) {
            vec4 c = texture2D(tId, uv + smery[k]);
            okraj += abs(klicVyberu(idZ(c)) - uVyber) > 0.5 ? 0.25 : 0.0;
          }
          hranice += vec3(0.6, 0.82, 1.0) * (min(okraj * 2.0, 1.0) * 3.0 + 0.07 + 0.035 * sin(uPuls * 3.0));
        }

        float faze = (uv.x + uv.y) * 9000.0;
        float fw = min(fwidth(faze), 10.0);
        float vlna = 0.5 + 0.5 * sin(faze - 1.5708);
        float pruh = smoothstep(0.75 - fw * 0.08, 0.75 + fw * 0.08, vlna);
        pruh = mix(0.333, pruh, clamp((2.5 - fw) / 1.5, 0.0, 1.0));
        vec3 popel = vec3(0.5, 0.52, 0.55) * pruh * nehlasi * 0.25;

        vec2 q = uv * vec2(2400.0, 1200.0);
        float fq = min(max(fwidth(q.x), fwidth(q.y)), 4.0);
        float tecka = 1.0 - smoothstep(0.2 - fq * 0.5, 0.2 + fq * 0.5, length(fract(q) - 0.5));
        tecka = mix(0.126, tecka, clamp((0.45 - fq) / 0.25, 0.0, 1.0));
        vec3 tecky = vec3(0.6, 0.63, 0.68) * tecka * bezDat * 0.35;

        float facing = 1.0 - abs(dot(N, V));
        vec3 opar = vec3(0.25, 0.5, 1.0) * pow(facing, 3.0) * clamp(lDot + 0.25, 0.0, 1.0) * 1.6;

        vec3 zeme = povrch + mesta + zar + popel + tecky + ockVypln + opatreniVypln;
        if (mimo > 0.5) zeme = mix(zeme, vec3(dot(zeme, vec3(0.2126, 0.7152, 0.0722))) * 0.45, 0.85);
        gl_FragColor = vec4(zeme + hranice + opar, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function materialAtmosfera(polomer) {
  return new THREE.ShaderMaterial({
    uniforms: { uSlunce: { value: new THREE.Vector3(1, 0, 0) }, uPolomer: { value: polomer } },
    vertexShader:  `
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader:  `
      uniform vec3 uSlunce; uniform float uPolomer;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        vec3 I = normalize(cameraPosition - vW);
        float c = abs(dot(N, I));
        float s = sqrt(max(1.0 - c * c, 0.0));
        float h = s * uPolomer - 1.0;
        float zare = exp(max(h, 0.0) / -0.0055) * exp(min(h, 0.0) / 0.035);
        float l = dot(N, uSlunce);
        float strana = 0.05 + clamp((l + 0.3) * 1.5, 0.0, 1.0);
        vec3 barva = mix(vec3(1.0, 0.42, 0.12), vec3(0.28, 0.52, 1.0), clamp(l * 3.0 + 0.35, 0.0, 1.0));
        gl_FragColor = vec4(barva * zare * strana * 3.5, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function sloupy(pocet) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 8, true);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader:  `
      varying float vF;
      void main() {
        vF = position.y;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader:  `
      varying float vF;
      void main() {
        float f = clamp(vF, 0.0, 1.0);
        vec3 barva = f < 0.4 ? mix(vec3(1.0, 0.97, 0.92), vec3(0.95, 0.96, 1.0), f / 0.4)
                             : mix(vec3(0.95, 0.96, 1.0), vec3(0.8, 0.86, 1.0), (f - 0.4) / 0.6);
        float zbytek = 1.0 - f;
        gl_FragColor = vec4(barva * (1.5 + 9.0 * zbytek * zbytek) * pow(zbytek, 0.6), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.InstancedMesh(geo, mat, pocet);
  m.frustumCulled = false;
  return m;
}

export function kotouce(pocet) {
  const geo = new THREE.CircleGeometry(1, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader:  `
      varying float vR;
      void main() {
        vR = length(position.xz);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader:  `
      varying float vR;
      void main() {
        float stred = pow(clamp(1.0 - vR, 0.0, 1.0), 2.2);
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.9) * 3.0 * stred * stred, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.InstancedMesh(geo, mat, pocet);
  m.frustumCulled = false;
  return m;
}

export function vesmir(tex) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tHvezdy: { value: tex } },
    vertexShader:  `
      varying vec3 vD;
      void main() { vD = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader:  `
      uniform sampler2D tHvezdy; varying vec3 vD;
      ${GLSL_UV}
      void main() {
        gl_FragColor = vec4(texture2D(tHvezdy, uvHvezdy(vD)).rgb * 0.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(90, 64, 32), mat);
}

export function slunceKotouc() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.06, "rgba(255,250,235,1)");
  r.addColorStop(0.1, "rgba(255,220,170,0.55)");
  r.addColorStop(0.3, "rgba(255,170,90,0.12)");
  r.addColorStop(1, "rgba(255,140,60,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false,
                                         color: new THREE.Color(4, 3.8, 3.5), toneMapped: true });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(9);
  return s;
}
