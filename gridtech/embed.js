/* GridTech project card: a still poster in the card; the interactive demo loads only when a visitor asks for it
 * and is unloaded again on close, so the portfolio never keeps a WebGL context running in the background. */
(() => {
    const modal = document.getElementById('demo-modal');
    const frame = document.getElementById('demo-iframe');
    if (!modal || !frame) return;

    let open = false;
    let returnFocus = null;
    let unloadTimer = 0;

    function openDemo() {
        if (open) return;
        open = true;
        clearTimeout(unloadTimer);
        returnFocus = document.activeElement;
        if (!frame.src.includes('gridtech')) frame.src = 'gridtech/?embed';
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.documentElement.classList.add('demo-open');
        setTimeout(() => frame.focus(), 300);
    }

    function closeDemo() {
        if (!open) return;
        open = false;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.documentElement.classList.remove('demo-open');
        // free the GPU and the ~10 MB of hourly results once the fade-out has finished
        unloadTimer = setTimeout(() => { frame.src = 'about:blank'; }, 600);
        if (returnFocus) returnFocus.focus({ preventScroll: true });
    }

    document.querySelectorAll('[data-demo-open]').forEach(b => b.addEventListener('click', openDemo));
    document.querySelectorAll('[data-demo-close]').forEach(b => b.addEventListener('click', closeDemo));
    window.addEventListener('message', e => {
        if (e.origin !== location.origin || !e.data) return;
        if (e.data.type === 'gridtech:close') closeDemo();
    });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closeDemo(); });
})();
