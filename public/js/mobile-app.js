(() => {
  const mq = window.matchMedia('(max-width: 768px)');

  function ensureAppShell() {
    const body = document.body;
    if (!body || !body.classList.contains('flex')) return;
    const aside = body.querySelector(':scope > aside');
    const main = body.querySelector(':scope > main');
    if (!aside || !main) return;
    const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay && !loginOverlay.classList.contains('hidden')) {
      const observer = new MutationObserver(() => {
        if (loginOverlay.classList.contains('hidden')) {
          observer.disconnect();
          ensureAppShell();
        }
      });
      observer.observe(loginOverlay, { attributes: true, attributeFilter: ['class'] });
      return;
    }

    if (!document.querySelector('.mobile-header') && !document.getElementById('app-shell-toggle')) {
      const btn = document.createElement('button');
      btn.id = 'app-shell-toggle';
      btn.className = 'app-shell-toggle';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Open navigation');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '☰';
      document.body.appendChild(btn);

      const backdrop = document.createElement('div');
      backdrop.className = 'app-shell-backdrop';
      backdrop.hidden = true;
      document.body.appendChild(backdrop);

      const setOpen = (open) => {
        body.classList.toggle('mobile-shell-open', open);
        btn.setAttribute('aria-expanded', String(open));
        btn.innerHTML = open ? '×' : '☰';
        backdrop.hidden = !open;
        body.style.overflow = open ? 'hidden' : '';
      };

      btn.addEventListener('click', () => setOpen(!body.classList.contains('mobile-shell-open')));
      backdrop.addEventListener('click', () => setOpen(false));
      aside.addEventListener('click', (event) => {
        const target = event.target.closest('a,button');
        if (target && mq.matches) setTimeout(() => setOpen(false), 120);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setOpen(false);
      });
    }

    if (!document.getElementById('app-bottom-nav')) {
      const nav = aside.querySelector('nav');
      if (!nav) return;
      const items = Array.from(nav.querySelectorAll('a,button')).filter((item) => {
        const label = item.textContent.trim();
        return label && !item.classList.contains('hidden') && getComputedStyle(item).display !== 'none';
      }).slice(0, 4);
      if (!items.length) return;

      const bottom = document.createElement('nav');
      bottom.id = 'app-bottom-nav';
      bottom.className = 'app-bottom-nav';
      bottom.style.setProperty('--ro-bottom-count', String(items.length));
      bottom.setAttribute('aria-label', 'Quick actions');

      items.forEach((item) => {
        const clone = item.cloneNode(true);
        clone.removeAttribute('class');
        clone.className = item.className.includes('bg-primary') || item.getAttribute('aria-current') === 'page' ? 'is-active' : '';
        clone.querySelectorAll('span').forEach((span, index) => {
          if (index > 0) span.remove();
        });
        bottom.appendChild(clone);
      });
      document.body.appendChild(bottom);
    }
  }

  function tuneForMobile() {
    document.documentElement.classList.add('mobile-enhanced');
    document.querySelectorAll('img:not([loading])').forEach((img) => {
      const rect = img.getBoundingClientRect();
      if (rect.top > window.innerHeight) img.loading = 'lazy';
    });
    document.querySelectorAll('img:not([decoding])').forEach((img) => { img.decoding = 'async'; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { ensureAppShell(); tuneForMobile(); });
  } else {
    ensureAppShell();
    tuneForMobile();
  }
})();
