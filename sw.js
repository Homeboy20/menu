// Service Worker for aggressive caching and offline functionality
// Version: 1.2.0 - Increment when updating cache strategy

const CACHE_NAME = 'restorder-v1.3.0';
const STATIC_CACHE = 'static-v1.3.0';
const DYNAMIC_CACHE = 'dynamic-v1.3.0';

// Critical resources to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/menu.html',
  '/admin.html',
  '/api/menus/demo',
  'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap'
];

// Cache strategies
const CACHE_STRATEGIES = {
  // Static assets - cache first, network fallback
  static: ['/index.html', '/menu.html', '/admin.html', '/sw.js'],
  
  // API calls - network first, cache fallback for offline
  api: ['/api/'],
  
  // External resources - cache first
  external: ['fonts.googleapis.com', 'fonts.gstatic.com']
};

// Install event - cache critical resources
self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing...');
  
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then(cache => {
        console.log('📦 Caching static assets...');
        return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
      }),
      caches.open(DYNAMIC_CACHE).then(cache => {
        console.log('🌐 Pre-caching external resources...');
        return Promise.allSettled(
          STATIC_ASSETS.filter(url => url.startsWith('http'))
            .map(url => cache.add(url).catch(e => console.log(`Failed to cache ${url}:`, e.message)))
        );
      })
    ]).then(() => {
      console.log('✅ Service Worker installed successfully');
      return self.skipWaiting();
    })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  console.log('🚀 Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then(cacheKeys => {
      return Promise.all(
        cacheKeys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log(`🗑️ Deleting old cache: ${key}`);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - intelligent caching strategies
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // Handle different types of requests with optimized strategies
  if (isStaticAsset(url)) {
    event.respondWith(handleStaticAsset(event.request));
  } else if (isAPIRequest(url)) {
    event.respondWith(handleAPIRequest(event.request));
  } else if (isExternalResource(url)) {
    event.respondWith(handleExternalResource(event.request));
  } else {
    event.respondWith(handleDefault(event.request));
  }
});

// Strategy: Cache First for static assets
async function handleStaticAsset(request) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log(`🎯 Cache hit: ${request.url}`);
      
      // Background update for HTML files
      if (request.url.includes('.html')) {
        fetch(request).then(response => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
        }).catch(() => {}); // Silent fail for background updates
      }
      
      return cached;
    }
    
    // Network fallback
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      console.log(`📥 Cached: ${request.url}`);
    }
    
    return response;
  } catch (error) {
    console.log(`❌ Static asset error: ${error.message}`);
    
    // Return offline fallback if available
    if (request.url.includes('.html')) {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>Offline</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px;">
          <h1>🔌 You're Offline</h1>
          <p>Please check your connection and try again.</p>
          <button onclick="location.reload()">Retry</button>
        </body></html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }
    
    throw error;
  }
}

// Strategy: Network First for API requests
async function handleAPIRequest(request) {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      // Cache successful API responses for offline access
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      console.log(`📡 API cached: ${request.url}`);
    }
    
    return response;
  } catch (error) {
    console.log(`🌐 Network failed, checking cache: ${request.url}`);
    
    // Fallback to cache
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log(`💾 Cache fallback: ${request.url}`);
      return cached;
    }
    
    // Return offline response for API calls
    return new Response(JSON.stringify({
      error: 'Offline',
      message: 'This request requires an internet connection',
      offline: true
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Strategy: Cache First for external resources (fonts, CDNs)
async function handleExternalResource(request) {
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log(`🎯 External cache hit: ${request.url}`);
      return cached;
    }
    
    // Network with timeout for external resources
    const response = await fetchWithTimeout(request, 3000);
    
    if (response.ok) {
      cache.put(request, response.clone());
      console.log(`🌍 External cached: ${request.url}`);
    }
    
    return response;
  } catch (error) {
    console.log(`❌ External resource failed: ${error.message}`);
    throw error;
  }
}

// Default strategy: Network first, no caching
async function handleDefault(request) {
  try {
    return await fetch(request);
  } catch (error) {
    console.log(`❌ Default request failed: ${request.url}`);
    throw error;
  }
}

// Helper functions
function isStaticAsset(url) {
  return CACHE_STRATEGIES.static.some(pattern => 
    url.pathname.includes(pattern) || url.pathname.endsWith(pattern)
  );
}

function isAPIRequest(url) {
  return CACHE_STRATEGIES.api.some(pattern => 
    url.pathname.startsWith(pattern)
  );
}

function isExternalResource(url) {
  return CACHE_STRATEGIES.external.some(domain => 
    url.hostname.includes(domain)
  );
}

function fetchWithTimeout(request, timeout = 5000) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), timeout)
    )
  ]);
}

// Background sync for pending requests (when available)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  console.log('🔄 Background sync triggered');
  // Implementation for syncing offline actions when back online
}

// Push notification support (future enhancement)
self.addEventListener('push', event => {
  if (event.data) {
    const options = {
      body: event.data.text(),
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2d/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍽️</text></svg>',
      badge: '/favicon.ico',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1
      }
    };
    
    event.waitUntil(
      self.registration.showNotification('RestOrder Update', options)
    );
  }
});

// Performance monitoring
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PERFORMANCE_LOG') {
    console.log('📊 Client performance:', event.data.metrics);
  }
});

console.log('🔧 Service Worker loaded and ready');