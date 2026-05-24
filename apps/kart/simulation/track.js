// Track geometry + queries. Pure data/math, no Three.js, no DOM — the renderer
// and a future authoritative host both build off the same sampled centerline.
//
// Builds a closed Catmull-Rom loop from the control points, samples it into a
// dense polyline, and exposes:
//   - samples / leftEdge / rightEdge  (for the renderer to build the ribbon)
//   - isOnTrack(x, z)                  (off-track penalty test)
//   - progressAt(x, z)                 (nearest-point lap progress, 0..1)
//   - startPose                        (where/which-way the kart starts)

import { TRACK } from '../config.js';

// Centripetal-ish Catmull-Rom point at parameter t (0..1) between p1 and p2.
function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return [
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ];
}

export function createTrack() {
    const cps = TRACK.controlPoints;
    const n = cps.length;
    const sub = TRACK.samplesPerSegment;
    const hw = TRACK.halfWidth;

    const samples = [];   // {x, z}
    const tangents = [];  // {x, z} unit
    for (let i = 0; i < n; i++) {
        const p0 = cps[(i - 1 + n) % n];
        const p1 = cps[i];
        const p2 = cps[(i + 1) % n];
        const p3 = cps[(i + 2) % n];
        for (let j = 0; j < sub; j++) {
            const t = j / sub;
            const p = catmull(p0, p1, p2, p3, t);
            samples.push({ x: p[0], z: p[1] });
        }
    }

    const count = samples.length;
    // Tangents + edge points (left/right offsets) + cumulative arc length.
    const leftEdge = [];
    const rightEdge = [];
    const cumLen = new Float32Array(count + 1);
    for (let i = 0; i < count; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % count];
        let tx = b.x - a.x;
        let tz = b.z - a.z;
        const segLen = Math.hypot(tx, tz) || 1e-6;
        tx /= segLen; tz /= segLen;
        tangents.push({ x: tx, z: tz });
        // right-hand normal of the tangent
        const nx = tz;
        const nz = -tx;
        leftEdge.push({ x: a.x - nx * hw, z: a.z - nz * hw });
        rightEdge.push({ x: a.x + nx * hw, z: a.z + nz * hw });
        cumLen[i + 1] = cumLen[i] + segLen;
    }
    const totalLen = cumLen[count];

    // Nearest point on the polyline to (x,z). Returns squared distance, the
    // segment index, and the param t along that segment.
    function nearest(x, z) {
        let best = Infinity, bestSeg = 0, bestT = 0, bestCx = x, bestCz = z;
        for (let i = 0; i < count; i++) {
            const a = samples[i];
            const b = samples[(i + 1) % count];
            const abx = b.x - a.x, abz = b.z - a.z;
            const apx = x - a.x, apz = z - a.z;
            const len2 = abx * abx + abz * abz || 1e-6;
            let t = (apx * abx + apz * abz) / len2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const cx = a.x + abx * t, cz = a.z + abz * t;
            const dx = x - cx, dz = z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 < best) { best = d2; bestSeg = i; bestT = t; bestCx = cx; bestCz = cz; }
        }
        return { dist2: best, seg: bestSeg, t: bestT, cx: bestCx, cz: bestCz };
    }

    function isOnTrack(x, z) {
        return nearest(x, z).dist2 <= hw * hw;
    }

    // Wall constraint: if (x,z) is farther than `radius` from the centerline,
    // return the clamped position on the wall plus the outward unit normal so the
    // caller can cancel the outward velocity and slide along the barrier.
    function confine(x, z, radius) {
        const nr = nearest(x, z);
        const d = Math.sqrt(nr.dist2);
        if (d <= radius) return { hit: false, x, z, nx: 0, nz: 0 };
        const ox = (x - nr.cx) / (d || 1e-6);
        const oz = (z - nr.cz) / (d || 1e-6);
        return { hit: true, x: nr.cx + ox * radius, z: nr.cz + oz * radius, nx: ox, nz: oz };
    }

    // Normalized lap progress 0..1 along the loop at the nearest centerline point.
    function progressAt(x, z) {
        const nr = nearest(x, z);
        const segLen = cumLen[nr.seg + 1] - cumLen[nr.seg];
        return (cumLen[nr.seg] + nr.t * segLen) / totalLen;
    }

    // Start pose: on the centerline at the first sample, facing along the tangent.
    const startPose = {
        x: samples[0].x,
        z: samples[0].z,
        heading: Math.atan2(tangents[0].x, tangents[0].z),
    };

    return {
        halfWidth: hw,
        wallHalfWidth: TRACK.wallHalfWidth,
        samples,
        leftEdge,
        rightEdge,
        tangents,
        totalLen,
        isOnTrack,
        confine,
        progressAt,
        startPose,
    };
}
