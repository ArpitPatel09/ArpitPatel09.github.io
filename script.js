(() => {
    const root = document.documentElement;
    root.classList.add('js');

    // "reduce" switches off scroll-jacking, parallax and drifting decoration only;
    // gentle fades, hovers and resizes stay on.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => [...c.querySelectorAll(s)];
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    // Split text before first paint of the hero so nothing flashes
    $$('[data-chars]').forEach(el => {
        const text = el.textContent;
        el.textContent = '';
        [...text].forEach((ch, i) => {
            const s = document.createElement('span');
            s.className = 'char';
            s.style.setProperty('--i', i);
            s.textContent = ch;
            el.appendChild(s);
        });
    });

    const start = () => {
        /* ---------------------------------------------------------------
           1. Smooth scrolling (Lenis, optional)
        --------------------------------------------------------------- */
        let lenis = null;
        if (!reduceMotion && window.Lenis) {
            lenis = new window.Lenis({
                duration: 1.15,
                easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                smoothWheel: true
            });
        }

        const scrollToTarget = target => {
            if (lenis) {
                lenis.scrollTo(target, { duration: 1.5 });
            } else if (typeof target === 'number') {
                window.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
            } else {
                target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
            }
        };

        let lockCount = 0;
        const lockScroll = on => {
            lockCount = Math.max(0, lockCount + (on ? 1 : -1));
            const locked = lockCount > 0;
            document.body.classList.toggle('is-locked', locked);
            if (lenis) locked ? lenis.stop() : lenis.start();
        };

        /* ---------------------------------------------------------------
           2. Preloader
        --------------------------------------------------------------- */
        const loader = $('.loader');
        const loaderFill = $('.loader__fill');
        const loaderPct = $('.loader__pct');
        const heroImg = $('.hero__media img');

        let loaded = false;
        const finishLoading = () => {
            if (loaded) return;
            loaded = true;
            if (lenis) lenis.start();
            document.body.classList.remove('is-loading');
            root.classList.add('is-ready');
            if (loader) {
                loader.classList.add('is-done');
                setTimeout(() => loader.remove(), 1300);
            }
        };

        if (!loader) {
            finishLoading();
        } else {
            if (lenis) lenis.stop();
            let imageReady = false;
            const markReady = () => { imageReady = true; };
            if (heroImg.complete) markReady();
            else {
                heroImg.addEventListener('load', markReady, { once: true });
                heroImg.addEventListener('error', markReady, { once: true });
            }
            setTimeout(markReady, 4000);

            const t0 = performance.now();
            const minTime = 1400;
            let shown = 0;
            const step = now => {
                const t = clamp((now - t0) / minTime, 0, 1);
                let p = (1 - Math.pow(1 - t, 3)) * 100;
                if (!imageReady) p = Math.min(p, 92);
                if (t >= 1 && imageReady) p = 100;
                shown = Math.max(shown, p);
                loaderFill.style.setProperty('--p', shown.toFixed(1));
                loaderPct.textContent = Math.round(shown);
                if (shown >= 100) setTimeout(finishLoading, 220);
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            // never let the loader trap the page (e.g. rAF paused in a background tab)
            setTimeout(finishLoading, 6000);
        }

        /* ---------------------------------------------------------------
           3. Split headings into words + scroll reveal
        --------------------------------------------------------------- */
        $$('.split').forEach(el => {
            const words = el.textContent.trim().split(/\s+/);
            el.setAttribute('aria-label', words.join(' '));
            el.textContent = '';
            words.forEach((w, i) => {
                const outer = document.createElement('span');
                outer.className = 'word';
                outer.setAttribute('aria-hidden', 'true');
                const inner = document.createElement('span');
                inner.style.setProperty('--i', i);
                inner.textContent = w;
                outer.appendChild(inner);
                el.appendChild(outer);
                if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
            });
        });

        const countUp = el => {
            const end = parseFloat(el.dataset.count);
            const decimals = parseInt(el.dataset.decimals || '0', 10);
            const format = v => decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
            const t0 = performance.now();
            const dur = 1800;
            const tick = now => {
                const k = clamp((now - t0) / dur, 0, 1);
                el.textContent = format(end * (1 - Math.pow(1 - k, 4)));
                if (k < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        };
        $$('[data-count]').forEach(el => {
            const decimals = parseInt(el.dataset.decimals || '0', 10);
            el.textContent = decimals ? (0).toFixed(decimals) : '0';
        });

        const revealObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                el.classList.add('is-in');
                if (el.hasAttribute('data-count')) countUp(el);
                revealObserver.unobserve(el);
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
        $$('[data-reveal], .split, [data-count]').forEach(el => revealObserver.observe(el));

        /* ---------------------------------------------------------------
           4. Navigation: hide on scroll, active pill, mobile menu
        --------------------------------------------------------------- */
        const nav = $('.nav');
        const navLinks = $$('.nav__links a');
        const navPill = $('.nav__pill');
        const burger = $('.nav__burger');
        const menu = $('#menu');
        let menuOpen = false;
        let activeId = '';

        const setActive = id => {
            activeId = id;
            let found = null;
            navLinks.forEach(a => {
                const on = a.getAttribute('href') === `#${id}`;
                a.classList.toggle('is-active', on);
                if (on) found = a;
            });
            if (found) {
                navPill.style.width = `${found.offsetWidth}px`;
                navPill.style.transform = `translateX(${found.offsetLeft}px)`;
                navPill.style.opacity = '1';
            } else {
                navPill.style.opacity = '0';
            }
        };
        const sectionObserver = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
        }, { rootMargin: '-45% 0px -54% 0px' });
        ['top', 'about', 'skills', 'projects', 'battery', 'research', 'experience', 'field', 'life', 'contact']
            .forEach(id => { const s = document.getElementById(id); if (s) sectionObserver.observe(s); });

        const toggleMenu = force => {
            menuOpen = typeof force === 'boolean' ? force : !menuOpen;
            document.body.classList.toggle('menu-open', menuOpen);
            if (menuOpen) nav.classList.remove('is-hidden');
            burger.setAttribute('aria-expanded', String(menuOpen));
            burger.setAttribute('aria-label', menuOpen ? 'Close menu' : 'Open menu');
            menu.setAttribute('aria-hidden', String(!menuOpen));
            lockScroll(menuOpen);
        };
        burger.addEventListener('click', () => toggleMenu());

        document.addEventListener('click', e => {
            const a = e.target.closest('a[href^="#"]');
            if (!a) return;
            const id = a.getAttribute('href').slice(1);
            const target = id ? document.getElementById(id) : null;
            if (!target) return;
            e.preventDefault();
            if (menuOpen) toggleMenu(false);
            scrollToTarget(id === 'top' ? 0 : target);
        });

        /* ---------------------------------------------------------------
           5. Cursor follower + magnetic buttons
        --------------------------------------------------------------- */
        const cursor = $('.cursor');
        const cursorLabel = $('.cursor__label');
        let mouseX = -100, mouseY = -100, ringX = -100, ringY = -100;
        const cursorOn = finePointer;

        if (cursorOn) {
            window.addEventListener('pointermove', e => {
                mouseX = e.clientX;
                mouseY = e.clientY;
                cursor.classList.add('is-visible');
            }, { passive: true });
            document.documentElement.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
            document.addEventListener('pointerover', e => {
                const labelled = e.target.closest('[data-cursor]');
                const interactive = e.target.closest('a, button, [role="button"], input');
                const label = labelled ? labelled.dataset.cursor : '';
                cursor.classList.toggle('has-label', !!label);
                cursor.classList.toggle('is-hover', !label && !!interactive);
                cursorLabel.textContent = label;
            });

            $$('.magnetic').forEach(el => {
                el.addEventListener('pointermove', e => {
                    const r = el.getBoundingClientRect();
                    const x = (e.clientX - r.left - r.width / 2) * 0.28;
                    const y = (e.clientY - r.top - r.height / 2) * 0.35;
                    el.style.translate = `${x}px ${y}px`;
                });
                el.addEventListener('pointerleave', () => { el.style.translate = ''; });
                el.style.transition = (getComputedStyle(el).transition || '') + ', translate .5s cubic-bezier(.22,1,.36,1)';
            });
        } else if (cursor) {
            cursor.remove();
        }

        /* ---------------------------------------------------------------
           6. Spotlight + tilt on glass
        --------------------------------------------------------------- */
        if (finePointer) {
            $$('[data-spotlight]').forEach(el => {
                el.addEventListener('pointermove', e => {
                    const r = el.getBoundingClientRect();
                    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
                    el.style.setProperty('--my', `${e.clientY - r.top}px`);
                });
            });
            {
                $$('[data-tilt]').forEach(el => {
                    el.addEventListener('pointermove', e => {
                        const r = el.getBoundingClientRect();
                        const px = (e.clientX - r.left) / r.width - 0.5;
                        const py = (e.clientY - r.top) / r.height - 0.5;
                        el.style.setProperty('--rx', `${(-py * 8).toFixed(2)}deg`);
                        el.style.setProperty('--ry', `${(px * 10).toFixed(2)}deg`);
                    });
                    el.addEventListener('pointerleave', () => {
                        el.style.setProperty('--rx', '0deg');
                        el.style.setProperty('--ry', '0deg');
                    });
                });
            }
        }

        /* ---------------------------------------------------------------
           7. Hero pointer parallax
        --------------------------------------------------------------- */
        const hero = $('.hero');
        let heroTX = 0, heroTY = 0, heroX = 0, heroY = 0;
        if (finePointer && !reduceMotion) {
            hero.addEventListener('pointermove', e => {
                const r = hero.getBoundingClientRect();
                heroTX = ((e.clientX - r.left) / r.width - 0.5) * 2;
                heroTY = ((e.clientY - r.top) / r.height - 0.5) * 2;
            });
            hero.addEventListener('pointerleave', () => { heroTX = 0; heroTY = 0; });
        }

        /* ---------------------------------------------------------------
           7b. Hero battery: a small random dispatch schedule.
           Each segment eases the charge level from -> to; reaching 100%
           holds as "full" and replays the green ground burst.
        --------------------------------------------------------------- */
        const cell = $('.cell');
        const cellRig = $('.cell__rig');
        const cellPct = $('.cell__pct');
        const cellState = $('.cell__state');
        const cellSub = $('.cell__sub');
        const cellCopy = {
            charging: ['Charging', 'Off-peak · storing energy'],
            full: ['Fully charged', 'Ready for the evening peak'],
            discharging: ['Discharging', 'Peak shaving'],
            regulating: ['Regulating', 'Balancing grid frequency'],
            idle: ['Standby', 'Holding charge']
        };
        const rand = (a, b) => a + Math.random() * (b - a);
        const easeSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
        let cellLevel = 0.22;
        let cellSeg = null;
        let cellPctShown = -1;
        let cellLastNow = 0;
        let burstTimer;

        const triggerBurst = () => {
            cell.classList.remove('is-burst');
            void cell.offsetWidth; // restart the CSS animations
            cell.classList.add('is-burst');
            clearTimeout(burstTimer);
            burstTimer = setTimeout(() => cell.classList.remove('is-burst'), 2200);
        };

        const startSegment = (kind, to, seconds, now) => {
            cellSeg = { kind, from: cellLevel, to, start: now, dur: seconds * 1000 };
        };
        // charge time scales with how far there is to go
        const chargeTo = (to, now) => {
            const target = Math.max(to, Math.min(1, cellLevel + 0.08)); // always upward
            startSegment('charging', target, Math.max(1.6, (target - cellLevel) * rand(4.6, 6.4)), now);
        };

        const nextSegment = now => {
            const prev = cellSeg ? cellSeg.kind : null;
            if (!prev) return chargeTo(1, now); // first thing visitors see: a full charge and a burst
            if (prev === 'full') return startSegment('discharging', rand(0.08, 0.42), rand(3.2, 5.4), now);
            if (prev === 'charging') {
                const r = Math.random();
                if (r < 0.45) return chargeTo(1, now);
                if (r < 0.75) return startSegment('regulating', cellLevel, rand(2.2, 3.6), now);
                return startSegment('discharging', Math.max(0.1, cellLevel - rand(0.15, 0.35)), rand(1.8, 3), now);
            }
            if (prev === 'regulating') return chargeTo(Math.random() < 0.6 ? 1 : Math.min(0.92, cellLevel + rand(0.15, 0.35)), now);
            if (prev === 'discharging' && Math.random() < 0.3) return startSegment('idle', cellLevel, rand(0.9, 1.8), now);
            return chargeTo(Math.random() < 0.65 ? 1 : rand(0.6, 0.9), now);
        };

        const renderCell = state => {
            cell.style.setProperty('--level', cellLevel.toFixed(3));
            const pct = Math.round(cellLevel * 100);
            if (pct !== cellPctShown) {
                cellPct.textContent = pct;
                cellPctShown = pct;
            }
            if (cell.dataset.state !== state) {
                cell.dataset.state = state;
                [cellState.textContent, cellSub.textContent] = cellCopy[state];
            }
        };

        const updateCell = (now, swayX, swayY) => {
            if (now <= 0) return renderCell('charging');
            // pause the schedule while the hero is off screen
            if (cellSeg && cellLastNow && now - cellLastNow > 400) cellSeg.start += now - cellLastNow;
            cellLastNow = now;
            if (!cellSeg) nextSegment(now);

            let t = (now - cellSeg.start) / cellSeg.dur;
            if (t >= 1) {
                cellLevel = cellSeg.to;
                if (cellSeg.kind === 'charging' && cellSeg.to >= 0.999) {
                    startSegment('full', 1, rand(1.6, 2.4), now);
                    triggerBurst();
                } else {
                    nextSegment(now);
                }
                t = 0;
            }

            const { kind, from, to } = cellSeg;
            if (kind === 'regulating') {
                // quick small wiggles, enveloped so it returns to where it started
                const secs = (now - cellSeg.start) / 1000;
                cellLevel = Math.min(1, Math.max(0.05, from + Math.sin(secs * 5.4) * 0.03 * Math.sin(Math.PI * t)));
            } else if (kind === 'idle' || kind === 'full') {
                cellLevel = from;
            } else {
                cellLevel = from + (to - from) * easeSine(t);
            }

            const secs = now / 1000;
            const ry = -30 + Math.sin(secs * 0.42) * 14 + swayX * 16;
            const rx = -15 + Math.sin(secs * 0.31) * 3 - swayY * 9;
            cellRig.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
            renderCell(kind);
        };
        if (cell) updateCell(0, 0, 0);

        /* ---------------------------------------------------------------
           8. About statement: words light up while scrolling
        --------------------------------------------------------------- */
        const scrub = $('[data-scrub]');
        let scrubWords = [];
        let scrubLit = -1;
        if (scrub) {
            const keyWords = new Set(['apart.', 'battery', 'optimization', 'robot']);
            const words = scrub.textContent.trim().split(/\s+/);
            scrub.setAttribute('aria-label', words.join(' '));
            scrub.textContent = '';
            words.forEach((w, i) => {
                const s = document.createElement('span');
                s.className = 'sw' + (keyWords.has(w.toLowerCase()) ? ' is-key' : '');
                s.setAttribute('aria-hidden', 'true');
                s.textContent = w;
                scrub.appendChild(s);
                if (i < words.length - 1) scrub.appendChild(document.createTextNode(' '));
            });
            scrubWords = $$('.sw', scrub);
        }

        /* ---------------------------------------------------------------
           9. Marquee reacts to scroll velocity
        --------------------------------------------------------------- */
        const marqueeAnims = reduceMotion ? [] : $$('.marquee__row').flatMap(r => r.getAnimations ? r.getAnimations() : []);
        let marqueeRate = 1;

        /* ---------------------------------------------------------------
           10. Project stack (sticky cards scale back as the next arrives)
        --------------------------------------------------------------- */
        const projects = $$('.project');
        const projectInners = projects.map(p => $('.project__inner', p));
        let stackOn = false;

        /* ---------------------------------------------------------------
           11. Field section: vertical scroll drives a horizontal track
        --------------------------------------------------------------- */
        const field = $('.field');
        const fieldPin = $('.field__pin');
        const fieldTrack = $('.field__track');
        const fieldBar = $('.field__progress span');
        const fieldHint = $('.field__hint');
        let fieldDist = 0;
        let fieldStatic = true;

        const measure = () => {
            stackOn = window.innerWidth > 960;
            if (!stackOn) projectInners.forEach(el => { el.style.removeProperty('--scale'); el.style.removeProperty('--dim'); });
            // a card taller than the viewport pins once its bottom is visible
            projects.forEach((p, i) => {
                if (window.innerWidth <= 960) { p.style.top = ''; return; }
                const ideal = 96 + i * 22;
                p.style.top = `${Math.min(ideal, window.innerHeight - projectInners[i].offsetHeight - 20)}px`;
            });

            fieldStatic = window.innerWidth <= 960;
            field.classList.toggle('is-static', fieldStatic);
            if (fieldHint) fieldHint.firstChild.textContent = fieldStatic ? 'Swipe ' : 'Scroll ';
            if (fieldStatic) {
                fieldPin.style.height = '';
                fieldTrack.style.transform = '';
            } else {
                fieldTrack.style.transform = 'translate3d(0,0,0)';
                fieldDist = Math.max(0, fieldTrack.scrollWidth - window.innerWidth);
                fieldPin.style.height = `${window.innerHeight + fieldDist}px`;
            }
            if (lenis && lenis.resize) lenis.resize();
            setActive(activeId);
            drawnY = -1;
        };

        if (fieldTrack) {
            fieldTrack.addEventListener('scroll', () => {
                if (!fieldStatic) return;
                const max = fieldTrack.scrollWidth - fieldTrack.clientWidth;
                fieldBar.style.setProperty('--p', max > 0 ? (fieldTrack.scrollLeft / max).toFixed(3) : 0);
            }, { passive: true });
        }

        /* ---------------------------------------------------------------
           12. Back to top + contact parallax + misc parallax
        --------------------------------------------------------------- */
        const toTop = $('.totop');
        const contactMedia = $('.contact__media');
        const contactFrame = $('.contact__frame');
        const parallaxImgs = $$('[data-parallax]');

        /* ---------------------------------------------------------------
           Main loop
        --------------------------------------------------------------- */
        let lastY = window.scrollY;
        let navY = lastY;
        let lastProgress = '';
        let lastHeroKey = '';
        let drawnY = -1;
        const stackCache = projects.map(() => '');
        const loop = time => {
            if (lenis) lenis.raf(time);
            const y = window.scrollY;
            const vh = window.innerHeight;
            const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
            const velocity = y - lastY;
            lastY = y;

            // scroll progress (battery logo + back-to-top ring)
            const progress = (y / maxScroll).toFixed(3);
            if (progress !== lastProgress) {
                nav.style.setProperty('--progress', progress);
                toTop.style.setProperty('--progress', progress);
                lastProgress = progress;
            }

            // nav
            nav.classList.toggle('is-solid', y > vh * 0.55);
            if (Math.abs(y - navY) > 8) {
                nav.classList.toggle('is-hidden', y > navY && y > vh * 0.9 && !menuOpen);
                navY = y;
            }
            toTop.classList.toggle('is-visible', y > vh * 0.9 && y < maxScroll - 220);

            // hero
            if (y < vh * 1.2) {
                heroX = lerp(heroX, heroTX, 0.06);
                heroY = lerp(heroY, heroTY, 0.06);
                const heroKey = `${heroX.toFixed(3)}|${heroY.toFixed(3)}|${y}`;
                if (heroKey !== lastHeroKey) {
                    lastHeroKey = heroKey;
                    hero.style.setProperty('--px', heroX.toFixed(3));
                    hero.style.setProperty('--py', heroY.toFixed(3));
                    hero.style.setProperty('--sy', reduceMotion ? 0 : clamp(y / vh, 0, 1.2).toFixed(4));
                }
                if (cell) updateCell(time, heroX, heroY);
            }

            // cursor
            if (cursorOn && (Math.abs(ringX - mouseX) > 0.1 || Math.abs(ringY - mouseY) > 0.1)) {
                ringX = lerp(ringX, mouseX, 0.2);
                ringY = lerp(ringY, mouseY, 0.2);
                cursor.style.transform = `translate3d(${ringX.toFixed(1)}px, ${ringY.toFixed(1)}px, 0)`;
            }

            // marquee speed
            if (marqueeAnims.length) {
                const target = 1 + clamp(Math.abs(velocity) / 12, 0, 5);
                let next = lerp(marqueeRate, target, 0.08);
                if (Math.abs(next - target) < 0.01) next = target;
                if (next !== marqueeRate) {
                    marqueeRate = next;
                    marqueeAnims.forEach(a => { a.playbackRate = marqueeRate; });
                }
            }

            // everything below only depends on scroll position
            if (y === drawnY) { requestAnimationFrame(loop); return; }
            drawnY = y;

            // about scrub
            if (scrubWords.length) {
                const r = scrub.getBoundingClientRect();
                if (r.top < vh && r.bottom > 0) {
                    const p = clamp((vh * 0.88 - r.top) / (r.height + vh * 0.4), 0, 1);
                    const lit = Math.round(p * scrubWords.length);
                    if (lit !== scrubLit) {
                        scrubWords.forEach((w, i) => w.classList.toggle('is-lit', i < lit));
                        scrubLit = lit;
                    }
                }
            }

            // parallax images
            if (!reduceMotion) parallaxImgs.forEach(img => {
                const r = img.parentElement.getBoundingClientRect();
                if (r.bottom < 0 || r.top > vh) return;
                const k = parseFloat(img.dataset.parallax) || 0.08;
                const off = (r.top + r.height / 2 - vh / 2) * -k;
                img.style.transform = `translate3d(0, ${off.toFixed(1)}px, 0)`;
            });

            // project stack
            if (stackOn) {
                for (let i = 0; i < projects.length - 1; i++) {
                    const cr = projects[i].getBoundingClientRect();
                    const nr = projects[i + 1].getBoundingClientRect();
                    const p = clamp(1 - (nr.top - cr.top) / cr.height, 0, 1).toFixed(3);
                    if (p === stackCache[i]) continue;
                    stackCache[i] = p;
                    projectInners[i].style.setProperty('--scale', (1 - p * 0.07).toFixed(4));
                    projectInners[i].style.setProperty('--dim', (p * 0.6).toFixed(3));
                }
            }

            // field horizontal scroll
            if (!fieldStatic && fieldDist > 0) {
                const r = fieldPin.getBoundingClientRect();
                const p = clamp(-r.top / fieldDist, 0, 1);
                fieldTrack.style.transform = `translate3d(${(-p * fieldDist).toFixed(1)}px, 0, 0)`;
                fieldBar.style.setProperty('--p', p.toFixed(4));
            }

            // contact parallax
            if (contactMedia && !reduceMotion) {
                const r = contactFrame.getBoundingClientRect();
                if (r.top < vh && r.bottom > 0) {
                    const p = (r.top / vh);
                    contactMedia.style.transform = `translate3d(0, ${(p * 90).toFixed(1)}px, 0) scale(1.05)`;
                }
            }

            requestAnimationFrame(loop);
        };

        measure();
        requestAnimationFrame(loop);

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(measure, 150);
        });
        window.addEventListener('load', measure);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

        /* ---------------------------------------------------------------
           13. Lightbox
        --------------------------------------------------------------- */
        const lightbox = $('.lightbox');
        const lbImg = $('.lightbox__img');
        const lbTitle = $('.lightbox__title');
        const lbCount = $('.lightbox__count');
        let lbItems = [];
        let lbIndex = 0;
        let lbReturnFocus = null;

        const lbRender = () => {
            const item = lbItems[lbIndex];
            lbImg.classList.remove('is-loaded');
            lbImg.src = item.src;
            lbImg.alt = item.alt || '';
            lbCount.textContent = `${String(lbIndex + 1).padStart(2, '0')} / ${String(lbItems.length).padStart(2, '0')}`;
        };
        lbImg.addEventListener('load', () => lbImg.classList.add('is-loaded'));

        const openLightbox = (items, index, title) => {
            if (!items.length) return;
            lbItems = items;
            lbIndex = index;
            lbTitle.textContent = title || '';
            lightbox.classList.toggle('is-single', items.length < 2);
            lbRender();
            lbReturnFocus = document.activeElement;
            lightbox.classList.add('is-open');
            lightbox.setAttribute('aria-hidden', 'false');
            lockScroll(true);
            lightbox.focus();
        };
        const closeLightbox = () => {
            if (!lightbox.classList.contains('is-open')) return;
            lightbox.classList.remove('is-open');
            lightbox.setAttribute('aria-hidden', 'true');
            lockScroll(false);
            if (lbReturnFocus) lbReturnFocus.focus({ preventScroll: true });
        };
        const lbStep = d => {
            if (lbItems.length < 2) return;
            lbIndex = (lbIndex + d + lbItems.length) % lbItems.length;
            lbRender();
        };
        $('.lightbox__prev').addEventListener('click', () => lbStep(-1));
        $('.lightbox__next').addEventListener('click', () => lbStep(1));
        $('[data-close]', lightbox).addEventListener('click', closeLightbox);
        lightbox.addEventListener('click', e => {
            if (e.target === lightbox || e.target.classList.contains('lightbox__stage')) closeLightbox();
        });
        let lbStartX = null;
        lightbox.addEventListener('pointerdown', e => { lbStartX = e.clientX; });
        lightbox.addEventListener('pointerup', e => {
            if (lbStartX === null) return;
            const dx = e.clientX - lbStartX;
            if (Math.abs(dx) > 50 && e.pointerType !== 'mouse') lbStep(dx < 0 ? 1 : -1);
            lbStartX = null;
        });

        /* ---------------------------------------------------------------
           14. Carousels
        --------------------------------------------------------------- */
        const icon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

        $$('[data-carousel]').forEach(carousel => {
            const slides = $$('.carousel__slide', carousel);
            const title = carousel.dataset.title || '';
            if (!slides.length) return;

            // blurred backdrop behind contained slides
            slides.forEach(slide => {
                if (slide.dataset.fit !== 'contain') return;
                const img = $('img', slide);
                if (!img) return;
                const back = document.createElement('img');
                back.className = 'carousel__backdrop';
                back.src = img.getAttribute('src');
                back.alt = '';
                back.setAttribute('aria-hidden', 'true');
                back.loading = 'lazy';
                slide.insertBefore(back, img);
            });

            const images = slides.map(s => $('img:not(.carousel__backdrop)', s)).filter(Boolean);
            slides.forEach(s => { if ($('img:not(.carousel__backdrop)', s)) s.dataset.cursor = 'View'; });

            let index = 0;
            slides[0].classList.add('is-active');

            carousel.addEventListener('click', e => {
                const img = e.target.closest('img');
                if (!img || carousel.dataset.dragged === '1') return;
                const main = $('img:not(.carousel__backdrop)', img.closest('.carousel__slide'));
                const i = images.indexOf(main);
                if (i >= 0) openLightbox(images.map(im => ({ src: im.currentSrc || im.src, alt: im.alt })), i, title);
            });

            if (slides.length < 2) return;

            carousel.tabIndex = 0;
            carousel.setAttribute('role', 'region');
            carousel.setAttribute('aria-roledescription', 'carousel');
            carousel.setAttribute('aria-label', title);

            const ui = document.createElement('div');
            ui.className = 'carousel__ui';
            const dots = document.createElement('div');
            dots.className = 'carousel__dots';
            slides.forEach((_, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('aria-label', `Show slide ${i + 1}`);
                b.addEventListener('click', () => go(i));
                dots.appendChild(b);
            });
            const arrows = document.createElement('div');
            arrows.className = 'carousel__arrows';
            arrows.innerHTML = `<button type="button" aria-label="Previous slide">${icon('i-chev-l')}</button><button type="button" aria-label="Next slide">${icon('i-chev-r')}</button>`;
            ui.append(dots, arrows);
            const count = document.createElement('span');
            count.className = 'carousel__count';
            carousel.append(ui, count);

            const dotBtns = [...dots.children];
            const go = i => {
                const prev = slides[index];
                prev.classList.remove('is-active');
                const v = $('video', prev);
                if (v) v.pause();
                index = (i + slides.length) % slides.length;
                slides[index].classList.add('is-active');
                dotBtns.forEach((d, k) => d.classList.toggle('is-active', k === index));
                count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
            };
            go(0);

            const [prevBtn, nextBtn] = arrows.children;
            prevBtn.addEventListener('click', () => go(index - 1));
            nextBtn.addEventListener('click', () => go(index + 1));
            carousel.addEventListener('keydown', e => {
                if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
                if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
            });

            let sx = null;
            carousel.addEventListener('pointerdown', e => {
                if (e.pointerType === 'mouse' || e.target.closest('button, video')) return;
                sx = e.clientX;
                carousel.dataset.dragged = '0';
            });
            carousel.addEventListener('pointerup', e => {
                if (sx === null) return;
                const dx = e.clientX - sx;
                if (Math.abs(dx) > 40) {
                    carousel.dataset.dragged = '1';
                    go(index + (dx < 0 ? 1 : -1));
                    setTimeout(() => { carousel.dataset.dragged = '0'; }, 50);
                }
                sx = null;
            });
            carousel.addEventListener('pointercancel', () => { sx = null; });
        });

        /* ---------------------------------------------------------------
           15. Life panels (accordion + slideshow)
        --------------------------------------------------------------- */
        const panels = $$('.panel');
        const panelState = new Map();
        panels.forEach(panel => {
            const imgs = $$(':scope > img', panel);
            imgs[0].classList.add('is-active');
            panelState.set(panel, { imgs, i: 0 });
            panel.dataset.cursor = 'Open';
        });
        let panelHoverTimer;
        let panelHoverTarget = null;
        const openPanel = panel => panels.forEach(p => p.classList.toggle('is-open', p === panel));
        const openGallery = panel => {
            const { imgs, i } = panelState.get(panel);
            openLightbox(imgs.map(im => ({ src: im.currentSrc || im.src, alt: im.alt })), i, panel.dataset.gallery);
        };
        panels.forEach(panel => {
            if (finePointer) {
                // open on real pointer movement only: panels sliding under a still
                // cursor fire enter events, which would otherwise ping-pong
                panel.addEventListener('pointermove', () => {
                    if (panel.classList.contains('is-open') || panelHoverTarget === panel) return;
                    panelHoverTarget = panel;
                    clearTimeout(panelHoverTimer);
                    panelHoverTimer = setTimeout(() => openPanel(panel), 120);
                });
                panel.addEventListener('pointerleave', () => {
                    if (panelHoverTarget !== panel) return;
                    clearTimeout(panelHoverTimer);
                    panelHoverTarget = null;
                });
            }
            panel.addEventListener('click', () => {
                if (panel.classList.contains('is-open')) openGallery(panel);
                else openPanel(panel);
            });
            panel.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (panel.classList.contains('is-open')) openGallery(panel);
                    else openPanel(panel);
                }
            });
        });

        let lifeVisible = false;
        const panelsWrap = $('.panels');
        if (panelsWrap) {
            new IntersectionObserver(es => { lifeVisible = es[0].isIntersecting; }, { threshold: 0.2 }).observe(panelsWrap);
        }
        {
            setInterval(() => {
                if (!lifeVisible || document.hidden) return;
                const open = panels.find(p => p.classList.contains('is-open'));
                if (!open) return;
                const st = panelState.get(open);
                if (st.imgs.length < 2) return;
                st.imgs[st.i].classList.remove('is-active');
                st.i = (st.i + 1) % st.imgs.length;
                st.imgs[st.i].classList.add('is-active');
            }, 3000);
        }

        /* ---------------------------------------------------------------
           15b. Battery stage explorer (tabs)
        --------------------------------------------------------------- */
        const bxTabs = $$('.bx__tab');
        const bxStrip = $('.bx__tabs');
        const selectStage = (tab, focus) => {
            bxTabs.forEach(t => {
                const on = t === tab;
                t.classList.toggle('is-active', on);
                t.setAttribute('aria-selected', String(on));
                t.tabIndex = on ? 0 : -1;
                document.getElementById(t.getAttribute('aria-controls')).classList.toggle('is-active', on);
            });
            if (focus) tab.focus({ preventScroll: true });
            // keep the chosen tab visible when the strip scrolls sideways on small screens
            if (bxStrip && bxStrip.scrollWidth > bxStrip.clientWidth) {
                bxStrip.scrollTo({ left: tab.offsetLeft - 8, behavior: reduceMotion ? 'auto' : 'smooth' });
            }
        };
        bxTabs.forEach((tab, i) => {
            tab.addEventListener('click', () => selectStage(tab, false));
            tab.addEventListener('keydown', e => {
                const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
                let next = null;
                if (step) next = bxTabs[(i + step + bxTabs.length) % bxTabs.length];
                if (e.key === 'Home') next = bxTabs[0];
                if (e.key === 'End') next = bxTabs[bxTabs.length - 1];
                if (!next) return;
                e.preventDefault();
                selectStage(next, true);
            });
        });

        /* ---------------------------------------------------------------
           16. PDF modal
        --------------------------------------------------------------- */
        const modal = $('#pdf-modal');
        const iframe = $('#pdf-iframe');
        const modalTitle = $('#pdf-title');
        const spinner = $('.modal__spinner');
        let modalReturnFocus = null;

        const openPdf = (src, title) => {
            modalTitle.textContent = title || 'Presentation';
            spinner.style.display = '';
            // #toolbar=0 hides the viewer's download/print controls
            iframe.src = `${src}#toolbar=0&navpanes=0&scrollbar=0`;
            modalReturnFocus = document.activeElement;
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
            lockScroll(true);
            $('[data-close]', modal).focus({ preventScroll: true });
        };
        const closePdf = () => {
            if (!modal.classList.contains('is-open')) return;
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
            lockScroll(false);
            setTimeout(() => { iframe.src = 'about:blank'; }, 450);
            if (modalReturnFocus) modalReturnFocus.focus({ preventScroll: true });
        };
        iframe.addEventListener('load', () => { if (iframe.src !== 'about:blank') spinner.style.display = 'none'; });
        $$('[data-pdf]').forEach(btn => btn.addEventListener('click', () => openPdf(btn.dataset.pdf, btn.dataset.title)));
        $('[data-close]', modal).addEventListener('click', closePdf);
        modal.addEventListener('click', e => { if (e.target === modal) closePdf(); });
        $('.modal__frame').addEventListener('contextmenu', e => e.preventDefault());

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeLightbox();
                closePdf();
                if (menuOpen) toggleMenu(false);
            }
            if (lightbox.classList.contains('is-open')) {
                if (e.key === 'ArrowRight') lbStep(1);
                if (e.key === 'ArrowLeft') lbStep(-1);
            }
        });

        /* ---------------------------------------------------------------
           17. Copy email
        --------------------------------------------------------------- */
        const toast = $('.toast');
        let toastTimer;
        const showToast = msg => {
            toast.textContent = msg;
            toast.classList.add('is-visible');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
        };
        $$('[data-copy]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                try {
                    await navigator.clipboard.writeText(btn.dataset.copy);
                    showToast(btn.dataset.copyMsg || 'Email copied to clipboard');
                } catch {
                    showToast(btn.dataset.copy);
                }
            });
        });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
