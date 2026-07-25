// A small hand-rolled post chain: bloom + FXAA + grade + vignette.
//
// Deliberately not three's EffectComposer -- this ships no addon files, and it
// lets every render target be UnsignedByte. Half-float targets are unreliable
// on iOS (silent black screens), so the scene is tone-mapped during the main
// pass and everything downstream works in gamma space, which is also where you
// want FXAA anyway.

import * as THREE from './three.js';

const QUAD = new THREE.PlaneGeometry(2, 2);
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT = `
uniform sampler2D tScene;
uniform float threshold;
uniform float softness;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(threshold, threshold + softness, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

// Separable 9-tap gaussian, sampled with bilinear pairs.
const BLUR = `
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tSrc, vUv).rgb * 0.2270270270;
  sum += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 texel;
uniform float bloomStrength;
uniform float vignette;
uniform float grain;
uniform float time;
uniform float fxaa;
varying vec2 vUv;

// FXAA 3.11 console variant -- cheap, and plenty at phone resolutions.
vec3 fxaaFilter(vec2 uv) {
  vec3 rgbNW = texture2D(tScene, uv + vec2(-1.0, -1.0) * texel).rgb;
  vec3 rgbNE = texture2D(tScene, uv + vec2( 1.0, -1.0) * texel).rgb;
  vec3 rgbSW = texture2D(tScene, uv + vec2(-1.0,  1.0) * texel).rgb;
  vec3 rgbSE = texture2D(tScene, uv + vec2( 1.0,  1.0) * texel).rgb;
  vec3 rgbM  = texture2D(tScene, uv).rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, luma), lNE = dot(rgbNE, luma);
  float lSW = dot(rgbSW, luma), lSE = dot(rgbSE, luma);
  float lM = dot(rgbM, luma);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < lMax * 0.18) return rgbM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcpDir = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpDir, -8.0, 8.0) * texel;
  vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb +
                  texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb +
                             texture2D(tScene, uv + dir * 0.5).rgb);
  float lB = dot(b, luma);
  return (lB < lMin || lB > lMax) ? a : b;
}

void main() {
  vec3 c = fxaa > 0.5 ? fxaaFilter(vUv) : texture2D(tScene, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * bloomStrength;

  // grade: lift the shadows slightly cool, warm the highlights, add contrast
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.09);
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.12);
  c += vec3(-0.008, 0.0, 0.014) * (1.0 - c);
  c *= vec3(1.015, 1.0, 0.985);

  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - vignette * smoothstep(0.35, 0.95, d);

  float n = fract(sin(dot(vUv * time, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * grain;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function pass(fragmentShader, uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader,
    depthTest: false, depthWrite: false,
  });
  return new THREE.Mesh(QUAD, mat);
}

function makeRT(w, h, depth) {
  const rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType, // never HalfFloat: iOS silently renders black
    depthBuffer: !!depth,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  return rt;
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.scenePass = new THREE.Scene();
    this.quadScene = new THREE.Scene();

    this.sceneRT = makeRT(2, 2, true);
    this.bloomA = makeRT(2, 2, false);
    this.bloomB = makeRT(2, 2, false);

    this.bright = pass(BRIGHT, {
      tScene: { value: null }, threshold: { value: 0.72 }, softness: { value: 0.28 },
    });
    this.blur = pass(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.composite = pass(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null },
      texel: { value: new THREE.Vector2() },
      bloomStrength: { value: 0.62 },
      vignette: { value: 0.15 },
      grain: { value: 0.016 },
      time: { value: 0 },
      fxaa: { value: 1 },
    });
    this.holder = new THREE.Scene();
  }

  setSize(w, h, pixelRatio) {
    const W = Math.max(2, Math.floor(w * pixelRatio));
    const H = Math.max(2, Math.floor(h * pixelRatio));
    if (this._w === W && this._h === H) return;
    this._w = W; this._h = H;
    this.sceneRT.setSize(W, H);
    const bw = Math.max(2, Math.floor(W / 4)), bh = Math.max(2, Math.floor(H / 4));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    this.composite.material.uniforms.texel.value.set(1 / W, 1 / H);
    this._bw = bw; this._bh = bh;
  }

  get target() {
    return this.enabled ? this.sceneRT : null;
  }

  /** Run the chain. The scene must already have been rendered into `target`. */
  render(time) {
    if (!this.enabled) return;
    const r = this.renderer;
    const draw = (mesh, rt) => {
      this.holder.clear();
      this.holder.add(mesh);
      r.setRenderTarget(rt);
      r.render(this.holder, CAM);
    };

    this.bright.material.uniforms.tScene.value = this.sceneRT.texture;
    draw(this.bright, this.bloomA);

    const bu = this.blur.material.uniforms;
    for (let i = 0; i < 3; i++) {
      const spread = 1 + i * 1.6;
      bu.tSrc.value = this.bloomA.texture;
      bu.dir.value.set(spread / this._bw, 0);
      draw(this.blur, this.bloomB);
      bu.tSrc.value = this.bloomB.texture;
      bu.dir.value.set(0, spread / this._bh);
      draw(this.blur, this.bloomA);
    }

    const cu = this.composite.material.uniforms;
    cu.tScene.value = this.sceneRT.texture;
    cu.tBloom.value = this.bloomA.texture;
    cu.time.value = time;
    r.setRenderTarget(null);
    draw(this.composite, null);
  }

  setQuality(q) {
    const cu = this.composite.material.uniforms;
    this.enabled = q !== 'low';
    cu.fxaa.value = q === 'high' ? 1 : 0;
    cu.bloomStrength.value = q === 'high' ? 0.62 : 0.5;
    cu.grain.value = q === 'high' ? 0.016 : 0;
  }
}
