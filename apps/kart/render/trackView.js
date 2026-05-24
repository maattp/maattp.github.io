// Builds the visible track from the simulation's sampled centerline: a flat
// asphalt ribbon, bright edge lines, a dashed center line, and a checkered
// start/finish stripe. Geometry only — no per-frame work.

import * as THREE from 'three';
import { COLORS } from '../config.js';

export function buildTrackView(track) {
    const group = new THREE.Group();
    const n = track.samples.length;

    // ---- asphalt ribbon (two triangles per segment, left/right edges) ----
    const positions = [];
    const indices = [];
    for (let i = 0; i < n; i++) {
        const l = track.leftEdge[i];
        const r = track.rightEdge[i];
        positions.push(l.x, 0, l.z, r.x, 0, r.z);
    }
    for (let i = 0; i < n; i++) {
        const a = i * 2;          // left i
        const b = i * 2 + 1;      // right i
        const ni = (i + 1) % n;
        const c = ni * 2;         // left i+1
        const d = ni * 2 + 1;     // right i+1
        indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLORS.track }));
    road.position.y = 0;
    group.add(road);

    // ---- edge lines (closed loops slightly inset so they sit on the asphalt) ----
    group.add(edgeLine(track.leftEdge, track.samples, 0.85, COLORS.trackEdge));
    group.add(edgeLine(track.rightEdge, track.samples, 0.85, COLORS.trackEdge));

    // ---- dashed center line ----
    group.add(centerDashes(track));

    // ---- start/finish checkered stripe across the track at sample 0 ----
    group.add(startStripe(track));

    return group;
}

// A thin quad strip running along an edge, nudged toward the centerline so it
// renders on the asphalt rather than the grass.
function edgeLine(edge, center, blend, color) {
    const n = edge.length;
    const width = 0.45;
    const positions = [];
    const indices = [];
    for (let i = 0; i < n; i++) {
        // point on the asphalt near the edge
        const ex = edge[i].x, ez = edge[i].z;
        const cx = center[i].x, cz = center[i].z;
        const px = ex + (cx - ex) * (1 - blend);
        const pz = ez + (cz - ez) * (1 - blend);
        // inward direction (toward center)
        let dx = cx - ex, dz = cz - ez;
        const dl = Math.hypot(dx, dz) || 1e-6; dx /= dl; dz /= dl;
        positions.push(px, 0, pz, px + dx * width, 0, pz + dz * width);
    }
    for (let i = 0; i < n; i++) {
        const a = i * 2, b = i * 2 + 1;
        const ni = (i + 1) % n;
        const c = ni * 2, d = ni * 2 + 1;
        indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.y = 0.02;
    return mesh;
}

function centerDashes(track) {
    const g = new THREE.Group();
    const n = track.samples.length;
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.centerLine });
    const dashGeo = new THREE.PlaneGeometry(0.35, 2.2);
    dashGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i += 3) {
        const s = track.samples[i];
        const t = track.tangents[i];
        const dash = new THREE.Mesh(dashGeo, mat);
        dash.position.set(s.x, 0.03, s.z);
        dash.rotation.y = Math.atan2(t.x, t.z);
        g.add(dash);
    }
    return g;
}

function startStripe(track) {
    const s = track.samples[0];
    const t = track.tangents[0];
    const w = track.halfWidth * 2;
    const geo = new THREE.PlaneGeometry(w, 2.2);
    geo.rotateX(-Math.PI / 2);
    const tex = checkerTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const stripe = new THREE.Mesh(geo, mat);
    stripe.position.set(s.x, 0.04, s.z);
    stripe.rotation.y = Math.atan2(t.x, t.z);
    return stripe;
}

function checkerTexture() {
    const size = 64, cells = 8;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const cs = size / cells;
    for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
            ctx.fillRect(x * cs, y * cs, cs, cs);
        }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
