/**
 * Interactive Battery & ECM Virtual Laboratory Studio Engine
 * Powers real-time simulations:
 * 1. 4-Wire Kelvin Sensing Bridge (2-wire vs 4-wire lead drop)
 * 2. Static OCV & Dither Hysteresis Collapse
 * 3. UDDS Dynamic Drive Cycle Oscilloscope
 * 4. ESC Equivalent Circuit Model Voltage Decomposition
 * 5. BMS Safe Operating Area (SOA) & Contactor Interlock
 */

(function () {
    'use strict';

    // Wait for DOM
    document.addEventListener('DOMContentLoaded', initStudio);

    function initStudio() {
        const studio = document.getElementById('bms-studio');
        if (!studio) return;

        // Mode Switching
        const modeBtns = studio.querySelectorAll('.bms-smode');
        const views = studio.querySelectorAll('.bms-view');
        let currentMode = 'kelvin';

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.smode;
                if (mode === currentMode) return;
                currentMode = mode;

                modeBtns.forEach(b => b.classList.toggle('is-active', b === btn));
                views.forEach(v => v.classList.toggle('is-active', v.id === `sview-${mode}`));

                updateTelemetry(mode);
                drawActiveCanvas(mode);
            });
        });

        // =====================================================================
        // MODE 1: 4-WIRE KELVIN BRIDGE
        // =====================================================================
        const kelvinCurrentSlider = document.getElementById('kelvin-current');
        const kelvinCurrentVal = document.getElementById('kelvin-current-val');
        const btn2Wire = document.getElementById('btn-2wire');
        const btn4Wire = document.getElementById('btn-4wire');
        const kelvinBanner = document.getElementById('kelvin-banner');
        const kelvinStatusText = document.getElementById('kelvin-status-text');
        const canvasKelvin = document.getElementById('canvas-kelvin');

        let is4Wire = true;
        let testCurrent = 60;
        const R_lead = 0.001; // 1 mOhm per lead
        const V_cell_true = 3.900;

        function updateKelvin() {
            testCurrent = parseFloat(kelvinCurrentSlider.value);
            kelvinCurrentVal.textContent = `${testCurrent} A`;

            const leadDrop_mV = testCurrent * R_lead * 2 * 1000; // Two leads
            const vMeasured = is4Wire ? V_cell_true : (V_cell_true - leadDrop_mV / 1000);
            const error_mV = is4Wire ? 0.0 : leadDrop_mV;

            const dot = kelvinBanner.querySelector('.bms-status-dot');
            if (is4Wire) {
                dot.className = 'bms-status-dot is-good';
                kelvinStatusText.innerHTML = `<b>4-Wire Kelvin Active:</b> Voltage sense leads carry zero current (I_sense = 0). Voltmeter reads true electrochemical potential <b>${vMeasured.toFixed(3)} V</b> with <b>0.0 mV lead error</b>.`;
            } else {
                dot.className = 'bms-status-dot is-trip';
                kelvinStatusText.innerHTML = `<b>2-Wire Lead Error Alert:</b> Lead resistance (2 mΩ round-trip) drops <b>${leadDrop_mV.toFixed(1)} mV</b> at ${testCurrent} A! Voltmeter reads <b>${vMeasured.toFixed(3)} V</b> (corrupts SOC estimate by ${(leadDrop_mV/15).toFixed(1)}%).`;
            }

            renderKelvinCanvas(canvasKelvin, is4Wire, testCurrent, leadDrop_mV, vMeasured);
            if (currentMode === 'kelvin') updateTelemetry('kelvin');
        }

        kelvinCurrentSlider.addEventListener('input', updateKelvin);
        btn2Wire.addEventListener('click', () => {
            is4Wire = false;
            btn2Wire.classList.add('is-active');
            btn4Wire.classList.remove('is-active');
            updateKelvin();
        });
        btn4Wire.addEventListener('click', () => {
            is4Wire = true;
            btn4Wire.classList.add('is-active');
            btn2Wire.classList.remove('is-active');
            updateKelvin();
        });

        function renderKelvinCanvas(canvas, is4W, current, drop_mV, vMeas) {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            // Background grid
            ctx.strokeStyle = '#182530';
            ctx.lineWidth = 1;
            for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
            for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

            // High Current Power Cycler (Left)
            ctx.fillStyle = '#16232d';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(30, 70, 110, 140, 8);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Battery Cycler', 85, 120);
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(`${current} A`, 85, 145);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.fillText('Power Source', 85, 165);

            // Cell Under Test (Center-Right)
            ctx.fillStyle = '#16232d';
            ctx.strokeStyle = '#f5c542';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(260, 60, 90, 160, 10);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#f5c542';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText('Li-ion Cell', 305, 115);
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 13px sans-serif';
            ctx.fillText('3.900 V', 305, 140);
            ctx.fillStyle = '#34d378';
            ctx.font = '10px sans-serif';
            ctx.fillText('True E_chem', 305, 160);

            // Terminals on Cell
            ctx.fillStyle = '#f5c542';
            ctx.fillRect(295, 48, 20, 12);
            ctx.fillText('+', 305, 42);
            ctx.fillRect(295, 220, 20, 12);
            ctx.fillText('−', 305, 245);

            // Power Leads (Thick Orange lines)
            ctx.strokeStyle = '#fb7185';
            ctx.lineWidth = 4;
            // Top lead
            ctx.beginPath();
            ctx.moveTo(140, 100);
            ctx.lineTo(295, 54);
            ctx.stroke();
            // Bottom lead
            ctx.beginPath();
            ctx.moveTo(140, 180);
            ctx.lineTo(295, 226);
            ctx.stroke();

            ctx.fillStyle = '#fb7185';
            ctx.font = '10px sans-serif';
            ctx.fillText(`Power Lead: R_lead = 1 mΩ`, 210, 70);

            // Voltmeter / AFE
            const vmX = 470;
            const vmY = 140;
            ctx.fillStyle = '#16232d';
            ctx.strokeStyle = is4W ? '#34d378' : '#fb7185';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(vmX, vmY, 38, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = is4W ? '#34d378' : '#fb7185';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(is4W ? 'Kelvin Sense' : '2-Wire Sense', vmX, vmY - 10);
            ctx.font = 'bold 15px sans-serif';
            ctx.fillStyle = '#f8fafc';
            ctx.fillText(`${vMeas.toFixed(3)} V`, vmX, vmY + 12);
            ctx.font = '9px sans-serif';
            ctx.fillStyle = is4W ? '#34d378' : '#fb7185';
            ctx.fillText(is4W ? 'Error: 0.0 mV' : `Err: -${drop_mV.toFixed(1)} mV`, vmX, vmY + 26);

            // Sense lines
            if (is4W) {
                // Independent sense leads directly from cell tabs
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 1.8;
                ctx.setLineDash([5, 4]);
                // Top sense
                ctx.beginPath();
                ctx.moveTo(315, 54);
                ctx.lineTo(435, 54);
                ctx.lineTo(vmX, vmY - 38);
                ctx.stroke();
                // Bottom sense
                ctx.beginPath();
                ctx.moveTo(315, 226);
                ctx.lineTo(435, 226);
                ctx.lineTo(vmX, vmY + 38);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#38bdf8';
                ctx.fillText('Sense Leads: I_sense = 0 A (Zero Loss)', 440, 42);
            } else {
                // 2-Wire taps into the power lead at the cycler terminals
                ctx.strokeStyle = '#fb7185';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(140, 100);
                ctx.lineTo(vmX, 100);
                ctx.lineTo(vmX, vmY - 38);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(140, 180);
                ctx.lineTo(vmX, 180);
                ctx.lineTo(vmX, vmY + 38);
                ctx.stroke();
                ctx.fillStyle = '#fb7185';
                ctx.fillText('2-Wire Taps Include Lead Drop!', 380, 90);
            }
        }

        // =====================================================================
        // MODE 2: STATIC OCV & DITHER HYSTERESIS COLLAPSE
        // =====================================================================
        const staticTempSlider = document.getElementById('static-temp');
        const staticTempVal = document.getElementById('static-temp-val');
        const btnToggleHyst = document.getElementById('btn-toggle-hyst');
        const btnDither = document.getElementById('btn-dither');
        const canvasStatic = document.getElementById('canvas-static');
        const staticStatusText = document.getElementById('static-status-text');

        let cellTemp = 25;
        let showHyst = false;
        let ditherActive = false;
        let ditherProgress = 0;

        function updateStatic() {
            cellTemp = parseInt(staticTempSlider.value);
            staticTempVal.textContent = `${cellTemp}°C`;

            const coulombicEff = (99.8 - Math.max(0, 25 - cellTemp) * 0.12).toFixed(1);
            const capacityAh = (2.50 * (1 - (25 - cellTemp) * 0.003)).toFixed(2);

            staticStatusText.innerHTML = `<b>C/30 Protocol at ${cellTemp}°C:</b> Coulombic efficiency <b>η = ${coulombicEff}%</b>, Available Capacity <b>Q = ${capacityAh} Ah</b>. Thermal Nernst voltage shift <b>${((cellTemp - 25) * 0.45).toFixed(1)} mV</b>.`;

            renderStaticCanvas(canvasStatic, cellTemp, showHyst, ditherActive, ditherProgress);
            if (currentMode === 'static') updateTelemetry('static');
        }

        staticTempSlider.addEventListener('input', updateStatic);
        btnToggleHyst.addEventListener('click', () => {
            showHyst = !showHyst;
            btnToggleHyst.classList.toggle('is-active', showHyst);
            updateStatic();
        });

        btnDither.addEventListener('click', () => {
            if (ditherActive) return;
            ditherActive = true;
            btnDither.classList.add('is-active');
            ditherProgress = 0;

            const interval = setInterval(() => {
                ditherProgress += 0.05;
                renderStaticCanvas(canvasStatic, cellTemp, showHyst, ditherActive, ditherProgress);
                if (ditherProgress >= 1.0) {
                    clearInterval(interval);
                    ditherActive = false;
                    btnDither.classList.remove('is-active');
                    showHyst = false;
                    btnToggleHyst.classList.remove('is-active');
                    updateStatic();
                }
            }, 30);
        });

        function renderStaticCanvas(canvas, temp, hyst, dither, prog) {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            // Plot area
            const padL = 60, padR = 30, padT = 30, padB = 40;
            const pw = w - padL - padR;
            const ph = h - padT - padB;

            // Grid
            ctx.strokeStyle = '#182530';
            ctx.lineWidth = 1;
            for (let v = 3.4; v <= 4.2; v += 0.2) {
                const y = padT + ph - ((v - 3.4) / 0.8) * ph;
                ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
                ctx.fillStyle = '#64748b';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(v.toFixed(1) + ' V', padL - 8, y + 3);
            }
            for (let s = 0; s <= 100; s += 25) {
                const x = padL + (s / 100) * pw;
                ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
                ctx.fillStyle = '#64748b';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(s + '%', x, padT + ph + 16);
            }
            ctx.fillText('State of Charge (SOC)', padL + pw / 2, h - 8);

            // OCV curve calculation
            const nShift = (temp - 25) * 0.00045;
            const hystSep = (hyst ? 0.035 : 0) * (dither ? (1 - prog) : 1);

            function calcOCV(socFrac) {
                return 3.42 + 0.45 * Math.pow(socFrac, 0.4) + 0.32 * socFrac + 0.04 * Math.pow(socFrac, 3) + nShift * Math.sin(Math.PI * socFrac);
            }

            // Draw Charge curve (if hysteresis enabled)
            if (hyst || dither) {
                ctx.strokeStyle = '#fb7185';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                for (let i = 0; i <= 100; i++) {
                    const soc = i / 100;
                    const v = calcOCV(soc) + hystSep;
                    const x = padL + soc * pw;
                    const y = padT + ph - ((v - 3.4) / 0.8) * ph;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();

                // Draw Discharge curve
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                for (let i = 0; i <= 100; i++) {
                    const soc = i / 100;
                    const v = calcOCV(soc) - hystSep;
                    const x = padL + soc * pw;
                    const y = padT + ph - ((v - 3.4) / 0.8) * ph;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            // Draw Central OCV curve (Gold)
            ctx.strokeStyle = '#f5c542';
            ctx.lineWidth = 2.8;
            ctx.beginPath();
            for (let i = 0; i <= 100; i++) {
                const soc = i / 100;
                const v = calcOCV(soc);
                const x = padL + soc * pw;
                const y = padT + ph - ((v - 3.4) / 0.8) * ph;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Legend
            ctx.textAlign = 'left';
            ctx.fillStyle = '#f5c542';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(`— True OCV(z, ${temp}°C)`, padL + 15, padT + 18);
            if (hyst || dither) {
                ctx.fillStyle = '#fb7185';
                ctx.fillText(`— C/30 Charge (+Hysteresis)`, padL + 175, padT + 18);
                ctx.fillStyle = '#38bdf8';
                ctx.fillText(`— C/30 Discharge (−Hysteresis)`, padL + 360, padT + 18);
            }

            // Dither Animation effect
            if (dither && prog < 1.0) {
                ctx.fillStyle = 'rgba(245, 197, 66, 0.8)';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`⚡ DITHER SIGNAL EXCITING VOLTAGE BOUNDARIES · COLLAPSING HYSTERESIS ${(prog*100).toFixed(0)}%`, padL + pw/2, padT + 40);
            }
        }

        // =====================================================================
        // MODE 3: UDDS DYNAMIC DRIVE TELEMETRY OSCILLOSCOPE
        // =====================================================================
        const canvasUDDS = document.getElementById('canvas-udds');
        const btnUddsRun = document.getElementById('btn-udds-run');
        const btnUddsPause = document.getElementById('btn-udds-pause');
        const btnUddsReset = document.getElementById('btn-udds-reset');
        const uddsR0Slider = document.getElementById('udds-r0');
        const uddsR0Val = document.getElementById('udds-r0-val');
        const uddsTauSlider = document.getElementById('udds-tau');
        const uddsTauVal = document.getElementById('udds-tau-val');

        let uddsRunning = true;
        let uddsTime = 0;
        let uddsR0 = 0.015;
        let uddsTau = 15;
        let uddsAnimId = null;

        // Precompute UDDS profile
        const uddsLen = 800;
        const uddsData = [];
        for (let i = 0; i < uddsLen; i++) {
            const p1 = Math.sin(i * 0.08) * 1.8;
            const p2 = Math.sin(i * 0.22) * 1.2;
            const pulse = (i % 50 < 15) ? (Math.sin(i * 0.5) * 2.5) : 0;
            uddsData.push(p1 + p2 + pulse);
        }

        function updateUDDSParams() {
            uddsR0 = parseInt(uddsR0Slider.value) / 1000;
            uddsR0Val.textContent = `${(uddsR0 * 1000).toFixed(0)} mΩ`;
            uddsTau = parseInt(uddsTauSlider.value);
            uddsTauVal.textContent = `${uddsTau} s`;
            if (currentMode === 'udds') updateTelemetry('udds');
        }

        uddsR0Slider.addEventListener('input', updateUDDSParams);
        uddsTauSlider.addEventListener('input', updateUDDSParams);

        btnUddsRun.addEventListener('click', () => {
            uddsRunning = true;
            btnUddsRun.classList.add('is-active');
            btnUddsPause.classList.remove('is-active');
        });
        btnUddsPause.addEventListener('click', () => {
            uddsRunning = false;
            btnUddsPause.classList.add('is-active');
            btnUddsRun.classList.remove('is-active');
        });
        btnUddsReset.addEventListener('click', () => {
            uddsTime = 0;
        });

        function animateUDDS() {
            if (uddsRunning && currentMode === 'udds') {
                uddsTime = (uddsTime + 1) % (uddsLen - 150);
                renderUDDSCanvas(canvasUDDS, uddsTime, uddsR0, uddsTau);
            }
            uddsAnimId = requestAnimationFrame(animateUDDS);
        }
        animateUDDS();

        function renderUDDSCanvas(canvas, tIndex, r0, tau) {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const midY = h / 2;
            const padL = 50, padR = 20, padT = 20, padB = 25;
            const pw = w - padL - padR;

            // Grid
            ctx.strokeStyle = '#182530';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, midY); ctx.lineTo(padL + pw, midY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL + pw, padT); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(padL, h - padB); ctx.lineTo(padL + pw, h - padB); ctx.stroke();

            // Scope Labels
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = '#f5c542';
            ctx.textAlign = 'left';
            ctx.fillText('CH 1: UDDS Current Profile (A)', padL + 10, padT + 12);
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('CH 2: Cell Terminal Voltage Response V_t(t)', padL + 10, midY + 16);

            // Channel 1: Current trace (Top half)
            ctx.strokeStyle = '#f5c542';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            const winSize = 140;
            for (let i = 0; i < winSize; i++) {
                const cur = uddsData[tIndex + i];
                const x = padL + (i / winSize) * pw;
                const y = (padT + (midY - padT) / 2) - (cur / 4.0) * ((midY - padT) / 2 - 10);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Channel 2: Terminal Voltage trace (Bottom half)
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            let lastV = 3.82;
            for (let i = 0; i < winSize; i++) {
                const cur = uddsData[tIndex + i];
                const v_r0 = - cur * r0 * 3.5;
                const v_rc = - cur * (r0 * 1.5) * (1 - Math.exp(- (i % 20) / (tau * 0.2)));
                const vt = 3.85 + v_r0 + v_rc;
                lastV = vt;
                const x = padL + (i / winSize) * pw;
                const y = (midY + (h - padB - midY) / 2) - ((vt - 3.85) / 0.25) * ((h - padB - midY) / 2 - 10);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Scanning Cursor Dot
            const curX = padL + pw;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(curX - 2, (padT + (midY - padT) / 2) - (uddsData[tIndex + winSize - 1] / 4.0) * ((midY - padT) / 2 - 10), 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#34d378';
            ctx.beginPath();
            ctx.arc(curX - 2, (midY + (h - padB - midY) / 2) - ((lastV - 3.85) / 0.25) * ((h - padB - midY) / 2 - 10), 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // =====================================================================
        // MODE 4: ESC VOLTAGE DECOMPOSITION
        // =====================================================================
        const ecmPulseSlider = document.getElementById('ecm-pulse-i');
        const ecmPulseVal = document.getElementById('ecm-pulse-val');
        const ecmR0Slider = document.getElementById('ecm-r0');
        const ecmR0Val = document.getElementById('ecm-r0-val');
        const ecmTauSlider = document.getElementById('ecm-tau');
        const ecmTauVal = document.getElementById('ecm-tau-val');
        const canvasECM = document.getElementById('canvas-ecm');

        let ecmI = 10;
        let ecmR0 = 0.018;
        let ecmTau = 20;

        function updateECM() {
            ecmI = parseFloat(ecmPulseSlider.value);
            ecmPulseVal.textContent = `${ecmI} A`;
            ecmR0 = parseInt(ecmR0Slider.value) / 1000;
            ecmR0Val.textContent = `${(ecmR0 * 1000).toFixed(0)} mΩ`;
            ecmTau = parseInt(ecmTauSlider.value);
            ecmTauVal.textContent = `${ecmTau} s`;

            renderECMCanvas(canvasECM, ecmI, ecmR0, ecmTau);
            if (currentMode === 'ecm') updateTelemetry('ecm');
        }

        ecmPulseSlider.addEventListener('input', updateECM);
        ecmR0Slider.addEventListener('input', updateECM);
        ecmTauSlider.addEventListener('input', updateECM);

        function renderECMCanvas(canvas, I, R0, tau) {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const padL = 60, padR = 25, padT = 30, padB = 40;
            const pw = w - padL - padR;
            const ph = h - padT - padB;

            // Time axis: 0 to 180 seconds
            // Pulse active from 30s to 110s
            const tPulseStart = 30;
            const tPulseEnd = 110;
            const tTotal = 180;

            const OCV_base = 4.05;
            const ohmicDrop = I * R0;
            const R1 = 0.025;
            const vrc_max = I * R1;

            // Grid
            ctx.strokeStyle = '#182530';
            ctx.lineWidth = 1;
            for (let v = 3.6; v <= 4.1; v += 0.1) {
                const y = padT + ph - ((v - 3.6) / 0.5) * ph;
                ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
                ctx.fillStyle = '#64748b';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(v.toFixed(2) + ' V', padL - 8, y + 3);
            }
            for (let t = 0; t <= tTotal; t += 30) {
                const x = padL + (t / tTotal) * pw;
                ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
                ctx.fillStyle = '#64748b';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(t + ' s', x, padT + ph + 16);
            }
            ctx.fillText('Pulse Time (seconds)', padL + pw / 2, h - 8);

            // 1. Draw OCV Line (White Dashed)
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            for (let t = 0; t <= tTotal; t++) {
                let ocv = OCV_base;
                if (t >= tPulseStart && t <= tPulseEnd) ocv -= 0.0008 * (t - tPulseStart);
                else if (t > tPulseEnd) ocv -= 0.0008 * (tPulseEnd - tPulseStart);
                const x = padL + (t / tTotal) * pw;
                const y = padT + ph - ((ocv - 3.6) / 0.5) * ph;
                if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // 2. Draw Terminal Voltage Vt(t) (Gold Solid Line)
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.8;
            ctx.beginPath();
            for (let t = 0; t <= tTotal; t++) {
                let ocv = OCV_base;
                if (t >= tPulseStart && t <= tPulseEnd) ocv -= 0.0008 * (t - tPulseStart);
                else if (t > tPulseEnd) ocv -= 0.0008 * (tPulseEnd - tPulseStart);

                let vt = ocv;
                if (t >= tPulseStart && t < tPulseEnd) {
                    const dt = t - tPulseStart;
                    const vrc = vrc_max * (1 - Math.exp(-dt / tau));
                    vt = ocv - ohmicDrop - vrc;
                } else if (t >= tPulseEnd) {
                    const dt = t - tPulseEnd;
                    const vrc_end = vrc_max * (1 - Math.exp(-(tPulseEnd - tPulseStart) / tau));
                    const vrc_relax = vrc_end * Math.exp(-dt / tau);
                    vt = ocv - vrc_relax;
                }
                const x = padL + (t / tTotal) * pw;
                const y = padT + ph - ((vt - 3.6) / 0.5) * ph;
                if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Annotate the 3 Regions
            const x30 = padL + (30 / tTotal) * pw;
            const yJumpTop = padT + ph - ((OCV_base - 3.6) / 0.5) * ph;
            const yJumpBot = padT + ph - (((OCV_base - ohmicDrop) - 3.6) / 0.5) * ph;

            // Ohmic Step indicator
            ctx.strokeStyle = '#fb7185';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x30 + 8, yJumpTop);
            ctx.lineTo(x30 + 8, yJumpBot);
            ctx.stroke();
            ctx.fillStyle = '#fb7185';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`1. Instant Ohmic Step: I·R₀ = ${(ohmicDrop * 1000).toFixed(0)} mV`, x30 + 14, (yJumpTop + yJumpBot) / 2 + 3);

            // Diffusion Sag
            ctx.fillStyle = '#34d378';
            ctx.fillText(`2. Diffusion Sag: R₁||C₁ (τ = ${tau} s)`, padL + (50 / tTotal) * pw, yJumpBot + 35);

            // Relaxation
            const x110 = padL + (110 / tTotal) * pw;
            ctx.fillStyle = '#f5c542';
            ctx.fillText(`3. Relaxation Cutoff`, x110 + 10, yJumpBot - 20);
        }

        // =====================================================================
        // MODE 5: BMS SAFE OPERATING AREA & CONTACTOR TRIP
        // =====================================================================
        const bmsVSlider = document.getElementById('bms-v');
        const bmsVVal = document.getElementById('bms-v-val');
        const bmsISlider = document.getElementById('bms-i');
        const bmsIVal = document.getElementById('bms-i-val');
        const bmsTSlider = document.getElementById('bms-t');
        const bmsTVal = document.getElementById('bms-t-val');
        const canvasBMS = document.getElementById('canvas-bms');
        const bmsSafetyBanner = document.getElementById('bms-safety-banner');
        const bmsSafetyDot = document.getElementById('bms-safety-dot');
        const bmsSafetyText = document.getElementById('bms-safety-text');

        let bmsV = 3.80;
        let bmsI = 15;
        let bmsT = 28;

        function updateBMS() {
            bmsV = parseFloat(bmsVSlider.value);
            bmsI = parseFloat(bmsISlider.value);
            bmsT = parseFloat(bmsTSlider.value);

            bmsVVal.textContent = `${bmsV.toFixed(2)} V`;
            bmsIVal.textContent = `${bmsI > 0 ? bmsI + ' A (Dchg)' : (bmsI < 0 ? Math.abs(bmsI) + ' A (Chg)' : '0 A')}`;
            bmsTVal.textContent = `${bmsT} °C`;

            // State Machine
            let status = 'NORMAL';
            let dotClass = 'is-good';
            let bannerMsg = 'BMS STATUS: NORMAL OPERATING REGION · All Safety Interlocks Closed · Contactor Active.';

            if (bmsV > 4.25) {
                status = 'TRIP_OV';
                dotClass = 'is-trip';
                bannerMsg = 'EMERGENCY TRIP: Overvoltage Exceeded (>4.25V) · Contactor FORCED OPEN in 8 ms · Pack Isolated.';
            } else if (bmsV < 2.50) {
                status = 'TRIP_UV';
                dotClass = 'is-trip';
                bannerMsg = 'EMERGENCY TRIP: Undervoltage Limit (<2.50V) · Load Disconnected · Copper Shunt Dissolution Avoided.';
            } else if (bmsT > 55) {
                status = 'TRIP_OT';
                dotClass = 'is-trip';
                bannerMsg = 'THERMAL RUNAWAY INTERLOCK (>55°C) · Pyrofuse Armed · Contactor OPENED · Emergency Coolant Max.';
            } else if (bmsT < 0 && bmsI < 0) {
                status = 'WARN_COLD';
                dotClass = 'is-warn';
                bannerMsg = 'WARNING: Sub-Zero Charging Interlock (<0°C) · Charge Blocked to Prevent Irreversible Lithium Metal Plating.';
            } else if (bmsT > 45) {
                status = 'WARN_HOT';
                dotClass = 'is-warn';
                bannerMsg = 'THERMAL DERATE (45°C to 55°C) · Discharge Power Reduced 50% · Chiller Pump at 100% Duty Cycle.';
            }

            bmsSafetyDot.className = `bms-status-dot ${dotClass}`;
            bmsSafetyText.textContent = bannerMsg;

            renderBMSCanvas(canvasBMS, bmsV, bmsI, bmsT, status);
            if (currentMode === 'bms') updateTelemetry('bms');
        }

        bmsVSlider.addEventListener('input', updateBMS);
        bmsISlider.addEventListener('input', updateBMS);
        bmsTSlider.addEventListener('input', updateBMS);

        function renderBMSCanvas(canvas, v, i, temp, status) {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const padL = 55, padR = 25, padT = 30, padB = 40;
            const pw = w - padL - padR;
            const ph = h - padT - padB;

            // X-axis: Temp (-20 to 65 °C)
            // Y-axis: Voltage (2.0 to 4.5 V)
            function getX(t) { return padL + ((t - (-20)) / (65 - (-20))) * pw; }
            function getY(volt) { return padT + ph - ((volt - 2.0) / (4.5 - 2.0)) * ph; }

            // Zones
            // 1. Normal Green Zone (0 to 45°C, 2.8 to 4.2V)
            ctx.fillStyle = 'rgba(52, 211, 120, 0.16)';
            ctx.fillRect(getX(0), getY(4.2), getX(45) - getX(0), getY(2.8) - getY(4.2));

            // 2. High Temp Derate (45 to 55°C)
            ctx.fillStyle = 'rgba(251, 146, 60, 0.16)';
            ctx.fillRect(getX(45), getY(4.0), getX(55) - getX(45), getY(2.8) - getY(4.0));

            // 3. Cold Derate (-10 to 0°C)
            ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
            ctx.fillRect(getX(-10), getY(3.8), getX(0) - getX(-10), getY(2.8) - getY(3.8));

            // Trip Threshold Lines
            ctx.strokeStyle = '#fb7185';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 4]);
            // Overvoltage 4.25V
            ctx.beginPath(); ctx.moveTo(padL, getY(4.25)); ctx.lineTo(padL + pw, getY(4.25)); ctx.stroke();
            // Undervoltage 2.50V
            ctx.beginPath(); ctx.moveTo(padL, getY(2.50)); ctx.lineTo(padL + pw, getY(2.50)); ctx.stroke();
            // Overtemp 55°C
            ctx.beginPath(); ctx.moveTo(getX(55), padT); ctx.lineTo(getX(55), padT + ph); ctx.stroke();
            ctx.setLineDash([]);

            // Labels
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#fb7185';
            ctx.textAlign = 'right';
            ctx.fillText('Trip Overvoltage (4.25 V)', padL + pw - 5, getY(4.25) - 4);
            ctx.fillText('Trip Undervoltage (2.50 V)', padL + pw - 5, getY(2.50) + 12);
            ctx.fillText('Trip Overtemp (55°C)', getX(55) - 4, padT + 20);

            // Axes & Grid
            ctx.strokeStyle = '#182530';
            ctx.lineWidth = 1;
            for (let volt = 2.5; volt <= 4.5; volt += 0.5) {
                const y = getY(volt);
                ctx.fillStyle = '#64748b';
                ctx.fillText(volt.toFixed(1) + ' V', padL - 8, y + 3);
            }
            for (let t = -20; t <= 60; t += 20) {
                const x = getX(t);
                ctx.fillStyle = '#64748b';
                ctx.textAlign = 'center';
                ctx.fillText(t + '°C', x, padT + ph + 16);
            }
            ctx.fillText('Cell Temperature (°C)', padL + pw / 2, h - 8);

            // Current Operating Point (Pulsing Crosshair)
            const cx = getX(temp);
            const cy = getY(v);
            const isTrip = status.startsWith('TRIP');
            const ptCol = isTrip ? '#fb7185' : (status.startsWith('WARN') ? '#fb923c' : '#34d378');

            ctx.strokeStyle = ptCol;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 9, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = ptCol;
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`Operating Point: (${temp}°C, ${v.toFixed(2)}V)`, cx + 14, cy + 4);
        }

        // =====================================================================
        // MODE 6: SWITCHED-MODE BUCK CHARGER & TI C2000 PIL SIMULATION
        // =====================================================================
        const btnChgCC = document.getElementById('btn-chg-cc');
        const btnChgCV = document.getElementById('btn-chg-cv');
        const btnChgCP = document.getElementById('btn-chg-cp');
        const btnChgPWM = document.getElementById('btn-chg-pwm');
        const btnCtrlPIL = document.getElementById('btn-ctrl-pil');
        const btnCtrlFF = document.getElementById('btn-ctrl-ff');
        const chgFswSlider = document.getElementById('chg-fsw');
        const chgFswVal = document.getElementById('chg-fsw-val');
        const canvasCharger = document.getElementById('canvas-charger');
        const chgBanner = document.getElementById('chg-banner');
        const chgStatusText = document.getElementById('chg-status-text');

        let chgMode = 'cc'; // 'cc', 'cv', 'cp', 'pwm'
        let ctrlType = 'pil'; // 'pil', 'ff'
        let fsw_kHz = 100;

        function updateCharger() {
            fsw_kHz = parseInt(chgFswSlider.value);
            chgFswVal.textContent = `${fsw_kHz} kHz`;

            const Vin = 12.0;
            const Vout = (chgMode === 'cv') ? 4.2 : 3.8;
            const D = Vout / Vin;
            const delta_IL = 0.20; // 200 mA ripple
            const delta_Vo = 0.010; // 10 mV ripple
            const fsw_Hz = fsw_kHz * 1000;
            const L_uH = ((Vin - Vout) * D) / (fsw_Hz * delta_IL) * 1e6;
            const C_uF = (delta_IL / (8 * fsw_Hz * delta_Vo)) * 1e6;

            if (ctrlType === 'pil') {
                chgStatusText.innerHTML = `<b>TI C2000 TMS320F28379D PIL Co-Simulation:</b> Embedded C code compiled for DSP target co-simulating with Simscape Battery; feedforward duty cycle eliminates startup droop with <b>&lt; 5 ms deadbeat settling</b>.`;
            } else {
                chgStatusText.innerHTML = `<b>Discrete Feedforward PI(z) Active:</b> Direct feedforward term <code>+(V_ref/V_in)</code> decouples DC bus fluctuations, guaranteeing zero overshoot across continuous &amp; discrete modes.`;
            }

            renderChargerCanvas(canvasCharger, chgMode, ctrlType, fsw_kHz, L_uH, C_uF);
            if (currentMode === 'charger') updateTelemetry('charger');
        }

        if (btnChgCC) {
            btnChgCC.addEventListener('click', () => { chgMode = 'cc'; updateChgBtns(); updateCharger(); });
            btnChgCV.addEventListener('click', () => { chgMode = 'cv'; updateChgBtns(); updateCharger(); });
            btnChgCP.addEventListener('click', () => { chgMode = 'cp'; updateChgBtns(); updateCharger(); });
            btnChgPWM.addEventListener('click', () => { chgMode = 'pwm'; updateChgBtns(); updateCharger(); });

            btnCtrlPIL.addEventListener('click', () => {
                ctrlType = 'pil';
                btnCtrlPIL.classList.add('is-active');
                btnCtrlFF.classList.remove('is-active');
                updateCharger();
            });
            btnCtrlFF.addEventListener('click', () => {
                ctrlType = 'ff';
                btnCtrlFF.classList.add('is-active');
                btnCtrlPIL.classList.remove('is-active');
                updateCharger();
            });

            chgFswSlider.addEventListener('input', updateCharger);
        }

        function updateChgBtns() {
            btnChgCC.classList.toggle('is-active', chgMode === 'cc');
            btnChgCV.classList.toggle('is-active', chgMode === 'cv');
            btnChgCP.classList.toggle('is-active', chgMode === 'cp');
            btnChgPWM.classList.toggle('is-active', chgMode === 'pwm');
        }

        function renderChargerCanvas(canvas, mode, ctrl, fsw, L_uH, C_uF) {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const padL = 55, padR = 25, padT = 25, padB = 30;
            const pw = w - padL - padR;
            const ph = h - padT - padB;
            const midY = padT + ph * 0.52;

            // Background grid
            ctx.strokeStyle = '#182530';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, midY); ctx.lineTo(padL + pw, midY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL + pw, padT); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(padL, padT + ph); ctx.lineTo(padL + pw, padT + ph); ctx.stroke();

            // Trace 1: Inductor Current i_L(t) (Top Half)
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = '#f5c542';
            ctx.textAlign = 'left';
            const modeLabel = mode === 'cc' ? '1.5 A CC' : (mode === 'cv' ? 'CV Taper (6.3A → 0A)' : (mode === 'cp' ? '50 W CP' : '100 kHz ePWM'));
            ctx.fillText(`CH 1: Inductor Current i_L(t) [${modeLabel}] · L = ${L_uH.toFixed(0)} µH, Ripple ΔI_L = 200 mA`, padL + 10, padT + 12);

            ctx.strokeStyle = '#f5c542';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            const nPts = 160;
            const targetI = mode === 'cc' ? 1.5 : (mode === 'cv' ? 3.0 : (mode === 'cp' ? 11.0 : 10.0));
            const iScale = mode === 'cp' ? 15.0 : 4.0;
            const yTopMid = padT + (midY - padT) / 2;

            for (let i = 0; i < nPts; i++) {
                const tFrac = i / nPts;
                // Step settling in first 10% if feedforward, or triangular ripple
                let baseI = targetI;
                if (tFrac < 0.12) {
                    baseI = targetI * (1 - Math.exp(-tFrac * 40));
                }
                if (mode === 'cv' && tFrac > 0.12) {
                    baseI = targetI * Math.exp(-(tFrac - 0.12) * 2.2);
                }
                const ripple = Math.sin(i * 1.2) * (0.15 * (100 / fsw));
                const currentVal = baseI + ripple;

                const x = padL + tFrac * pw;
                const y = yTopMid - (currentVal / iScale) * ((midY - padT) / 2 - 12);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Trace 2: Cell Terminal Voltage V_t(t) (Bottom Half)
            ctx.fillStyle = '#38bdf8';
            ctx.fillText(`CH 2: Cell Voltage V_t(t) · Pre-charged C = ${C_uF.toFixed(0)} µF · ΔV_o ≤ 10 mV`, padL + 10, midY + 16);

            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            const yBotMid = midY + (padT + ph - midY) / 2;

            for (let i = 0; i < nPts; i++) {
                const tFrac = i / nPts;
                let vVal = 3.8;
                if (mode === 'cv') {
                    vVal = 4.20;
                } else if (mode === 'cc') {
                    vVal = 3.80 + 0.40 * tFrac;
                } else if (mode === 'cp') {
                    vVal = 3.85 + 0.45 * tFrac;
                } else {
                    vVal = 3.80 + (tFrac < 0.08 ? tFrac * 5 : 0.40);
                }
                // Cap precharge prevents t=0 drop
                const vRipple = Math.sin(i * 1.2 + 1) * (0.005 * (100 / fsw));
                const totalV = vVal + vRipple;

                const x = padL + tFrac * pw;
                const y = yBotMid - ((totalV - 3.7) / 0.7) * ((padT + ph - midY) / 2 - 12);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Hardware Annotation Badge (TI C2000 PIL)
            ctx.fillStyle = ctrl === 'pil' ? 'rgba(52, 211, 120, 0.15)' : 'rgba(56, 189, 248, 0.15)';
            ctx.strokeStyle = ctrl === 'pil' ? '#34d378' : '#38bdf8';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(padL + pw - 210, padT + 8, 200, 24, 6);
            ctx.fill();
            ctx.stroke();

            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = ctrl === 'pil' ? '#34d378' : '#38bdf8';
            ctx.textAlign = 'center';
            ctx.fillText(ctrl === 'pil' ? 'TI C2000 TMS320F28379D PIL · 200 MHz' : 'Simulink Discrete PI(z) Feedforward', padL + pw - 110, padT + 23);
        }

        // =====================================================================
        // TELEMETRY PANEL UPDATES
        // =====================================================================
        const telemCards = document.getElementById('bms-telem-cards');
        const telemDesc = document.getElementById('bms-telem-explanation');

        function updateTelemetry(mode) {
            if (mode === 'kelvin') {
                const drop_mV = is4Wire ? 0.0 : (testCurrent * R_lead * 2 * 1000);
                const vMeas = is4Wire ? 3.900 : (3.900 - drop_mV / 1000);
                telemCards.innerHTML = `
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Connection Mode</span>
                        <span class="bms-tcard__val" style="color:${is4Wire ? '#34d378' : '#fb7185'};">${is4Wire ? '4-Wire Kelvin' : '2-Wire Leads'}</span>
                        <span class="bms-tcard__sub">${is4Wire ? 'High-impedance sense' : 'Power leads combined'}</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Test Current</span>
                        <span class="bms-tcard__val">${testCurrent} A</span>
                        <span class="bms-tcard__sub">Dynamic test load</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Lead Voltage Drop</span>
                        <span class="bms-tcard__val" style="color:${is4Wire ? '#34d378' : '#fb7185'};">${drop_mV.toFixed(1)} mV</span>
                        <span class="bms-tcard__sub">2 · I · R_lead loss</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Voltmeter Reading</span>
                        <span class="bms-tcard__val">${vMeas.toFixed(3)} V</span>
                        <span class="bms-tcard__sub">${is4Wire ? 'True E_chem potential' : 'Corrupted by lead IR'}</span>
                    </div>
                `;
                telemDesc.innerHTML = `<b>Why Kelvin 4-Wire Sensing is Critical:</b> In battery cycler testing, currents reach up to 100A+. Standard test leads have ~1–2 mΩ contact and wire resistance. In 2-wire mode, that causes a massive <b>${(testCurrent * 2).toFixed(0)} mV</b> IR drop across the measurement leads, misleading the BMS into diagnosing false undervoltage. <b>4-Wire Kelvin sensing</b> uses isolated high-impedance sense leads (carrying zero current) to measure pure electrochemical cell potential directly at the tabs.`;
            } else if (mode === 'static') {
                const eff = (99.8 - Math.max(0, 25 - cellTemp) * 0.12).toFixed(1);
                const cap = (2.50 * (1 - (25 - cellTemp) * 0.003)).toFixed(2);
                telemCards.innerHTML = `
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Test Temperature</span>
                        <span class="bms-tcard__val">${cellTemp} °C</span>
                        <span class="bms-tcard__sub">4-Script procedure</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Coulombic Efficiency</span>
                        <span class="bms-tcard__val">${eff}%</span>
                        <span class="bms-tcard__sub">Q_chg / Q_dchg</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Cell Capacity Q</span>
                        <span class="bms-tcard__val">${cap} Ah</span>
                        <span class="bms-tcard__sub">Full Ah integration</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Hysteresis State</span>
                        <span class="bms-tcard__val">${showHyst ? 'Separated' : 'Collapsed'}</span>
                        <span class="bms-tcard__sub">${showHyst ? 'ΔV_hyst ≈ 35 mV' : 'Zero dither error'}</span>
                    </div>
                `;
                telemDesc.innerHTML = `<b>Static Characterization Protocol:</b> The cell is cycled at an ultra-slow <b>C/30 rate</b> (~30-hour test). Because current is minuscule, all dynamic RC diffusion polarization drops decay to zero, meaning terminal voltage equals true thermodynamic chemical potential. Applying <b>dither signals</b> (frequency sweeps at cutoff limits) relaxes domain walls and collapses hysteresis into the true central OCV curve for <code>processOCV.m</code>.`;
            } else if (mode === 'udds') {
                telemCards.innerHTML = `
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Drive Schedule</span>
                        <span class="bms-tcard__val">EPA UDDS</span>
                        <span class="bms-tcard__sub">Urban drive cycle</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Ohmic Resistance R₀</span>
                        <span class="bms-tcard__val">${(uddsR0 * 1000).toFixed(0)} mΩ</span>
                        <span class="bms-tcard__sub">Feedthrough term -D</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Diffusion Time τ</span>
                        <span class="bms-tcard__val">${uddsTau} s</span>
                        <span class="bms-tcard__sub">RC pair eigenvalue</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Model Accuracy</span>
                        <span class="bms-tcard__val" style="color:#34d378;">5.7 mV</span>
                        <span class="bms-tcard__sub">RMS validation error</span>
                    </div>
                `;
                telemDesc.innerHTML = `<b>Live UDDS System Identification:</b> Standardized EPA drive cycles exercise the cell across broadband excitation frequencies. <code>processDynamic.m</code> subtracts the static OCV lookup surface to isolate dynamic residual voltage, then executes <b>Subspace System Identification (SISOsubid)</b> to extract discrete state-space matrices A, B, C, D, bounded by non-negative least squares.`;
            } else if (mode === 'ecm') {
                const drop = (ecmI * ecmR0 * 1000).toFixed(1);
                telemCards.innerHTML = `
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Discharge Current</span>
                        <span class="bms-tcard__val">${ecmI} A</span>
                        <span class="bms-tcard__sub">Square pulse test</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Instant Ohmic Drop</span>
                        <span class="bms-tcard__val" style="color:#fb7185;">${drop} mV</span>
                        <span class="bms-tcard__sub">ΔV = I · R₀</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">RC₁ Time Constant</span>
                        <span class="bms-tcard__val">${ecmTau} s</span>
                        <span class="bms-tcard__sub">τ = R₁ · C₁</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Model Formulation</span>
                        <span class="bms-tcard__val">ESC State-Space</span>
                        <span class="bms-tcard__sub">x[k+1] = Ax[k] + Bu[k]</span>
                    </div>
                `;
                telemDesc.innerHTML = `<b>The 3 Voltage Regimes of an ESC Model:</b> When a current pulse hits, the cell exhibits three distinct physical responses: <b>1. Instantaneous Ohmic Drop</b> (${drop} mV) caused by pure electrolyte resistance; <b>2. Exponential Diffusion Sag</b> as charge-transfer overpotentials build up in the RC pairs; and <b>3. Two-Stage Relaxation</b> upon current cutoff as solid-state lithium concentration gradients relax back to equilibrium.`;
            } else if (mode === 'bms') {
                telemCards.innerHTML = `
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Cell Voltage</span>
                        <span class="bms-tcard__val">${bmsV.toFixed(2)} V</span>
                        <span class="bms-tcard__sub">SOA: 2.8V to 4.2V</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Current Load</span>
                        <span class="bms-tcard__val">${bmsI} A</span>
                        <span class="bms-tcard__sub">${bmsI > 0 ? 'Discharging' : (bmsI < 0 ? 'Charging' : 'Idle')}</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Temperature</span>
                        <span class="bms-tcard__val">${bmsT} °C</span>
                        <span class="bms-tcard__sub">Thermal limit: 45°C</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Contactor State</span>
                        <span class="bms-tcard__val" style="color:${(bmsV > 4.25 || bmsV < 2.50 || bmsT > 55) ? '#fb7185' : '#34d378'};">${(bmsV > 4.25 || bmsV < 2.50 || bmsT > 55) ? 'OPEN (TRIPPED)' : 'CLOSED (ACTIVE)'}</span>
                        <span class="bms-tcard__sub">HV safety interlock</span>
                    </div>
                `;
                telemDesc.innerHTML = `<b>BMS Functional Safety Enforcement:</b> The supervisory controller continuously validates telemetry against the <b>Safe Operating Area (SOA)</b> envelope. If cell voltage crosses 4.25V (risk of thermal cathode breakdown) or temperature crosses 55°C (thermal runaway threshold), the safety loop trips the main pyrofuse contactor in under <b>8 milliseconds</b>, galvanically isolating the high-voltage pack.`;
            } else if (mode === 'charger') {
                const Vin = 12.0;
                const Vout = (chgMode === 'cv') ? 4.2 : 3.8;
                const D = Vout / Vin;
                const delta_IL = 0.20;
                const delta_Vo = 0.010;
                const fsw_Hz = fsw_kHz * 1000;
                const L_uH = ((Vin - Vout) * D) / (fsw_Hz * delta_IL) * 1e6;
                const C_uF = (delta_IL / (8 * fsw_Hz * delta_Vo)) * 1e6;

                telemCards.innerHTML = `
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Control Architecture</span>
                        <span class="bms-tcard__val" style="color:#34d378;">${ctrlType === 'pil' ? 'TI C2000 PIL' : 'Feedforward PI(z)'}</span>
                        <span class="bms-tcard__sub">${ctrlType === 'pil' ? 'Embedded C on DSP Target' : 'Duty cycle +(V_ref/V_in)'}</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Switching Frequency</span>
                        <span class="bms-tcard__val">${fsw_kHz} kHz</span>
                        <span class="bms-tcard__sub">ePWM carrier period</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Buck Inductor L</span>
                        <span class="bms-tcard__val">${L_uH.toFixed(0)} µH</span>
                        <span class="bms-tcard__sub">ΔI_L ripple = 200 mA</span>
                    </div>
                    <div class="bms-tcard">
                        <span class="bms-tcard__label">Filter Capacitor C</span>
                        <span class="bms-tcard__val">${C_uF.toFixed(0)} µF</span>
                        <span class="bms-tcard__sub">ΔV_o ripple ≤ 10 mV</span>
                    </div>
                `;
                telemDesc.innerHTML = `<b>Parametric Sizing &amp; PIL Target Co-Simulation:</b> Derived buck converter inductance and capacitance in <code>Buck_Converter_Design.mlx</code> using Faraday's law and charge variation. Sized for 100 kHz ePWM, achieving &lt;10 mV output ripple. In <b>Processor-in-the-Loop (PIL)</b> mode, embedded C code compiled for the <b>Texas Instruments C2000 (TMS320F28379D)</b> 200 MHz DSP executes the discrete-time control loop with voltage feedforward, eliminating current overshoot and settling within <b>5 milliseconds</b>.`;
            }
        }

        function drawActiveCanvas(mode) {
            if (mode === 'kelvin') updateKelvin();
            else if (mode === 'static') updateStatic();
            else if (mode === 'udds') renderUDDSCanvas(canvasUDDS, uddsTime, uddsR0, uddsTau);
            else if (mode === 'ecm') updateECM();
            else if (mode === 'bms') updateBMS();
            else if (mode === 'charger') updateCharger();
        }

        // Initial setup
        updateKelvin();
    }
})();
