/**
 * RestOrder A/B Testing Framework
 * 
 * Simple, lightweight A/B testing for landing page optimization.
 * Integrates with Google Analytics for conversion tracking.
 * 
 * Installation:
 * 1. Add this script to your HTML: <script src="/js/ab-testing.js"></script>
 * 2. Define your tests in the TESTS configuration
 * 3. View results in Google Analytics under Events
 * 
 * Features:
 * - Cookie-based variant assignment (consistent experience)
 * - Automatic conversion tracking
 * - Google Analytics integration
 * - Multiple simultaneous tests
 * - Statistical significance calculator
 */

// A/B Test Configuration
const AB_TESTS = {
  // Test 1: Hero Headline Variants
  heroHeadline: {
    name: 'Hero Headline Test',
    enabled: true,
    variants: [
      {
        id: 'control',
        weight: 50,  // 50% of traffic
        changes: {
          selector: '.hero h1',
          html: 'Stop Losing <span class="highlight">$3,600/Month</span> to Paper Menus'
        }
      },
      {
        id: 'variant-a',
        weight: 50,  // 50% of traffic
        changes: {
          selector: '.hero h1',
          html: 'Increase Revenue <span class="highlight">30% Instantly</span> with Digital Menus'
        }
      }
    ]
  },
  
  // Test 2: CTA Button Text
  ctaButton: {
    name: 'CTA Button Text Test',
    enabled: false,  // Set to true to activate
    variants: [
      {
        id: 'control',
        weight: 33,
        changes: {
          selector: '.hero .btn-primary',
          html: '<span class="material-symbols-outlined">rocket_launch</span>Start 14-Day FREE Trial (No Credit Card)'
        }
      },
      {
        id: 'variant-a',
        weight: 33,
        changes: {
          selector: '.hero .btn-primary',
          html: '<span class="material-symbols-outlined">rocket_launch</span>Try It FREE for 14 Days →'
        }
      },
      {
        id: 'variant-b',
        weight: 34,
        changes: {
          selector: '.hero .btn-primary',
          html: '<span class="material-symbols-outlined">rocket_launch</span>Get Started FREE Today'
        }
      }
    ]
  },
  
  // Test 3: Pricing Display
  pricingDisplay: {
    name: 'Pricing Anchor Test',
    enabled: false,
    variants: [
      {
        id: 'control',
        weight: 50,
        changes: {
          selector: '.pricing-card.popular .plan-price',
          html: '<span style="text-decoration: line-through; opacity: 0.5; font-size: 0.5em; color: var(--text-light);">$99</span><span class="price-currency">$</span><span class="price-amount">39</span><span class="price-period">/month</span>'
        }
      },
      {
        id: 'variant-a',
        weight: 50,
        changes: {
          selector: '.pricing-card.popular .plan-price',
          html: '<span class="price-currency">$</span><span class="price-amount">39</span><span class="price-period">/month</span>'
        }
      }
    ]
  },
  
  // Test 4: Social Proof Placement
  socialProof: {
    name: 'Social Proof Position Test',
    enabled: false,
    variants: [
      {
        id: 'control',
        weight: 50,
        changes: {} // Default position (below hero)
      },
      {
        id: 'variant-a',
        weight: 50,
        changes: {
          selector: '.hero-badge',
          html: '<span class="material-symbols-outlined" style="font-size: 18px;">verified</span><span>⭐⭐⭐⭐⭐ 4.9/5 • 1,247 businesses joined this month</span>'
        }
      }
    ]
  }
};

/**
 * Cookie Management
 */
function setCookie(name, value, days = 30) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

/**
 * Assign user to variant (weighted random distribution)
 */
function assignVariant(test) {
  const cookieName = `ab_${test}`;
  let assigned = getCookie(cookieName);
  
  if (assigned) {
    return assigned;
  }
  
  // Weighted random selection
  const variants = AB_TESTS[test].variants;
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const variant of variants) {
    random -= variant.weight;
    if (random <= 0) {
      setCookie(cookieName, variant.id);
      trackEvent('ab_test_assigned', {
        test_name: AB_TESTS[test].name,
        variant: variant.id
      });
      return variant.id;
    }
  }
  
  // Fallback to control
  return 'control';
}

/**
 * Apply variant changes to DOM
 */
function applyVariant(testKey, variantId) {
  const test = AB_TESTS[testKey];
  const variant = test.variants.find(v => v.id === variantId);
  
  if (!variant || !variant.changes.selector) return;
  
  const element = document.querySelector(variant.changes.selector);
  if (!element) return;
  
  // Apply changes
  if (variant.changes.html) {
    element.innerHTML = variant.changes.html;
  }
  if (variant.changes.text) {
    element.textContent = variant.changes.text;
  }
  if (variant.changes.class) {
    element.className = variant.changes.class;
  }
  if (variant.changes.style) {
    Object.assign(element.style, variant.changes.style);
  }
  
  console.log(`[A/B Test] Applied: ${test.name} - Variant: ${variantId}`);
}

/**
 * Track events to Google Analytics
 */
function trackEvent(eventName, params = {}) {
  // Google Analytics 4
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, params);
  }
  
  // Google Analytics Universal
  if (typeof ga !== 'undefined') {
    ga('send', 'event', params.event_category || 'AB Test', eventName, params.variant);
  }
  
  // Console log for debugging
  console.log(`[Analytics] ${eventName}:`, params);
}

/**
 * Track conversion (signup, trial start, purchase)
 */
function trackConversion(conversionType = 'signup') {
  // Track which variants led to this conversion
  Object.keys(AB_TESTS).forEach(testKey => {
    const test = AB_TESTS[testKey];
    if (!test.enabled) return;
    
    const variantId = getCookie(`ab_${testKey}`);
    if (variantId) {
      trackEvent('ab_test_conversion', {
        test_name: test.name,
        variant: variantId,
        conversion_type: conversionType
      });
    }
  });
}

/**
 * Initialize all active A/B tests
 */
function initABTests() {
  console.log('[A/B Testing] Initializing...');
  
  Object.keys(AB_TESTS).forEach(testKey => {
    const test = AB_TESTS[testKey];
    
    if (!test.enabled) {
      console.log(`[A/B Test] Skipping disabled test: ${test.name}`);
      return;
    }
    
    const variantId = assignVariant(testKey);
    applyVariant(testKey, variantId);
    
    console.log(`[A/B Test] ${test.name}: ${variantId}`);
  });
}

/**
 * Attach conversion tracking to forms and CTAs
 */
function attachConversionTracking() {
  // Track registration form submits
  const registerForm = document.querySelector('form[action*="register"]');
  if (registerForm) {
    registerForm.addEventListener('submit', () => {
      trackConversion('signup');
    });
  }
  
  // Track CTA clicks
  document.querySelectorAll('a[href*="register"], .btn-primary').forEach(btn => {
    btn.addEventListener('click', () => {
      trackEvent('cta_click', {
        cta_text: btn.textContent.trim(),
        cta_location: getElementLocation(btn)
      });
    });
  });
  
  // Track pricing plan selections
  document.querySelectorAll('.plan-cta').forEach(btn => {
    btn.addEventListener('click', () => {
      const planName = btn.closest('.pricing-card').querySelector('.plan-name').textContent;
      trackEvent('pricing_plan_click', {
        plan: planName
      });
    });
  });
}

/**
 * Get element location on page (for tracking)
 */
function getElementLocation(element) {
  if (element.closest('.hero')) return 'hero';
  if (element.closest('.pricing')) return 'pricing';
  if (element.closest('.cta-section')) return 'cta';
  if (element.closest('header')) return 'header';
  return 'other';
}

/**
 * Calculate statistical significance (Chi-square test)
 */
function calculateSignificance(controlConversions, controlVisitors, variantConversions, variantVisitors) {
  const controlRate = controlConversions / controlVisitors;
  const variantRate = variantConversions / variantVisitors;
  
  const pooledRate = (controlConversions + variantConversions) / (controlVisitors + variantVisitors);
  
  const seControl = Math.sqrt(pooledRate * (1 - pooledRate) / controlVisitors);
  const seVariant = Math.sqrt(pooledRate * (1 - pooledRate) / variantVisitors);
  const seDiff = Math.sqrt(seControl ** 2 + seVariant ** 2);
  
  const zScore = (variantRate - controlRate) / seDiff;
  
  // Calculate p-value (approximate)
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
  
  return {
    controlRate,
    variantRate,
    improvement: ((variantRate - controlRate) / controlRate) * 100,
    zScore,
    pValue,
    significant: pValue < 0.05  // 95% confidence
  };
}

// Helper: Normal CDF approximation
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * Get A/B test results summary (call from console)
 */
window.getABTestResults = function() {
  const results = {};
  
  Object.keys(AB_TESTS).forEach(testKey => {
    const test = AB_TESTS[testKey];
    const variantId = getCookie(`ab_${testKey}`);
    
    results[testKey] = {
      name: test.name,
      enabled: test.enabled,
      assignedVariant: variantId || 'none',
      allVariants: test.variants.map(v => v.id)
    };
  });
  
  console.table(results);
  return results;
};

/**
 * Force a specific variant (for testing)
 * Usage: forceVariant('heroHeadline', 'variant-a')
 */
window.forceVariant = function(testKey, variantId) {
  setCookie(`ab_${testKey}`, variantId);
  location.reload();
};

/**
 * Clear all A/B test assignments (reset)
 */
window.clearABTests = function() {
  Object.keys(AB_TESTS).forEach(testKey => {
    document.cookie = `ab_${testKey}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
  });
  console.log('[A/B Testing] All assignments cleared. Reload page to get new variants.');
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initABTests();
    attachConversionTracking();
  });
} else {
  initABTests();
  attachConversionTracking();
}

/**
 * USAGE EXAMPLES:
 * 
 * 1. Check your current variants:
 *    getABTestResults()
 * 
 * 2. Force a specific variant for testing:
 *    forceVariant('heroHeadline', 'variant-a')
 * 
 * 3. Clear all assignments:
 *    clearABTests()
 * 
 * 4. Track a custom conversion:
 *    trackConversion('trial_started')
 * 
 * 5. View in Google Analytics:
 *    Events → ab_test_assigned (variant assignments)
 *    Events → ab_test_conversion (conversions by variant)
 * 
 * 6. Calculate statistical significance:
 *    calculateSignificance(50, 1000, 65, 1000)
 *    // 50 conversions from 1000 visitors (control)
 *    // 65 conversions from 1000 visitors (variant)
 */
