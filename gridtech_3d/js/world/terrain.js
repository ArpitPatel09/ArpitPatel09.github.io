/* Terrain, roads and vegetation. One height function drives the ground mesh and every placement. */
import * as THREE from 'three';

// Site zones that must stay flat (centre x, z, half-size x, z)
export const ZONES = {
    campus: { x: 40, z: 0, hx: 230, hz: 150 },
    solar: { x: -430, z: -250, hx: 175, hz: 120 },
    nuclear: { x: -760, z: 470, hx: 120, hz: 110 },
    remote: { x: 980, z: -560, hx: 70, hz: 60 },
};

function hash(x, z) {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
}
function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
    return s;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function flatMask(x, z) {
    let m = 1;
    for (const k in ZONES) {
        const zn = ZONES[k];
        const dx = Math.max(0, Math.abs(x - zn.x) - zn.hx), dz = Math.max(0, Math.abs(z - zn.z) - zn.hz);
        m = Math.min(m, smooth(0, 120, Math.hypot(dx, dz)));
    }
    return m;
}

/** Ground height at (x, z). A wind ridge runs east-west around z = -720. */
export function heightAt(x, z) {
    const hills = (fbm(x / 420, z / 420) - 0.45) * 90;
    const ridge = Math.exp(-(((z + 720) / 170) ** 2)) * 55 * (0.7 + 0.3 * vnoise(x / 300, 3.1));
    const far = smooth(1400, 2600, Math.hypot(x, z)) * 160 * fbm(x / 900 + 7, z / 900);
    return (Math.max(-8, hills) + ridge + far) * flatMask(x, z);
}

export function buildTerrain(scene) {
    const size = 14000, seg = 440;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grass = new THREE.Color('#7f9a52'), dry = new THREE.Color('#b8a46a'), dark = new THREE.Color('#5d7a3e'), rock = new THREE.Color('#9a8f7a');
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = heightAt(x, z);
        pos.setY(i, h);
        const n = fbm(x / 160 + 11, z / 160);
        c.copy(grass).lerp(dry, smooth(0.35, 0.75, n)).lerp(dark, smooth(0.55, 0.9, fbm(x / 60, z / 60)) * 0.5);
        if (h > 45) c.lerp(rock, smooth(45, 120, h) * 0.6);
        colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);

    // gravel pads under the campus and offsite plants
    const pad = (x, z, w, d, color, y = 0.08) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, y, z);
        m.receiveShadow = true;
        scene.add(m);
        return m;
    };
    pad(0, 0, 150, 160, '#8d9294');        // campus hardstand
    pad(152, 0, 120, 160, '#a39d8e', 0.1); // onsite 8-acre energy pad
    pad(80, 0, 34, 50, '#9a9a96', 0.12);   // switchyard
    pad(-80, 70, 46, 40, '#9a9a96', 0.12); // grid substation
    pad(ZONES.solar.x, ZONES.solar.z, 330, 220, '#9c9a76', 0.05);
    pad(ZONES.nuclear.x, ZONES.nuclear.z, 200, 180, '#9b9a94', 0.06);
    pad(ZONES.remote.x, ZONES.remote.z, 110, 90, '#8d9294', 0.06);

    // roads
    const roadMat = new THREE.MeshStandardMaterial({ color: '#3d4245', roughness: 0.9 });
    const road = (pts, w = 9) => {
        const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.25, z)));
        const n = 140;
        const verts = [], idx = [];
        for (let i = 0; i <= n; i++) {
            const p = curve.getPoint(i / n), t = curve.getTangent(i / n);
            const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(w / 2);
            verts.push(p.x + side.x, heightAt(p.x + side.x, p.z + side.z) + 0.3, p.z + side.z, p.x - side.x, heightAt(p.x - side.x, p.z - side.z) + 0.3, p.z - side.z);
            if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, roadMat);
        m.receiveShadow = true;
        scene.add(m);
    };
    road([[0, 90], [0, 200], [-60, 420], [-300, 700], [-700, 1100]]);
    road([[-60, 120], [-200, 60], [-420, -110], [-430, -130]], 7);
    road([[90, 85], [260, 120], [600, 60], [1100, 0]], 7);
    road([[-200, 60], [-500, 300], [-700, 380]], 7);

    return ground;
}

/** Scatter instanced trees outside the built zones. */
export function buildTrees(scene, count = 900) {
    const trunkG = new THREE.CylinderGeometry(0.5, 0.7, 4, 5);
    trunkG.translate(0, 2, 0);
    const crownG = new THREE.ConeGeometry(4, 11, 6);
    crownG.translate(0, 9, 0);
    const roundG = new THREE.IcosahedronGeometry(4.6, 0);
    roundG.translate(0, 7.5, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 1 }), count);
    const crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: '#4f6b34', roughness: 1, flatShading: true }), Math.ceil(count / 2));
    const round = new THREE.InstancedMesh(roundG, new THREE.MeshStandardMaterial({ color: '#647d3c', roughness: 1, flatShading: true }), Math.ceil(count / 2));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let placed = 0, ci = 0, ri = 0, tries = 0;
    const col = new THREE.Color();
    while (placed < count && tries < count * 20) {
        tries++;
        const r = 120 + Math.pow(Math.random(), 0.8) * 1500;
        const a = Math.random() * Math.PI * 2;
        const x = Math.cos(a) * r + 40, z = Math.sin(a) * r;
        if (flatMask(x, z) < 0.98) continue;
        if (Math.abs(z + 720) < 110 && Math.abs(x) < 700) continue; // keep the wind ridge open
        if (fbm(x / 220, z / 220) < 0.48) continue; // clumps
        const y = heightAt(x, z);
        const sc = 0.7 + Math.random() * 0.7;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
        m.compose(p.set(x, y, z), q, s.set(sc, sc * (0.8 + Math.random() * 0.4), sc));
        trunk.setMatrixAt(placed, m);
        col.setHSL(0.24 + Math.random() * 0.06, 0.35 + Math.random() * 0.15, 0.25 + Math.random() * 0.1);
        if (placed % 2 === 0 && ci < crown.count) { crown.setMatrixAt(ci, m); crown.setColorAt(ci++, col); }
        else if (ri < round.count) { round.setMatrixAt(ri, m); round.setColorAt(ri++, col); }
        placed++;
    }
    trunk.count = placed; crown.count = ci; round.count = ri;
    for (const im of [trunk, crown, round]) { im.castShadow = false; im.receiveShadow = false; scene.add(im); }
}
