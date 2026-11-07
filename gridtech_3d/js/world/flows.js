/* Animated energy links: a glowing conduit whose pulse density, speed and brightness follow the MW flowing through it. */
import * as THREE from 'three';
import { heightAt, } from './terrain.js';
import { pylonGeometry, MATERIALS } from './models.js';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const frag = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uLen;
uniform float uDir;
uniform float uAlert;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
    float spacing = mix(26.0, 9.0, clamp(uFlow, 0.0, 1.0));
    float x = vUv.x * uLen - uTime * uDir * (14.0 + 40.0 * uFlow);
    float f = fract(x / spacing);
    float pulse = smoothstep(0.0, 0.18, f) * (1.0 - smoothstep(0.18, 0.55, f));
    float on = step(0.002, uFlow);
    float core = 0.18 + 0.82 * on;
    vec3 base = mix(vec3(0.16, 0.19, 0.21), uColor, 0.35 + 0.65 * on);
    vec3 alert = vec3(1.0, 0.2, 0.15) * uAlert * (0.5 + 0.5 * sin(uTime * 7.0));
    vec3 col = base * core + uColor * pulse * on * (1.0 + 1.6 * uFlow) + alert * 0.5;
    float a = 0.35 + 0.65 * on;
    gl_FragColor = vec4(col, a);
}`;

export class FlowLink {
    constructor(scene, points, color, { radius = 0.55, segments = 160 } = {}) {
        this.curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3);
        this.len = this.curve.getLength();
        this.uniforms = {
            uTime: { value: 0 }, uFlow: { value: 0 }, uLen: { value: this.len }, uDir: { value: 1 }, uAlert: { value: 0 },
            uColor: { value: new THREE.Color(color) },
        };
        const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
        this.mesh = new THREE.Mesh(new THREE.TubeGeometry(this.curve, segments, radius, 6, false), mat);
        this.mesh.renderOrder = 2;
        scene.add(this.mesh);
        this.flow = 0;
        this.mw = 0;
    }
    /** mw: signed flow (negative reverses the pulses), norm: MW that reads as "full" */
    set(mw, norm) {
        this.mw = mw;
        this.target = Math.min(1, Math.abs(mw) / Math.max(norm, 1e-6));
        if (Math.abs(mw) > 1e-6) this.uniforms.uDir.value = mw >= 0 ? 1 : -1;
    }
    update(dt, time) {
        this.flow += ((this.target || 0) - this.flow) * Math.min(1, dt * 4);
        this.uniforms.uFlow.value = this.flow;
        this.uniforms.uTime.value = time;
    }
}

/** Overhead route: pylons along a ground path, conduit at cross-arm height. */
export function overheadRoute(path, { spacing = 70, height = 22, pylons = [] } = {}) {
    const ground = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const len = ground.getLength();
    const n = Math.max(2, Math.round(len / spacing));
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const p = ground.getPoint(i / n);
        const y = heightAt(p.x, p.z);
        pts.push(new THREE.Vector3(p.x, y + height, p.z));
        if (i > 0 && i < n) {
            const t = ground.getTangent(i / n);
            pylons.push({ x: p.x, y, z: p.z, rot: Math.atan2(t.x, t.z) + Math.PI / 2 });
        }
    }
    // add a sag between towers
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push(a);
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 3.2;
        out.push(mid);
    }
    out.push(pts[pts.length - 1]);
    return out;
}

export function placePylons(scene, pylons) {
    const im = new THREE.InstancedMesh(pylonGeometry(), MATERIALS.steel, pylons.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    pylons.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, s);
        im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    scene.add(im);
    return im;
}

/** Low busduct between onsite equipment (raised on short supports). */
export function busduct(pts, h = 3.2) {
    return pts.map(([x, z]) => new THREE.Vector3(x, h, z));
}

/** High arc used for workload relocation to the remote site. */
export function arc(a, b, lift = 260) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const p = a.clone().lerp(b, t);
        p.y += Math.sin(Math.PI * t) * lift;
        pts.push(p);
    }
    return pts;
}
