(() => {
  function injectHeaderStyles() {
    if (document.getElementById('public-header-styles')) return;
    const style = document.createElement('style');
    style.id = 'public-header-styles';
    style.textContent = `
      #header{position:fixed;top:0;left:0;right:0;background:rgba(255,255,255,.94);backdrop-filter:blur(20px);border-bottom:1px solid rgba(231,229,228,.85);z-index:1000;transition:box-shadow .25s ease,border-color .25s ease,top .25s ease}
      #header.with-urgency{top:48px}
      #header.scrolled{box-shadow:0 14px 40px rgba(15,23,42,.08);border-bottom-color:#e7e5e4}
      #header nav.container{max-width:1280px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px}
      #header .logo{display:flex;align-items:center;gap:12px;color:#059669;text-decoration:none;font:800 22px/1 Fraunces,Georgia,serif;font-style:italic;letter-spacing:-.03em}
      #header .logo-icon{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#059669 0%,#10b981 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 26px rgba(5,150,105,.22)}
      #header .logo-icon svg{width:22px;height:22px;fill:#fff}
      #header .nav-center{display:flex;align-items:center;gap:4px;list-style:none;margin:0;padding:4px;border:1px solid #e7e5e4;border-radius:14px;background:rgba(255,255,255,.78)}
      #header .nav-center a{display:block;padding:10px 22px;border-radius:10px;color:#1c1917;text-decoration:none;font:700 15px/1 Outfit,system-ui,sans-serif;transition:background .2s,color .2s}
      #header .nav-center a:hover,#header .nav-center a.active{background:#ecfdf5;color:#059669}
      #header .nav-actions{display:flex;align-items:center;gap:10px}
      #header .btn-nav-secondary,#header .btn-nav{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 22px;border-radius:12px;border:1px solid #e7e5e4;background:#fff;color:#059669;text-decoration:none;font:800 15px/1 Outfit,system-ui,sans-serif;box-shadow:0 1px 0 rgba(15,23,42,.03);transition:transform .2s,box-shadow .2s,border-color .2s,background .2s}
      #header .btn-nav{background:#059669;color:#fff;border-color:#059669;box-shadow:0 14px 28px rgba(5,150,105,.22)}
      #header .btn-nav-secondary:hover,#header .btn-nav:hover{transform:translateY(-1px);box-shadow:0 16px 34px rgba(15,23,42,.1)}
      #header .btn-nav-secondary svg,#header .btn-nav svg{width:1em;height:1em}
      .mobile-menu-btn{display:none;background:#fff;border:1px solid #e7e5e4;border-radius:12px;width:44px;height:44px;font-size:22px;color:#059669}
      .mobile-menu{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1100;opacity:0;pointer-events:none;transition:opacity .2s ease}
      .mobile-menu.active{opacity:1;pointer-events:auto}
      .mobile-menu-content{margin-left:auto;width:min(360px,88vw);height:100%;background:#fff;padding:22px;box-shadow:-24px 0 60px rgba(15,23,42,.2);transform:translateX(100%);transition:transform .25s ease}
      .mobile-menu.active .mobile-menu-content{transform:translateX(0)}
      .mobile-menu-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
      .mobile-menu-close{width:42px;height:42px;border:1px solid #e7e5e4;background:#fff;border-radius:12px;font-size:28px;line-height:1;color:#57534e}
      .mobile-nav-links{list-style:none;margin:0 0 24px;padding:0;display:grid;gap:8px}
      .mobile-nav-link{display:block;padding:14px 16px;border-radius:12px;color:#1c1917;text-decoration:none;font:800 16px/1 Outfit,system-ui,sans-serif}
      .mobile-nav-link:hover,.mobile-nav-link.active{background:#ecfdf5;color:#059669}
      .mobile-nav-actions{display:grid;gap:10px}
      @media(max-width:900px){#header .nav-center,#header .nav-actions{display:none}.mobile-menu-btn{display:inline-flex;align-items:center;justify-content:center}#header nav.container{padding:14px 18px}#header .logo{font-size:20px}}
      @media(max-width:520px){#header.with-urgency{top:64px}}
    `;
    document.head.appendChild(style);
  }

  function buildHeader(activePage) {
    const isActive = (key) => (activePage === key ? ' class="active"' : '');
    const isMobileActive = (key) => (activePage === key ? ' class="mobile-nav-link active"' : ' class="mobile-nav-link"');
    const urgencyClass = document.getElementById('urgency-bar') ? ' class="with-urgency"' : '';

    return `
  <header id="header"${urgencyClass}>
    <nav class="container">
      <a href="/" class="logo">
        <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg></div>
        <span>RestOrder</span>
      </a>

      <ul class="nav-center">
        <li><a href="/features"${isActive('features')}>Features</a></li>
        <li><a href="/pricing"${isActive('pricing')}>Pricing</a></li>
        <li><a href="/about"${isActive('about')}>About</a></li>
        <li><a href="/contact"${isActive('contact')}>Contact</a></li>
      </ul>

      <div class="nav-actions">
        <a href="/menu?id=demo" target="_blank" class="btn-nav-secondary">
          <svg class="material-symbols-outlined" style="font-size: 16px;" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-visibility"/></svg>
          View Demo
        </a>
        <a href="/customer-login" class="btn-nav-secondary">Sign In</a>
        <a href="/register" class="btn-nav">
          <svg class="material-symbols-outlined" style="font-size: 16px;" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-rocket_launch"/></svg>
          Get Started
        </a>
      </div>

      <button class="mobile-menu-btn" id="mobile-menu-btn" type="button" aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false">&#9776;</button>
    </nav>
  </header>

  <div class="mobile-menu" id="mobile-menu">
    <div class="mobile-menu-content">
      <div class="mobile-menu-header">
        <a href="/" class="logo">
          <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg></div>
          <span>RestOrder</span>
        </a>
        <button class="mobile-menu-close" id="mobile-menu-close" type="button" aria-label="Close menu">&times;</button>
      </div>

      <ul class="mobile-nav-links">
        <li><a href="/features"${isMobileActive('features')}>Features</a></li>
        <li><a href="/pricing"${isMobileActive('pricing')}>Pricing</a></li>
        <li><a href="/about"${isMobileActive('about')}>About</a></li>
        <li><a href="/contact"${isMobileActive('contact')}>Contact</a></li>
      </ul>

      <div class="mobile-nav-actions">
        <a href="/menu?id=demo" target="_blank" class="btn-nav-secondary">
          <svg class="material-symbols-outlined" style="font-size: 18px;" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-visibility"/></svg>
          View Demo
        </a>
        <a href="/customer-login" class="btn-nav-secondary">Sign In</a>
        <a href="/register" class="btn-nav">
          <svg class="material-symbols-outlined" style="font-size: 18px;" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-rocket_launch"/></svg>
          Get Started
        </a>
      </div>
    </div>
  </div>`;
  }

  const mount = document.getElementById('site-header-container');
  if (!mount) return;
  injectHeaderStyles();
  const page = document.body.getAttribute('data-page') || '';
  mount.innerHTML = buildHeader(page);

  const menuButton = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const closeButton = document.getElementById('mobile-menu-close');
  const setMenuOpen = (open) => {
    if (!menu || !menuButton) return;
    menu.classList.toggle('active', open);
    document.body.classList.toggle('public-menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  };

  if (menuButton && menu) {
    menuButton.addEventListener('click', () => setMenuOpen(true));
    closeButton?.addEventListener('click', () => setMenuOpen(false));
    menu.addEventListener('click', (event) => {
      if (event.target === menu) setMenuOpen(false);
    });
    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenuOpen(false));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    });
  }
})();
