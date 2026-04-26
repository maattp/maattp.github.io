// Leaky integrate-and-fire (LIF) network with synaptic delays.
//
// Data layout: structure-of-arrays typed arrays so the hot loops are
// cache-friendly and the JIT can keep them in monomorphic call sites.
//
// Spike delivery uses a slot-per-step ring buffer of accumulated current.
// When neuron i fires, we iterate i's outgoing synapses and add each
// weight into ring[(now + delay) mod ringSize][target]. Each step, we
// drain the current slot into V[] and zero it. This avoids any dynamic
// allocation in the hot path.
//
// Tunables are at the top — these are the knobs that decide whether the
// network looks dead, looks like static, or sits at the edge of chaos.

// ---------- Tunables ----------

export const NEURON_COUNT = 16384;       // 128² — power of two, fits comfortably in CPU sim budget
export const CLUSTER_COUNT = 7;
export const NETWORK_RADIUS = 90;        // overall extent of the cloud
export const CLUSTER_RADIUS = 22;        // gaussian sigma per cluster
export const E_FRACTION = 0.8;           // fraction excitatory

// LIF parameters (membrane time in ms, V in dimensionless units, threshold = 1)
export const SIM_DT_MS = 5;              // 200 Hz simulation
const V_REST = 0.0;
const V_THRESHOLD = 1.0;
const V_RESET = -0.15;                   // hyperpolarized after spike
const V_TAU_MS = 22;                     // membrane decay time constant
const REFRACTORY_MS = 6;
// Per-step noise: (rand + rand - 1) * AMPLITUDE. Tuned so equilibrium V
// has std dev ≈ 0.27, putting threshold ~4σ away. Spontaneous firings
// from noise alone bootstrap recurrent activity; the E/I balance below
// determines whether that recurrence settles, oscillates, or runs away.
// These three numbers are the most important knobs in the whole file —
// nudge by ±10% if dynamics drift toward dead or saturated.
const NOISE_AMPLITUDE = 0.42;
const E_WEIGHT = 0.14;
const I_WEIGHT = -0.46;
const STIMULUS_STRENGTH = 1.4;           // per-neuron current injection on click
const STIMULUS_RADIUS = 9;               // world-space radius of click cascade
const STIMULUS_NEIGHBOURS_MAX = 60;

// Connectivity — kept moderate so total in-flight pulse count stays
// within the render pool budget at edge-of-chaos firing rates.
const SYN_OUT_E = 34;
const SYN_OUT_I = 48;
const LOCAL_FRACTION = 0.86;             // share of synapses to same cluster
const LOCAL_FALLOFF = 28.0;              // exp(-d/falloff) probability falloff inside cluster

// Delays — in ms, distance-proportional with jitter
const DELAY_BASE_MS = 80;
const DELAY_RANGE_MS = 320;
const DELAY_JITTER_MS = 18;
const MAX_DELAY_MS = DELAY_BASE_MS + DELAY_RANGE_MS + DELAY_JITTER_MS + SIM_DT_MS;

// Visual brightness decay (separate from V — this is what renderers see)
const BRIGHTNESS_TAU_MS = 280;
const BRIGHTNESS_PEAK = 1.0;

// Pulse pool cap — drop excess pulses gracefully if we ever overflow.
// At ~1 Hz/neuron firing rate × ~40 synapses × 0.2s avg delay this fills
// to ~130k. We cap at 90k as a render budget — the simulation propagates
// every spike regardless; only visualization is throttled.
export const MAX_ACTIVE_PULSES = 90000;

// Colors as packed Float32 R,G,B (linear-ish HDR)
const COLOR_E = [0.05, 0.78, 1.0];       // cyan
const COLOR_I = [1.0, 0.18, 0.58];       // hot magenta
const COLOR_COINCIDENCE = [1.6, 1.6, 1.6]; // bright white flash

// ---------- RNG (deterministic for reproducible builds) ----------

function mulberry32(seed) {
    let t = seed >>> 0;
    return function() {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function gaussian(rand) {
    // Box-Muller; one of two samples
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- Network ----------

export class Network {
    constructor(neuronCount = NEURON_COUNT) {
        this.n = neuronCount;
        this.rand = mulberry32(0xC07E78);

        // Per-neuron state
        this.positions = new Float32Array(this.n * 3);
        this.types = new Uint8Array(this.n);             // 0=E, 1=I
        this.cluster = new Uint8Array(this.n);
        this.V = new Float32Array(this.n);
        this.refractory = new Float32Array(this.n);      // ms remaining
        this.brightness = new Float32Array(this.n);      // 0..N, decays exponentially

        // For coincidence detection — track recent E and I arrivals per neuron
        this.recentE = new Float32Array(this.n);
        this.recentI = new Float32Array(this.n);
        this.coincidenceFlash = new Float32Array(this.n); // brief 0..1 flash channel

        // Cluster centers (computed during build)
        this.clusterCenters = new Float32Array(CLUSTER_COUNT * 3);

        // Synapses (CSR-style by source neuron)
        this.synOutStart = new Uint32Array(this.n + 1);
        this.synDst = null;     // Uint32Array(M)
        this.synWeight = null;  // Float32Array(M)
        this.synDelay = null;   // Float32Array(M)
        this.synapseCount = 0;

        // Delivery ring buffer: ringSize × n floats of pending current
        this.ringSize = Math.ceil(MAX_DELAY_MS / SIM_DT_MS) + 1;
        this.ring = new Array(this.ringSize);
        for (let s = 0; s < this.ringSize; s++) {
            this.ring[s] = new Float32Array(this.n);
        }
        this.ringIdx = 0;
        this.simTimeMs = 0;

        // Active pulses: parallel typed arrays for fast renderer upload
        // Layout: srcXYZ, dstXYZ, tStart, tEnd, colorRGB. 11 floats per pulse.
        this.pulseStride = 11;
        this.pulseData = new Float32Array(MAX_ACTIVE_PULSES * this.pulseStride);
        this.pulseAlive = new Uint8Array(MAX_ACTIVE_PULSES);
        this.pulseTEnd = new Float32Array(MAX_ACTIVE_PULSES);
        this.pulseFreeStack = new Int32Array(MAX_ACTIVE_PULSES);
        for (let i = 0; i < MAX_ACTIVE_PULSES; i++) {
            this.pulseFreeStack[i] = MAX_ACTIVE_PULSES - 1 - i;
        }
        this.pulseFreeTop = MAX_ACTIVE_PULSES;
        this.activePulseCount = 0;

        this._build();
    }

    _build() {
        this._placeClusters();
        this._placeNeurons();
        this._assignTypes();
        this._buildSynapses();
        this._initState();
    }

    _placeClusters() {
        // Distribute cluster centers around a sphere shell with jitter,
        // so clusters are visually separable but not on a perfect lattice.
        for (let c = 0; c < CLUSTER_COUNT; c++) {
            // Fibonacci sphere point + jitter
            const golden = Math.PI * (3 - Math.sqrt(5));
            const y = 1 - (c / Math.max(1, CLUSTER_COUNT - 1)) * 2;
            const r = Math.sqrt(1 - y * y);
            const theta = golden * c;
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r;
            const radius = NETWORK_RADIUS * (0.55 + 0.25 * this.rand());
            this.clusterCenters[c * 3 + 0] = x * radius + (this.rand() - 0.5) * 14;
            this.clusterCenters[c * 3 + 1] = y * radius + (this.rand() - 0.5) * 14;
            this.clusterCenters[c * 3 + 2] = z * radius + (this.rand() - 0.5) * 14;
        }
    }

    _placeNeurons() {
        // Roughly equal neurons per cluster, with ±10% jitter
        const baseCount = Math.floor(this.n / CLUSTER_COUNT);
        const counts = new Array(CLUSTER_COUNT).fill(baseCount);
        let leftover = this.n - baseCount * CLUSTER_COUNT;
        for (let c = 0; leftover > 0; c = (c + 1) % CLUSTER_COUNT, leftover--) counts[c]++;

        let idx = 0;
        for (let c = 0; c < CLUSTER_COUNT; c++) {
            const cx = this.clusterCenters[c * 3 + 0];
            const cy = this.clusterCenters[c * 3 + 1];
            const cz = this.clusterCenters[c * 3 + 2];
            // Each cluster gets a slightly different sigma — visual variety
            const sigma = CLUSTER_RADIUS * (0.85 + 0.3 * this.rand());
            for (let k = 0; k < counts[c]; k++) {
                this.positions[idx * 3 + 0] = cx + gaussian(this.rand) * sigma;
                this.positions[idx * 3 + 1] = cy + gaussian(this.rand) * sigma;
                this.positions[idx * 3 + 2] = cz + gaussian(this.rand) * sigma;
                this.cluster[idx] = c;
                idx++;
            }
        }
    }

    _assignTypes() {
        for (let i = 0; i < this.n; i++) {
            this.types[i] = this.rand() < E_FRACTION ? 0 : 1;
        }
    }

    _buildSynapses() {
        // First pass: count. Second pass: fill.
        // For each source we sample target neurons; mostly local (same
        // cluster, distance-weighted), some long-range to any neuron.
        const counts = new Uint32Array(this.n);
        for (let i = 0; i < this.n; i++) {
            counts[i] = this.types[i] === 0 ? SYN_OUT_E : SYN_OUT_I;
        }

        // Build cluster -> neuron index list for fast local sampling
        const clusterMembers = [];
        for (let c = 0; c < CLUSTER_COUNT; c++) clusterMembers.push([]);
        for (let i = 0; i < this.n; i++) clusterMembers[this.cluster[i]].push(i);

        // CSR offsets
        let total = 0;
        for (let i = 0; i < this.n; i++) {
            this.synOutStart[i] = total;
            total += counts[i];
        }
        this.synOutStart[this.n] = total;
        this.synapseCount = total;

        this.synDst = new Uint32Array(total);
        this.synWeight = new Float32Array(total);
        this.synDelay = new Float32Array(total);

        const TWO_PI = Math.PI * 2;

        for (let i = 0; i < this.n; i++) {
            const sx = this.positions[i * 3 + 0];
            const sy = this.positions[i * 3 + 1];
            const sz = this.positions[i * 3 + 2];
            const myCluster = this.cluster[i];
            const myType = this.types[i];
            const baseW = myType === 0 ? E_WEIGHT : I_WEIGHT;
            const localPool = clusterMembers[myCluster];

            const start = this.synOutStart[i];
            const k = counts[i];

            for (let s = 0; s < k; s++) {
                let tgt;
                let attempts = 0;
                if (this.rand() < LOCAL_FRACTION) {
                    // Local: rejection-sample by distance
                    do {
                        tgt = localPool[(this.rand() * localPool.length) | 0];
                        const dx = this.positions[tgt * 3 + 0] - sx;
                        const dy = this.positions[tgt * 3 + 1] - sy;
                        const dz = this.positions[tgt * 3 + 2] - sz;
                        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        const accept = Math.exp(-d / LOCAL_FALLOFF);
                        if (this.rand() < accept && tgt !== i) break;
                        attempts++;
                    } while (attempts < 8);
                } else {
                    // Long-range: any neuron in any cluster
                    do {
                        tgt = (this.rand() * this.n) | 0;
                        attempts++;
                    } while (tgt === i && attempts < 4);
                }

                this.synDst[start + s] = tgt;
                // Per-synapse weight jitter ±25%
                this.synWeight[start + s] = baseW * (0.75 + 0.5 * this.rand());

                // Distance-proportional delay
                const dx = this.positions[tgt * 3 + 0] - sx;
                const dy = this.positions[tgt * 3 + 1] - sy;
                const dz = this.positions[tgt * 3 + 2] - sz;
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                const norm = Math.min(1, d / (NETWORK_RADIUS * 1.6));
                let delay = DELAY_BASE_MS + DELAY_RANGE_MS * norm;
                delay += (this.rand() - 0.5) * 2 * DELAY_JITTER_MS;
                if (delay < SIM_DT_MS) delay = SIM_DT_MS;
                this.synDelay[start + s] = delay;
            }
        }
    }

    _initState() {
        // Start with V near rest with small spread so the network doesn't
        // fire all-at-once on the first step.
        for (let i = 0; i < this.n; i++) {
            this.V[i] = V_REST + (this.rand() - 0.5) * 0.4;
            this.refractory[i] = 0;
            this.brightness[i] = 0;
        }
    }

    // Inject stimulus near a 3D point. Returns count of stimulated neurons.
    stimulate(px, py, pz, radius = STIMULUS_RADIUS, strength = STIMULUS_STRENGTH) {
        let count = 0;
        const r2 = radius * radius;
        // First pass — find candidates
        const candidates = [];
        for (let i = 0; i < this.n; i++) {
            const dx = this.positions[i * 3 + 0] - px;
            const dy = this.positions[i * 3 + 1] - py;
            const dz = this.positions[i * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < r2) candidates.push([i, d2]);
        }
        // Sort by distance, take up to STIMULUS_NEIGHBOURS_MAX closest
        candidates.sort((a, b) => a[1] - b[1]);
        const take = Math.min(candidates.length, STIMULUS_NEIGHBOURS_MAX);
        for (let k = 0; k < take; k++) {
            const i = candidates[k][0];
            // Stronger near the click point
            const falloff = 1 - candidates[k][1] / r2;
            this.V[i] += strength * (0.5 + 0.5 * falloff);
            count++;
        }
        return count;
    }

    // Step the simulation by SIM_DT_MS. Spikes generated this step push
    // pulses into the pulse pool for rendering.
    step() {
        const N = this.n;
        const dt = SIM_DT_MS;
        const decayV = Math.exp(-dt / V_TAU_MS);
        const decayB = Math.exp(-dt / BRIGHTNESS_TAU_MS);
        const decayCoincidence = Math.exp(-dt / 60);

        // 1. Drain current ring slot into V, then zero it.
        const slot = this.ring[this.ringIdx];
        for (let i = 0; i < N; i++) {
            const c = slot[i];
            if (c !== 0) {
                if (c > 0) this.recentE[i] += c;
                else this.recentI[i] += -c;
                this.V[i] += c;
                slot[i] = 0;
            }
        }

        // 2. Decay V toward rest, decrement refractory, decay brightness.
        // 3. Add background noise to non-refractory neurons.
        // 4. Threshold detection — mark spikes.
        const spikes = []; // indices that fired this step
        const noiseScale = NOISE_AMPLITUDE;
        const rand = this.rand;
        for (let i = 0; i < N; i++) {
            // Recent E/I tracking
            this.recentE[i] *= decayCoincidence;
            this.recentI[i] *= decayCoincidence;

            this.brightness[i] *= decayB;
            this.coincidenceFlash[i] *= decayCoincidence;

            if (this.refractory[i] > 0) {
                this.refractory[i] -= dt;
                this.V[i] = V_RESET; // hold at reset during refractory
                continue;
            }

            // Membrane decay
            this.V[i] = V_REST + (this.V[i] - V_REST) * decayV;
            // Noise — cheap uniform-ish; std ≈ NOISE_AMPLITUDE/√3
            const u1 = rand() - 0.5;
            const u2 = rand() - 0.5;
            this.V[i] += (u1 + u2) * noiseScale;

            if (this.V[i] >= V_THRESHOLD) {
                // Fire
                this.V[i] = V_RESET;
                this.refractory[i] = REFRACTORY_MS;
                this.brightness[i] = BRIGHTNESS_PEAK;
                spikes.push(i);

                // Coincidence flash if both E and I arrived recently
                if (this.recentE[i] > 0.4 && this.recentI[i] > 0.4) {
                    this.coincidenceFlash[i] = 1.0;
                }
            }
        }

        // 5. For each spike, queue deliveries and emit pulses for rendering.
        const ringSize = this.ringSize;
        const ringIdx = this.ringIdx;
        const tStart = this.simTimeMs;
        for (let k = 0; k < spikes.length; k++) {
            const src = spikes[k];
            const start = this.synOutStart[src];
            const end = this.synOutStart[src + 1];
            const srcType = this.types[src];
            const sx = this.positions[src * 3 + 0];
            const sy = this.positions[src * 3 + 1];
            const sz = this.positions[src * 3 + 2];
            const color = srcType === 0 ? COLOR_E : COLOR_I;

            for (let s = start; s < end; s++) {
                const dst = this.synDst[s];
                const w = this.synWeight[s];
                const delay = this.synDelay[s];
                // Slot to deliver into
                const slotsAhead = Math.max(1, Math.round(delay / dt));
                const targetSlot = (ringIdx + slotsAhead) % ringSize;
                this.ring[targetSlot][dst] += w;

                // Emit pulse for rendering
                this._spawnPulse(
                    sx, sy, sz,
                    this.positions[dst * 3 + 0],
                    this.positions[dst * 3 + 1],
                    this.positions[dst * 3 + 2],
                    tStart, tStart + delay,
                    color
                );
            }
        }

        // 6. Advance time and prune expired pulses.
        this.simTimeMs += dt;
        this.ringIdx = (this.ringIdx + 1) % this.ringSize;
        this._prunePulses();

        return spikes.length;
    }

    _spawnPulse(sx, sy, sz, dx, dy, dz, tStart, tEnd, color) {
        if (this.pulseFreeTop === 0) return; // overflow — drop silently
        const slot = this.pulseFreeStack[--this.pulseFreeTop];
        const o = slot * this.pulseStride;
        this.pulseData[o + 0] = sx;
        this.pulseData[o + 1] = sy;
        this.pulseData[o + 2] = sz;
        this.pulseData[o + 3] = dx;
        this.pulseData[o + 4] = dy;
        this.pulseData[o + 5] = dz;
        this.pulseData[o + 6] = tStart;
        this.pulseData[o + 7] = tEnd;
        this.pulseData[o + 8] = color[0];
        this.pulseData[o + 9] = color[1];
        this.pulseData[o + 10] = color[2];
        this.pulseAlive[slot] = 1;
        this.pulseTEnd[slot] = tEnd;
        this.activePulseCount++;
    }

    _prunePulses() {
        // Walk all slots and free expired. Cheap because we only check
        // the alive bit and the tEnd float — fits in cache.
        const now = this.simTimeMs;
        const alive = this.pulseAlive;
        const tEndArr = this.pulseTEnd;
        const free = this.pulseFreeStack;
        let top = this.pulseFreeTop;
        let count = this.activePulseCount;
        for (let i = 0, n = alive.length; i < n; i++) {
            if (alive[i] && tEndArr[i] <= now) {
                alive[i] = 0;
                free[top++] = i;
                count--;
            }
        }
        this.pulseFreeTop = top;
        this.activePulseCount = count;
    }

    // Build a contiguous Float32Array of just the active pulses for
    // upload to the GPU. Returns {data, count}.
    snapshotActivePulses() {
        const stride = this.pulseStride;
        const out = new Float32Array(this.activePulseCount * stride);
        const alive = this.pulseAlive;
        const src = this.pulseData;
        let w = 0;
        for (let i = 0, n = alive.length; i < n; i++) {
            if (alive[i]) {
                const o = i * stride;
                for (let k = 0; k < stride; k++) out[w + k] = src[o + k];
                w += stride;
            }
        }
        return { data: out, count: this.activePulseCount };
    }
}
