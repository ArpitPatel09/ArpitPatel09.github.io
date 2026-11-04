/* Procedural low-poly models for every resource in the GridTech catalog.
 * Each asset exposes: group, anchor (flow endpoint), labelPos, hit (picking box), setCount(n), update(dt, s).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, ZONES } from './terrain.js';

export const COLORS = {
    solar: '#ffc53d', wind: '#4fd6ff', nuclear: '#b28dff', grid: '#e9f1f5', turbine: '#ff8a3d',
    engine: '#ff5e57', fuel: '#6f8dff', battery: '#4dff9d', campus: '#ffffff', reloc: '#ff4fd8',
};

const M = {
    steel: new THREE.MeshStandardMaterial({ color: '#c9cfd3', roughness: 0.45, metalness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: '#eef1f2', roughness: 0.6, metalness: 0.1 }),
    grey: new THREE.MeshStandardMaterial({ color: '#7d878c', roughness: 0.7, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2c3438', roughness: 0.6, metalness: 0.3 }),
    concrete: new THREE.MeshStandardMaterial({ color: '#b4b2aa', roughness: 0.95 }),
    facade: new THREE.MeshStandardMaterial({ color: '#4a565c', roughness: 0.55, metalness: 0.35 }),
    roof: new THREE.MeshStandardMaterial({ color: '#d8dcdc', roughness: 0.8 }),
    panel: new THREE.MeshStandardMaterial({ color: '#1d2f5a', roughness: 0.22, metalness: 0.75, envMapIntensity: 1.4 }),
    frame: new THREE.MeshStandardMaterial({ color: '#a7adb0', roughness: 0.5, metalness: 0.7 }),
    copper: new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.6, metalness: 0.4 }),
    ghost: new THREE.MeshBasicMaterial({ color: '#cfe8ff', wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
};
export const MATERIALS = M;

const glow = (color, intensity = 1) => new THREE.MeshStandardMaterial({ color: '#111', emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 14) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

let smokeTex = null;
function smokeTexture() {
    if (smokeTex) return smokeTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    smokeTex = new THREE.CanvasTexture(c);
    return smokeTex;
}

/** Rising plume of sprites (exhaust or steam). */
class Plume {
    constructor(parent, pos, { count = 12, color = '#dfe4e6', size = 6, rise = 22, spread = 4 } = {}) {
        this.items = [];
        this.rise = rise;
        this.spread = spread;
        this.size = size;
        this.amount = 0;
        for (let i = 0; i < count; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color, transparent: true, depthWrite: false, opacity: 0 }));
            s.position.copy(pos);
            s.userData = { t: i / count, base: pos.clone(), drift: Math.random() * 6.28 };
            parent.add(s);
            this.items.push(s);
        }
    }
    update(dt, amount, windDir = 1) {
        this.amount += (amount - this.amount) * Math.min(1, dt * 2);
        for (const s of this.items) {
            const u = s.userData;
            u.t = (u.t + dt * 0.25) % 1;
            const k = u.t;
            s.position.set(u.base.x + windDir * k * this.spread * 3 + Math.sin(u.drift + k * 4) * 1.2, u.base.y + k * this.rise, u.base.z + Math.cos(u.drift) * k * this.spread);
            const sz = this.size * (0.4 + k * 1.6);
            s.scale.set(sz, sz, 1);
            s.material.opacity = this.amount * Math.sin(Math.PI * k) * 0.55;
            s.visible = this.amount > 0.01;
        }
    }
}

/* ------------------------------------------------------------------ base class */

class Asset {
    constructor(key, name, slots, makeUnit, { ghostUnit } = {}) {
        this.key = key;
        this.name = name;
        this.group = new THREE.Group();
        this.group.name = key;
        this.units = slots.map((s, i) => {
            const u = makeUnit(i);
            u.group.position.copy(s.pos);
            u.group.rotation.y = s.rot || 0;
            this.group.add(u.group);
            return u;
        });
        const g = (ghostUnit || makeUnit)(-1);
        g.group.traverse(o => { if (o.isMesh) { o.material = M.ghost; o.castShadow = false; } if (o.isSprite) o.visible = false; });
        g.group.position.copy(slots[0].pos);
        g.group.rotation.y = slots[0].rot || 0;
        this.ghost = g.group;
        this.group.add(this.ghost);
        this.count = 0;
        this.online = true;
    }
    setCount(n) {
        this.count = n;
        this.units.forEach((u, i) => (u.group.visible = i < n));
        this.ghost.visible = n === 0;
    }
    makeHit(center, size) {
        this.hit = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
        this.hit.position.copy(center);
        this.hit.userData.asset = this.key;
        this.group.add(this.hit);
    }
}

/* ------------------------------------------------------------------ wind */

function windTurbineUnit() {
    const g = new THREE.Group();
    const tower = cyl(0.9, 1.7, 62, M.white, 0, 0, 0, 12);
    const nac = box(3.2, 3.2, 9, M.white, 0, 61, -1.5);
    const rotor = new THREE.Group();
    rotor.position.set(0, 62.6, 3.4);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), M.white);
    hub.scale.set(1, 1, 1.4);
    const bladeG = new THREE.BoxGeometry(1.8, 30, 0.35);
    const pos = bladeG.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = (y + 15) / 30;
        pos.setX(i, pos.getX(i) * (1 - 0.75 * t) + 0.5 * (1 - t));
        pos.setY(i, y + 15.5);
    }
    bladeG.computeVertexNormals();
    const blades = mergeGeometries([0, 1, 2].map(k => bladeG.clone().rotateZ((k * Math.PI * 2) / 3)));
    const bl = new THREE.Mesh(blades, M.white);
    bl.castShadow = true;
    rotor.add(hub, bl);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), glow('#ff2a2a', 0));
    beacon.position.set(0, 63, -4);
    g.add(tower, nac, rotor, beacon);
    return { group: g, rotor, beacon, phase: Math.random() * 6.28 };
}

export class WindFarm extends Asset {
    constructor(scene, max = 40) {
        const slots = [];
        for (let i = 0; i < max; i++) {
            const row = i % 2;
            const x = -620 + Math.floor(i / 2) * 62 + row * 31;
            const z = -720 + (row ? 70 : -40) + Math.sin(i * 1.7) * 18;
            slots.push({ pos: new THREE.Vector3(x, heightAt(x, z) - 0.5, z), rot: 0 });
        }
        super('wind', 'Wind farm', slots, windTurbineUnit);
        scene.add(this.group);
        this.anchor = new THREE.Vector3(0, heightAt(0, -650) + 18, -650);
        this.labelPos = new THREE.Vector3(-0, heightAt(0, -720) + 110, -720);
        this.makeHit(new THREE.Vector3(0, heightAt(0, -720) + 40, -720), new THREE.Vector3(1300, 120, 220));
        this.speed = 0;
    }
    update(dt, s) {
        // rotor speed follows the hour's wind capacity factor, even when the contract is not yet online
        const target = s.windCf * 2.4 + 0.05;
        this.speed += (target - this.speed) * Math.min(1, dt);
        const blink = (Math.sin(s.time * 3.2) > 0.6 ? 1 : 0) * s.night * 3;
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i];
            if (!u.group.visible) continue;
            u.rotor.rotation.z -= dt * this.speed * (0.9 + 0.1 * Math.sin(u.phase));
            u.beacon.material.emissiveIntensity = blink;
        }
        const yaw = s.windYaw;
        for (const u of this.units) u.group.rotation.y = yaw;
        this.ghost.rotation.y = yaw;
    }
}

/* ------------------------------------------------------------------ solar */

export class SolarFarm {
    constructor(scene, maxRows = 30, perRow = 44) {
        this.key = 'solar';
        this.name = 'Solar farm';
        this.group = new THREE.Group();
        const { x: cx, z: cz } = ZONES.solar;
        this.perRow = perRow;
        this.maxRows = maxRows;
        const n = maxRows * perRow;
        const panelG = new THREE.BoxGeometry(6.2, 0.22, 3.3);
        this.panels = new THREE.InstancedMesh(panelG, M.panel, n);
        this.posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.18, 2.6, 5).translate(0, 1.3, 0), M.frame, n);
        this.panels.castShadow = true;
        this.panels.receiveShadow = true;
        this.slots = [];
        for (let r = 0; r < maxRows; r++) {
            for (let k = 0; k < perRow; k++) {
                const x = cx - 150 + r * 10.4;
                const z = cz - 78 + k * 3.55 + (k >= perRow / 2 ? 6 : 0);
                this.slots.push(new THREE.Vector3(x, 2.7, z));
            }
        }
        const m = new THREE.Matrix4();
        this.slots.forEach((p, i) => { m.makeTranslation(p.x, 0, p.z); this.posts.setMatrixAt(i, m); });
        this.group.add(this.panels, this.posts);
        // inverter skids + collector
        for (let i = 0; i < 6; i++) this.group.add(box(4, 2.6, 3, M.white, cx - 160 + i * 52, 0, cz + 96));
        this.group.add(box(14, 6, 10, M.grey, cx + 165, 0, cz + 100));
        // ghost outline of the field when no solar is selected
        this.ghost = new THREE.Mesh(new THREE.BoxGeometry(316, 3, 170), M.ghost);
        this.ghost.position.set(cx + 2, 2, cz + 2);
        this.group.add(this.ghost);
        scene.add(this.group);
        this.anchor = new THREE.Vector3(cx + 165, 18, cz + 100);
        this.labelPos = new THREE.Vector3(cx, 40, cz);
        this.hit = new THREE.Mesh(new THREE.BoxGeometry(330, 30, 200), new THREE.MeshBasicMaterial({ visible: false }));
        this.hit.position.set(cx, 10, cz);
        this.hit.userData.asset = 'solar';
        this.group.add(this.hit);
        this.tilt = 0;
        this.rows = 0;
        this.q = new THREE.Quaternion();
    }
    setCount(rows) {
        this.rows = rows;
        this.panels.count = rows * this.perRow;
        this.posts.count = rows * this.perRow;
        this.ghost.visible = rows === 0;
        this.dirty = true;
    }
    update(dt, s) {
        // single-axis trackers: tilt east-west toward the sun, stow flat at night
        const target = s.sunUp ? THREE.MathUtils.clamp(-s.sunAzX * 0.95, -0.95, 0.95) : 0;
        if (Math.abs(target - this.tilt) > 0.002 || this.dirty) {
            this.tilt += (target - this.tilt) * Math.min(1, dt * 1.5);
            const m = new THREE.Matrix4();
            const e = new THREE.Euler(0, 0, this.tilt);
            this.q.setFromEuler(e);
            const sc = new THREE.Vector3(1, 1, 1);
            const n = this.panels.count;
            for (let i = 0; i < n; i++) { m.compose(this.slots[i], this.q, sc); this.panels.setMatrixAt(i, m); }
            this.panels.instanceMatrix.needsUpdate = true;
            this.posts.instanceMatrix.needsUpdate = true;
            this.dirty = false;
        }
    }
}

/* ------------------------------------------------------------------ onsite gas */

function gasTurbineUnit(i) {
    const g = new THREE.Group();
    g.add(box(18, 0.8, 9, M.concrete));
    g.add(box(15, 7.5, 6.5, M.white, -1, 0.8, 0));
    g.add(box(4.5, 9.5, 8, M.grey, -9.5, 0.8, 0));
    g.add(box(3, 2, 3, M.steel, 7.5, 0.8, 0));
    const stack = cyl(1.8, 2.2, 20, M.steel, 9.5, 0.8, 0);
    g.add(stack);
    const heat = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.6, 14), glow('#ff6a1a', 0));
    heat.position.set(9.5, 21.2, 0);
    g.add(heat);
    const status = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 5.6), glow('#ff8a3d', 0));
    status.position.set(-1, 7.4, 3.3);
    status.rotation.y = Math.PI / 2;
    g.add(status);
    return { group: g, heat, status, stackTop: new THREE.Vector3(9.5, 22, 0) };
}

function engineUnit() {
    const g = new THREE.Group();
    g.add(box(10, 3.2, 3.4, M.white));
    g.add(box(3.4, 1.6, 3.2, M.grey, 3, 3.2, 0));
    g.add(cyl(0.35, 0.4, 3.2, M.steel, -3.4, 3.2, 0.8, 8));
    const status = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 0.1), glow('#ff5e57', 0));
    status.position.set(0, 2.6, 1.75);
    g.add(status);
    return { group: g, status, stackTop: new THREE.Vector3(-3.4, 6.6, 0.8) };
}

function fuelCellUnit() {
    const g = new THREE.Group();
    g.add(box(10, 0.5, 3.6, M.concrete));
    for (let k = 0; k < 4; k++) g.add(box(2.1, 2.6, 2.4, M.white, -3.6 + k * 2.4, 0.5, 0));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.22, 0.08), glow('#6f8dff', 0));
    strip.position.set(0, 2.6, 1.24);
    g.add(strip);
    return { group: g, status: strip };
}

function batteryUnit() {
    const g = new THREE.Group();
    g.add(box(9.5, 3, 2.9, M.white));
    g.add(box(1.2, 1.4, 2.6, M.grey, 5.3, 0, 0));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 0.06), glow('#4dff9d', 0));
    strip.position.set(0, 2.5, 1.48);
    const socBar = new THREE.Mesh(new THREE.BoxGeometry(9, 0.45, 0.06), glow('#4dff9d', 0.8));
    socBar.position.set(0, 1.6, 1.48);
    g.add(strip, socBar);
    return { group: g, strip, socBar };
}

class GasAsset extends Asset {
    constructor(scene, key, name, slots, make, plumeOpts) {
        super(key, name, slots, make);
        scene.add(this.group);
        this.plumes = plumeOpts ? this.units.map(u => new Plume(u.group, u.stackTop, plumeOpts)) : [];
        this.level = 0;
    }
    update(dt, s, frac, color) {
        this.level += (frac - this.level) * Math.min(1, dt * 3);
        const on = this.level;
        this.units.forEach((u, i) => {
            if (!u.group.visible) return;
            u.status.material.emissiveIntensity = 0.15 + on * 2;
            if (u.heat) u.heat.material.emissiveIntensity = on * 2.5;
            if (this.plumes[i]) this.plumes[i].update(dt, on, 1);
        });
    }
}

export function buildOnsite(scene) {
    const tSlots = [0, 1, 2].map(i => ({ pos: new THREE.Vector3(122, 0.1, -62 + i * 15), rot: 0 }));
    const turbine = new GasAsset(scene, 'turbine', 'Gas turbines', tSlots, gasTurbineUnit, { count: 14, size: 7, rise: 34, color: '#d9dcdc' });
    turbine.anchor = new THREE.Vector3(122, 4, -20);
    turbine.labelPos = new THREE.Vector3(122, 34, -48);
    turbine.makeHit(new THREE.Vector3(122, 10, -47), new THREE.Vector3(30, 22, 50));

    const eSlots = [];
    for (let i = 0; i < 12; i++) eSlots.push({ pos: new THREE.Vector3(158 + (i % 2) * 16, 0.1, -66 + Math.floor(i / 2) * 9), rot: 0 });
    const engine = new GasAsset(scene, 'engine', 'Gas engines', eSlots, engineUnit, { count: 6, size: 3.2, rise: 14, color: '#c9cccc' });
    engine.anchor = new THREE.Vector3(166, 4, -12);
    engine.labelPos = new THREE.Vector3(166, 24, -42);
    engine.makeHit(new THREE.Vector3(166, 6, -42), new THREE.Vector3(34, 14, 60));

    const fSlots = [];
    for (let i = 0; i < 6; i++) fSlots.push({ pos: new THREE.Vector3(122, 0.1, 18 + i * 8), rot: 0 });
    const fuel = new GasAsset(scene, 'fuel', 'Fuel cells', fSlots, fuelCellUnit, null);
    fuel.anchor = new THREE.Vector3(122, 4, 12);
    fuel.labelPos = new THREE.Vector3(122, 20, 38);
    fuel.makeHit(new THREE.Vector3(122, 5, 38), new THREE.Vector3(22, 12, 56));

    const bSlots = [];
    for (let i = 0; i < 12; i++) bSlots.push({ pos: new THREE.Vector3(158 + (i % 2) * 16, 0.1, 14 + Math.floor(i / 2) * 8), rot: 0 });
    const battery = new Asset('battery', '4-hour battery', bSlots, batteryUnit);
    scene.add(battery.group);
    battery.anchor = new THREE.Vector3(166, 4, 12);
    battery.labelPos = new THREE.Vector3(166, 20, 38);
    battery.makeHit(new THREE.Vector3(166, 5, 36), new THREE.Vector3(34, 12, 52));
    battery.update = function (dt, s) {
        const chg = s.chg > 1e-6, dis = s.dis > 1e-6;
        const col = chg ? '#4dff9d' : dis ? '#ffb02e' : '#7fb8ff';
        const soc = s.emax > 0 ? s.soc / s.emax : 0;
        this.units.forEach(u => {
            if (!u.group.visible) return;
            u.strip.material.emissive.set(col);
            u.strip.material.emissiveIntensity = chg || dis ? 1.6 + Math.sin(s.time * 6) * 0.5 : 0.4;
            u.socBar.scale.x = Math.max(0.02, soc);
            u.socBar.position.x = -4.5 + 4.5 * Math.max(0.02, soc);
            u.socBar.material.emissive.set(soc > 0.6 ? '#4dff9d' : soc > 0.25 ? '#ffd34d' : '#ff6b5e');
        });
    };
    return { turbine, engine, fuel, battery };
}

/* ------------------------------------------------------------------ nuclear (offsite) */

export class Nuclear {
    constructor(scene) {
        this.key = 'nuclear';
        this.name = 'Nuclear plant';
        const { x, z } = ZONES.nuclear;
        this.group = new THREE.Group();
        this.group.position.set(x, 0, z);
        const pts = [];
        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const r = 26 - 14 * Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.95 + (t > 0.85 ? (t - 0.85) * 30 : 0);
            pts.push(new THREE.Vector2(r, t * 78));
        }
        const towerMat = M.concrete.clone();
        const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), towerMat);
        tower.material.side = THREE.DoubleSide;
        tower.position.set(-40, 0, 0);
        tower.castShadow = true;
        const tower2 = tower.clone();
        tower2.position.set(-40, 0, 62);
        const dome = new THREE.Group();
        dome.add(cyl(16, 16, 28, M.white, 0, 0, 0, 28));
        const cap = new THREE.Mesh(new THREE.SphereGeometry(16, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
        cap.position.y = 28;
        dome.add(cap);
        dome.position.set(30, 0, 10);
        this.real = new THREE.Group();
        this.real.add(tower, tower2, dome, box(46, 18, 22, M.grey, 40, 0, 50), box(10, 30, 10, M.white, 64, 0, 18));
        this.group.add(this.real);
        this.plumes = [new Plume(this.group, new THREE.Vector3(-40, 80, 0), { count: 18, size: 30, rise: 70, spread: 6, color: '#f4f6f7' }),
            new Plume(this.group, new THREE.Vector3(-40, 80, 62), { count: 18, size: 30, rise: 70, spread: 6, color: '#f4f6f7' })];
        this.ghost = this.real.clone();
        this.ghost.traverse(o => { if (o.isMesh) { o.material = M.ghost; o.castShadow = false; } });
        this.group.add(this.ghost);
        scene.add(this.group);
        this.anchor = new THREE.Vector3(x + 70, 18, z - 40);
        this.labelPos = new THREE.Vector3(x, 120, z);
        this.hit = new THREE.Mesh(new THREE.BoxGeometry(200, 100, 160), new THREE.MeshBasicMaterial({ visible: false }));
        this.hit.position.set(0, 40, 30);
        this.hit.userData.asset = 'nuclear';
        this.group.add(this.hit);
        this.level = 0;
    }
    setCount(n) { this.real.visible = n > 0; this.ghost.visible = n === 0; this.scaleMw = n; }
    update(dt, s, frac) {
        this.level += (frac - this.level) * Math.min(1, dt * 2);
        for (const p of this.plumes) p.update(dt, this.real.visible ? this.level : 0, 1);
    }
}

/* ------------------------------------------------------------------ data center campus */

export class DataCenter {
    constructor(scene) {
        this.key = 'campus';
        this.name = 'Data center campus';
        this.group = new THREE.Group();
        this.halls = [];
        this.fans = [];
        const winMat = () => new THREE.MeshStandardMaterial({ color: '#0a1418', emissive: '#7fe7ff', emissiveIntensity: 0, roughness: 0.3 });
        for (let i = 0; i < 3; i++) {
            const x = -40 + i * 40;
            const hall = new THREE.Group();
            hall.position.set(x, 0, -6);
            hall.add(box(30, 13, 66, M.facade));
            hall.add(box(30.4, 0.6, 66.4, M.roof, 0, 13, 0));
            const strips = [];
            for (const side of [-1, 1]) {
                for (let r = 0; r < 2; r++) {
                    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 60), winMat());
                    s.position.set(side * 15.08, 4 + r * 4.6, 0);
                    hall.add(s);
                    strips.push(s);
                }
            }
            const front = new THREE.Mesh(new THREE.BoxGeometry(24, 0.7, 0.12), winMat());
            front.position.set(0, 8.6, 33.08);
            hall.add(front);
            strips.push(front);
            for (let k = 0; k < 8; k++) {
                const u = box(5, 2.2, 5, M.grey, (k % 2 ? 6.5 : -6.5), 13.6, -24 + Math.floor(k / 2) * 16);
                hall.add(u);
                const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.2, 10), M.dark);
                fan.position.set(u.position.x, 16.05, u.position.z);
                const blade = box(3.4, 0.1, 0.5, M.steel);
                blade.position.y = 0.12;
                fan.add(blade);
                hall.add(fan);
                this.fans.push(fan);
            }
            this.group.add(hall);
            this.halls.push({ group: hall, strips });
        }
        // office, cooling plant, fence
        this.group.add(box(48, 9, 16, M.white, 0, 0, 52));
        this.office = new THREE.Mesh(new THREE.BoxGeometry(44, 1.2, 0.12), winMat());
        this.office.position.set(0, 5, 60.1);
        this.group.add(this.office);
        for (let k = 0; k < 6; k++) this.group.add(cyl(3, 3, 7, M.white, -62 + (k % 3) * 8, 0, -48 + Math.floor(k / 3) * 8, 12));
        const fenceMat = new THREE.MeshStandardMaterial({ color: '#6b7478', transparent: true, opacity: 0.55, roughness: 0.8 });
        const fence = (w, d, x, z) => { const f = box(w, 2.4, d, fenceMat, x, 0, z); f.castShadow = false; this.group.add(f); };
        fence(148, 0.2, 0, 76); fence(148, 0.2, 0, -78); fence(0.2, 154, -74, -1); fence(0.2, 154, 74, -1);
        // construction crane shown before the opening month
        this.crane = new THREE.Group();
        this.crane.add(box(1.6, 48, 1.6, glow('#ffb02e', 0.25), 0, 0, 0));
        const jib = box(46, 1.2, 1.4, glow('#ffb02e', 0.25), 14, 46, 0);
        this.crane.add(jib, box(4, 3, 3, M.grey, -8, 44, 0));
        this.crane.position.set(52, 0, -20);
        this.group.add(this.crane);
        // lamp posts
        this.lamps = [];
        for (let k = 0; k < 10; k++) {
            const x = -66 + k * 14.6;
            const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), glow('#ffd9a0', 0));
            lamp.position.set(x, 7, 70);
            this.group.add(cyl(0.18, 0.2, 7, M.grey, x, 0, 70, 6), lamp);
            this.lamps.push(lamp);
        }
        scene.add(this.group);
        this.anchor = new THREE.Vector3(40, 6, -6);
        this.labelPos = new THREE.Vector3(0, 34, -6);
        this.hit = new THREE.Mesh(new THREE.BoxGeometry(150, 30, 150), new THREE.MeshBasicMaterial({ visible: false }));
        this.hit.position.set(0, 10, 0);
        this.hit.userData.asset = 'campus';
        this.group.add(this.hit);
    }
    update(dt, s) {
        const halls = s.loadFrac <= 0 ? 0 : Math.max(1, Math.round(s.loadFrac * 3));
        const col = s.intr > 0.01 ? '#ff5e57' : s.reloc > 0.01 ? '#ff4fd8' : '#7fe7ff';
        this.halls.forEach((h, i) => {
            const on = i < halls;
            const flicker = s.intr > 0.01 ? 0.6 + 0.4 * Math.sin(s.time * 14 + i) : 1;
            for (const st of h.strips) {
                st.material.emissive.set(col);
                st.material.emissiveIntensity = on ? (1 + s.night * 0.9) * flicker : 0.03;
            }
        });
        const spin = s.loadFrac * (1 + s.heatIndex);
        this.fans.forEach((f, i) => { if (Math.floor(i / 8) < halls) f.rotation.y += dt * spin * 9; });
        this.crane.visible = s.loadFrac <= 0;
        this.crane.rotation.y += dt * 0.15;
        this.office.material.emissive.set('#ffe2b0');
        this.office.material.emissiveIntensity = s.night * 1.1;
        for (const l of this.lamps) l.material.emissiveIntensity = s.night * 2.2;
    }
}

/* ------------------------------------------------------------------ switchyards, pylons, grid, remote site */

function switchyard(x, z, scale = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    for (let i = 0; i < 3; i++) {
        const t = new THREE.Group();
        t.add(box(5 * scale, 4.5 * scale, 4 * scale, M.grey));
        for (let f = 0; f < 4; f++) t.add(box(0.2, 3.6 * scale, 3.6 * scale, M.dark, -2.8 * scale, 0.4, 0));
        t.add(cyl(0.4, 0.4, 3, M.copper, -1, 4.5 * scale, 0, 6), cyl(0.4, 0.4, 3, M.copper, 1, 4.5 * scale, 0, 6));
        t.position.set(-10 + i * 10, 0, -6);
        g.add(t);
    }
    for (let i = 0; i < 4; i++) {
        const gx = -14 + i * 9.5;
        g.add(box(0.5, 12, 0.5, M.steel, gx, 0, 8), box(0.5, 12, 0.5, M.steel, gx, 0, 14));
        g.add(box(0.6, 0.6, 6.5, M.steel, gx, 12, 11));
    }
    g.add(box(30, 0.3, 0.3, M.copper, 0, 11.2, 11));
    return g;
}

export function pylonGeometry() {
    const parts = [];
    const leg = (x, z) => {
        const g = new THREE.CylinderGeometry(0.25, 0.4, 24, 4);
        g.translate(0, 12, 0);
        const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(z * 0.06, 0, -x * 0.06));
        g.applyMatrix4(m);
        g.translate(x * 1.6, 0, z * 1.6);
        parts.push(g);
    };
    leg(1, 1); leg(-1, 1); leg(1, -1); leg(-1, -1);
    parts.push(new THREE.BoxGeometry(0.4, 22, 0.4).translate(0, 13, 0));
    parts.push(new THREE.BoxGeometry(12, 0.5, 0.6).translate(0, 22, 0));
    parts.push(new THREE.BoxGeometry(8, 0.45, 0.5).translate(0, 18, 0));
    for (const xx of [-5.6, 5.6, -3.8, 3.8]) parts.push(new THREE.BoxGeometry(0.2, 1.6, 0.2).translate(xx, xx * xx > 20 ? 21 : 17, 0));
    return mergeGeometries(parts);
}

export function buildGridInfra(scene) {
    const campusYard = switchyard(80, 0);
    const gridSub = switchyard(-80, 70, 1.25);
    scene.add(campusYard, gridSub);

    // city skyline = ERCOT market
    const city = new THREE.Group();
    const cityWin = new THREE.MeshStandardMaterial({ color: '#30383c', emissive: '#ffd59a', emissiveIntensity: 0, roughness: 0.7 });
    for (let i = 0; i < 46; i++) {
        const w = 12 + Math.random() * 18, h = 20 + Math.pow(Math.random(), 2) * 110;
        const x = -1650 + (Math.random() - 0.5) * 300, z = 260 + (Math.random() - 0.5) * 260;
        const b = box(w, h, w, i % 3 ? M.facade : cityWin, x, heightAt(x, z) - 1, z);
        b.castShadow = false;
        city.add(b);
    }
    scene.add(city);

    // remote data center (receives relocated Tier 1 work during grid emergencies)
    const { x: rx, z: rz } = ZONES.remote;
    const remote = new THREE.Group();
    remote.add(box(50, 12, 30, M.facade, rx, 0, rz), box(50.4, 0.5, 30.4, M.roof, rx, 12, rz));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), glow('#ff4fd8', 0.4));
    beacon.position.set(rx, 26, rz);
    remote.add(cyl(0.4, 0.5, 14, M.steel, rx, 12, rz, 6), beacon);
    scene.add(remote);

    return { campusYard, gridSub, city, cityWin, remote, remoteBeacon: beacon };
}
