(() => {
  function buildHeader(activePage) {
    const isActive = (key) => (activePage === key ? ' class="active"' : '');
    const isMobileActive = (key) => (activePage === key ? ' class="mobile-nav-link active"' : ' class="mobile-nav-link"');

    return `
  <header id="header">
    <nav class="container">
      <a href="/" class="logo">
        <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg></div>
        <span>RestOrder</span>
      </a>

      <ul class="nav-center">
        <li><a href="/features"${isActive('features')}>Features</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/about"${isActive('about')}>About</a></li>
        <li><a href="/contact"${isActive('contact')}>Contact</a></li>
      </ul>

      <div class="nav-actions">
        <a href="/menu?id=demo" target="_blank" class="btn-nav-secondary">
          <svg class="material-symbols-outlined" style="font-size: 16px;" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-visibility"/></svg>
          View Demo
        </a>
        <a href="/login" class="btn-nav-secondary">Sign In</a>
        <a href="/register" class="btn-nav">
          <svg class="material-symbols-outlined" style="font-size: 16px;" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><use href="/icons/sprite.svg#icon-rocket_launch"/></svg>
          Get Started
        </a>
      </div>

      <button class="mobile-menu-btn" id="mobile-menu-btn">&#9776;</button>
    </nav>
  </header>

  <div class="mobile-menu" id="mobile-menu">
    <div class="mobile-menu-content">
      <div class="mobile-menu-header">
        <a href="/" class="logo">
          <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg></div>
          <span>RestOrder</span>
        </a>
        <button class="mobile-menu-close" id="mobile-menu-close">&times;</button>
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
        <a href="/login" class="btn-nav-secondary">Sign In</a>
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
  const page = document.body.getAttribute('data-page') || '';
  mount.innerHTML = buildHeader(page);
})();
