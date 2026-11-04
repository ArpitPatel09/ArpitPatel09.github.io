document.addEventListener('DOMContentLoaded', () => {
    // 1. Custom Cursor Logic
    const cursor = document.querySelector('.custom-cursor');
    const hoverables = document.querySelectorAll('a, .btn, .project-card, .field-card, .hobby-item, .skill-card');

    // Only enable custom cursor if device supports hover (not a touchscreen)
    if (window.matchMedia("(any-hover: hover)").matches) {
        document.addEventListener('mousemove', (e) => {
            cursor.style.left = e.clientX + 'px';
            cursor.style.top = e.clientY + 'px';
        });

        hoverables.forEach(el => {
            el.addEventListener('mouseenter', () => {
                cursor.classList.add('hovering');
            });
            el.addEventListener('mouseleave', () => {
                cursor.classList.remove('hovering');
            });
        });
    } else {
        cursor.style.display = 'none';
    }

    // 2. Scroll Reveal Animations using IntersectionObserver
    const revealElements = document.querySelectorAll('.reveal-up, .reveal-left');

    const revealOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                // Optional: Stop observing once revealed
                // observer.unobserve(entry.target);
            }
        });
    }, revealOptions);

    revealElements.forEach(el => {
        revealObserver.observe(el);
    });

    // 3. Navbar Scrolled Effect
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // 4. Mobile Menu Toggle
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
            if (navLinks.style.display === 'flex') {
                navLinks.style.flexDirection = 'column';
                navLinks.style.position = 'absolute';
                navLinks.style.top = '100%';
                navLinks.style.right = '20px';
                navLinks.style.background = 'rgba(13, 17, 23, 0.95)';
                navLinks.style.padding = '20px';
                navLinks.style.borderRadius = '12px';
                navLinks.style.border = '1px solid rgba(255,255,255,0.1)';
            }
        });
    }

    // 5. PDF Modal Logic
    const pdfButtons = document.querySelectorAll('.view-pdf-btn');
    const pdfModal = document.getElementById('pdf-modal');
    const pdfIframe = document.getElementById('pdf-iframe');
    const closeModal = document.querySelector('.close-modal');

    if (pdfButtons.length > 0 && pdfModal) {
        pdfButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const pdfPath = btn.getAttribute('data-pdf');
                // Append #toolbar=0 to disable download/print controls in viewer
                pdfIframe.src = pdfPath + '#toolbar=0&navpanes=0&scrollbar=0';
                pdfModal.classList.add('show');
                document.body.style.overflow = 'hidden'; // Prevent background scrolling
            });
        });

        const closePdfModal = () => {
            pdfModal.classList.remove('show');
            document.body.style.overflow = 'auto';
            setTimeout(() => {
                pdfIframe.src = ''; // Clear src after animation to stop rendering
            }, 300);
        };

        closeModal.addEventListener('click', closePdfModal);

        // Close when clicking outside the modal content
        pdfModal.addEventListener('click', (e) => {
            if (e.target === pdfModal) {
                closePdfModal();
            }
        });
        
        // Disable right click on the iframe wrapper to help prevent "Save As"
        const iframeContainer = document.querySelector('.iframe-container');
        if (iframeContainer) {
            iframeContainer.addEventListener('contextmenu', e => e.preventDefault());
        }
    }

    // 6. Image Carousels
    const carousels = document.querySelectorAll('.carousel');
    carousels.forEach(carousel => {
        const inner = carousel.querySelector('.carousel-inner');
        if (!inner) return;
        const slides = inner.querySelectorAll('img, video');
        const dots = carousel.querySelectorAll('.dot');
        const prevBtn = carousel.querySelector('.prev');
        const nextBtn = carousel.querySelector('.next');
        if (slides.length <= 1) return; // No need for carousel logic if only 1 slide

        let currentIndex = 0;

        const updateCarousel = (index) => {
            slides.forEach(slide => {
                slide.classList.remove('active');
                if (slide.tagName.toLowerCase() === 'video') {
                    slide.pause();
                }
            });
            dots.forEach(dot => dot.classList.remove('active'));
            
            slides[index].classList.add('active');
            if (slides[index].tagName.toLowerCase() === 'video') {
                slides[index].play();
            }
            if(dots[index]) dots[index].classList.add('active');
            carousel.setAttribute('data-slide', index);
        };

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                currentIndex = (currentIndex - 1 + slides.length) % slides.length;
                updateCarousel(currentIndex);
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                currentIndex = (currentIndex + 1) % slides.length;
                updateCarousel(currentIndex);
            });
        }

        dots.forEach((dot, idx) => {
            dot.addEventListener('click', () => {
                currentIndex = idx;
                updateCarousel(currentIndex);
            });
        });
    });
});
