// Three.js r160 is vendored (not CDN-loaded) so the game works fully offline.
// The version is in the filename: the service worker treats it as immutable and
// carries it forward across cache bumps instead of re-downloading 1.2 MB.
export * from '../vendor/three-0.160.0.module.js';
