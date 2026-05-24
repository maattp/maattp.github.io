// Builds the visible track from the sim's sampled centerline, draped over the
// terrain heightfield so the asphalt, kerbs, walls, banner and cones follow the
// hills. Geometry only — built once, no per-frame work.

import * as THREE from 'three';
import { COLORS, VISUALS } from '../config.js';
import { heightAt } from '../simulation/terrain.js';
import { toonMat } from './materials.js';

// small vertical offsets so layers stack cleanly on the terrain
const Y_ROAD = 0.06, Y_KERB = 0.10, Y_EDGE = 0.14, Y_DASH = 0.16, Y_START = 0.18;

export function buildTrackView(track) {
    const group = new THREE.Group();
    const n = track.samples.length;

    // ---- asphalt ribbon ----
    const positions = [];
    const indices = [];
    for (let i = 0; i < n; i++) {
        const l = track.leftEdge[i], r = track.rightEdge[i];
        positions.push(l.x, heightAt(l.x, l.z) + Y_ROAD, l.z,
                       r.x, heightAt(r.x, r.z) + Y_ROAD, r.z);
    }
    for (let i = 0; i < n; i++) {
        const ni = (i + 1) % n;
        indices.push(i * 2, i * 2 + 1, ni * 2, i * 2 + 1, ni * 2 + 1, ni * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, toonMat(COLORS.track));
    road.receiveShadow = true;
    group.add(road);

    // ---- kerbs (striped red/white strips just outside each edge) ----
    group.add(kerb(track.leftEdge, track.samples));
    group.add(kerb(track.rightEdge, track.samples));

    // ---- white edge lines + dashed centre line ----
    group.add(edgeLine(track.leftEdge, track.samples));
    group.add(edgeLine(track.rightEdge, track.samples));
    group.add(centerDashes(track));

    // ---- start line + banner ----
    group.add(startStripe(track));
    group.add(startBanner(track));

    // ---- cones along the edges ----
    group.add(cones(track));

    // ---- barrier walls just outside the runoff (these constrain the kart) ----
    group.add(walls(track));

    return group;
}

function walls(track) {
    const g = new THREE.Group();
    const n = track.samples.length;
    const wallR = track.wallHalfWidth;
    const height = 1.6;
    for (const sign of [-1, 1]) {
        const pos = [], idx = [], col = [];
        const red = new THREE.Color(COLORS.kerbRed);
        const white = new THREE.Color(COLORS.kerbWhite);
        for (let i = 0; i < n; i++) {
            const s = track.samples[i], t = track.tangents[i];
            const nx = t.z * sign, nz = -t.x * sign;      // outward normal for this side
            const bx = s.x + nx * wallR, bz = s.z + nz * wallR;
            const by = heightAt(bx, bz);
            pos.push(bx, by, bz, bx, by + height, bz);
            const c = (i % 2) ? red : white;
            col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        for (let i = 0; i < n; i++) {
            const ni = (i + 1) % n;
            idx.push(i * 2, i * 2 + 1, ni * 2, i * 2 + 1, ni * 2 + 1, ni * 2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, toonMat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
        m.castShadow = true;
        g.add(m);
    }
    return g;
}

function kerb(edge, center) {
    const n = edge.length;
    const width = 0.9;
    const pos = [], idx = [], col = [];
    const red = new THREE.Color(COLORS.kerbRed);
    const white = new THREE.Color(COLORS.kerbWhite);
    for (let i = 0; i < n; i++) {
        const ex = edge[i].x, ez = edge[i].z;
        let ox = ex - center[i].x, oz = ez - center[i].z; // outward
        const ol = Math.hypot(ox, oz) || 1e-6; ox /= ol; oz /= ol;
        const ax = ex, az = ez, bx = ex + ox * width, bz = ez + oz * width;
        pos.push(ax, heightAt(ax, az) + Y_KERB, az, bx, heightAt(bx, bz) + Y_KERB, bz);
        const c = (i % 2) ? red : white;
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < n; i++) {
        const ni = (i + 1) % n;
        idx.push(i * 2, i * 2 + 1, ni * 2, i * 2 + 1, ni * 2 + 1, ni * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, toonMat(0xffffff, { vertexColors: true }));
    m.receiveShadow = true;
    return m;
}

function edgeLine(edge, center) {
    const n = edge.length;
    const width = 0.4, inset = 0.12;
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
        const ex = edge[i].x, ez = edge[i].z;
        let dx = center[i].x - ex, dz = center[i].z - ez;
        const dl = Math.hypot(dx, dz) || 1e-6; dx /= dl; dz /= dl;
        const px = ex + dx * inset, pz = ez + dz * inset;
        const qx = px + dx * width, qz = pz + dz * width;
        pos.push(px, heightAt(px, pz) + Y_EDGE, pz, qx, heightAt(qx, qz) + Y_EDGE, qz);
    }
    for (let i = 0; i < n; i++) {
        const ni = (i + 1) % n;
        idx.push(i * 2, i * 2 + 1, ni * 2, i * 2 + 1, ni * 2 + 1, ni * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: COLORS.trackEdge }));
}

function centerDashes(track) {
    const g = new THREE.Group();
    const n = track.samples.length;
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.centerLine });
    const dashGeo = new THREE.PlaneGeometry(0.4, 2.6);
    dashGeo.rotateX(-Math.PI / 2);
    for (let i = 4; i < n; i += 4) {
        const s = track.samples[i], t = track.tangents[i];
        const d = new THREE.Mesh(dashGeo, mat);
        d.position.set(s.x, heightAt(s.x, s.z) + Y_DASH, s.z);
        d.rotation.y = Math.atan2(t.x, t.z);
        g.add(d);
    }
    return g;
}

function startStripe(track) {
    const s = track.samples[0], t = track.tangents[0];
    const geo = new THREE.PlaneGeometry(track.halfWidth * 2, 2.6);
    geo.rotateX(-Math.PI / 2);
    const stripe = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: checkerTexture() }));
    stripe.position.set(s.x, heightAt(s.x, s.z) + Y_START, s.z);
    stripe.rotation.y = Math.atan2(t.x, t.z);
    return stripe;
}

function startBanner(track) {
    const g = new THREE.Group();
    const s = track.samples[0], t = track.tangents[0];
    const yaw = Math.atan2(t.x, t.z);
    const span = track.halfWidth * 2 + 1.6;
    const postMat = toonMat(COLORS.bannerPost);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const postH = 5.2;

    for (const side of [-1, 1]) {
        const bx = s.x + rx * side * span / 2, bz = s.z + rz * side * span / 2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, postH, 12), postMat);
        post.position.set(bx, heightAt(bx, bz) + postH / 2, bz);
        post.castShadow = true;
        g.add(post);
    }

    const banner = new THREE.Mesh(
        new THREE.BoxGeometry(span, 1.3, 0.2),
        new THREE.MeshBasicMaterial({ map: bannerTexture() })
    );
    banner.position.set(s.x, heightAt(s.x, s.z) + postH - 0.2, s.z);
    banner.rotation.y = yaw;
    g.add(banner);
    return g;
}

function cones(track) {
    const g = new THREE.Group();
    const n = track.samples.length;
    const step = Math.max(1, Math.floor(n / VISUALS.conesPerSide));
    const coneGeo = new THREE.ConeGeometry(0.28, 0.8, 12);
    const mat = toonMat(COLORS.cone);
    for (let i = 0; i < n; i += step) {
        for (const edge of [track.leftEdge, track.rightEdge]) {
            let ox = edge[i].x - track.samples[i].x, oz = edge[i].z - track.samples[i].z;
            const ol = Math.hypot(ox, oz) || 1e-6; ox /= ol; oz /= ol;
            const cx = edge[i].x + ox * 1.4, cz = edge[i].z + oz * 1.4;
            const c = new THREE.Mesh(coneGeo, mat);
            c.position.set(cx, heightAt(cx, cz) + 0.4, cz);
            c.castShadow = true;
            g.add(c);
        }
    }
    return g;
}

function checkerTexture() {
    const size = 64, cells = 8;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const cs = size / cells;
    for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
            ctx.fillRect(x * cs, y * cs, cs, cs);
        }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function bannerTexture() {
    const w = 512, h = 96;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a2f3a'; ctx.fillRect(0, 0, w, h);
    const cs = 16;
    for (let x = 0; x < w / cs; x++) {
        ctx.fillStyle = x % 2 ? '#fff' : '#111';
        ctx.fillRect(x * cs, 0, cs, cs);
        ctx.fillStyle = x % 2 ? '#111' : '#fff';
        ctx.fillRect(x * cs, h - cs, cs, cs);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 44px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('START / FINISH', w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
