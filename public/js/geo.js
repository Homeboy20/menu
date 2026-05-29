/**
 * RestOrder Country Geolocation & Customizer System (geo.js)
 * Manages country detection, dynamic theme styling based on country, currency conversion,
 * form pre-filling, and localized greetings.
 */

// CURRENCIES mapping
const GEO_CURRENCIES = {
  USD: '$', EUR: '€', GBP: '£', BRL: 'R$', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$',
  AED: 'AED ', SAR: 'SAR ', QAR: 'QR ', KWD: 'KD ', BHD: 'BD ', OMR: 'OMR ', ILS: '₪', JOD: 'JD ', LBP: 'LL ', IQD: 'IQD ',
  INR: '₹', PKR: '₨', BDT: '৳', LKR: 'Rs ', NPR: 'Rs ', JPY: '¥', CNY: '¥', KRW: '₩', HKD: 'HK$', TWD: 'NT$',
  MYR: 'RM', SGD: 'S$', THB: '฿', PHP: '₱', IDR: 'Rp', VND: '₫', MMK: 'K ', KHR: 'KHR ',
  TRY: '₺', RUB: '₽', UAH: '₴', PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RON: 'lei ', BGN: 'лв ', HRK: 'kn ', RSD: 'RSD ',
  SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF', MXN: '$', ARS: '$', CLP: '$', COP: '$', PEN: 'S/',
  NGN: '₦', GHS: '₵', KES: 'KSh', TZS: 'TSh', ZAR: 'R', UGX: 'USh', RWF: 'FRw', ETB: 'Br',
  XOF: 'CFA', XAF: 'FCFA', EGP: 'E£', MAD: 'MAD ', DZD: 'DZD ', TND: 'DT ', LYD: 'LYD '
};

// COUNTRY -> CURRENCY code mapping
const GEO_COUNTRY_CURRENCY = {
  US:'USD', CA:'CAD', MX:'MXN', BR:'BRL', AR:'ARS', CL:'CLP', CO:'COP', PE:'PEN',
  GB:'GBP', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', PT:'EUR', NL:'EUR', BE:'EUR',
  AT:'EUR', IE:'EUR', FI:'EUR', EE:'EUR', LV:'EUR', LT:'EUR', SK:'EUR', SI:'EUR',
  MT:'EUR', CY:'EUR', LU:'EUR', CH:'CHF', SE:'SEK', NO:'NOK', DK:'DKK',
  PL:'PLN', CZ:'CZK', HU:'HUF', RO:'RON', BG:'BGN', HR:'HRK', RS:'RSD', UA:'UAH',
  AE:'AED', SA:'SAR', QA:'QAR', KW:'KWD', BH:'BHD', OM:'OMR', EG:'EGP',
  IQ:'IQD', JO:'JOD', LB:'LBP', IL:'ILS', TR:'TRY',
  IN:'INR', PK:'PKR', BD:'BDT', LK:'LKR', NP:'NPR',
  CN:'CNY', JP:'JPY', KR:'KRW', HK:'HKD', TW:'TWD',
  SG:'SGD', MY:'MYR', TH:'THB', ID:'IDR', PH:'PHP', VN:'VND', MM:'MMK', KH:'KHR',
  NG:'NGN', GH:'GHS', KE:'KES', TZ:'TZS', UG:'UGX', RW:'RWF', ET:'ETB',
  ZA:'ZAR', MA:'MAD', DZ:'DZD', TN:'TND', LY:'LYD',
  CI:'XOF', SN:'XOF', ML:'XOF', BF:'XOF', NE:'XOF', TG:'XOF', BJ:'XOF', GW:'XOF', MR:'XOF',
  CM:'XAF', CG:'XAF', GA:'XAF', CF:'XAF', TD:'XAF', GQ:'XAF', CD:'CDF',
  ZM:'ZMW', MZ:'MZN', ZW:'ZWL', NA:'NAD', BW:'BWP', MW:'MWK', AO:'AOA',
  GM:'GMD', GN:'GNF', BI:'BIF', SO:'SOS', SS:'SSP', DJ:'DJF', KM:'KMF',
  SC:'SCR', MU:'MUR', MG:'MGA', ER:'ERN', SD:'SDG', SZ:'SZL', LS:'LSL',
  AU:'AUD', NZ:'NZD', RU:'RUB'
};

const GEO_COUNTRY_NAMES = {
  'US': 'United States', 'CA': 'Canada', 'MX': 'Mexico', 'BR': 'Brazil', 'AR': 'Argentina',
  'GB': 'United Kingdom', 'DE': 'Germany', 'FR': 'France', 'IT': 'Italy', 'ES': 'Spain',
  'TR': 'Turkey', 'KE': 'Kenya', 'TZ': 'Tanzania', 'UG': 'Uganda', 'ZA': 'South Africa',
  'IN': 'India', 'JP': 'Japan', 'CN': 'China', 'AE': 'UAE', 'SG': 'Singapore', 'AU': 'Australia'
};

// Accents and "Feels" for countries
const GEO_FEELS = {
  TR: {
    name: 'Anatolian Warmth',
    primary: '#e11d48', // Crimson/Rose red
    primaryLight: '#f43f5e',
    primaryDark: '#be123c',
    glow: 'rgba(225, 29, 72, 0.15)',
    gradient: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
    flag: '🇹🇷',
    banner: 'Merhaba! RestOrder artık Türkiye\'deki restoranlar için yerel ödeme yöntemleri ve özel fiyatlarla yayında!',
    testimonials: {
      'Maria Perez': 'Merve Yılmaz',
      'James Liu': 'Cem Aslan',
      'Tom Chen': 'Volkan Demir',
      'Pizza Palace Restaurant': 'Yıldız Pizza Salonu',
      'Café Luna': 'Ayışığı Kafe',
      'The Craft Tap Bar': 'Bira Atölyesi Barı'
    }
  },
  MEDITERRANEAN: { // IT, ES, GR, etc.
    name: 'Rustic Trattoria',
    primary: '#c2410c', // Terracotta orange
    primaryLight: '#ea580c',
    primaryDark: '#9a3412',
    glow: 'rgba(194, 65, 12, 0.15)',
    gradient: 'linear-gradient(135deg, #c2410c 0%, #ea580c 100%)',
    flag: '🍕',
    banner: 'Benvenuto! Crea il tuo menu digitale per attirare più clienti locali e turisti!',
    testimonials: {
      'Maria Perez': 'Maria Rossi',
      'James Liu': 'Juan Garcia',
      'Tom Chen': 'Marco Esposito'
    }
  },
  DE: {
    name: 'Bavarian Precision',
    primary: '#0f766e', // Teal Green
    primaryLight: '#0d9488',
    primaryDark: '#115e59',
    glow: 'rgba(15, 118, 110, 0.15)',
    gradient: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)',
    flag: '🇩🇪',
    banner: 'Hallo! RestOrder bietet jetzt DSGVO-konforme digitale Speisekarten für deutsche Restaurants an!',
    testimonials: {
      'Maria Perez': 'Gabriele Schmidt',
      'James Liu': 'Hans Müller',
      'Tom Chen': 'Thomas Weber'
    }
  },
  FR: {
    name: 'Parisian Elegance',
    primary: '#1d4ed8', // Bistro Blue
    primaryLight: '#2563eb',
    primaryDark: '#1e40af',
    glow: 'rgba(29, 78, 216, 0.15)',
    gradient: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
    flag: '🇫🇷',
    banner: 'Bonjour ! RestOrder propose des menus numériques élégants pour les bistrots et la haute cuisine !',
    testimonials: {
      'Maria Perez': 'Marie Dubois',
      'James Liu': 'Jean Martin',
      'Tom Chen': 'Thomas Laurent'
    }
  },
  EAST_AFRICA: { // KE, TZ, UG, RW
    name: 'Savannah Safari',
    primary: '#059669', // Safari Green
    primaryLight: '#10b981',
    primaryDark: '#047857',
    glow: 'rgba(5, 150, 105, 0.15)',
    gradient: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
    flag: '🌍',
    banner: 'Hello! Easily receive customer orders and get paid directly via Mobile Money (M-Pesa, Airtel) locally!',
    testimonials: {
      'Maria Perez': 'Grace Mwangi',
      'James Liu': 'Juma Ally',
      'Tom Chen': 'David Ochieng',
      'Pizza Palace Restaurant': 'Nairobi Pizza Palace',
      'Café Luna': 'Kili Café'
    }
  },
  JP: {
    name: 'Zen Minimalist',
    primary: '#be123c', // Cherry Red
    primaryLight: '#e11d48',
    primaryDark: '#9f1239',
    glow: 'rgba(190, 18, 60, 0.15)',
    gradient: 'linear-gradient(135deg, #be123c 0%, #9f1239 100%)',
    flag: '🇯🇵',
    banner: 'ようこそ！スマートなデジタルQRコードメニューで、インバウンド対応と業務効率化を同時に実現。',
    testimonials: {
      'Maria Perez': '佐藤 まりあ',
      'James Liu': '田中 健',
      'Tom Chen': '鈴木 茂'
    }
  },
  DEFAULT: {
    name: 'High-Tech Modern',
    primary: '#c2410c',
    primaryLight: '#ea580c',
    primaryDark: '#9a3412',
    glow: 'rgba(194, 65, 12, 0.15)',
    gradient: 'linear-gradient(135deg, #c2410c 0%, #ea580c 100%)',
    flag: '🚀',
    banner: 'Launch your interactive digital menu. Try RestOrder free for 7 days!',
    testimonials: {}
  }
};

// Maps a country code to its specific feel key
function getFeelKey(country) {
  if (!country) return 'DEFAULT';
  const c = country.toUpperCase();
  if (c === 'TR') return 'TR';
  if (['IT', 'ES', 'GR', 'PT'].includes(c)) return 'MEDITERRANEAN';
  if (c === 'DE' || c === 'CH' || c === 'AT') return 'DE';
  if (c === 'FR') return 'FR';
  if (['KE', 'TZ', 'UG', 'RW', 'BI', 'ET', 'SO'].includes(c)) return 'EAST_AFRICA';
  if (c === 'JP') return 'JP';
  return 'DEFAULT';
}

/**
 * Returns the currently detected country information.
 * Uses cached data or queries geolocation endpoints.
 */
async function getOrDetectCountry() {
  const cachedCode = localStorage.getItem('user_country_code');
  const cachedName = localStorage.getItem('user_country_name');
  const cachedCurrency = localStorage.getItem('user_currency_code');
  const cachedTs = localStorage.getItem('user_geo_timestamp');

  // Use cache if under 24 hours old
  if (cachedCode && cachedTs && (Date.now() - parseInt(cachedTs) < 24 * 60 * 60 * 1000)) {
    return {
      code: cachedCode,
      name: cachedName || GEO_COUNTRY_NAMES[cachedCode] || cachedCode,
      currency: cachedCurrency || 'USD'
    };
  }

  let code = '';
  // 1. Try server endpoint /api/geo
  try {
    const r = await fetch('/api/geo', { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const d = await r.json();
      code = (d.country || '').toUpperCase();
    }
  } catch (e) {
    console.warn('Backend geo detection failed, trying third-party fallback...');
  }

  // 2. Try ipapi.co fallback
  if (!code || code === 'XX' || code === 'T1') {
    try {
      const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const d = await r.json();
        code = (d.country_code || '').toUpperCase();
      }
    } catch (e) {
      console.warn('ipapi.co fallback failed; using timezone fallback.');
    }
  }

  // 3. Default timezone-based fallback
  if (!code) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.includes('Europe/Istanbul') || tz.includes('Turkey')) code = 'TR';
    else if (tz.includes('Europe/Berlin')) code = 'DE';
    else if (tz.includes('Europe/Paris')) code = 'FR';
    else if (tz.includes('Africa/Nairobi')) code = 'KE';
    else if (tz.includes('Africa/Dar_es_Salaam')) code = 'TZ';
    else if (tz.includes('Asia/Tokyo')) code = 'JP';
    else code = 'US';
  }

  const currency = GEO_COUNTRY_CURRENCY[code] || 'USD';
  const name = GEO_COUNTRY_NAMES[code] || code;

  // Cache settings
  localStorage.setItem('user_country_code', code);
  localStorage.setItem('user_country_name', name);
  localStorage.setItem('user_currency_code', currency);
  localStorage.setItem('user_geo_timestamp', Date.now().toString());

  return { code, name, currency };
}

/**
 * Returns exchange conversion rates relative to USD.
 * Caches for 1 hour to prevent API spam.
 */
async function getExchangeRate(targetCurrency) {
  if (!targetCurrency || targetCurrency === 'USD') return 1;

  const cacheKey = `fx_USD_${targetCurrency}`;
  const cachedVal = localStorage.getItem(cacheKey);
  if (cachedVal) {
    try {
      const { rate, ts } = JSON.parse(cachedVal);
      if (Date.now() - ts < 60 * 60 * 1000) { // 1 hour cache
        return rate;
      }
    } catch (e) {}
  }

  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const d = await r.json();
      const rate = d.rates && d.rates[targetCurrency];
      if (rate && rate > 0) {
        localStorage.setItem(cacheKey, JSON.stringify({ rate, ts: Date.now() }));
        return rate;
      }
    }
  } catch (e) {
    console.error('Failed to fetch exchange rates, using 1:1 fallback', e);
  }

  return 1;
}

/**
 * Dynamically injects country-specific colors/variables as CSS overrides
 */
function applyCountryStyles(feel) {
  let styleEl = document.getElementById('country-theme-overrides');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'country-theme-overrides';
    document.head.appendChild(styleEl);
  }

  // Inject variables into :root and body classes
  styleEl.textContent = `
    :root {
      --primary: ${feel.primary} !important;
      --brand: ${feel.primary} !important;
      --accent: ${feel.primary} !important;
      --accent-dark: ${feel.primaryDark} !important;
      --primary-light: ${feel.primaryLight} !important;
      --primary-dark: ${feel.primaryDark} !important;
      --accent-glow: ${feel.glow} !important;
      --gradient-1: ${feel.gradient} !important;
    }
    
    /* Highlight styling for localized banners */
    .country-welcome-banner {
      background: linear-gradient(135deg, ${feel.primaryDark} 0%, ${feel.primary} 100%);
      color: #ffffff;
      padding: 10px 24px;
      text-align: center;
      font-size: 13.5px;
      font-weight: 600;
      position: relative;
      z-index: 1010;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.08);
      animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    @keyframes slideDown {
      from { transform: translateY(-100%); }
      to { transform: translateY(0); }
    }
    
    .country-welcome-banner button {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 11px;
      cursor: pointer;
      margin-left: 10px;
      transition: background 0.2s;
    }
    
    .country-welcome-banner button:hover {
      background: rgba(255,255,255,0.35);
    }
  `;

  // Inject variables dynamically into Tailwind config if tailwind object exists
  if (window.tailwind && window.tailwind.config) {
    try {
      window.tailwind.config.theme.extend.colors.primary = feel.primary;
      window.tailwind.config.theme.extend.colors['primary-light'] = feel.primaryLight;
      window.tailwind.config.theme.extend.colors['primary-dark'] = feel.primaryDark;
    } catch(e) {}
  }
}

/**
 * Initializes localized welcome top banner
 */
function injectWelcomeBanner(feel, code) {
  if (!feel.banner) return;
  // Don't show if closed previously in this session
  if (sessionStorage.getItem('hide_country_banner') === '1') return;

  const banner = document.createElement('div');
  banner.className = 'country-welcome-banner';
  banner.id = 'country-welcome-banner';
  banner.innerHTML = `
    <span>${feel.flag} ${feel.banner}</span>
    <button onclick="document.getElementById('country-welcome-banner').remove(); sessionStorage.setItem('hide_country_banner','1');">Dismiss</button>
  `;

  // Insert before header/body first element
  const header = document.querySelector('header') || document.body.firstChild;
  if (header === document.body.firstChild) {
    document.body.insertBefore(banner, header);
  } else {
    document.body.prepend(banner);
  }

  // Adjust header position if it has fixed class
  const mainHeader = document.querySelector('header');
  if (mainHeader && window.getComputedStyle(mainHeader).position === 'fixed') {
    mainHeader.style.top = '39px'; // Offset header slightly down
    // Also inject styles to reset this when banner is closed
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node.id === 'country-welcome-banner') {
            mainHeader.style.top = '0';
          }
        });
      });
    });
    observer.observe(document.body, { childList: true });
  }
}

/**
 * Customizes testimonials to represent regional personas.
 */
function localizeTestimonials(feel) {
  if (!feel.testimonials || Object.keys(feel.testimonials).length === 0) return;

  const cards = document.querySelectorAll('.testimonial-card, .testimonials-grid div');
  cards.forEach(card => {
    let html = card.innerHTML;
    Object.entries(feel.testimonials).forEach(([original, replacement]) => {
      // Replace safe strings (regex avoids breaking raw HTML strings where possible)
      html = html.split(original).join(replacement);
    });
    card.innerHTML = html;
  });
}

/**
 * Pre-fills country selectors on register/login forms
 */
function setupCountrySelector(code) {
  const sel = document.getElementById('country-select');
  if (!sel) return;

  // Set selector value
  sel.value = code;
  
  // Trigger onCountryChange or pre-fill prefix manually
  if (typeof window.onCountryChange === 'function') {
    window.onCountryChange();
  } else {
    // Fallback manual prefix matching if onCountryChange isn't declared yet
    const phoneInput = document.getElementById('phone-input') || document.getElementById('auth-phone');
    if (phoneInput && window.COUNTRIES) {
      const match = window.COUNTRIES.find(x => x.c === code);
      if (match) phoneInput.placeholder = match.d + ' ...';
    }
  }
}

/**
 * Main initialization entrypoint for pages.
 * @param {string} pageType ('index', 'pricing', 'register', 'login', 'checkout', 'menu')
 */
async function initCountryCustomization(pageType) {
  try {
    const geo = await getOrDetectCountry();
    const feelKey = getFeelKey(geo.code);
    const feel = GEO_FEELS[feelKey] || GEO_FEELS.DEFAULT;

    // 1. Inject styling customization
    applyCountryStyles(feel);

    // 2. Banner & testimonials (Landing/Pricing)
    if (pageType === 'index' || pageType === 'pricing') {
      injectWelcomeBanner(feel, geo.code);
      localizeTestimonials(feel);
    }

    // 3. Pre-fill selectors (Auth pages)
    if (pageType === 'register' || pageType === 'login') {
      setupCountrySelector(geo.code);
    }

    // 4. Expose conversion state globally for pricing grids
    window.localGeo = geo;
    window.localFeel = feel;
    window.localConversionRate = await getExchangeRate(geo.currency);
    window.localCurrencySymbol = GEO_CURRENCIES[geo.currency] || '$';

    // 5. Expose formatLocalPrice globally
    window.formatLocalPrice = function(priceUSD) {
      if (priceUSD === 0) return 'FREE';
      const rate = window.localConversionRate || 1;
      const symbol = window.localCurrencySymbol || '$';
      const converted = priceUSD * rate;
      if (converted > 100) {
        return symbol + Math.round(converted).toLocaleString();
      }
      return symbol + converted.toFixed(2).replace('.00', '');
    };

    // Hook custom display logic if page supports it
    if (typeof window.onGeoReady === 'function') {
      window.onGeoReady(geo, feel);
    }
  } catch (err) {
    console.error('Localization initialization failed', err);
  }
}
