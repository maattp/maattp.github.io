import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COLORS } from './config.js';

export const BASE_FOV = 80;

// Renderer + scene + camera + lighting + bloom post stack.
export class Engine {
  constructor(quality = 'high') {
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = quality === 'high';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    document.getElementById('game').appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);
    scene.fog = new THREE.FogExp2(COLORS.fog, 0.0145);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.03, 700);
    scene.add(camera);
    this.camera = camera;

    this._setupLights();

    this.bloomEnabled = quality !== 'low';
    if (this.bloomEnabled) {
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.85);
      bloom.threshold = 0.82; bloom.strength = quality === 'high' ? 0.55 : 0.45; bloom.radius = 0.4;
      this.bloom = bloom;
      this.composer.addPass(bloom);
      this.composer.addPass(new OutputPass());
    }
    addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x4a5f82, 0x14121f, 0.7));
    s.add(new THREE.AmbientLight(0x2a3850, 0.55));
    const dir = new THREE.DirectionalLight(0x8aa0ff, 0.55);
    dir.position.set(46, 78, 22);
    if (this.quality === 'high') {
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      const c = dir.shadow.camera, d = 72;
      c.left = -d; c.right = d; c.top = d; c.bottom = -d; c.near = 10; c.far = 220;
      dir.shadow.bias = -0.0005;
    }
    s.add(dir); this.sun = dir;
    const p1 = new THREE.PointLight(COLORS.cyan, 0.7, 130); p1.position.set(-34, 20, -26); s.add(p1);
    const p2 = new THREE.PointLight(COLORS.magenta, 0.7, 130); p2.position.set(34, 20, 28); s.add(p2);
    this.p1 = p1; this.p2 = p2;
    this.muzzle = new THREE.PointLight(0xffffff, 0, 20); s.add(this.muzzle);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
  }

  render(t) {
    this.p1.intensity = 0.6 + Math.sin(t * 1.3) * 0.18;
    this.p2.intensity = 0.6 + Math.cos(t * 1.1) * 0.18;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
