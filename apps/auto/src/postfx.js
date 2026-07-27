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

// Depth-aware blur, for the AO buffer only.
//
// The Gaussian above is depth-blind, so smoothing the AO with it drags a
// building's contact darkening several pixels out over the road behind it and
// washes the crevice darkening back out of the crevice. The result is AO you
// are paying for and cannot see -- which is why the strength had to stay low
// to avoid haloing. Weighting each tap by how close its depth is to the
// centre's keeps the occlusion on the surface that generated it, and lets the
// strength go up.
const AOBLUR = `
precision highp float;
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 dir;
uniform float depthScale;
varying vec2 vUv;

void main() {
  float zc = texture2D(tDepth, vUv).x;
  float sum = texture2D(tSrc, vUv).r * 0.2270270270;
  float wsum = 0.2270270270;
  for (int i = 0; i < 2; i++) {
    float off = i == 0 ? 1.3846153846 : 3.2307692308;
    float base = i == 0 ? 0.3162162162 : 0.0702702703;
    for (int s = 0; s < 2; s++) {
      vec2 uv = vUv + dir * off * (s == 0 ? 1.0 : -1.0);
      float z = texture2D(tDepth, uv).x;
      // Depth here is the non-linear device value, so the same absolute
      // difference means very different distances near and far. Scaling by the
      // centre depth's own gradient keeps the falloff usable across the frame.
      float w = base * exp(-abs(z - zc) * depthScale / max(1.0 - zc, 1e-4));
      sum += texture2D(tSrc, uv).r * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(vec3(sum / wsum), 1.0);
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
uniform sampler2D tAO;
uniform float aoAmount;
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
  // AO before bloom: occlusion belongs to the surface, and applying it after
  // would let bloom bleed back into the crevices it just darkened.
  if (aoAmount > 0.0) {
    float ao = texture2D(tAO, vUv).r;
    c *= mix(1.0, ao, aoAmount);
  }
  c += texture2D(tBloom, vUv).rgb * bloomStrength;

  // Toe and shoulder.
  //
  // The grade was a smoothstep, which is symmetric: it pushed the shadows
  // DOWN as hard as it pushed the highlights up. Road, glass and grazing-angle
  // water all clamped to near zero and the tower tops all clamped near one, so
  // both ends of the image carried no separation at all. A toe that only acts
  // on the darkest values keeps detail out of the crush; a shoulder that only
  // acts above the knee keeps the bright faces from flattening.
  c += vec3(0.024) * pow(1.0 - c, vec3(4.0));
  c -= vec3(0.11) * pow(max(c - 0.62, vec3(0.0)), vec3(1.6));
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.05);
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.12);
  c += vec3(-0.008, 0.0, 0.014) * (1.0 - c);
  c *= vec3(1.015, 1.0, 0.985);

  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - vignette * smoothstep(0.35, 0.95, d);

  // Dither from PIXEL coordinates, not from uv.
  //
  // A sin-of-dot hash on uv is periodic along both screen axes, so it lays down
  // a regular comb across the sky and a diagonal weave on the water -- an
  // aligned pattern beating against a smooth gradient, which reads as a broken
  // shader and is worse than the banding it was meant to hide. Hashing integer
  // pixel coordinates with a per-frame offset gives actual noise, and the
  // triangular PDF (two uniforms differenced) is what removes the banding
  // rather than merely covering it.
  vec2 px = vUv / texel + vec2(fract(time * 71.0) * 977.0, fract(time * 53.0) * 331.0);
  float n1 = fract(sin(dot(floor(px), vec2(12.9898, 78.233))) * 43758.5453);
  float n2 = fract(sin(dot(floor(px) + 17.0, vec2(39.3468, 11.135))) * 24634.6345);
  c += (n1 - n2) * (0.5 / 255.0) + (n1 - 0.5) * grain;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Screen-space ambient occlusion.
//
// Reads the DEPTH TEXTURE the scene pass already filled -- an integer depth
// attachment, not a half-float colour target, so it stays inside the rule that
// keeps this chain working on iOS. It also costs no extra draw calls: the depth
// is a by-product of the pass that was happening anyway, where a separate depth
// prepass would have doubled the scene's 215 draws.
const SSAO = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 projInv;
uniform mat4 proj;
uniform vec2 texel;
uniform float radius;
uniform float strength;
uniform float bias;

vec3 viewPos(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  vec4 clip = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vec4 v = projInv * clip;
  return v.xyz / v.w;
}

// 12 points on a hemisphere, weighted toward the centre so near-contact
// darkening reads without the far samples turning into banding.
const vec3 K[12] = vec3[12](
  vec3( 0.5381, 0.1856, 0.4319), vec3( 0.1379, 0.2486, 0.4430),
  vec3( 0.3371, 0.5679, 0.0057), vec3(-0.6999,-0.0451, 0.0019),
  vec3( 0.0689,-0.1598, 0.8547), vec3( 0.0560, 0.0069, 0.1843),
  vec3(-0.0146, 0.1402, 0.0762), vec3( 0.0100,-0.1924, 0.0344),
  vec3(-0.3577,-0.5301, 0.4358), vec3(-0.3169, 0.1063, 0.0158),
  vec3( 0.0103,-0.5869, 0.0046), vec3(-0.0897,-0.4940, 0.3287)
);

void main() {
  float z = texture2D(tDepth, vUv).x;
  // Sky: depth 1.0. Occluding it produces a dark halo along every roofline.
  if (z >= 0.9999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  float rnd = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  float ca = cos(rnd * 6.2831), sa = sin(rnd * 6.2831);
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 k = K[i];
    k.xy = vec2(k.x * ca - k.y * sa, k.x * sa + k.y * ca);
    if (dot(k, N) < 0.0) k = -k;
    vec3 sp = P + k * radius;
    vec4 cp = proj * vec4(sp, 1.0);
    vec2 suv = (cp.xy / cp.w) * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = viewPos(suv).z;
    // Range check: a foreground object must not occlude the distant ground
    // behind it, which is what produces black outlines around everything.
    float rc = smoothstep(0.0, 1.0, radius / abs(P.z - sz));
    occ += (sz >= sp.z + bias ? 1.0 : 0.0) * rc;
  }
  float ao = clamp(1.0 - (occ / 12.0) * strength, 0.0, 1.0);
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

function pass(fragmentShader, uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(QUAD, mat);
  mesh.frustumCulled = false;
  // Each pass keeps its own scene. Re-parenting one quad between passes every
  // frame is scene-graph churn on exactly the tiers trying to claw back time.
  const scene = new THREE.Scene();
  scene.add(mesh);
  mesh.userData.scene = scene;
  return mesh;
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
    // Integer depth attachment, filled by the scene pass at no extra cost. This
    // is what SSAO reads; a separate depth prepass would double the draw calls.
    this.sceneRT.depthTexture = new THREE.DepthTexture(2, 2);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    this.bloomA = makeRT(2, 2, false);
    this.bloomB = makeRT(2, 2, false);
    this.aoA = makeRT(2, 2, false);
    this.aoB = makeRT(2, 2, false);
    this.ssaoOn = true;

    this.bright = pass(BRIGHT, {
      tScene: { value: null }, threshold: { value: 0.86 }, softness: { value: 0.22 },
    });
    this.blur = pass(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.aoBlur = pass(AOBLUR, {
      tSrc: { value: null }, tDepth: { value: null },
      dir: { value: new THREE.Vector2() }, depthScale: { value: 0.02 },
    });
    this.ssao = pass(SSAO, {
      tDepth: { value: null },
      projInv: { value: new THREE.Matrix4() },
      proj: { value: new THREE.Matrix4() },
      texel: { value: new THREE.Vector2() },
      radius: { value: 0.85 },
      strength: { value: 2.1 },
      bias: { value: 0.035 },
    });
    this.composite = pass(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null },
      texel: { value: new THREE.Vector2() },
      bloomStrength: { value: 0.62 },
      vignette: { value: 0.15 },
      grain: { value: 0.005 },
      time: { value: 0 },
      fxaa: { value: 1 },
      tAO: { value: null },
      aoAmount: { value: 1.0 },
    });
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
    this.sceneRT.depthTexture.image.width = W;
    this.sceneRT.depthTexture.image.height = H;
    this.sceneRT.depthTexture.needsUpdate = true;
    // Half res: AO is a low-frequency term and full res buys nothing visible.
    const aw = Math.max(2, Math.floor(W / 2)), ah = Math.max(2, Math.floor(H / 2));
    this.aoA.setSize(aw, ah);
    this.aoB.setSize(aw, ah);
    this.ssao.material.uniforms.texel.value.set(1 / aw, 1 / ah);
    this._aw = aw; this._ah = ah;
    this.composite.material.uniforms.texel.value.set(1 / W, 1 / H);
    this._bw = bw; this._bh = bh;
  }

  get target() {
    return this.enabled ? this.sceneRT : null;
  }

  /** Run the chain. The scene must already have been rendered into `target`. */
  render(time, camera) {
    if (!this.enabled) return;
    const r = this.renderer;
    const draw = (mesh, rt) => {
      r.setRenderTarget(rt);
      r.render(mesh.userData.scene, CAM);
    };

    if (this.ssaoOn && camera) {
      const su = this.ssao.material.uniforms;
      su.tDepth.value = this.sceneRT.depthTexture;
      su.proj.value.copy(camera.projectionMatrix);
      su.projInv.value.copy(camera.projectionMatrixInverse);
      draw(this.ssao, this.aoA);
      // Two cheap separable passes: the sample kernel is noisy by design and
      // unblurred AO reads as dirt on the lens.
      const bu2 = this.aoBlur.material.uniforms;
      bu2.tDepth.value = this.sceneRT.depthTexture;
      bu2.tSrc.value = this.aoA.texture;
      bu2.dir.value.set(1 / this._aw, 0);
      draw(this.aoBlur, this.aoB);
      bu2.tSrc.value = this.aoB.texture;
      bu2.dir.value.set(0, 1 / this._ah);
      draw(this.aoBlur, this.aoA);
      this.composite.material.uniforms.tAO.value = this.aoA.texture;
    }

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

  dispose() {
    for (const rt of [this.sceneRT, this.bloomA, this.bloomB, this.aoA, this.aoB]) rt.dispose();
    for (const m of [this.bright, this.blur, this.aoBlur, this.composite, this.ssao]) m.material.dispose();
    QUAD.dispose();
  }

  setQuality(q) {
    const cu = this.composite.material.uniforms;
    this.enabled = q !== 'low';
    // FXAA is a single fullscreen tap and the context has no MSAA, so keep it on
    // for medium too -- dropping it entirely was a visible edge-quality cliff.
    cu.fxaa.value = q === 'low' ? 0 : 1;
    cu.bloomStrength.value = q === 'high' ? 0.62 : 0.5;
    // Film grain is separate from the dither and much larger; at 0.016 it was
    // reading as texture across the sky now that the dither is per-pixel.
    cu.grain.value = q === 'high' ? 0.005 : 0;
    // SSAO is the most expensive pass here, so it is the first thing to go.
    this.ssaoOn = q === 'high';
    cu.aoAmount.value = this.ssaoOn ? 1.0 : 0.0;
  }
}
