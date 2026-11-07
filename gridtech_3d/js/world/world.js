/* The 3D world: renderer, sky/day-night cycle, assets, energy links, labels, picking and camera moves. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildTerrain, buildTrees, heightAt, ZONES } from './terrain.js';
import { WindFarm, SolarFarm, Nuclear, DataCenter, buildOnsite, buildGridInfra, COLORS } from './models.js';
import { FlowLink, overheadRoute, placePylons, busduct, arc } from './flows.js';

const LAT = THREE.MathUtils.degToRad(30.6);

export const VIEWS = {
    overview: { pos: [560, 360, 560], target: [-140, 0, -170], label: 'Overview' },
    campus: { pos: [175, 85, 175], target: [30, 6, -4], label: 'Data center' },
    onsite: { pos: [250, 62, 70], target: [145, 4, -12], label: 'Onsite yard' },
    solar: { pos: [-230, 110, -70], target: [-430, 0, -250], label: 'Solar' },
    wind: { pos: [330, 190, -390], target: [0, 70, -720], label: 'Wind' },
    nuclear: { pos: [-540, 140, 660], target: [-760, 30, 470], label: 'Nuclear' },
    grid: { pos: [10, 70, 190], target: [-80, 8, 70], label: 'Grid tie' },
    remote: { pos: [760, 170, -330], target: [980, 10, -560], label: 'Remote DC' },
};

const gaugeFrag = /* glsl */ `
uniform float uFill; uniform float uCap; uniform float uTime; uniform float uAlert;
varying vec2 vUv;
void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r < 0.72 || r > 1.0) discard;
    float a = (atan(p.x, p.y) + 3.14159265) / 6.2831853;
    vec3 track = vec3(0.12, 0.16, 0.18);
    vec3 col = track;
    float alpha = 0.55;
    if (a > uCap) { col = vec3(0.5, 0.08, 0.06) * (0.6 + 0.4 * sin(uTime * 6.0) * uAlert); alpha = 0.7; }
    if (a < uFill) { col = mix(vec3(0.3, 0.9, 1.0), vec3(1.0, 0.75, 0.2), smoothstep(0.7, 1.0, uFill / max(uCap, 0.01))) * 2.2; alpha = 0.95; }
    float edge = smoothstep(0.72, 0.75, r) * (1.0 - smoothstep(0.97, 1.0, r));
    gl_FragColor = vec4(col, alpha * edge);
}`;

export class World {
    constructor(container, { preview = false, still = false } = {}) {
        this.container = container;
        this.preview = preview;
        this.still = still;
        this.lite = preview && !still; // the small card preview trades quality for speed
        this.time = 0;
        this.onPick = null;
        this.onHover = null;
        this.labelsOn = !preview;
        this.state = null;
    }

    init() {
        const W = this.container.clientWidth, H = this.container.clientHeight;
        const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.lite, powerPreference: 'high-performance' }));
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lite ? 1 : 1.75));
        renderer.setSize(W, H);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.55;
        renderer.shadowMap.enabled = !this.lite;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(renderer.domElement);

        const scene = (this.scene = new THREE.Scene());
        scene.fog = new THREE.Fog('#b9cad3', 1500, 6500);
        const camera = (this.camera = new THREE.PerspectiveCamera(48, W / H, 1, 12000));
        camera.position.set(...VIEWS.overview.pos);

        const controls = (this.controls = new OrbitControls(camera, renderer.domElement));
        controls.target.set(...VIEWS.overview.target);
        if (this.preview) { camera.position.set(400, 250, 430); controls.target.set(-70, 0, -150); }
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.maxPolarAngle = Math.PI * 0.47;
        controls.minDistance = 40;
        controls.maxDistance = 2600;
        controls.autoRotate = this.preview && !this.still;
        controls.autoRotateSpeed = 0.35;
        controls.addEventListener('start', () => (this.tween = null));

        // sky + PBR environment
        this.sky = new Sky();
        this.sky.scale.setScalar(10000);
        const u = this.sky.material.uniforms;
        u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
        scene.add(this.sky);
        this.pmrem = new THREE.PMREMGenerator(renderer);
        this.envScene = new THREE.Scene();
        this.envSky = new Sky();
        this.envSky.scale.setScalar(1000);
        this.envScene.add(this.envSky);
        this.lastEnvSun = new THREE.Vector3(9, 9, 9);

        // stars + moon
        const sg = new THREE.BufferGeometry();
        const sp = [];
        for (let i = 0; i < 2200; i++) {
            const v = new THREE.Vector3().randomDirection();
            if (v.y < 0.02) v.y = Math.abs(v.y) + 0.02;
            sp.push(v.x * 8000, v.y * 8000, v.z * 8000);
        }
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
        scene.add(this.stars);
        this.moon = new THREE.Mesh(new THREE.SphereGeometry(110, 24, 16), new THREE.MeshBasicMaterial({ color: '#f3f0e6', fog: false, transparent: true }));
        scene.add(this.moon);

        // lights
        this.hemi = new THREE.HemisphereLight('#cfe6ff', '#6b6a4a', 0.6);
        scene.add(this.hemi);
        const sun = (this.sun = new THREE.DirectionalLight('#fff3dc', 2.2));
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.left = -260; sc.right = 260; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 1800;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.6;
        sun.target.position.set(40, 0, 0);
        scene.add(sun, sun.target);
        this.moonLight = new THREE.DirectionalLight('#9db8ff', 0);
        this.moonLight.position.set(-300, 600, 300);
        scene.add(this.moonLight);
        this.campusGlow = new THREE.PointLight('#8fe9ff', 0, 260, 1.6);
        this.campusGlow.position.set(0, 40, 0);
        scene.add(this.campusGlow);

        // clouds
        this.clouds = [];
        const ctex = (() => {
            const c = document.createElement('canvas');
            c.width = 128; c.height = 64;
            const g = c.getContext('2d');
            for (let i = 0; i < 9; i++) {
                const x = 20 + Math.random() * 88, y = 24 + Math.random() * 18, r = 14 + Math.random() * 16;
                const gr = g.createRadialGradient(x, y, 1, x, y, r);
                gr.addColorStop(0, 'rgba(255,255,255,0.85)');
                gr.addColorStop(1, 'rgba(255,255,255,0)');
                g.fillStyle = gr;
                g.fillRect(0, 0, 128, 64);
            }
            return new THREE.CanvasTexture(c);
        })();
        for (let i = 0; i < 26; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
            s.position.set((Math.random() - 0.5) * 4000, 520 + Math.random() * 260, (Math.random() - 0.5) * 4000);
            const k = 500 + Math.random() * 600;
            s.scale.set(k, k * 0.45, 1);
            scene.add(s);
            this.clouds.push(s);
        }

        // ground, scenery, assets
        buildTerrain(scene);
        buildTrees(scene, this.lite ? 450 : 900);
        this.assets = {};
        this.assets.wind = new WindFarm(scene);
        this.assets.solar = new SolarFarm(scene);
        this.assets.nuclear = new Nuclear(scene);
        this.assets.campus = new DataCenter(scene);
        Object.assign(this.assets, buildOnsite(scene));
        this.infra = buildGridInfra(scene);

        // links
        const pylons = [];
        const L = (this.links = {});
        const subTop = new THREE.Vector3(-80, 16, 70);
        const route = (path, extra = []) => [...overheadRoute(path, { pylons }), ...extra];
        L.solar = new FlowLink(scene, route([[-265, -150], [-220, -70], [-140, 30], [-90, 64]], [subTop]), COLORS.solar, { radius: 0.9 });
        L.wind = new FlowLink(scene, route([[0, -650], [-30, -420], [-70, -160], [-82, 50]], [subTop]), COLORS.wind, { radius: 0.9 });
        L.nuclear = new FlowLink(scene, route([[-690, 430], [-420, 320], [-220, 190], [-96, 88]], [subTop]), COLORS.nuclear, { radius: 0.9 });
        L.market = new FlowLink(scene, route([[-1500, 250], [-1000, 140], [-520, 100], [-200, 86], [-100, 74]], [subTop]), COLORS.grid, { radius: 1 });
        L.import = new FlowLink(scene, [subTop, new THREE.Vector3(-60, 13, 92), new THREE.Vector3(10, 13, 96), new THREE.Vector3(70, 13, 70), new THREE.Vector3(80, 12, 14)], '#bfe8ff', { radius: 1.3 });
        L.turbine = new FlowLink(scene, busduct([[118, -40], [100, -22], [86, -6]]), COLORS.turbine, { radius: 0.8 });
        L.engine = new FlowLink(scene, busduct([[160, -14], [118, -8], [90, -2]]), COLORS.engine, { radius: 0.8 });
        L.fuel = new FlowLink(scene, busduct([[118, 14], [100, 8], [88, 4]]), COLORS.fuel, { radius: 0.8 });
        L.battery = new FlowLink(scene, busduct([[160, 12], [128, 6], [92, 2]]), COLORS.battery, { radius: 0.8 });
        L.campus = new FlowLink(scene, busduct([[72, 0], [64, -3], [56, -6]], 7), '#ffffff', { radius: 1.5 });
        L.reloc = new FlowLink(scene, arc(new THREE.Vector3(0, 22, -6), new THREE.Vector3(ZONES.remote.x, 26, ZONES.remote.z)), COLORS.reloc, { radius: 1.6, segments: 120 });
        placePylons(scene, pylons);

        // import gauge over the grid substation
        this.gauge = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.ShaderMaterial({
            uniforms: { uFill: { value: 0 }, uCap: { value: 1 }, uTime: { value: 0 }, uAlert: { value: 0 } },
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: gaugeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        }));
        this.gauge.position.set(-80, 42, 70);
        scene.add(this.gauge);

        // extra pick targets
        const hitBox = (key, pos, size) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ visible: false }));
            m.position.set(...pos);
            m.userData.asset = key;
            scene.add(m);
            return m;
        };
        this.hits = Object.values(this.assets).map(a => a.hit).filter(Boolean);
        this.hits.push(hitBox('grid', [-80, 12, 70], [50, 30, 44]), hitBox('market', [-1650, 60, 260], [340, 160, 300]), hitBox('remote', [ZONES.remote.x, 15, ZONES.remote.z], [80, 40, 60]), hitBox('yard', [80, 8, 0], [36, 18, 50]));

        // labels
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(W, H);
        const lr = this.labelRenderer.domElement;
        lr.className = 'labels';
        this.container.appendChild(lr);
        this.labels = {};
        const mk = (key, pos, title, cls = '') => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'tag ' + cls;
            el.innerHTML = `<i></i><b>${title}</b><span>-</span>`;
            el.addEventListener('click', e => { e.stopPropagation(); this.onPick && this.onPick(key); });
            const o = new CSS2DObject(el);
            o.position.copy(pos);
            scene.add(o);
            this.labels[key] = { obj: o, el, val: el.querySelector('span') };
            el.style.setProperty('--c', COLORS[{ fuel: 'fuel', engine: 'engine', turbine: 'turbine', battery: 'battery', grid: 'grid', market: 'grid', remote: 'reloc', campus: 'campus' }[key] || key] || '#fff');
        };
        mk('campus', this.assets.campus.labelPos, 'Data center', 'tag--big');
        mk('solar', this.assets.solar.labelPos, 'Solar');
        mk('wind', this.assets.wind.labelPos, 'Wind');
        mk('nuclear', this.assets.nuclear.labelPos, 'Nuclear');
        mk('turbine', this.assets.turbine.labelPos, 'Gas turbine');
        mk('engine', this.assets.engine.labelPos, 'Engines');
        mk('fuel', this.assets.fuel.labelPos, 'Fuel cells');
        mk('battery', this.assets.battery.labelPos, 'Battery');
        mk('grid', new THREE.Vector3(-80, 66, 70), 'Grid import', 'tag--big');
        mk('market', new THREE.Vector3(-1650, 190, 260), 'ERCOT market');
        mk('remote', new THREE.Vector3(ZONES.remote.x, 46, ZONES.remote.z), 'Remote site');
        this.setLabels(this.labelsOn);

        // post-processing
        this.composer = new EffectComposer(renderer);
        this.composer.addPass(new RenderPass(scene, camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.4, 0.35, 0.85);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());

        // picking
        this.ray = new THREE.Raycaster();
        this.ptr = new THREE.Vector2();
        let down = null;
        const el = renderer.domElement;
        el.addEventListener('pointerdown', e => (down = [e.clientX, e.clientY]));
        el.addEventListener('pointerup', e => {
            if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
            const k = this.pickAt(e);
            if (k && this.onPick) this.onPick(k);
        });
        el.addEventListener('pointermove', e => {
            if (e.buttons) return;
            const k = this.pickAt(e);
            el.style.cursor = k ? 'pointer' : '';
            this.hoverKey = k;
            for (const key in this.labels) this.labels[key].el.classList.toggle('is-hover', key === k);
        });

        this.resizeObs = new ResizeObserver(() => this.resize());
        this.resizeObs.observe(this.container);
        this.clock = new THREE.Clock();
        this.setSunFrom(13, 172, 1);
        this.running = true;
        renderer.setAnimationLoop(() => this.frame());
    }

    pickAt(e) {
        const r = this.renderer.domElement.getBoundingClientRect();
        this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.ray.setFromCamera(this.ptr, this.camera);
        const hit = this.ray.intersectObjects(this.hits, false)[0];
        return hit ? hit.object.userData.asset : null;
    }

    resize() {
        const W = this.container.clientWidth, H = this.container.clientHeight;
        if (!W || !H) return;
        this.camera.aspect = W / H;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(W, H);
        this.composer.setSize(W, H);
        this.labelRenderer.setSize(W, H);
    }

    setLabels(on) {
        this.labelsOn = on;
        for (const k in this.labels) this.labels[k].obj.visible = on;
    }

    setPaused(p) {
        this.running = !p;
        this.renderer.setAnimationLoop(p ? null : () => this.frame());
    }

    /** Show the right number of units for a portfolio. units: { solarRows, wind, turbine, engine, fuel, battery, nuclear } */
    setPortfolio(units) {
        const a = this.assets;
        a.solar.setCount(units.solarRows);
        a.wind.setCount(units.wind);
        a.turbine.setCount(units.turbine);
        a.engine.setCount(units.engine);
        a.fuel.setCount(units.fuel);
        a.battery.setCount(units.battery);
        a.nuclear.setCount(units.nuclear);
    }

    flyTo(name) {
        const v = VIEWS[name];
        if (!v) return;
        this.controls.autoRotate = false;
        this.tween = { t: 0, from: this.camera.position.clone(), to: new THREE.Vector3(...v.pos), tf: this.controls.target.clone(), tt: new THREE.Vector3(...v.target) };
    }

    /** Sun/moon from local hour, day of year and a night override 0..1 */
    setSunFrom(hod, doy) {
        const dec = THREE.MathUtils.degToRad(23.44) * Math.sin((2 * Math.PI * (284 + doy)) / 365);
        const H = THREE.MathUtils.degToRad(15 * (hod - 12.5));
        const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
        const cosEl = Math.sqrt(Math.max(1e-6, 1 - sinEl * sinEl));
        // azimuth from north, clockwise (east = +90 deg); world axes: north = -z, east = +x
        const sinA = (-Math.sin(H) * Math.cos(dec)) / cosEl;
        const cosA = (Math.sin(dec) - sinEl * Math.sin(LAT)) / (cosEl * Math.cos(LAT));
        const dir = new THREE.Vector3(cosEl * sinA, sinEl, -cosEl * cosA).normalize();
        this.sunDir = dir;
        this.sinEl = sinEl;
    }

    applyLighting(s) {
        const dir = this.sunDir;
        const sinEl = this.sinEl;
        const day = THREE.MathUtils.smoothstep(sinEl, -0.12, 0.12);
        const night = 1 - day;
        const golden = THREE.MathUtils.smoothstep(sinEl, -0.05, 0.08) * (1 - THREE.MathUtils.smoothstep(sinEl, 0.1, 0.4));
        this.night = night;
        const u = this.sky.material.uniforms;
        const cloud = s ? s.cloud : 0;
        u.sunPosition.value.copy(dir);
        u.turbidity.value = 4 + cloud * 10;
        u.rayleigh.value = 1.2 + golden * 1.8 + cloud * 0.6;
        this.sun.position.copy(dir).multiplyScalar(900).add(this.sun.target.position);
        this.sun.intensity = 2.6 * day * (1 - cloud * 0.55);
        this.sun.color.setHSL(0.09 + 0.04 * (1 - golden), 0.6 * golden + 0.25, 0.85);
        this.sun.castShadow = day > 0.05 && !this.lite;
        this.moonLight.intensity = 0.75 * night;
        this.hemi.intensity = 0.34 + 0.41 * day;
        this.hemi.color.set(night > 0.5 ? '#5a74a0' : '#cfe6ff');
        this.hemi.groundColor.set(night > 0.5 ? '#1b2026' : '#6b6a4a');
        this.renderer.toneMappingExposure = 0.5 + 0.22 * night;
        this.stars.material.opacity = THREE.MathUtils.smoothstep(night, 0.5, 1) * 0.95;
        const mdir = dir.clone().multiplyScalar(-1);
        mdir.y = Math.abs(mdir.y) * 0.8 + 0.25;
        this.moon.position.copy(mdir.normalize().multiplyScalar(7000));
        this.moon.material.opacity = night;
        this.moonLight.position.copy(mdir).multiplyScalar(900);
        const fogDay = new THREE.Color('#bccdd6').lerp(new THREE.Color('#e7b48f'), golden * 0.6).lerp(new THREE.Color('#9aa6ad'), cloud * 0.5);
        this.scene.fog.color.copy(fogDay.lerp(new THREE.Color('#0b1520'), night));
        // night keeps a soft glow on lights and power lines without washing out the scene
        this.bloom.strength = 0.3 + night * 0.22;
        this.bloom.threshold = 0.86 - night * 0.08;
        this.campusGlow.intensity = night * 1.4 * (s ? Math.min(1, s.loadFrac * 1.5) : 0);
        for (const c of this.clouds) c.material.opacity = (0.2 + cloud * 0.7) * (0.25 + 0.75 * day);
        if (this.lastEnvSun.distanceTo(dir) > 0.04) {
            this.envSky.material.uniforms.sunPosition.value.copy(dir);
            if (this.envRT) this.envRT.dispose();
            this.envRT = this.pmrem.fromScene(this.envScene);
            this.scene.environment = this.envRT.texture;
            this.lastEnvSun.copy(dir);
        }
        this.scene.environmentIntensity = 0.3 + 0.7 * day;
    }

    /** Push one simulated hour into the scene. */
    update(s) {
        this.state = s;
    }

    frame() {
        const dt = Math.min(0.05, this.clock.getDelta());
        this.time += dt;
        const s = this.state;
        if (s) {
            this.setSunFrom(s.hodFrac, s.doy);
            this.applyLighting(s);
            const ctx = {
                time: this.time, night: this.night, windCf: s.windCf, windYaw: s.windYaw, sunUp: this.sinEl > 0,
                sunAzX: Math.atan2(this.sunDir.x, Math.max(0.05, this.sunDir.y)), loadFrac: s.loadFrac, intr: s.intr, reloc: s.reloc,
                chg: s.chg, dis: s.dis, soc: s.soc, emax: s.emax, heatIndex: s.heatIndex,
            };
            const a = this.assets;
            a.wind.update(dt, ctx);
            a.solar.update(dt, ctx);
            a.campus.update(dt, ctx);
            a.turbine.update(dt, ctx, s.frac.turbine);
            a.engine.update(dt, ctx, s.frac.engine);
            a.fuel.update(dt, ctx, s.frac.fuel);
            a.battery.update(dt, ctx);
            a.nuclear.update(dt, ctx, s.frac.nuclear);
            const norm = Math.max(25, s.peak);
            const L = this.links;
            L.solar.set(s.mw.solar, norm * 0.8);
            L.wind.set(s.mw.wind, norm * 0.8);
            L.nuclear.set(s.mw.nuclear, norm * 0.5);
            L.market.set(s.mw.grid, norm * 0.8);
            L.import.set(s.mw.import, norm);
            L.turbine.set(s.mw.turbine, norm * 0.5);
            L.engine.set(s.mw.engine, norm * 0.5);
            L.fuel.set(s.mw.fuel, norm * 0.5);
            L.battery.set(s.mw.dis - s.mw.chg, norm * 0.2);
            L.campus.set(s.mw.local, norm);
            L.reloc.set(s.mw.reloc, norm * 0.12);
            const alert = s.stress ? 1 : 0;
            for (const k of ['import', 'market', 'solar', 'wind', 'nuclear']) L[k].uniforms.uAlert.value = alert;
            const g = this.gauge.material.uniforms;
            g.uFill.value += ((s.ordinary > 0 ? s.mw.import / s.ordinary : 0) - g.uFill.value) * Math.min(1, dt * 4);
            g.uCap.value = s.ordinary > 0 ? s.cap / s.ordinary : 0;
            g.uAlert.value = alert;
            g.uTime.value = this.time;
            this.infra.cityWin.emissiveIntensity = this.night * 0.9;
            this.infra.remoteBeacon.material.emissiveIntensity = 0.4 + (s.mw.reloc > 0.01 ? 4 + 2 * Math.sin(this.time * 8) : 0);
            if (this.labelsOn && s.labels) for (const k in s.labels) if (this.labels[k]) {
                const lab = this.labels[k];
                if (lab.val.textContent !== s.labels[k].text) lab.val.textContent = s.labels[k].text;
                lab.el.classList.toggle('is-off', !!s.labels[k].off);
                lab.el.classList.toggle('is-alert', !!s.labels[k].alert);
            }
        }
        for (const k in this.links) this.links[k].update(dt, this.time);
        for (const c of this.clouds) { c.position.x += dt * 6; if (c.position.x > 2200) c.position.x = -2200; }
        this.gauge.quaternion.copy(this.camera.quaternion);
        if (this.tween) {
            const t = (this.tween.t = Math.min(1, this.tween.t + dt / 1.6));
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
            this.controls.target.lerpVectors(this.tween.tf, this.tween.tt, e);
            if (t >= 1) this.tween = null;
        }
        this.controls.update();
        this.composer.render();
        if (this.labelsOn) this.labelRenderer.render(this.scene, this.camera);
    }
}
