// Small shared helpers — pure, no Three dependency.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;
export const rand  = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b));
export const pick  = arr => arr[(Math.random() * arr.length) | 0];
// frame-rate-independent damping toward a target
export const damp  = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export const dist2 = (x1, z1, x2, z2) => { const dx = x1 - x2, dz = z1 - z2; return dx * dx + dz * dz; };
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const $ = id => document.getElementById(id);
export const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
