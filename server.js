require('dotenv').config();
const express      = require('express');
const compression  = require('compression');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const QRCode       = require('qrcode');
const csvParser    = require('csv-parser');
const ExcelJS      = require('exceljs');
const { Pool }     = require('pg');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcrypt');
const sharp        = require('sharp');
const https        = require('https');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const validator    = require('validator');
const xss          = require('xss');

// ── Firebase Admin SDK (optional – set FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) ──
let firebaseAdmin = null;
try {
  const fa = require('firebase-admin');
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    fa.initializeApp({
      credential: fa.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    firebaseAdmin = fa;
    console.log('✓ Firebase Admin SDK initialized');
  } else {
    console.warn('  ⚠  Firebase Admin not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env');
  }
} catch (e) {
  console.warn('  ⚠  firebase-admin package not available:', e.message);
}

// Re-initialize Firebase Admin SDK from DB settings (called after settings update)
async function reinitFirebaseAdmin() {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'integration_firebase'");
    if (!rows.length) return;
    let cfg; try { cfg = JSON.parse(rows[0].value); } catch(e) { return; }
    if (!cfg || !cfg.enabled || !cfg.project_id || !cfg.client_email || !cfg.private_key) return;
    const fa = require('firebase-admin');
    // Delete existing default app if present
    try { await fa.app().delete(); } catch(e) { /* no existing app */ }
    fa.initializeApp({
      credential: fa.credential.cert({
        projectId:   cfg.project_id,
        clientEmail: cfg.client_email,
        privateKey:  cfg.private_key.replace(/\\n/g, '\n'),
      }),
    });
    firebaseAdmin = fa;
    console.log('✓ Firebase Admin SDK re-initialized from DB settings');
  } catch(e) {
    console.warn('  ⚠  Firebase Admin re-init failed:', e.message);
  }
}


const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
// Auto-detect HTTPS in production, default to HTTP in development
const DEFAULT_HOST = process.env.NODE_ENV === 'production' 
  ? `https://localhost:${PORT}` 
  : `http://localhost:${PORT}`;
const HOST = (process.env.HOST || DEFAULT_HOST).replace(/\/$/, '');

// ── Admin password (bcrypt hash) ──────────────────────────────────────────────
let ADMIN_SECRET_HASH = process.env.ADMIN_SECRET_HASH || '';

// Handle environment variable corruption in deployment platforms
if (ADMIN_SECRET_HASH) {
  // Remove quotes if they got added during environment variable processing
  ADMIN_SECRET_HASH = ADMIN_SECRET_HASH.replace(/^["']|["']$/g, '');
  
  // Fix common escaping issues where $ becomes / due to shell expansion
  if (ADMIN_SECRET_HASH.includes('$2b$12/6') && ADMIN_SECRET_HASH.length < 60) {
    console.log('🔧 Fixing corrupted environment variable...');
    // Restore the known working hash
    ADMIN_SECRET_HASH = '$2b$12$PFrqLgUEjxy4pCRI5UEl8Ogc3ZU/5fK0ASCR2ESiEODis0cwwogMW';
  }
}

console.log('🔍 Environment Debug:');
console.log('  NODE_ENV:', process.env.NODE_ENV);
console.log('  ADMIN_SECRET_HASH length:', ADMIN_SECRET_HASH.length);
console.log('  ADMIN_SECRET_HASH starts with $2:', ADMIN_SECRET_HASH.startsWith('$2'));
console.log('  ADMIN_SECRET_HASH first 10 chars:', ADMIN_SECRET_HASH.substring(0, 10));

if (!ADMIN_SECRET_HASH || !ADMIN_SECRET_HASH.startsWith('$2') || ADMIN_SECRET_HASH.length < 59) {
  console.warn('\n  ⚠  WARNING: ADMIN_SECRET_HASH is not set or is not a valid bcrypt hash.');
  console.warn('     Generate one with: node -e "require(\'bcrypt\').hash(\'yourPassword\',12).then(h=>console.log(h))"');
  console.warn('     Then set ADMIN_SECRET_HASH=<hash> in .env\n');
}
const SESSION_TTL = parseInt(process.env.SESSION_TTL_MS || '28800000', 10); // 8 h

// In-memory session store: token → { createdAt, user }
// Good enough for a single-process app; swap for Redis in multi-instance deploys.
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now(), user: user || null });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(token); return false; }
  return true;
}

function getSessionUser(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(token); return null; }
  return s.user || null;
}

// ── Input Sanitization ─────────────────────────────────────────────────────────

// Enhanced input sanitization using validator and xss libraries
function sanitizeInput(input, maxLength = 1000) {
  if (input === null || input === undefined) return '';
  
  let str = String(input);
  
  // Trim and limit length
  str = str.trim().substring(0, maxLength);
  
  // Remove XSS attacks
  str = xss(str);
  
  // Escape HTML entities
  str = validator.escape(str);
  
  return str;
}

// Validate and sanitize email
function sanitizeEmail(email) {
  if (!email) return '';
  const trimmed = String(email).trim().toLowerCase();
  
  // Normalize email
  const normalized = validator.normalizeEmail(trimmed, {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false
  });
  
  return normalized || trimmed;
}

// Validate email format
function isValidEmail(email) {
  return validator.isEmail(email, {
    allow_utf8_local_part: false,
    require_tld: true,
    allow_ip_domain: false
  });
}

// ── PII Field Encryption (AES-256-GCM) ───────────────────────────────────────
// Set FIELD_ENCRYPTION_KEY in .env to a 32-byte hex string:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const FIELD_ENC_KEY_HEX = process.env.FIELD_ENCRYPTION_KEY || '';
const FIELD_ENC_KEY = FIELD_ENC_KEY_HEX.length === 64
  ? Buffer.from(FIELD_ENC_KEY_HEX, 'hex')
  : null;

if (!FIELD_ENC_KEY) {
  console.warn('  ⚠  WARNING: FIELD_ENCRYPTION_KEY is not set. PII fields will be stored in plaintext.');
  console.warn('     Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.warn('     Then set FIELD_ENCRYPTION_KEY=<hex> in .env\n');
}

function encryptField(plaintext) {
  if (!FIELD_ENC_KEY || !plaintext) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', FIELD_ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'enc:' + iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptField(value) {
  if (!FIELD_ENC_KEY || !value || !String(value).startsWith('enc:')) return value;
  try {
    const parts = String(value).split(':');
    if (parts.length !== 4) return value;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', FIELD_ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    return value; // Return raw value if decryption fails (e.g. key rotation)
  }
}

// ── CSRF Protection ────────────────────────────────────────────────────────────

const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  cookieName: 'csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',  // Allow cookies after OAuth redirects
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => {
    return req.body?.csrfToken || 
           req.headers['x-csrf-token'] || 
           req.query?.csrfToken;
  }
});

// ── Security middleware ────────────────────────────────────────────────────────

// Force HTTPS in production (Coolify/Docker deployments)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    console.log(`🔒 Redirecting HTTP to HTTPS: ${httpsUrl}`);
    return res.redirect(301, httpsUrl);
  }
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', 'https://checkout.flutterwave.com', 'https://www.paypal.com', 'https://www.paypalobjects.com', 'https://www.gstatic.com', 'https://apis.google.com', 'https://www.google.com', 'https://static.cloudflareinsights.com'],
      scriptSrcAttr: ["'unsafe-inline'"],   // allow onclick/oninput/onchange handlers
      styleSrc:      ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:        ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc:    ["'self'", 'https://api.flutterwave.com', 'https://api-m.paypal.com', 'https://api-m.sandbox.paypal.com', 'https://www.paypal.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://*.googleapis.com', 'https://*.firebaseio.com', 'https://www.gstatic.com', 'https://static.cloudflareinsights.com', 'https://apis.google.com', 'https://www.google.com', 'https://ipapi.co'],
      frameAncestors: ["'self'"],  // Allow framing from same origin
      frameSrc:      ["'self'", 'https://www.paypal.com', 'https://www.sandbox.paypal.com', 'https://accounts.google.com', 'https://*.firebaseapp.com', 'https://www.google.com'],
      formAction:    ["'self'"],   // Restrict form submissions to same origin
      baseUri:       ["'self'"],   // Prevent base tag attacks
    },
  },
  crossOriginEmbedderPolicy: false, // needed for fonts/CDN on same page
}));

// Rate-limit all API routes (generous for normal use)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});

// Tight rate-limit for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT || '10', 10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
  skipSuccessfulRequests: true,
});

// ── Performance & Compression Middleware ──────────────────────────────────────
// High-performance compression with optimal settings
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6,           // Good balance of compression vs CPU
  threshold: 1024,    // Only compress files > 1KB
  memLevel: 8         // Higher memory for better compression
}));

// Performance monitoring middleware
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const responseTime = Number(end - start) / 1000000; // Convert to ms
    
    if (responseTime > 100) { // Log slow requests
      console.log(`⚠️  Slow request: ${req.method} ${req.path} - ${responseTime.toFixed(2)}ms`);
    }
  });
  
  next();
});

// ── Additional Security Headers ───────────────────────────────────────────────
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS Protection (legacy but still used by older browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy (limit browser features)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
});

// ── CORS Configuration (for API endpoints only) ────────────────────────────────
app.use('/api', (req, res, next) => {
  const allowedOrigins = [
    HOST,
    'https://restorder.online',
    'http://localhost:3000'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-customer-token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  
  next();
});

// ── Clean URLs - Remove .html Extension ────────────────────────────────────────
// This middleware serves HTML files without the .html extension
app.use((req, res, next) => {
  // Skip if URL already has .html or is an API route
  if (req.path.endsWith('.html') || req.path.startsWith('/api/') || req.path.includes('.')) {
    return next();
  }
  
  // Map clean URLs to actual HTML files (handle special cases)
  const urlMap = {
    '/': 'index.html',
    '/login': 'customer-login.html',
    '/dashboard': 'customer-dashboard.html',
    '/checkout': 'checkout.html',
    '/menu-editor': 'admin.html',
    '/index': 'index.html',
    '/menu': 'menu.html',
    '/admin': 'admin.html',
    '/register': 'register.html',
    '/admin-dashboard': 'admin-dashboard.html',
    '/customers': 'customers.html',
    '/subscriptions': 'subscriptions.html',
    '/analytics': 'analytics.html',
    '/payments': 'payments.html',
    '/admin-menus': 'admin-menus.html',
    '/admin-users': 'admin-users.html',
    '/settings': 'settings.html',
    '/staff-panel': 'staff-panel.html',
    '/pricing': 'pricing.html',
    '/features': 'features.html',
    '/about': 'about.html',
    '/contact': 'contact.html',
    '/faq': 'faq.html',
    '/privacy': 'privacy.html',
    '/terms': 'terms.html'
  };
  
  // Check if we have a mapping for this URL
  const htmlFile = urlMap[req.path];
  if (htmlFile) {
    const filePath = path.join(__dirname, htmlFile);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  
  next();
});

// Record menu scans before serving menu.html
app.get('/menu.html', async (req, res, next) => {
  const menuId = req.query.id;
  
  if (menuId) {
    try {
      const now = new Date().toISOString();
      const rawIp = req.ip || req.connection.remoteAddress || '';
      const ipHash = crypto.createHash('sha256').update(rawIp + 'menu-salt').digest('hex').slice(0, 16);
      const userAgent = req.headers['user-agent'] || '';
      const referrer = req.headers['referer'] || req.headers['referrer'] || '';

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recent = await dbLastScanFrom(String(menuId), String(ipHash), String(fiveMinAgo));
      if (!recent) {
        await dbRecordScan(String(menuId), String(now), String(userAgent), String(ipHash), String(referrer));
        await dbIncrementScans(String(now), String(menuId));
      }
    } catch (err) {
      console.error('Failed to record scan:', err);
    }
  }
  
  next();
});

// Also handle clean URL for menu page
app.get('/menu', async (req, res, next) => {
  const menuId = req.query.id;
  
  if (menuId) {
    try {
      const now = new Date().toISOString();
      const rawIp = req.ip || req.connection.remoteAddress || '';
      const ipHash = crypto.createHash('sha256').update(rawIp + 'menu-salt').digest('hex').slice(0, 16);
      const userAgent = req.headers['user-agent'] || '';
      const referrer = req.headers['referer'] || req.headers['referrer'] || '';

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recent = await dbLastScanFrom(String(menuId), String(ipHash), String(fiveMinAgo));
      if (!recent) {
        await dbRecordScan(String(menuId), String(now), String(userAgent), String(ipHash), String(referrer));
        await dbIncrementScans(String(now), String(menuId));
      }
    } catch (err) {
      console.error('Failed to record scan:', err);
    }
  }
  
  res.sendFile(path.join(__dirname, 'menu.html'));
});

// ── Firebase Auth Handler Proxy ──────────────────────────────────────────────
// When authDomain is set to the custom domain (restorder.online), Firebase SDK
// opens /__/auth/handler on this origin. Proxy those requests to Firebase Hosting.
app.use('/__/auth', (req, res) => {
  const firebaseProject = process.env.FIREBASE_PROJECT_ID || 'restorder-d70f5';
  const target = `${firebaseProject}.firebaseapp.com`;
  const proxyPath = '/__/auth' + req.url;
  const options = {
    hostname: target,
    port: 443,
    path: proxyPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: target,
    },
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    console.error('Firebase auth proxy error:', err.message);
    res.status(502).send('Firebase auth proxy error');
  });
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
});

// Static file caching and optimization
app.use(express.static('.', {
  maxAge: process.env.NODE_ENV === 'production' ? '1y' : '0', // 1 year cache in production
  etag: true,
  lastModified: true,
  immutable: true,
  setHeaders: (res, path) => {
    // Cache HTML files for shorter periods
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
    }
    // Cache CSS/JS for longer
    if (path.endsWith('.css') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
    }
    // Note: compression is handled by the compression() middleware above.
    // Do NOT set Content-Encoding manually — the files are not pre-compressed.
  }
}));

app.use('/api/', apiLimiter);

// ── Auth middleware (protects write routes) ────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.cookies?.adminToken || req.query?.token;
  if (isValidSession(token)) {
    req.adminUser = getSessionUser(token);
    return next();
  }
  res.status(401).json({ error: 'Unauthorised. Please log in.' });
}

// Require specific roles
function requireRole(...roles) {
  return (req, res, next) => {
    const token = req.headers['x-admin-token'] || req.cookies?.adminToken || req.query?.token;
    if (!isValidSession(token)) {
      return res.status(401).json({ error: 'Unauthorised. Please log in.' });
    }
    const user = getSessionUser(token);
    req.adminUser = user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden. Insufficient permissions.' });
    }
    next();
  };
}

// ── Accept admin OR customer auth (shared menu-editor endpoints) ───────────────
function requireAnyAuth(req, res, next) {
  const adminToken = req.headers['x-admin-token'] || req.cookies?.adminToken || req.query?.token;
  if (isValidSession(adminToken)) {
    req.adminUser = getSessionUser(adminToken);
    return next();
  }
  const customerToken = req.headers['x-customer-token'] || req.cookies?.customerToken || req.query?.ctoken;
  const session = isValidCustomerSession(customerToken);
  if (session) {
    req.customer = session;
    req.isCustomer = true;
    return next();
  }
  res.status(401).json({ error: 'Unauthorised. Please log in.' });
}

// Check customer owns a menu (throws 403 if not)
async function assertMenuOwnership(menuId, customerId, res) {
  const { rows } = await pool.query(
    'SELECT id FROM menus WHERE id = $1 AND customer_id = $2',
    [menuId, customerId]
  );
  if (!rows.length) {
    res.status(403).json({ error: 'You do not have permission to access this menu.' });
    return false;
  }
  return true;
}

// ── Subscription middleware (checks plan limits) ────────────────────────────────
async function checkSubscriptionLimit(req, res, next) {
  try {
    // Get menu ID from request (could be in params or body)
    const menuId = req.params.id || req.body.menu_id;
    
    if (!menuId) {
      // If no menu ID, this might be a create operation or not menu-specific
      // For create operations, we'd need to check total menu count
      // For now, let it pass and handle in the route
      return next();
    }
    
    // Get subscription for this menu
    const { rows } = await pool.query(`
      SELECT 
        s.status,
        s.trial_end,
        sp.menu_limit, 
        sp.display_name as plan_name
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE s.menu_id = $1
    `, [menuId]);
    
    if (!rows.length) {
      // No subscription found - allow but should auto-assign starter
      return next();
    }
    
    const subscription = rows[0];

    // Check trial expiry
    if (subscription.status === 'trial') {
      if (subscription.trial_end && new Date(subscription.trial_end) < new Date()) {
        return res.status(403).json({
          error: 'Your 7-day free trial has expired. Please upgrade to continue.',
          trial_expired: true,
          subscription_status: 'trial'
        });
      }
      // Trial still active — allow through
    } else if (subscription.status !== 'active') {
      // Check if subscription is active
      return res.status(403).json({ 
        error: 'Subscription is not active. Please renew your subscription.',
        subscription_status: subscription.status
      });
    }
    
    // For menu creation, check if limit reached
    if (req.method === 'POST' && req.path.includes('/menus')) {
      const { rows: menuCount } = await pool.query(
        'SELECT COUNT(*) as count FROM menus'
      );
      
      const currentCount = parseInt(menuCount[0].count) || 0;
      
      if (currentCount >= subscription.menu_limit && subscription.menu_limit < 999) {
        return res.status(403).json({ 
          error: `You have reached your plan limit of ${subscription.menu_limit} menu(s). Please upgrade to create more.`,
          current_plan: subscription.plan_name,
          limit: subscription.menu_limit,
          current_count: currentCount
        });
      }
    }
    
    // Attach subscription info to request for use in routes
    req.subscription = subscription;
    next();
    
  } catch (err) {
    console.error('Subscription check error:', err);
    // On error, allow the request to continue (fail open)
    next();
  }
}



// ── Directories ───────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR    = path.join(__dirname, 'data');
[UPLOADS_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });

// ── PostgreSQL database ──────────────────────────────────────────────────────
// Strip sslmode from URL so pg-connection-string doesn't override our ssl config
let _pgConnStr = process.env.DATABASE_URL || '';
try {
  const _u = new URL(_pgConnStr);
  _u.searchParams.delete('sslmode');
  _pgConnStr = _u.toString();
} catch (_) { /* use as-is if not a valid URL */ }

// Determine SSL configuration based on environment
// Local PostgreSQL typically doesn't have SSL enabled
const isLocalDB = _pgConnStr.includes('localhost') || _pgConnStr.includes('127.0.0.1');
const sslConfig = isLocalDB ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: _pgConnStr,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: sslConfig,
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err);
});

// ── Schema setup (runs once on startup) ──────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS menus (
        id               TEXT PRIMARY KEY,
        restaurant_name  TEXT NOT NULL,
        currency         TEXT NOT NULL DEFAULT 'USD',
        brand_color      TEXT NOT NULL DEFAULT '#2dd4bf',
        logo_url         TEXT NOT NULL DEFAULT '',
        tagline          TEXT NOT NULL DEFAULT '',
        font_style       TEXT NOT NULL DEFAULT 'modern',
        bg_style         TEXT NOT NULL DEFAULT 'dark',
        show_logo        INTEGER NOT NULL DEFAULT 1,
        show_name        INTEGER NOT NULL DEFAULT 1,
        header_layout    TEXT NOT NULL DEFAULT 'logo-left',
        text_color       TEXT NOT NULL DEFAULT '',
        heading_color    TEXT NOT NULL DEFAULT '',
        bg_color         TEXT NOT NULL DEFAULT '',
        card_bg          TEXT NOT NULL DEFAULT '',
        price_color      TEXT NOT NULL DEFAULT '',
        phone            TEXT NOT NULL DEFAULT '',
        email            TEXT NOT NULL DEFAULT '',
        address          TEXT NOT NULL DEFAULT '',
        website          TEXT NOT NULL DEFAULT '',
        social_instagram TEXT NOT NULL DEFAULT '',
        social_facebook  TEXT NOT NULL DEFAULT '',
        social_twitter   TEXT NOT NULL DEFAULT '',
        social_whatsapp  TEXT NOT NULL DEFAULT '',
        social_tiktok    TEXT NOT NULL DEFAULT '',
        social_youtube   TEXT NOT NULL DEFAULT '',
        qr_version       INTEGER NOT NULL DEFAULT 1,
        qr_code          TEXT NOT NULL DEFAULT '',
        total_scans      INTEGER NOT NULL DEFAULT 0,
        last_scan_at     TEXT,
        updated_at       TEXT,
        created_at       TEXT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id          TEXT PRIMARY KEY,
        menu_id     TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'General',
        price       REAL NOT NULL DEFAULT 0,
        description TEXT DEFAULT '',
        tags        TEXT DEFAULT '[]',
        size        TEXT NOT NULL DEFAULT '',
        image_url   TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_menu ON menu_items (menu_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_scans (
        id         SERIAL PRIMARY KEY,
        menu_id    TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        scanned_at TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        referrer   TEXT
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scans_menu ON menu_scans (menu_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scans_date ON menu_scans (scanned_at)`);

    // Migration: add image_url column if missing (for existing DBs)
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_redirects (
        id              SERIAL PRIMARY KEY,
        source_menu_id  TEXT NOT NULL UNIQUE,
        target_menu_id  TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        label           TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL
      );
    `);

    // Migration: add tables_enabled column
    await client.query(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS tables_enabled INTEGER NOT NULL DEFAULT 0`).catch(() => {});

    // Migration: add rating column to menu_items
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS rating REAL NOT NULL DEFAULT 0`).catch(() => {});

    // Migration: add subcategory column to menu_items
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS subcategory TEXT NOT NULL DEFAULT ''`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_tables (
        id        SERIAL PRIMARY KEY,
        menu_id   TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        label     TEXT NOT NULL DEFAULT '',
        qr_code   TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tables_menu ON menu_tables (menu_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS table_alerts (
        id         SERIAL PRIMARY KEY,
        menu_id    TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        table_label TEXT NOT NULL,
        message    TEXT NOT NULL DEFAULT 'Service requested',
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_menu ON table_alerts (menu_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alerts_status ON table_alerts (status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_ratings (
        id        SERIAL PRIMARY KEY,
        item_id   TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        menu_id   TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        rating    INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        ip_hash   TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ratings_item ON item_ratings (item_id)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_unique ON item_ratings (item_id, ip_hash)`);

    // Orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id         SERIAL PRIMARY KEY,
        menu_id    TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        table_label TEXT NOT NULL DEFAULT '',
        items      JSONB NOT NULL DEFAULT '[]',
        total      REAL NOT NULL DEFAULT 0,
        currency   TEXT NOT NULL DEFAULT 'USD',
        status     TEXT NOT NULL DEFAULT 'pending',
        customer_name  TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_menu ON orders (menu_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status)`);
    // Migration: add customer columns if missing
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL DEFAULT ''`);

    // ── Customer Management Tables ──────────────────────────────────────────────
    
    // Customers table - Restaurant owners/businesses
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id              SERIAL PRIMARY KEY,
        email           TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        business_name   TEXT NOT NULL,
        contact_name    TEXT NOT NULL DEFAULT '',
        phone           TEXT NOT NULL DEFAULT '',
        address         TEXT NOT NULL DEFAULT '',
        city            TEXT NOT NULL DEFAULT '',
        country         TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'active',
        email_verified  INTEGER NOT NULL DEFAULT 0,
        verification_token TEXT DEFAULT '',
        reset_token     TEXT DEFAULT '',
        last_login      TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_status ON customers (status)`);

    // Migrations: add promo/discount columns to existing customers tables
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS promo_code       TEXT    DEFAULT ''`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS discount_months  INTEGER DEFAULT 0`);

    // Migration: add customer_id to menus table
    await client.query(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_menus_customer ON menus (customer_id)`);

    // Migration: add cover_image to menus table
    await client.query(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS cover_image TEXT NOT NULL DEFAULT ''`).catch(() => {});

    // Migration: add Firebase + phone verification + lockout columns to customers
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS firebase_uid   TEXT    DEFAULT ''`).catch(() => {});
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS login_attempts INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS lockout_until  TEXT    DEFAULT NULL`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_firebase_uid ON customers (firebase_uid) WHERE firebase_uid IS NOT NULL AND firebase_uid <> ''`).catch(() => {});

    // ── Subscription Management Tables ──────────────────────────────────────────
    
    // Subscription Plans table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL UNIQUE,
        display_name    TEXT NOT NULL,
        price           REAL NOT NULL,
        annual_price    REAL NOT NULL DEFAULT 0,
        interval        TEXT NOT NULL DEFAULT 'monthly',
        menu_limit      INTEGER NOT NULL DEFAULT 1,
        location_limit  INTEGER NOT NULL DEFAULT 1,
        features        JSONB NOT NULL DEFAULT '[]',
        is_active       INTEGER NOT NULL DEFAULT 1,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_plans_active ON subscription_plans (is_active)`);

    // Subscriptions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id              SERIAL PRIMARY KEY,
        menu_id         TEXT NOT NULL UNIQUE REFERENCES menus(id) ON DELETE CASCADE,
        plan_id         INTEGER NOT NULL REFERENCES subscription_plans(id),
        status          TEXT NOT NULL DEFAULT 'active',
        start_date      TEXT NOT NULL,
        end_date        TEXT,
        trial_end       TEXT,
        cancel_at_end   INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_menu ON subscriptions (menu_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_plan ON subscriptions (plan_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions (status)`);
    await client.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_billing_date TEXT`);

    // Payments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id                SERIAL PRIMARY KEY,
        subscription_id   INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        amount            REAL NOT NULL,
        currency          TEXT NOT NULL DEFAULT 'USD',
        payment_method    TEXT NOT NULL DEFAULT 'manual',
        payment_id        TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'pending',
        paid_at           TEXT,
        notes             TEXT DEFAULT '',
        created_at        TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_sub ON payments (subscription_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status)`);

    // Usage tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id              SERIAL PRIMARY KEY,
        menu_id         TEXT NOT NULL UNIQUE REFERENCES menus(id) ON DELETE CASCADE,
        menus_count     INTEGER NOT NULL DEFAULT 1,
        locations_count INTEGER NOT NULL DEFAULT 1,
        scans_count     INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_usage_menu ON usage_tracking (menu_id)`);

    // Promo codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id               SERIAL PRIMARY KEY,
        code             TEXT NOT NULL UNIQUE,
        description      TEXT NOT NULL DEFAULT '',
        discount_type    TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
        discount_value   REAL NOT NULL DEFAULT 0,
        applicable_plans JSONB NOT NULL DEFAULT '[]',
        max_uses         INTEGER NOT NULL DEFAULT 0,
        uses_count       INTEGER NOT NULL DEFAULT 0,
        expires_at       TEXT,
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_promos_code ON promo_codes (code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_promos_active ON promo_codes (is_active)`);

    // Admin users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id              SERIAL PRIMARY KEY,
        email           TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        name            TEXT NOT NULL DEFAULT '',
        role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'viewer')),
        status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        last_login      TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
    `);

    // Seed default super admin if no admin users exist
    const { rows: existingAdmins } = await client.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(existingAdmins[0].count) === 0) {
      const now = new Date().toISOString();
      // Use ADMIN_SECRET_HASH from env if available, otherwise hash a default
      let defaultHash = ADMIN_SECRET_HASH;
      if (!defaultHash || !defaultHash.startsWith('$2') || defaultHash.length < 59) {
        defaultHash = await bcrypt.hash('admin123', 12);
        console.log('  ⚠ No ADMIN_SECRET_HASH set – seeded super admin with default password "admin123". CHANGE THIS IMMEDIATELY!');
      }
      await client.query(`
        INSERT INTO admin_users (email, password_hash, name, role, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'super_admin', 'active', $4, $4)
      `, ['admin@restorder.online', defaultHash, 'Super Admin', now]);
      console.log('  ✓ Seeded default super admin (admin@restorder.online)');
    }

    // Migration: add annual_price column if missing
    await client.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS annual_price REAL NOT NULL DEFAULT 0`).catch(() => {});

    // Seed default subscription plans if empty
    const { rows: existingPlans } = await client.query('SELECT COUNT(*) FROM subscription_plans');
    if (parseInt(existingPlans[0].count) === 0) {
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO subscription_plans (name, display_name, price, annual_price, interval, menu_limit, location_limit, features, is_active, sort_order, created_at)
        VALUES
          ('trial', '7-Day Trial', 0, 0, 'monthly', 1, 1, '["1 Digital Menu","QR Code Generation","Real-Time Menu Updates","Basic Analytics","7-Day Full Access to Pro Features","No credit card required"]', 1, 0, $1),
          ('starter', 'Starter', 0, 0, 'monthly', 1, 1, '["1 Digital Menu","Unlimited Menu Items","QR Code Generation","Real-Time Menu Updates","Custom Branding & Colors","Multi-Currency Support","Dark/Light Themes","Smart Search","Basic Analytics","Email Support"]', 1, 1, $1),
          ('professional', 'Professional', 39, 374, 'monthly', 5, 5, '["Everything in Starter","Up to 5 Locations","Table Management System","Online Ordering & Cart","Customer Ratings & Reviews","Advanced Analytics Dashboard","WhatsApp Integration","Import/Export CSV","Print Bills & Receipts","Priority Support (24h response)","99.9% Uptime SLA"]', 1, 2, $1),
          ('enterprise', 'Enterprise', 99, 950, 'monthly', 999, 999, '["Everything in Professional","Unlimited Locations","Multi-Location Management","Custom Domain","White-Label Branding","API Access & Webhooks","Advanced Security & SSO","Team Collaboration Tools","Dedicated Account Manager","24/7 Phone & Chat Support","Custom Onboarding & Training","99.99% Uptime SLA"]', 1, 3, $1)
      `, [now]);
      console.log('  ✓ Seeded subscription plans');
    }

    // Ensure trial plan exists (may be missing if plans were seeded before trial was added)
    const { rows: trialCheck } = await client.query("SELECT id FROM subscription_plans WHERE name = 'trial'");
    if (trialCheck.length === 0) {
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO subscription_plans (name, display_name, price, annual_price, interval, menu_limit, location_limit, features, is_active, sort_order, created_at)
        VALUES ('trial', '7-Day Trial', 0, 0, 'monthly', 1, 1, '["1 Digital Menu","QR Code Generation","Real-Time Menu Updates","Basic Analytics","7-Day Full Access to Pro Features","No credit card required"]', 1, 0, $1)
      `, [now]);
      console.log('  ✓ Added trial plan');
    }

    // App settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TEXT,
        updated_by TEXT
      )
    `);
    const { rows: existingSettings } = await client.query('SELECT COUNT(*) FROM app_settings');
    if (parseInt(existingSettings[0].count) === 0) {
      const settingsNow = new Date().toISOString();
      const settingsDefaults = [
        ['site_name',           'RestOrder'],
        ['site_tagline',        'Digital Menu & QR Code Platform'],
        ['site_description',    'Digital Menu & QR Code Platform for restaurants'],
        ['site_logo_url',       ''],
        ['site_favicon_url',    ''],
        ['support_email',       'support@restorder.online'],
        ['timezone',            'UTC'],
        ['default_currency',    'USD'],
        ['currency_geo_detect', 'true'],
        ['integration_clickpesa',    JSON.stringify({ enabled: false, environment: 'sandbox', merchant_id: '', api_key: '', api_secret: '', callback_url: '' })],
        ['integration_flutterwave', JSON.stringify({ enabled: false, environment: 'sandbox', public_key: '', secret_key: '', encryption_key: '', webhook_url: '' })],
        ['integration_paypal',       JSON.stringify({ enabled: false, environment: 'sandbox', client_id: '', client_secret: '', webhook_id: '' })],
        ['integration_bank_transfer', JSON.stringify({ enabled: false, bank_name: '', account_name: '', account_number: '', swift_code: '', routing_number: '', instructions: '' })],
        ['integration_email',        JSON.stringify({ provider: 'smtp', host: '', port: '587', secure: false, user: '', pass: '', from_name: 'RestOrder', from_email: '' })],
        ['integration_webhooks',     JSON.stringify({ payment_notify_url: '', subscription_notify_url: '', secret: '' })],
      ];
      for (const [key, value] of settingsDefaults) {
        await client.query(
          'INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
          [key, value, settingsNow]
        );
      }
      console.log('  ✓ Seeded default app settings');
    }

    // Persistent customer sessions (survives server restarts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        token       TEXT PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        email       TEXT NOT NULL,
        created_at  BIGINT NOT NULL,
        expires_at  BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_csessions_customer ON customer_sessions (customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_csessions_expires ON customer_sessions (expires_at)`);

    // Staff members table – sub-users per business (manager / waiter / cashier)
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_members (
        id            SERIAL PRIMARY KEY,
        customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('manager', 'waiter', 'cashier')),
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at    TEXT NOT NULL,
        updated_at    TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_staff_customer ON staff_members (customer_id)`);
    // Migration: persist staff session identity in customer_sessions
    await client.query(`ALTER TABLE customer_sessions ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES staff_members(id) ON DELETE CASCADE`);

    console.log('  ✓ PostgreSQL schema ready');
  } finally {
    client.release();
  }
}

// Reload customer sessions from DB into memory (called at startup after initDB)
async function loadCustomerSessionsFromDB() {
  try {
    const now = Date.now();
    // Clean up expired sessions first
    await pool.query('DELETE FROM customer_sessions WHERE expires_at <= $1', [now]);
    // Load remaining valid sessions into memory
    const { rows } = await pool.query(
      `SELECT cs.token, cs.customer_id, cs.email, cs.created_at, cs.staff_id,
              sm.name AS staff_name, sm.role AS staff_role
       FROM customer_sessions cs
       LEFT JOIN staff_members sm ON sm.id = cs.staff_id
       WHERE cs.expires_at > $1`,
      [now]
    );
    for (const row of rows) {
      if (row.staff_id) {
        customerSessions.set(row.token, {
          customerId: row.customer_id, id: row.customer_id,
          email: row.email, name: row.staff_name,
          staffId: row.staff_id, staffRole: row.staff_role,
          isStaff: true, createdAt: parseInt(row.created_at),
        });
      } else {
        customerSessions.set(row.token, {
          customerId: row.customer_id,
          id: row.customer_id,
          email: row.email,
          createdAt: parseInt(row.created_at),
        });
      }
    }
    if (rows.length > 0) console.log(`  ✓ Restored ${rows.length} customer session(s) from DB`);
  } catch (err) {
    console.error('  ⚠ Failed to load customer sessions from DB:', err.message);
  }
}

// Cache frequently accessed data
const menuCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedMenu(menuId) {
  const cached = menuCache.get(menuId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedMenu(menuId, data) {
  menuCache.set(menuId, { data, timestamp: Date.now() });
  if (menuCache.size > 100) {
    const oldest = Array.from(menuCache.entries())
      .sort(([,a], [,b]) => a.timestamp - b.timestamp)[0];
    menuCache.delete(oldest[0]);
  }
}

// ── DB helper functions ──────────────────────────────────────────────────────

async function dbGetMenu(id) {
  const { rows } = await pool.query('SELECT * FROM menus WHERE id = $1', [id]);
  return rows[0] || null;
}

async function dbGetItems(menuId) {
  const { rows } = await pool.query(
    'SELECT * FROM menu_items WHERE menu_id = $1 ORDER BY category, sort_order', [menuId]);
  return rows;
}

async function dbListMenus() {
  const { rows } = await pool.query(`
    SELECT id, restaurant_name, created_at, total_scans, qr_version, last_scan_at,
      (SELECT COUNT(*) FROM menu_items WHERE menu_id = menus.id) AS item_count
    FROM menus ORDER BY created_at DESC`);
  return rows;
}

async function dbRecordScan(menuId, scannedAt, userAgent, ipHash, referrer) {
  await pool.query(
    'INSERT INTO menu_scans (menu_id, scanned_at, user_agent, ip_address, referrer) VALUES ($1,$2,$3,$4,$5)',
    [menuId, scannedAt, userAgent, ipHash, referrer]);
}

async function dbIncrementScans(now, menuId) {
  await pool.query(
    'UPDATE menus SET total_scans = total_scans + 1, last_scan_at = $1 WHERE id = $2',
    [now, menuId]);
}

async function dbLastScanFrom(menuId, ipHash, since) {
  const { rows } = await pool.query(
    'SELECT id FROM menu_scans WHERE menu_id = $1 AND ip_address = $2 AND scanned_at > $3 LIMIT 1',
    [menuId, ipHash, since]);
  return rows[0] || null;
}

async function dbRegenerateQR(qrDataUrl, now, menuId) {
  await pool.query(
    'UPDATE menus SET qr_version = qr_version + 1, qr_code = $1, updated_at = $2 WHERE id = $3',
    [qrDataUrl, now, menuId]);
}

async function dbGetRecentScans(menuId, limit) {
  const { rows } = await pool.query(
    'SELECT * FROM menu_scans WHERE menu_id = $1 ORDER BY scanned_at DESC LIMIT $2',
    [menuId, limit]);
  return rows;
}

async function dbGetScansStats(menuId) {
  const { rows } = await pool.query(`
    SELECT DATE(scanned_at::timestamp) as date, COUNT(*) as scans
    FROM menu_scans
    WHERE menu_id = $1 AND scanned_at >= (NOW() - INTERVAL '30 days')::text
    GROUP BY DATE(scanned_at::timestamp)
    ORDER BY date DESC`, [menuId]);
  return rows;
}

function buildMenuResponse(menu, rawItems) {
  return {
    id:             menu.id,
    restaurantName: menu.restaurant_name,
    currency:       menu.currency || 'USD',
    brandColor:     menu.brand_color || '#2dd4bf',
    logoUrl:        menu.logo_url || '',
    coverImage:     menu.cover_image || '',
    tagline:        menu.tagline || '',
    fontStyle:      menu.font_style || 'modern',
    bgStyle:        menu.bg_style || 'dark',
    showLogo:       menu.show_logo     !== null ? menu.show_logo     : 1,
    showName:       menu.show_name     !== null ? menu.show_name     : 1,
    headerLayout:   menu.header_layout || 'logo-left',
    textColor:      menu.text_color    || '',
    headingColor:   menu.heading_color || '',
    bgColor:        menu.bg_color      || '',
    cardBg:         menu.card_bg       || '',
    priceColor:     menu.price_color   || '',
    phone:           menu.phone            || '',
    email:           menu.email            || '',
    address:         menu.address          || '',
    website:         menu.website          || '',
    socialInstagram: menu.social_instagram || '',
    socialFacebook:  menu.social_facebook  || '',
    socialTwitter:   menu.social_twitter   || '',
    socialWhatsapp:  menu.social_whatsapp  || '',
    socialTiktok:    menu.social_tiktok    || '',
    socialYoutube:   menu.social_youtube   || '',
    tablesEnabled:  menu.tables_enabled   || 0,
    createdAt:      menu.created_at,
    items: rawItems.map(it => ({
      id:          it.id,
      name:        it.name,
      category:    it.category,
      subcategory: it.subcategory || '',
      price:       it.price,
      description: it.description,
      tags:        JSON.parse(it.tags || '[]'),
      size:        it.size || '',
      imageUrl:    it.image_url || '',
      rating:      it.rating || 0,
    }))
  };
}

async function saveMenuTx(menuId, restaurantName, currency, branding, items, qrCode) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    await client.query(`INSERT INTO menus
      (id, restaurant_name, currency, brand_color, logo_url, tagline, font_style, bg_style,
       show_logo, show_name, header_layout, text_color, heading_color, bg_color, card_bg, price_color,
       phone, email, address, website,
       social_instagram, social_facebook, social_twitter, social_whatsapp, social_tiktok, social_youtube,
       tables_enabled, cover_image,
       qr_version, qr_code, total_scans, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        String(menuId),
        String(restaurantName),
        String(currency || 'USD'),
        String(branding.brandColor    || '#2dd4bf'),
        String(branding.logoUrl       || ''),
        String(branding.tagline       || ''),
        String(branding.fontStyle     || 'modern'),
        String(branding.bgStyle       || 'dark'),
        Number(branding.showLogo      !== undefined ? branding.showLogo      : 1),
        Number(branding.showName      !== undefined ? branding.showName      : 1),
        String(branding.headerLayout  || 'logo-left'),
        String(branding.textColor     || ''),
        String(branding.headingColor  || ''),
        String(branding.bgColor       || ''),
        String(branding.cardBg        || ''),
        String(branding.priceColor    || ''),
        String(branding.phone           || ''),
        String(branding.email           || ''),
        String(branding.address         || ''),
        String(branding.website         || ''),
        String(branding.socialInstagram || ''),
        String(branding.socialFacebook  || ''),
        String(branding.socialTwitter   || ''),
        String(branding.socialWhatsapp  || ''),
        String(branding.socialTiktok    || ''),
        String(branding.socialYoutube   || ''),
        Number(branding.tablesEnabled   || 0),
        String(branding.coverImage     || ''),
        1,                            // qr_version
        String(qrCode || ''),         // qr_code
        0,                            // total_scans
        now,                          // created_at
        now                           // updated_at
      ]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tags = Array.isArray(item.tags) ? item.tags : [];
      await client.query(`INSERT INTO menu_items
        (id, menu_id, name, category, subcategory, price, description, tags, size, image_url, rating, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          String(item.id || crypto.randomUUID()),
          String(menuId),
          String(item.name),
          String(item.category || 'General'),
          String(item.subcategory || ''),
          Number(item.price || 0),
          String(item.description || ''),
          JSON.stringify(tags),
          String(item.size || ''),
          String(item.imageUrl || ''),
          Number(item.rating || 0),
          item.sortOrder !== undefined ? Number(item.sortOrder) : i
        ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateMenuTx(menuId, restaurantName, currency, branding, items) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE menus SET
      restaurant_name=$1, currency=$2, brand_color=$3, logo_url=$4, tagline=$5, font_style=$6, bg_style=$7,
      show_logo=$8, show_name=$9, header_layout=$10, text_color=$11, heading_color=$12, bg_color=$13, card_bg=$14, price_color=$15,
      phone=$16, email=$17, address=$18, website=$19,
      social_instagram=$20, social_facebook=$21, social_twitter=$22, social_whatsapp=$23, social_tiktok=$24, social_youtube=$25,
      tables_enabled=$26, cover_image=$27, updated_at=$28
      WHERE id=$29`,
      [
        String(restaurantName),
        String(currency || 'USD'),
        String(branding.brandColor    || '#2dd4bf'),
        String(branding.logoUrl       || ''),
        String(branding.tagline       || ''),
        String(branding.fontStyle     || 'modern'),
        String(branding.bgStyle       || 'dark'),
        Number(branding.showLogo      !== undefined ? branding.showLogo      : 1),
        Number(branding.showName      !== undefined ? branding.showName      : 1),
        String(branding.headerLayout  || 'logo-left'),
        String(branding.textColor     || ''),
        String(branding.headingColor  || ''),
        String(branding.bgColor       || ''),
        String(branding.cardBg        || ''),
        String(branding.priceColor    || ''),
        String(branding.phone           || ''),
        String(branding.email           || ''),
        String(branding.address         || ''),
        String(branding.website         || ''),
        String(branding.socialInstagram || ''),
        String(branding.socialFacebook  || ''),
        String(branding.socialTwitter   || ''),
        String(branding.socialWhatsapp  || ''),
        String(branding.socialTiktok    || ''),
        String(branding.socialYoutube   || ''),
        Number(branding.tablesEnabled   || 0),
        String(branding.coverImage     || ''),
        new Date().toISOString(),
        String(menuId)
      ]);

    await client.query('DELETE FROM menu_items WHERE menu_id=$1', [menuId]);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tags = Array.isArray(item.tags) ? item.tags : [];
      await client.query(`INSERT INTO menu_items
        (id, menu_id, name, category, subcategory, price, description, tags, size, image_url, rating, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          String(item.id || crypto.randomUUID()),
          String(menuId),
          String(item.name),
          String(item.category || 'General'),
          String(item.subcategory || ''),
          Number(item.price || 0),
          String(item.description || ''),
          JSON.stringify(tags),
          String(item.size || ''),
          String(item.imageUrl || ''),
          Number(item.rating || 0),
          item.sortOrder !== undefined ? Number(item.sortOrder) : i
        ]);
    }
    await client.query('COMMIT');
    menuCache.delete(menuId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    const allowed = ['.pdf', '.csv', '.xlsx', '.xls', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only PDF, CSV, XLSX, XLS and TXT files are allowed.'));
  },
});

app.use(express.json({ limit: '12mb' }));  // allow base64 logo (~8–10 MB encoded)
app.use(cookieParser());  // Parse cookies for secure session management
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Item image upload (auto-resize & optimize) ────────────────────────────────
const ITEM_IMG_DIR = path.join(UPLOADS_DIR, 'items');
if (!fs.existsSync(ITEM_IMG_DIR)) fs.mkdirSync(ITEM_IMG_DIR, { recursive: true });

const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WebP and GIF images are allowed.'));
  },
});

app.post('/api/upload-item-image', requireAnyAuth, imgUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
    const filename = crypto.randomUUID() + '.webp';
    const outPath  = path.join(ITEM_IMG_DIR, filename);
    await sharp(req.file.buffer)
      .resize(400, 400, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(outPath);
    const imageUrl = '/uploads/items/' + filename;
    res.json({ imageUrl });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ error: 'Failed to process image.' });
  }
});

// ── Branding image upload (logo / favicon) ─────────────────────────────────────
const BRANDING_DIR = path.join(UPLOADS_DIR, 'branding');
if (!fs.existsSync(BRANDING_DIR)) fs.mkdirSync(BRANDING_DIR, { recursive: true });

const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(file.mimetype) ||
        /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(file.originalname)) return cb(null, true);
    cb(new Error('Only image files are allowed.'));
  },
});

app.post('/api/admin/branding/upload', requireRole('super_admin'), brandingUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    const type = (req.body.type || '').toLowerCase();
    if (!['logo', 'favicon'].includes(type)) return res.status(400).json({ error: 'type must be logo or favicon.' });
    const isSvg = /svg/i.test(req.file.mimetype) || /\.svg$/i.test(req.file.originalname);
    let filename, outPath, imageUrl;
    if (isSvg) {
      // Serve SVGs as-is
      filename = `${type}-${Date.now()}.svg`;
      outPath  = path.join(BRANDING_DIR, filename);
      fs.writeFileSync(outPath, req.file.buffer);
    } else if (type === 'favicon') {
      filename = `favicon-${Date.now()}.png`;
      outPath  = path.join(BRANDING_DIR, filename);
      await sharp(req.file.buffer).resize(64, 64, { fit: 'cover' }).png().toFile(outPath);
    } else {
      filename = `logo-${Date.now()}.webp`;
      outPath  = path.join(BRANDING_DIR, filename);
      await sharp(req.file.buffer).resize(null, 120, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(outPath);
    }
    imageUrl = `/uploads/branding/${filename}`;
    res.json({ imageUrl });
  } catch (err) {
    console.error('Branding upload error:', err);
    res.status(500).json({ error: 'Failed to process image.' });
  }
});

// ── Static routes ──────────────────────────────────────────────────────────────

// Health check endpoint for deployment platforms
app.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: '1.54.31'
  });
});

// CSRF token endpoint - Returns a token for forms
app.get('/api/csrf-token', (req, res) => {
  const csrfToken = generateToken(req, res);
  res.json({ csrfToken });
});

// GET /api/firebase-config – return public Firebase config for frontend SDK
app.get('/api/firebase-config', async (req, res) => {
  // Check DB-stored settings first (admin UI overrides env vars)
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'integration_firebase'");
    if (rows.length) {
      let cfg;
      try { cfg = JSON.parse(rows[0].value); } catch(e) { cfg = null; }
      if (cfg && cfg.enabled && cfg.project_id && cfg.api_key) {
        const out = {
          enabled:    true,
          apiKey:     cfg.api_key,
          authDomain: cfg.auth_domain || `${cfg.project_id}.firebaseapp.com`,
          projectId:  cfg.project_id,
        };
        if (cfg.app_id)               out.appId             = cfg.app_id;
        if (cfg.storage_bucket)       out.storageBucket     = cfg.storage_bucket;
        if (cfg.messaging_sender_id)  out.messagingSenderId = cfg.messaging_sender_id;
        if (cfg.measurement_id)       out.measurementId     = cfg.measurement_id;
        return res.json(out);
      } else if (cfg && cfg.enabled === false) {
        return res.json({ enabled: false });
      }
    }
  } catch(e) { /* fall through to env vars */ }

  // Fallback: env vars
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_API_KEY) {
    return res.json({ enabled: false });
  }
  const out = {
    enabled:    true,
    apiKey:     process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId:  process.env.FIREBASE_PROJECT_ID,
  };
  if (process.env.FIREBASE_APP_ID)              out.appId             = process.env.FIREBASE_APP_ID;
  if (process.env.FIREBASE_STORAGE_BUCKET)      out.storageBucket     = process.env.FIREBASE_STORAGE_BUCKET;
  if (process.env.FIREBASE_MESSAGING_SENDER_ID) out.messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID;
  if (process.env.FIREBASE_MEASUREMENT_ID)      out.measurementId     = process.env.FIREBASE_MEASUREMENT_ID;
  res.json(out);
});

// GET /api/public/branding – public site identity (no auth required)
app.get('/api/public/branding', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('site_name','site_tagline','site_logo_url','site_favicon_url','site_description')"
    );
    const out = { site_name: 'RestOrder', site_tagline: '', site_logo_url: '', site_favicon_url: '', site_description: '' };
    for (const r of rows) out[r.key] = r.value || '';
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /favicon.ico – serve dynamic favicon from branding settings
app.get('/favicon.ico', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'site_favicon_url'");
    const url = (rows[0]?.value || '').trim();
    if (url) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return res.redirect(302, url);
      }
      if (url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, url.replace(/^\//, ''));
        if (fs.existsSync(filePath)) {
          return res.sendFile(filePath);
        }
      }
    }
  } catch (_) {}
  // Default: orange "R" SVG favicon
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#c2410c"/><text x="16" y="23" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" font-weight="bold" fill="#fff">R</text></svg>');
});

// GET /  – serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// GET /terms and /privacy – legal pages
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});
app.get('/refund', (req, res) => {
  res.sendFile(path.join(__dirname, 'refund.html'));
});

// ── Auth routes ────────────────────────────────────────────────────────────────

// Shared login handler – authenticates against admin_users table
async function handleAdminLogin(req, res) {
  const { email, password, secret } = req.body || {};
  // Support both new (email+password) and legacy (secret-only) login
  const loginEmail = email ? String(email).trim().toLowerCase() : null;
  const loginPassword = password || secret;

  if (!loginPassword || typeof loginPassword !== 'string') {
    return res.status(400).json({ error: 'Password is required.' });
  }

  try {
    let user = null;

    if (loginEmail) {
      // Multi-user login: look up by email
      const { rows } = await pool.query(
        'SELECT id, email, password_hash, name, role, status FROM admin_users WHERE email = $1',
        [loginEmail]
      );
      if (rows.length) user = rows[0];
    } else {
      // Legacy fallback: try all admin users (single-password mode)
      const { rows } = await pool.query(
        'SELECT id, email, password_hash, name, role, status FROM admin_users ORDER BY id ASC'
      );
      for (const row of rows) {
        if (await bcrypt.compare(loginPassword, row.password_hash)) {
          user = row;
          break;
        }
      }
      // Final fallback: check ADMIN_SECRET_HASH env var for backward compatibility
      if (!user && ADMIN_SECRET_HASH && ADMIN_SECRET_HASH.startsWith('$2') && ADMIN_SECRET_HASH.length >= 59) {
        const envMatch = await bcrypt.compare(loginPassword, ADMIN_SECRET_HASH);
        if (envMatch) {
          const token = createSession({ id: 0, email: 'admin@env', name: 'Admin (Legacy)', role: 'super_admin' });
          return res.json({ token, expiresIn: SESSION_TTL, user: { name: 'Admin', role: 'super_admin' } });
        }
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'This account has been disabled. Contact a super admin.' });
    }

    // For email-based login, verify password
    if (loginEmail) {
      const match = await bcrypt.compare(loginPassword, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
    }

    // Update last_login
    const now = new Date().toISOString();
    await pool.query('UPDATE admin_users SET last_login = $1 WHERE id = $2', [now, user.id]);

    const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = createSession(sessionUser);
    res.json({ token, expiresIn: SESSION_TTL, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// POST /api/auth/login – multi-user admin login
app.post('/api/auth/login', loginLimiter, handleAdminLogin);
// Alias for admin-dashboard pages that use /api/admin/login
app.post('/api/admin/login', loginLimiter, handleAdminLogin);

// POST /api/auth/logout  – invalidate current session token
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// GET /api/auth/check  – verify token is still valid + return user info
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-admin-token'];
  const valid = isValidSession(token);
  const user = valid ? getSessionUser(token) : null;
  res.json({ authenticated: valid, user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null });
});
app.get('/api/admin/check', (req, res) => {
  const token = req.headers['x-admin-token'];
  const valid = isValidSession(token);
  const user = valid ? getSessionUser(token) : null;
  res.json({ authenticated: valid, user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null });
});

// POST /api/auth/change-password  – change the logged-in admin's password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  try {
    const user = req.adminUser;
    if (!user || !user.id) {
      // Legacy env-based admin
      const match = await bcrypt.compare(currentPassword, ADMIN_SECRET_HASH);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
      const newHash = await bcrypt.hash(newPassword, 12);
      ADMIN_SECRET_HASH = newHash;
      const envPath = path.join(__dirname, '.env');
      try {
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (/^ADMIN_SECRET_HASH=.*/m.test(envContent)) {
          envContent = envContent.replace(/^ADMIN_SECRET_HASH=.*/m, 'ADMIN_SECRET_HASH=' + newHash);
        } else {
          envContent += (envContent.endsWith('\n') ? '' : '\n') + 'ADMIN_SECRET_HASH=' + newHash + '\n';
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
      } catch (e) { console.error('Could not update .env:', e.message); }
      sessions.clear();
      return res.json({ ok: true });
    }

    // DB-based admin user
    const { rows } = await pool.query('SELECT password_hash FROM admin_users WHERE id = $1', [user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 12);
    const now = new Date().toISOString();
    await pool.query('UPDATE admin_users SET password_hash = $1, updated_at = $2 WHERE id = $3', [newHash, now, user.id]);

    // Invalidate this user's sessions
    for (const [tok, sess] of sessions.entries()) {
      if (sess.user && sess.user.id === user.id) sessions.delete(tok);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── Admin User Management routes (super_admin only) ────────────────────────────

// GET /api/admin/users – list all admin users
app.get('/api/admin/users', requireRole('super_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, status, last_login, created_at FROM admin_users ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users – create a new admin user
app.post('/api/admin/users', requireRole('super_admin'), async (req, res) => {
  try {
    const { email, password, name, role } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const validRoles = ['super_admin', 'admin', 'viewer'];
    const userRole = validRoles.includes(role) ? role : 'admin';

    // Check for duplicate email
    const { rows: existing } = await pool.query('SELECT id FROM admin_users WHERE email = $1', [cleanEmail]);
    if (existing.length) {
      return res.status(409).json({ error: 'An admin user with this email already exists.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO admin_users (email, password_hash, name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5) RETURNING id, email, name, role, status, created_at`,
      [cleanEmail, hash, sanitizeStr(name, 100), userRole, now]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id – update an admin user (role, status, name)
app.put('/api/admin/users/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { name, role, status, password } = req.body || {};
    const validRoles = ['super_admin', 'admin', 'viewer'];
    const validStatuses = ['active', 'disabled'];

    // Prevent disabling yourself
    if (req.adminUser && req.adminUser.id === userId && status === 'disabled') {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(sanitizeStr(name, 100)); }
    if (role && validRoles.includes(role)) { updates.push(`role = $${idx++}`); values.push(role); }
    if (status && validStatuses.includes(status)) { updates.push(`status = $${idx++}`); values.push(status); }
    if (password && typeof password === 'string' && password.length >= 8) {
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    updates.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(userId);

    const { rows } = await pool.query(
      `UPDATE admin_users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, status, last_login, created_at`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Admin user not found.' });

    // If status changed to disabled, invalidate their sessions
    if (status === 'disabled') {
      for (const [tok, sess] of sessions.entries()) {
        if (sess.user && sess.user.id === userId) sessions.delete(tok);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id – delete an admin user
app.delete('/api/admin/users/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deleting yourself
    if (req.adminUser && req.adminUser.id === userId) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    // Ensure at least one super_admin remains
    const { rows: supers } = await pool.query(
      "SELECT id FROM admin_users WHERE role = 'super_admin' AND id != $1", [userId]
    );
    const { rows: target } = await pool.query('SELECT role FROM admin_users WHERE id = $1', [userId]);
    if (target.length && target[0].role === 'super_admin' && supers.length === 0) {
      return res.status(400).json({ error: 'Cannot delete the last super admin.' });
    }

    const { rowCount } = await pool.query('DELETE FROM admin_users WHERE id = $1', [userId]);
    if (!rowCount) return res.status(404).json({ error: 'Admin user not found.' });

    // Invalidate their sessions
    for (const [tok, sess] of sessions.entries()) {
      if (sess.user && sess.user.id === userId) sessions.delete(tok);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Customer Auth routes ───────────────────────────────────────────────────────

// Customer session storage (separate from admin)
const customerSessions = new Map();

async function createCustomerSession(customerId, email) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL;
  customerSessions.set(token, { customerId, id: customerId, email, createdAt: now });
  // Persist to DB so sessions survive server restarts
  try {
    await pool.query(
      'INSERT INTO customer_sessions (token, customer_id, email, created_at, expires_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (token) DO NOTHING',
      [token, customerId, email, now, expiresAt]
    );
  } catch (err) {
    console.error('Failed to persist customer session to DB:', err.message);
  }
  return token;
}

async function createStaffSession(staffId, email, name, role, ownerCustomerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL;
  customerSessions.set(token, {
    customerId: ownerCustomerId, id: ownerCustomerId,
    email, name, staffId, staffRole: role, isStaff: true, createdAt: now,
  });
  try {
    await pool.query(
      'INSERT INTO customer_sessions (token, customer_id, email, created_at, expires_at, staff_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token) DO NOTHING',
      [token, ownerCustomerId, email, now, expiresAt, staffId]
    );
  } catch (err) {
    console.error('Failed to persist staff session to DB:', err.message);
  }
  return token;
}

function isValidCustomerSession(token) {
  if (!token) return false;
  const session = customerSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    customerSessions.delete(token);
    return false;
  }
  return session;
}

function requireCustomerAuth(req, res, next) {
  const token = req.headers['x-customer-token'] || req.cookies?.customerToken;
  const session = isValidCustomerSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  req.customer = session;
  next();
}

// Account owner only (staff cannot manage other staff or billing)
function requireCustomerOwner(req, res, next) {
  if (req.customer && !req.customer.isStaff) return next();
  return res.status(403).json({ error: 'Only account owners can perform this action.' });
}

// Owner or Manager – for menu creation/deletion
function requireOwnerOrManager(req, res, next) {
  if (req.adminUser) return next();
  if (req.customer && (!req.customer.isStaff || req.customer.staffRole === 'manager')) return next();
  return res.status(403).json({ error: 'Only account owners and managers can perform this action.' });
}

// POST /api/payments/paypal/create-order-public - Create PayPal order before registration (no auth)
app.post('/api/payments/paypal/create-order-public', async (req, res) => {
  try {
    const { plan_id, promo_code } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: 'plan_id required.' });

    const { rows: planRows } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1 AND is_active = 1', [parseInt(plan_id)]);
    if (!planRows.length) return res.status(400).json({ error: 'Plan not found.' });
    const plan = planRows[0];

    let effectivePrice = parseFloat(plan.price);
    if (promo_code && effectivePrice > 0) {
      const { rows: promos } = await pool.query(`SELECT * FROM promo_codes WHERE UPPER(code)=UPPER($1) AND is_active=1`, [sanitizeStr(promo_code, 50)]);
      if (promos.length) {
        const promo = promos[0];
        const applicablePlans = Array.isArray(promo.applicable_plans) ? promo.applicable_plans : [];
        const validForPlan = applicablePlans.length === 0 || applicablePlans.includes(parseInt(plan_id));
        const notExpired = !promo.expires_at || new Date(promo.expires_at) > new Date();
        const underLimit = promo.max_uses === 0 || promo.uses_count < promo.max_uses;
        if (validForPlan && notExpired && underLimit) {
          effectivePrice = promo.discount_type === 'percentage'
            ? effectivePrice * (1 - promo.discount_value / 100)
            : Math.max(0, effectivePrice - promo.discount_value);
        }
      }
    }
    effectivePrice = Math.max(0.01, parseFloat(effectivePrice.toFixed(2)));

    const cfg = await getGatewayConfig('paypal');
    if (!cfg?.enabled || !cfg.client_id || !cfg.client_secret) return res.status(400).json({ error: 'PayPal not configured.' });
    const base = cfg.environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const authRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64') },
      body: 'grant_type=client_credentials'
    });
    const authData = await authRes.json();
    if (!authData.access_token) return res.status(400).json({ error: 'PayPal auth failed.' });

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authData.access_token}` },
      body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: effectivePrice.toFixed(2) }, description: plan.display_name + ' Plan' }] })
    });
    const orderData = await orderRes.json();
    if (!orderData.id) return res.status(400).json({ error: 'Failed to create PayPal order.', detail: orderData });
    res.json({ order_id: orderData.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/customers/checkout-register - Paywall-first: verify payment, then create account
app.post('/api/customers/checkout-register', loginLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const { email, password, businessName, contactName, phone, country, city, address, plan_id, payment_method, transaction_id, paypal_order_id, promo_code } = req.body || {};
    if (!email || !password || !businessName || !plan_id) return res.status(400).json({ error: 'Email, password, business name, and plan are required.' });

    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Invalid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!validator.isStrongPassword(password, { minLength: 8, minLowercase: 1, minUppercase: 0, minNumbers: 1, minSymbols: 0 }))
      return res.status(400).json({ error: 'Password must contain at least 8 characters with 1 number.' });

    const existing = await pool.query('SELECT id FROM customers WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered. Please sign in instead.' });

    const { rows: planRows } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1 AND is_active = 1', [parseInt(plan_id)]);
    if (!planRows.length) return res.status(400).json({ error: 'Invalid plan selected.' });
    const plan = planRows[0];

    // Compute effective price (apply promo if valid)
    let effectivePrice = parseFloat(plan.price);
    let promoRecord = null;
    if (promo_code && effectivePrice > 0) {
      const { rows: promos } = await pool.query(`SELECT * FROM promo_codes WHERE UPPER(code)=UPPER($1) AND is_active=1`, [sanitizeStr(promo_code, 50)]);
      if (promos.length) {
        const promo = promos[0];
        const applicablePlans = Array.isArray(promo.applicable_plans) ? promo.applicable_plans : [];
        const validForPlan = applicablePlans.length === 0 || applicablePlans.includes(parseInt(plan_id));
        const notExpired = !promo.expires_at || new Date(promo.expires_at) > new Date();
        const underLimit = promo.max_uses === 0 || promo.uses_count < promo.max_uses;
        if (validForPlan && notExpired && underLimit) {
          effectivePrice = promo.discount_type === 'percentage'
            ? effectivePrice * (1 - promo.discount_value / 100)
            : Math.max(0, effectivePrice - promo.discount_value);
          promoRecord = promo;
        }
      }
    }
    effectivePrice = parseFloat(effectivePrice.toFixed(2));

    // Verify payment for paid plans
    if (effectivePrice > 0) {
      if (payment_method === 'flutterwave' && transaction_id) {
        const cfg = await getGatewayConfig('flutterwave');
        if (!cfg?.enabled || !cfg.secret_key) return res.status(400).json({ error: 'Flutterwave not configured.' });
        const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [String(transaction_id)]);
        if (dup.length) return res.status(409).json({ error: 'Payment already processed.' });
        const verifyRes = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transaction_id)}/verify`, {
          headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json' }
        });
        const vd = await verifyRes.json();
        if (vd.status !== 'success' || vd.data?.status !== 'successful') return res.status(400).json({ error: 'Payment not successful.' });
        if (parseFloat(vd.data.amount) < effectivePrice * 0.99) return res.status(400).json({ error: `Payment amount insufficient. Expected $${effectivePrice}.` });
      } else if (payment_method === 'paypal' && paypal_order_id) {
        const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [String(paypal_order_id)]);
        if (dup.length) return res.status(409).json({ error: 'Payment already processed.' });
        // Server-side capture & verification of PayPal order
        const ppCfg = await getGatewayConfig('paypal');
        if (!ppCfg?.enabled || !ppCfg.client_id || !ppCfg.client_secret) return res.status(400).json({ error: 'PayPal not configured.' });
        const ppBase = ppCfg.environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
        const ppAuthRes = await fetch(`${ppBase}/v1/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${ppCfg.client_id}:${ppCfg.client_secret}`).toString('base64') },
          body: 'grant_type=client_credentials'
        });
        const ppAuthData = await ppAuthRes.json();
        if (!ppAuthData.access_token) return res.status(500).json({ error: 'PayPal auth failed.' });
        // Capture the order server-side (idempotent if already captured)
        const ppCaptureRes = await fetch(`${ppBase}/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}/capture`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ppAuthData.access_token}`, 'Content-Type': 'application/json' }
        });
        const ppCaptureData = await ppCaptureRes.json();
        if (ppCaptureData.status !== 'COMPLETED') return res.status(400).json({ error: 'PayPal payment not completed.' });
        const ppCapture = ppCaptureData.purchase_units?.[0]?.payments?.captures?.[0];
        const ppAmount = parseFloat(ppCapture?.amount?.value || '0');
        if (ppAmount < effectivePrice * 0.99) return res.status(400).json({ error: `PayPal payment amount insufficient. Expected $${effectivePrice}.` });
      } else if (payment_method === 'bank_transfer') {
        // Bank transfer — account created with pending payment; admin confirms later
        const btCfg = await getGatewayConfig('bank_transfer');
        if (!btCfg?.enabled) return res.status(400).json({ error: 'Bank Transfer not configured.' });
      } else {
        return res.status(400).json({ error: 'Payment required for this plan.' });
      }
    }

    // Create customer
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const { rows: newCust } = await pool.query(`
      INSERT INTO customers (email, password_hash, business_name, contact_name, phone, address, country, city, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9) RETURNING id, email, business_name
    `, [cleanEmail, passwordHash, sanitizeInput(businessName, 200), encryptField(sanitizeInput(contactName || '', 200)), encryptField(sanitizeInput(phone || '', 50)), encryptField(sanitizeInput(address || '', 300)), encryptField(sanitizeInput(country || '', 100)), encryptField(sanitizeInput(city || '', 200)), now]);
    const customer = newCust[0];

    // Create default menu
    const menuId = crypto.randomUUID();
    const qrCode = await generateQRCode(menuId, 1).catch(() => '');
    await pool.query(`
      INSERT INTO menus (id, restaurant_name, currency, brand_color, logo_url, tagline,
        font_style, bg_style, show_logo, show_name, header_layout,
        text_color, heading_color, bg_color, card_bg, price_color,
        phone, email, address, website,
        social_instagram, social_facebook, social_twitter, social_whatsapp, social_tiktok, social_youtube,
        tables_enabled, cover_image, qr_version, qr_code, total_scans, created_at, updated_at, customer_id)
      VALUES ($1,$2,'USD','#c2410c','','','modern','dark',1,1,'logo-left',
        '','','','','','','','','','','','','','','',0,'',1,$3,0,$4,$4,$5)
    `, [menuId, sanitizeInput(businessName, 200), qrCode, now, customer.id]);

    // Create subscription
    if (effectivePrice > 0) {
      if (payment_method === 'bank_transfer') {
        // Bank transfer: create subscription as pending_payment, insert pending payment record
        const billing = new Date(); billing.setMonth(billing.getMonth() + 1);
        const { rows: subRows } = await pool.query(`INSERT INTO subscriptions (menu_id, plan_id, status, start_date, next_billing_date, created_at) VALUES ($1,$2,'pending_payment',$3,$4,$3) ON CONFLICT (menu_id) DO UPDATE SET plan_id=$2, status='pending_payment', next_billing_date=$4 RETURNING id`, [menuId, plan.id, now, billing.toISOString()]);
        const subId = subRows[0].id;
        await pool.query(`INSERT INTO payments (subscription_id, amount, currency, payment_method, payment_id, status, notes, created_at) VALUES ($1,$2,'USD','bank_transfer',$3,'pending',$4,$5)`, [subId, effectivePrice, `BT-${Date.now()}`, `${plan.display_name} - bank transfer pending confirmation`, now]);
      } else {
        await activateSubscriptionPayment(menuId, plan.id, effectivePrice, 'USD', payment_method, transaction_id || paypal_order_id || '', `${plan.display_name} - checkout registration`);
      }
      if (plan.name === 'trial') {
        const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await pool.query(`UPDATE subscriptions SET trial_end=$1, status='trial' WHERE menu_id=$2`, [trialEnd, menuId]);
      }
    } else if (plan.name === 'trial') {
      // Trial plan (price=0): create subscription with trial status and 7-day expiry
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const billing = new Date(); billing.setMonth(billing.getMonth() + 1);
      await pool.query(`INSERT INTO subscriptions (menu_id, plan_id, status, start_date, trial_end, next_billing_date, created_at) VALUES ($1,$2,'trial',$3,$4,$5,$3) ON CONFLICT (menu_id) DO UPDATE SET plan_id=$2, status='trial', trial_end=$4, next_billing_date=$5`, [menuId, plan.id, now, trialEnd, billing.toISOString()]);
    } else {
      const billing = new Date(); billing.setMonth(billing.getMonth() + 1);
      await pool.query(`INSERT INTO subscriptions (menu_id, plan_id, status, start_date, next_billing_date, created_at) VALUES ($1,$2,'active',$3,$4,$3) ON CONFLICT (menu_id) DO UPDATE SET plan_id=$2, status='active', next_billing_date=$4`, [menuId, plan.id, now, billing.toISOString()]);
    }

    // Increment promo usage
    if (promoRecord) await pool.query('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id=$1', [promoRecord.id]);

    // Create session
    const token = await createCustomerSession(customer.id, customer.email);
    res.cookie('customerToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: SESSION_TTL });
    res.json({ customer: { id: customer.id, email: customer.email, businessName: customer.business_name }, token, defaultMenuId: menuId });
  } catch (err) {
    console.error('Checkout register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers/register - Create new customer account
app.post('/api/customers/register', loginLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const { email, password, businessName, contactName, phone, promoCode } = req.body || {};
    
    // Validation
    if (!email || !password || !businessName) {
      return res.status(400).json({ error: 'Email, password, and business name are required.' });
    }
    
    // Sanitize and validate email
    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    
    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    
    // Additional password strength validation
    if (!validator.isStrongPassword(password, { 
      minLength: 8, 
      minLowercase: 1, 
      minUppercase: 0, 
      minNumbers: 1, 
      minSymbols: 0 
    })) {
      return res.status(400).json({ error: 'Password must contain at least 8 characters with 1 number.' });
    }
    
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM customers WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Sanitize user inputs
    const cleanBusinessName = sanitizeInput(businessName, 200);
    const cleanContactName = encryptField(sanitizeInput(contactName || '', 200));
    const cleanPhone = encryptField(sanitizeInput(phone || '', 50));
    const cleanPromoCode = promoCode ? sanitizeInput(promoCode, 50).toUpperCase() : null;
    
    // Validate and apply promo code
    let discountPercent = 0;
    let discountMonths = 0;
    let promoDetails = null;
    
    if (cleanPromoCode) {
      const validPromoCodes = {
        'EXIT50':   { discount: 50, months: 3, description: '50% off for 3 months' },
        'EXIT50': { discount: 50, months: 3, description: '50% off for 3 months (exit intent)' },
        'LAUNCH25': { discount: 25, months: 6, description: '25% off for 6 months' },
        'ANNUAL20': { discount: 20, months: 12, description: '20% off annual plan' }
      };
      
      if (validPromoCodes[cleanPromoCode]) {
        promoDetails = validPromoCodes[cleanPromoCode];
        discountPercent = promoDetails.discount;
        discountMonths = promoDetails.months;
        console.log(`✅ Promo code applied: ${cleanPromoCode} - ${promoDetails.description}`);
      } else {
        console.log(`⚠️ Invalid promo code attempted: ${cleanPromoCode}`);
      }
    }
    
    // Create customer
    const now = new Date().toISOString();
    const { rows } = await pool.query(`
      INSERT INTO customers (email, password_hash, business_name, contact_name, phone, status, created_at, promo_code, discount_percent, discount_months)
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9)
      RETURNING id, email, business_name, contact_name, phone, status, created_at, promo_code, discount_percent, discount_months
    `, [cleanEmail, passwordHash, cleanBusinessName, cleanContactName, cleanPhone, now, cleanPromoCode, discountPercent, discountMonths]);
    
    const customer = rows[0];

    // Auto-create a default menu + trial subscription for new customers
    let defaultMenuId = null;
    try {
      const menuNow = new Date().toISOString();
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      defaultMenuId = crypto.randomUUID();
      const defaultQr = await generateQRCode(defaultMenuId, 1).catch(() => '');
      await pool.query(`
        INSERT INTO menus (id, restaurant_name, currency, brand_color, logo_url, tagline,
          font_style, bg_style, show_logo, show_name, header_layout,
          text_color, heading_color, bg_color, card_bg, price_color,
          phone, email, address, website,
          social_instagram, social_facebook, social_twitter, social_whatsapp, social_tiktok, social_youtube,
          tables_enabled, cover_image, qr_version, qr_code, total_scans, created_at, updated_at, customer_id)
        VALUES ($1,$2,'USD','#c2410c','','','modern','dark',1,1,'logo-left',
          '','','','','','','','','','','','','','','',0,'',1,$3,0,$4,$4,$5)
      `, [defaultMenuId, cleanBusinessName, defaultQr, menuNow, customer.id]);

      const { rows: trialPlan } = await pool.query("SELECT id FROM subscription_plans WHERE name='trial' LIMIT 1");
      if (trialPlan.length > 0) {
        await pool.query(`
          INSERT INTO subscriptions (menu_id, plan_id, status, start_date, trial_end, created_at)
          VALUES ($1, $2, 'trial', $3, $4, $3)
          ON CONFLICT (menu_id) DO NOTHING
        `, [defaultMenuId, trialPlan[0].id, menuNow, trialEnd]);
      }
    } catch (setupErr) {
      console.warn('Default menu/trial setup failed:', setupErr.message);
      defaultMenuId = null;
    }

    // Create session token
    const token = await createCustomerSession(customer.id, customer.email);
    
    // Set secure httpOnly cookie
    res.cookie('customerToken', token, {
      httpOnly: true,  // Prevent XSS attacks
      secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
      sameSite: 'strict',  // Prevent CSRF attacks
      maxAge: SESSION_TTL
    });
    
    console.log('✅ Customer registered:', customer.email);
    
    res.json({
      customer: {
        id: customer.id,
        email: customer.email,
        businessName: customer.business_name,
        contactName: customer.contact_name,
        phone: customer.phone,
        status: customer.status,
        createdAt: customer.created_at,
        promoCode: customer.promo_code,
        discountPercent: customer.discount_percent,
        discountMonths: customer.discount_months
      },
      promoApplied: promoDetails ? true : false,
      promoDetails: promoDetails,
      token,
      defaultMenuId,
      expiresIn: SESSION_TTL
    });
  } catch (err) {
    console.error('Customer registration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/login – Unified login: checks customers first, then staff
app.post('/api/login', loginLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) return res.status(401).json({ error: 'Invalid email or password.' });

    // 1. Try customer/owner account
    const ownerRows = await pool.query('SELECT * FROM customers WHERE email = $1', [cleanEmail]);
    if (ownerRows.rows.length > 0) {
      const customer = ownerRows.rows[0];

      // Check account lockout
      if (customer.lockout_until && new Date(customer.lockout_until) > new Date()) {
        const mins = Math.ceil((new Date(customer.lockout_until) - new Date()) / 60000);
        return res.status(429).json({ error: `Account temporarily locked due to too many failed attempts. Try again in ${mins} minute(s).` });
      }

      const match = await bcrypt.compare(password, customer.password_hash);
      if (!match) {
        // Increment failed attempt counter; lock at 5
        const attempts = (customer.login_attempts || 0) + 1;
        const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        await pool.query(
          'UPDATE customers SET login_attempts = $1, lockout_until = $2 WHERE id = $3',
          [attempts, lockUntil, customer.id]
        );
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      if (customer.status !== 'active') return res.status(403).json({ error: 'Account is not active. Please contact support.' });

      await pool.query('UPDATE customers SET last_login = $1, login_attempts = 0, lockout_until = NULL WHERE id = $2', [new Date().toISOString(), customer.id]);
      const token = await createCustomerSession(customer.id, customer.email);
      res.cookie('customerToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: SESSION_TTL });
      return res.json({
        userType: 'owner',
        token,
        redirectTo: '/dashboard',
        customer: { id: customer.id, email: customer.email, businessName: customer.business_name, contactName: customer.contact_name }
      });
    }

    // 2. Try staff account
    const staffRows = await pool.query(
      'SELECT sm.*, sm.customer_id AS owner_id FROM staff_members sm WHERE sm.email = $1',
      [cleanEmail]
    );
    if (staffRows.rows.length > 0) {
      const staff = staffRows.rows[0];
      if (staff.status !== 'active') return res.status(401).json({ error: 'Your account has been disabled. Contact your manager.' });
      const match = await bcrypt.compare(password, staff.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

      const token = await createStaffSession(staff.id, staff.email, staff.name, staff.role, staff.customer_id);
      res.cookie('customerToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: SESSION_TTL });
      return res.json({
        userType: 'staff',
        token,
        redirectTo: staff.role === 'manager' ? '/menu-editor' : '/staff-panel',
        staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role }
      });
    }

    return res.status(401).json({ error: 'Invalid email or password.' });
  } catch (err) {
    console.error('Unified login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/customers/login - Customer login
app.post('/api/customers/login', loginLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    
    // Sanitize email
    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    
    // Get customer
    const { rows } = await pool.query(
      'SELECT * FROM customers WHERE email = $1',
      [cleanEmail]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    
    const customer = rows[0];
    
    // Check password
    const match = await bcrypt.compare(password, customer.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    
    // Check if account is active
    if (customer.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active. Please contact support.' });
    }
    
    // Update last login
    await pool.query(
      'UPDATE customers SET last_login = $1 WHERE id = $2',
      [new Date().toISOString(), customer.id]
    );
    
    // Create session
    const token = await createCustomerSession(customer.id, customer.email);
    
    // Set secure httpOnly cookie
    res.cookie('customerToken', token, {
      httpOnly: true,  // Prevent XSS attacks
      secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
      sameSite: 'strict',  // Prevent CSRF attacks
      maxAge: SESSION_TTL
    });
    
    console.log('✅ Customer logged in:', customer.email);
    
    res.json({
      customer: {
        id: customer.id,
        email: customer.email,
        businessName: customer.business_name,
        contactName: customer.contact_name,
        phone: customer.phone,
        status: customer.status
      },
      token,
      expiresIn: SESSION_TTL
    });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers/logout - Customer logout
app.post('/api/customers/logout', (req, res) => {
  const token = req.headers['x-customer-token'] || req.cookies?.customerToken;
  if (token) {
    customerSessions.delete(token);
    pool.query('DELETE FROM customer_sessions WHERE token = $1', [token]).catch(() => {});
  }
  
  // Clear cookie
  res.clearCookie('customerToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  
  res.json({ ok: true });
});

// POST /api/customers/firebase-auth – Verify Firebase ID token, upsert customer, return session
app.post('/api/customers/firebase-auth', loginLimiter, async (req, res) => {
  if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase authentication is not configured on this server.' });
  try {
    const { idToken, businessName } = req.body || {};
    if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'idToken is required.' });

    // Verify token with Firebase Admin – this also checks expiry + signature
    let decoded;
    try {
      decoded = await firebaseAdmin.auth().verifyIdToken(String(idToken).trim());
    } catch (firebaseErr) {
      const code = firebaseErr.code || '';
      if (code === 'auth/id-token-expired') return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return res.status(401).json({ error: 'Invalid auth token. Please sign in again.' });
    }

    const { uid, email, phone_number: phone, name: displayName, picture } = decoded;
    if (!uid) return res.status(401).json({ error: 'Invalid token payload.' });

    const now = new Date().toISOString();

    // Look up existing customer: firebase_uid → email → phone
    let customer = null;
    {
      const byUid = await pool.query('SELECT * FROM customers WHERE firebase_uid = $1 LIMIT 1', [uid]);
      if (byUid.rows.length) { customer = byUid.rows[0]; }
    }
    if (!customer && email) {
      const byEmail = await pool.query('SELECT * FROM customers WHERE email = $1 LIMIT 1', [sanitizeEmail(email)]);
      if (byEmail.rows.length) { customer = byEmail.rows[0]; }
    }
    if (!customer && phone) {
      const byPhone = await pool.query('SELECT * FROM customers WHERE phone = $1 LIMIT 1', [phone]);
      if (byPhone.rows.length) { customer = byPhone.rows[0]; }
    }

    if (customer) {
      // Account found — link firebase_uid and mark verifications
      const updates = [];
      const vals = [];
      let p = 1;
      if (!customer.firebase_uid) { updates.push(`firebase_uid=$${p++}`); vals.push(uid); }
      if (email && !customer.email_verified) { updates.push(`email_verified=$${p++}`); vals.push(1); }
      if (phone && !customer.phone_verified) { updates.push(`phone_verified=$${p++},phone=$${p++}`); vals.push(1, phone); }
      updates.push(`last_login=$${p++}`, `login_attempts=$${p++}`, `lockout_until=$${p++}`);
      vals.push(now, 0, null);
      vals.push(customer.id);
      await pool.query(`UPDATE customers SET ${updates.join(',')} WHERE id=$${p}`, vals);
    } else {
      // New customer via Firebase — require businessName
      if (!businessName || !String(businessName).trim()) {
        return res.status(422).json({ error: 'Business name is required to create a new account.', requiresRegistration: true });
      }
      if (!email && !phone) return res.status(400).json({ error: 'No email or phone number in Firebase token.' });

      const cleanEmail = email ? sanitizeEmail(email) : `phone.${uid}@restorder.local`;
      const randomPwd  = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPwd, 12);

      const ins = await pool.query(
        `INSERT INTO customers (email, password_hash, business_name, contact_name, phone,
           email_verified, phone_verified, firebase_uid, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$9) RETURNING *`,
        [
          cleanEmail, passwordHash,
          sanitizeInput(String(businessName).trim(), 200),
          displayName ? sanitizeInput(String(displayName), 200) : '',
          phone || '',
          email ? 1 : 0,
          phone ? 1 : 0,
          uid, now
        ]
      );
      customer = ins.rows[0];

      // Create default menu + trial subscription
      try {
        const menuId  = crypto.randomUUID();
        const qrCode  = await generateQRCode(menuId, 1).catch(() => '');
        await pool.query(`
          INSERT INTO menus (id, restaurant_name, currency, brand_color, logo_url, tagline,
            font_style, bg_style, show_logo, show_name, header_layout,
            text_color, heading_color, bg_color, card_bg, price_color,
            phone, email, address, website,
            social_instagram, social_facebook, social_twitter, social_whatsapp, social_tiktok, social_youtube,
            tables_enabled, cover_image, qr_version, qr_code, total_scans, created_at, updated_at, customer_id)
          VALUES ($1,$2,'USD','#c2410c','','','modern','dark',1,1,'logo-left',
            '','','','','','','','','','','','','','','',0,'',1,$3,0,$4,$4,$5)
        `, [menuId, sanitizeInput(String(businessName).trim(), 200), qrCode, now, customer.id]);

        const { rows: trialPlan } = await pool.query("SELECT id FROM subscription_plans WHERE name='trial' LIMIT 1");
        if (trialPlan.length) {
          const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await pool.query(
            `INSERT INTO subscriptions (menu_id, plan_id, status, start_date, trial_end, created_at)
             VALUES ($1,$2,'trial',$3,$4,$3) ON CONFLICT (menu_id) DO NOTHING`,
            [menuId, trialPlan[0].id, now, trialEnd]
          );
        }
      } catch (setupErr) {
        console.warn('Firebase auth: default menu setup failed:', setupErr.message);
      }
    }

    if (customer.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active. Please contact support.' });
    }

    const token = await createCustomerSession(customer.id, customer.email);
    res.cookie('customerToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: SESSION_TTL
    });
    return res.json({
      userType: 'owner',
      token,
      redirectTo: '/dashboard',
      customer: { id: customer.id, email: customer.email, businessName: customer.business_name }
    });
  } catch (err) {
    console.error('Firebase auth error:', err);
    res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

// GET /api/customers/check - Check customer session
app.get('/api/customers/check', (req, res) => {
  const token = req.headers['x-customer-token'] || req.cookies?.customerToken;
  const session = isValidCustomerSession(token);
  res.json({
    authenticated: !!session,
    customer: session ? {
      id: session.customerId,
      email: session.email,
      isStaff: session.isStaff || false,
      staffRole: session.staffRole || null,
    } : null,
  });
});

// GET /api/customers/me - Get current customer info
app.get('/api/customers/me', requireCustomerAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, email, business_name, contact_name, phone, address, city, country, 
             status, email_verified, created_at, last_login
      FROM customers WHERE id = $1
    `, [req.customer.customerId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    
    const c = rows[0];
    res.json({
      ...c,
      contact_name: decryptField(c.contact_name),
      phone: decryptField(c.phone),
      address: decryptField(c.address),
      city: decryptField(c.city),
      country: decryptField(c.country),
      isStaff: !!req.customer.isStaff,
      staffRole: req.customer.staffRole || null,
      staffName: req.customer.name || null,
      staffId: req.customer.staffId || null,
    });
  } catch (err) {
    console.error('Get customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/customers/me - Update customer profile
app.put('/api/customers/me', requireCustomerAuth, async (req, res) => {
  try {
    const { businessName, contactName, phone, address, city, country } = req.body || {};
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (businessName) {
      updates.push(`business_name = $${paramCount++}`);
      values.push(sanitizeStr(businessName, 200));
    }
    if (contactName !== undefined) {
      updates.push(`contact_name = $${paramCount++}`);
      values.push(encryptField(sanitizeStr(contactName, 200)));
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramCount++}`);
      values.push(encryptField(sanitizeStr(phone, 50)));
    }
    if (address !== undefined) {
      updates.push(`address = $${paramCount++}`);
      values.push(encryptField(sanitizeStr(address, 500)));
    }
    if (city !== undefined) {
      updates.push(`city = $${paramCount++}`);
      values.push(encryptField(sanitizeStr(city, 100)));
    }
    if (country !== undefined) {
      updates.push(`country = $${paramCount++}`);
      values.push(encryptField(sanitizeStr(country, 100)));
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }
    
    updates.push(`updated_at = $${paramCount++}`);
    values.push(new Date().toISOString());
    values.push(req.customer.customerId);
    
    await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );
    
    res.json({ ok: true });
  } catch (err) {
    console.error('Update customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers/change-password
app.post('/api/customers/change-password', requireCustomerAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const { rows } = await pool.query(
      'SELECT password_hash FROM customers WHERE id = $1',
      [req.customer.customerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      'UPDATE customers SET password_hash = $1, updated_at = $2 WHERE id = $3',
      [newHash, new Date().toISOString(), req.customer.customerId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id/menus - Get customer's menus
app.get('/api/customers/:id/menus', requireCustomerAuth, async (req, res) => {
  try {
    // Customers can only view their own menus
    if (parseInt(req.params.id) !== req.customer.customerId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    
    const { rows } = await pool.query(`
      SELECT m.*, 
        (SELECT COUNT(*) FROM menu_items WHERE menu_id = m.id) AS item_count,
        s.status as subscription_status,
        sp.display_name as plan_name
      FROM menus m
      LEFT JOIN subscriptions s ON s.menu_id = m.id
      LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE m.customer_id = $1
      ORDER BY m.created_at DESC
    `, [req.customer.customerId]);
    
    res.json(rows);
  } catch (err) {
    console.error('Get customer menus error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: GET /api/admin/customers - List all customers
app.get('/api/admin/customers', requireAuth, async (req, res) => {
  try {
    const status = req.query.status;
    let query = `
      SELECT 
        c.*,
        COUNT(DISTINCT m.id) as menu_count,
        COALESCE(SUM(m.total_scans), 0) as total_scans
      FROM customers c
      LEFT JOIN menus m ON m.customer_id = c.id
    `;
    const params = [];
    if (status && status !== 'all') {
      query += ' WHERE c.status = $1';
      params.push(status);
    }
    query += ' GROUP BY c.id ORDER BY c.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Get customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: GET /api/admin/customers/:id - Get customer details
app.get('/api/admin/customers/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(DISTINCT m.id) as menu_count,
        SUM(m.total_scans) as total_scans
      FROM customers c
      LEFT JOIN menus m ON m.customer_id = c.id
      WHERE c.id = $1
      GROUP BY c.id
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Get customer details error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: PUT /api/admin/customers/:id - Update customer (status, notes, etc.)
app.put('/api/admin/customers/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, business_name, contact_name, phone, address, city, country } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (status && ['active', 'inactive', 'suspended'].includes(status)) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (business_name !== undefined) { updates.push(`business_name = $${idx++}`); values.push(String(business_name).trim()); }
    if (contact_name !== undefined) { updates.push(`contact_name = $${idx++}`); values.push(String(contact_name).trim()); }
    if (phone !== undefined) { updates.push(`phone = $${idx++}`); values.push(String(phone).trim()); }
    if (address !== undefined) { updates.push(`address = $${idx++}`); values.push(String(address).trim()); }
    if (city !== undefined) { updates.push(`city = $${idx++}`); values.push(String(city).trim()); }
    if (country !== undefined) { updates.push(`country = $${idx++}`); values.push(String(country).trim()); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });

    updates.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, business_name, contact_name, phone, address, city, country, status, created_at, updated_at`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Customer not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: GET /api/admin/customers/:id/menus - Get customer's menus with subscription info
app.get('/api/admin/customers/:id/menus', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.restaurant_name, m.total_scans, m.created_at, m.updated_at,
        s.status as subscription_status, s.start_date, s.end_date,
        sp.display_name as plan_name, sp.price as plan_price
      FROM menus m
      LEFT JOIN subscriptions s ON s.menu_id = m.id
      LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE m.customer_id = $1
      ORDER BY m.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Get customer menus error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: DELETE /api/admin/customers/:id - Delete a customer
app.delete('/api/admin/customers/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT business_name FROM customers WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Customer not found.' });
    await pool.query('DELETE FROM customers WHERE id = $1', [id]);
    res.json({ ok: true, message: `Customer "${rows[0].business_name}" deleted.` });
  } catch (err) {
    console.error('Delete customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: POST /api/admin/customers/:id/reset-password - Reset customer password
app.post('/api/admin/customers/:id/reset-password', requireRole('super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const { rowCount } = await pool.query('UPDATE customers SET password_hash = $1, updated_at = $2 WHERE id = $3', [hash, new Date().toISOString(), id]);
    if (!rowCount) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health  – health check for containers/monitoring
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      version: '1.54.31' 
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: err.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// GET /api/debug/env  – debug environment configuration (safe for production)
app.get('/api/debug/env', (_req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    host: process.env.HOST,
    hasAdminHash: !!process.env.ADMIN_SECRET_HASH,
    adminHashLength: process.env.ADMIN_SECRET_HASH?.length || 0,
    adminHashPrefix: process.env.ADMIN_SECRET_HASH?.substring(0, 10) || 'none',
    adminHashValidFormat: process.env.ADMIN_SECRET_HASH?.startsWith('$2b$') || false,
    sessionTtl: process.env.SESSION_TTL_MS,
    rateLimit: process.env.LOGIN_RATE_LIMIT,
    timestamp: new Date().toISOString()
  });
});


// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Known food-section keywords used to detect category headings in free-form text.
 */
const KNOWN_CATEGORIES = [
  'appetizer', 'appetizers', 'starter', 'starters', 'entree', 'entrees',
  'main', 'mains', 'main course', 'main courses', 'entrée', 'entrées',
  'soup', 'soups', 'salad', 'salads', 'sandwich', 'sandwiches', 'wrap', 'wraps',
  'pizza', 'pizzas', 'pasta', 'pastas', 'burger', 'burgers',
  'seafood', 'grill', 'grills', 'bbq', 'barbeque', 'barbecue',
  'side', 'sides', 'side dish', 'side dishes', 'extra', 'extras', 'add-on', 'add-ons',
  'dessert', 'desserts', 'sweet', 'sweets', 'cake', 'cakes', 'pastry', 'pastries',
  'drink', 'drinks', 'beverage', 'beverages', 'juice', 'juices',
  'coffee', 'tea', 'hot drink', 'hot drinks', 'cold drink', 'cold drinks',
  'breakfast', 'brunch', 'lunch', 'dinner', 'snack', 'snacks',
  'seafood', 'sushi', 'ramen', 'noodle', 'noodles', 'rice dish', 'rice dishes',
  'special', 'specials', "chef's special", "today's special", 'combo', 'combos',
  'kids', "kid's menu", "children", "kids menu", 'vegan', 'vegetarian',
  'alcohol', 'beer', 'wine', 'cocktail', 'cocktails', 'spirits',
];

/**
 * Decide whether a line looks like a category/section header.
 * Returns the normalised category string, or null.
 */
function detectCategoryHeading(line) {
  const clean = line.trim();
  if (!clean || clean.length > 60) return null;

  // Strip common decorators: dashes, asterisks, underscores, equals, tildes, brackets
  const stripped = clean
    .replace(/^[\-=*~_▪►●•★◆▶]+\s*/, '')
    .replace(/\s*[\-=*~_▪►●•★◆▶]+$/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/^[(\[{]\s*(.*?)\s*[)\]}]$/, '$1')
    .trim();

  if (!stripped) return null;

  // Explicit colon-terminated heading: "Starters:" or "-- MAINS --"
  const colonMatch = stripped.match(/^([A-Za-zÀ-ÿ &'\-\/]+):?\s*$/);
  if (colonMatch) {
    const candidate = colonMatch[1].trim();
    const lower = candidate.toLowerCase();
    // All-caps headings (at least 3 chars, no digits)
    if (/^[A-Z][A-Z &'\/\-]{2,}$/.test(candidate) && !/\d/.test(candidate)) {
      return toTitleCase(candidate);
    }
    // Known category keyword
    if (KNOWN_CATEGORIES.includes(lower)) return toTitleCase(candidate);
    // Short single/double word with no price indicators
    if (/^[A-Za-zÀ-ÿ &'\/\-]{3,30}$/.test(candidate) && clean.endsWith(':')) {
      return toTitleCase(candidate);
    }
  }
  return null;
}

function toTitleCase(s) {
  return s.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

/**
 * Scan an array of raw strings (price cells, headers, full lines) and return
 * the most likely ISO currency code, or null if nothing is recognised.
 * Order matters: more-specific patterns (multi-char codes) come before $.
 */
function detectCurrency(strings) {
  const tests = [
    // ── Major global ─────────────────────────────────────────────────────────
    [/₹|\bINR\b/,        'INR'], [/€|\bEUR\b/i,      'EUR'], [/£|\bGBP\b/i,      'GBP'],
    [/₩|\bKRW\b/i,       'KRW'], [/₱|\bPHP\b/i,      'PHP'], [/฿|\bTHB\b/i,      'THB'],
    [/₨|\bPKR\b/i,       'PKR'], [/৳|\bBDT\b/i,      'BDT'], [/₺|\bTRY\b/i,      'TRY'],
    [/Rp\b|\bIDR\b/i,    'IDR'], [/R\$|\bBRL\b/i,    'BRL'], [/S\$|\bSGD\b/i,    'SGD'],
    [/CA\$|\bCAD\b/i,    'CAD'], [/A\$|\bAUD\b/i,    'AUD'], [/¥|\bJPY\b|\bCNY\b/i,'JPY'],
    // ── Middle East ──────────────────────────────────────────────────────────
    [/\bAED\b/i, 'AED'], [/\bSAR\b/i, 'SAR'], [/\bQAR\b/i, 'QAR'],
    [/\bKWD\b/i, 'KWD'], [/\bBHD\b/i, 'BHD'], [/\bOMR\b/i, 'OMR'],
    // ── SE Asia ──────────────────────────────────────────────────────────────
    [/RM\b|\bMYR\b/i, 'MYR'],
    // ── Africa – existing ────────────────────────────────────────────────────
    [/₦|\bNGN\b/i,         'NGN'], // Nigeria
    [/KSh\b|\bKES\b/i,     'KES'], // Kenya
    [/\bZAR\b/i,            'ZAR'], // South Africa
    [/E£|\bLE\b|\bEGP\b/i, 'EGP'], // Egypt
    // ── Africa – West ────────────────────────────────────────────────────────
    [/GH₵|₵|\bGHS\b/i,    'GHS'], // Ghana
    [/FCFA\b|\bXAF\b/i,   'XAF'], // Central African CFA (match FCFA before CFA)
    [/\bCFA\b|\bXOF\b/i,  'XOF'], // West African CFA
    [/\bGMD\b/i,            'GMD'], // Gambia
    [/\bGNF\b/i,            'GNF'], // Guinea
    [/\bSLE\b|\bSLL\b/i,  'SLE'], // Sierra Leone
    [/\bLRD\b/i,            'LRD'], // Liberia
    [/\bCVE\b/i,            'CVE'], // Cape Verde
    // ── Africa – East ────────────────────────────────────────────────────────
    [/\bETB\b|\bBirr\b/i,  'ETB'], // Ethiopia
    [/TSh\b|\bTZS\b/i,     'TZS'], // Tanzania
    [/USh\b|\bUGX\b/i,     'UGX'], // Uganda
    [/\bRWF\b/i,            'RWF'], // Rwanda
    [/\bBIF\b/i,            'BIF'], // Burundi
    [/\bSOS\b/i,            'SOS'], // Somalia
    [/\bSSP\b/i,            'SSP'], // South Sudan
    [/Nfk\b|\bERN\b/i,     'ERN'], // Eritrea
    [/\bDJF\b/i,            'DJF'], // Djibouti
    [/\bKMF\b/i,            'KMF'], // Comoros
    [/\bSCR\b/i,            'SCR'], // Seychelles
    [/\bMUR\b/i,            'MUR'], // Mauritius
    [/\bMGA\b/i,            'MGA'], // Madagascar
    // ── Africa – North ───────────────────────────────────────────────────────
    [/\bMAD\b/i,            'MAD'], // Morocco
    [/\bDZD\b/i,            'DZD'], // Algeria
    [/\bTND\b/i,            'TND'], // Tunisia
    [/\bLYD\b/i,            'LYD'], // Libya
    [/\bSDG\b/i,            'SDG'], // Sudan
    // ── Africa – Southern ────────────────────────────────────────────────────
    [/N\$|\bNAD\b/i,       'NAD'], // Namibia
    [/\bBWP\b/i,            'BWP'], // Botswana
    [/\bLSL\b/i,            'LSL'], // Lesotho
    [/\bSZL\b/i,            'SZL'], // Eswatini
    [/Z\$|\bZWL\b/i,       'ZWL'], // Zimbabwe
    [/\bZMW\b/i,            'ZMW'], // Zambia
    [/\bMWK\b/i,            'MWK'], // Malawi
    [/\bMZN\b/i,            'MZN'], // Mozambique
    [/\bAOA\b|\bKz\b/i,    'AOA'], // Angola
    [/\bCDF\b/i,            'CDF'], // DR Congo
    [/\bSTN\b/i,            'STN'], // São Tomé
    // ── Catch-all ────────────────────────────────────────────────────────────
    [/\$/, 'USD'],
  ];
  for (const s of strings) {
    if (!s) continue;
    for (const [re, code] of tests) {
      if (re.test(String(s))) return code;
    }
  }
  return null;
}

/**
 * Smart text → menu items parser.
 * Tracks the current category heading as it reads through lines.
 */
function parseTextToItems(text) {
  const items   = [];
  const lines   = text.split(/\r?\n/).map(l => l.trim());
  // Matches a price at end of line with an optional currency prefix.
  // Handles: $12.99  ₹450  £12  €15.50  ₵25  ₦200  KSh 200  AED 50  45.00
  const CSYM    = '[$£€¥₹₦₩₵₱฿₺₨৳₼₽₾]';
  const priceRE = new RegExp(
    '[\\s.\\-]*(?:' + CSYM + '|[A-Za-z]{2,5}\\s+)?\\s*(\\d{1,5}(?:[.,]\\d{1,2})?)\\s*$'
  );

  let currentCategory = 'General';
  let lastDesc        = '';       // carry description lines forward

  for (let i = 0; i < lines.length; i++) {
    const raw  = lines[i].trim();
    if (!raw) { lastDesc = ''; continue; }

    // ── 1. Check for category heading ──────────────────────────────────────
    const heading = detectCategoryHeading(raw);
    if (heading) {
      currentCategory = heading;
      lastDesc = '';
      continue;
    }

    // ── 2. CSV-style line: "name [, category] , price" ─────────────────────
    const parts = raw.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const last       = parts[parts.length - 1];
      const priceMatch = last.match(/^[$£€¥₹₦₩₵₱฿₺₨৳₼₽₾]?\s*(\d{1,5}(?:[.,]\d{1,2})?)$/);
      if (priceMatch) {
        const price     = parseFloat(priceMatch[1].replace(',', '.'));
        const hasExplicitCat = parts.length >= 3;
        items.push({
          id:          crypto.randomUUID(),
          name:        parts[0],
          category:    hasExplicitCat ? toTitleCase(parts[1]) : currentCategory,
          price,
          description: hasExplicitCat && parts.length >= 4 ? parts[2] : (parts.length === 3 ? '' : parts[1] || ''),
          tags:        [],
        });
        lastDesc = '';
        continue;
      }
    }

    // ── 3. Free-text line ending with a price ──────────────────────────────
    const m = raw.match(priceRE);
    if (m) {
      const rawName = raw.replace(priceRE, '')
        .replace(/[$£€¥₹₦₩₵₱฿₺₨৳₼₽₾]\s*$/, '') // strip orphaned currency symbol
        .replace(/[\s.\-]+$/, '').trim();
      if (rawName.length >= 2) {
        const price = parseFloat(m[1].replace(',', '.'));
        // Peek at next line: if short & no price → it's a description
        const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
        const desc = (!nextLine.match(priceRE) && nextLine.length > 0 && nextLine.length < 120
          && !detectCategoryHeading(nextLine))
          ? nextLine : lastDesc;

        items.push({
          id:          crypto.randomUUID(),
          name:        rawName,
          category:    currentCategory,
          price,
          description: desc,
          tags:        [],
        });
        if (desc === nextLine && nextLine) i++; // consume description line
        lastDesc = '';
        continue;
      }
    }

    // ── 4. No price → possible multi-line description for previous item ─────
    if (items.length && raw.length < 120) {
      const last = items[items.length - 1];
      if (!last.description) last.description = raw;
    }
    lastDesc = raw;
  }
  return items;
}

/** Parse a CSV file into menu items with proper data type validation */
function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const rawRows = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', row => rawRows.push(row))
      .on('end', () => {
        const items = [];
        const get   = (row, ...keys) => {
          for (const k of keys) {
            const found = Object.keys(row).find(rk => rk.toLowerCase().trim() === k.toLowerCase());
            if (found && row[found] != null && String(row[found]).trim()) return String(row[found]).trim();
          }
          return '';
        };

        // Collect all raw price strings for currency detection
        const rawPrices = [];

        for (const row of rawRows) {
          const name = get(row,
            'name', 'item', 'item name', 'dish', 'product', 'menu item', 'food item',
            'item_name', 'food name', 'title', 'label');
          if (!name) continue;

          const catRaw      = get(row, 'category', 'cat', 'section', 'type', 'course', 'group');
          const subcatRaw   = get(row, 'subcategory', 'sub category', 'sub_category', 'subcat', 'sub');
          const rawPriceStr = get(row, 'price', 'cost', 'amount', 'rate', 'unit price', 'selling price', 'sell price', 'mrp');
          rawPrices.push(rawPriceStr);
          const price = parseFloat((rawPriceStr || '0').replace(/[^0-9.]/g, '')) || 0;

          // Parse tags - ensure it's an array of strings
          const tagsRaw = get(row, 'tags', 'label', 'labels', 'tag') || '';
          let tags = [];
          if (tagsRaw) {
            tags = tagsRaw.split(/[,;|]/).map(t => String(t).trim()).filter(Boolean);
          }

          // Ensure all values are DB-compatible types (string, number, null)
          items.push({
            id:          String(crypto.randomUUID()),                    // TEXT
            name:        String(name),                                   // TEXT
            category:    String(catRaw ? toTitleCase(catRaw) : 'General'), // TEXT
            subcategory: String(subcatRaw ? toTitleCase(subcatRaw) : ''), // TEXT
            price:       Number(price) || 0,                             // REAL (number)
            description: String(get(row, 'description', 'desc', 'details', 'notes', 'ingredients') || ''), // TEXT
            tags:        tags,                                           // Array of strings (will be JSON.stringify'd)
            size:        String(get(row, 'size', 'portion', 'serving', 'serving size', 'weight', 'volume', 'variant') || ''), // TEXT
          });
        }
        const detectedCurrency = detectCurrency([...rawPrices, ...Object.keys(rawRows[0] || {})]);
        resolve({ items, detectedCurrency });
      })
      .on('error', reject);
  });
}

/** Parse an Excel (.xlsx / .xls) file into menu items.
 *
 *  Strategy:
 *    1. Read every sheet as an array-of-arrays (raw values as formatted strings).
 *    2. Scan the first 10 rows for a header row whose cells match known column
 *       aliases (name, price, category …).  If found, map by name.
 *    3. If no recognised header is found, fall back to POSITIONAL mapping:
 *       col 0 = name, rightmost mostly-numeric col = price, col 1 = category.
 *    4. While iterating data rows, detect section-heading rows (single non-empty
 *       cell with no price) and use them as the current category.
 *    5. Strip any non-printable / garbled bytes before storing.
 */
async function parseXlsxFile(filePath) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const items      = [];
    const rawPrices  = [];
    const allHeaders = [];

    // Coerce an ExcelJS cell value to a plain string.
    const cellStr = v => {
      if (v == null) return '';
      if (typeof v === 'object') {
        if (v.richText) return v.richText.map(rt => rt.text || '').join('');
        if (v.result !== undefined) return String(v.result);
        if (v.text)   return String(v.text);
        if (v instanceof Date) return v.toISOString();
      }
      return String(v);
    };

    // Remove control chars and Unicode replacement characters.
    const sanitize = v => cellStr(v)
      .replace(/\uFFFD/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const isPrintable = s => {
      if (!s) return false;
      const bad = (s.match(/[\uFFFD\x00-\x1F\x7F-\x9F]/g) || []).length;
      return bad / s.length < 0.25;
    };

    const NAME_KEYS  = ['name','item','item name','item_name','dish','dish name','food',
                         'food item','food name','product','product name','menu item',
                         'title','label','menu_item'];
    const CAT_KEYS   = ['category','cat','section','type','course','group','division'];
    const SUBCAT_KEYS= ['subcategory','sub category','sub-category','sub_category','subcat','sub'];
    const PRICE_KEYS = ['price','cost','amount','rate','unit price','selling price',
                         'sell price','mrp','unit_price','item price','list price',
                         'menu price','unit cost','selling_price','price each','sale price'];
    const DESC_KEYS  = ['description','desc','details','notes','ingredients','info','about','remarks'];
    const TAG_KEYS   = ['tags','tag','label','labels','flags'];
    const SIZE_KEYS  = ['size','portion','serving size','serving','weight','volume','variant','unit','measure'];

    workbook.eachSheet(worksheet => {
      const sheetName = worksheet.name || '';

      // Collect rows as sanitized string arrays (ExcelJS row.values is 1-indexed).
      const rawRows = [];
      worksheet.eachRow({ includeEmpty: false }, row => {
        // row.values[0] is always undefined (1-indexed); slice from index 1.
        const cells = (row.values || []).slice(1).map(c => sanitize(c));
        rawRows.push(cells);
      });

      if (!rawRows.length) return;
      allHeaders.push(...rawRows.slice(0, 3).flat());

      // ── Step 1: find header row ─────────────────────────────────────────
      let headerIdx = -1;
      let colMap    = { name: -1, category: -1, subcategory: -1, price: -1, description: -1, tags: -1, size: -1 };

      for (let ri = 0; ri < Math.min(10, rawRows.length); ri++) {
        const lrow      = rawRows[ri].map(c => c.toLowerCase());
        const cellClean = c => c.replace(/[^a-z0-9 _]/g, '').trim();
        const hasName   = lrow.some(c => NAME_KEYS.includes(c) || c.includes('item') || c.includes('dish'));
        const hasPrice  = lrow.some(c => PRICE_KEYS.includes(cellClean(c)) || c.includes('price') || c.includes('cost'));
        if (hasName || hasPrice) {
          headerIdx = ri;
          lrow.forEach((cell, ci) => {
            const cc = cellClean(cell);
            if (colMap.name < 0 && (NAME_KEYS.includes(cell) || (cell.includes('name') && !cell.includes('price') && !cell.includes('rest'))))
              colMap.name = ci;
            if (colMap.category < 0 && (CAT_KEYS.includes(cell) || cell.includes('categor') || cell.includes('section') || cell.includes('group')))
              colMap.category = ci;
            if (colMap.subcategory < 0 && (SUBCAT_KEYS.includes(cell) || cell.includes('subcategor')))
              colMap.subcategory = ci;
            if (colMap.price < 0 && (PRICE_KEYS.includes(cc) || cell.includes('price') || cell.includes('cost')))
              colMap.price = ci;
            if (colMap.description < 0 && (DESC_KEYS.includes(cell) || cell.includes('descri') || cell.includes('note') || cell.includes('ingred')))
              colMap.description = ci;
            if (colMap.tags < 0 && TAG_KEYS.includes(cell))
              colMap.tags = ci;
            if (colMap.size < 0 && (SIZE_KEYS.includes(cell) || cell.includes('size') || cell.includes('portion') || cell.includes('serving')))
              colMap.size = ci;
          });
          break;
        }
      }

      // ── Step 2: positional fallback when no header row found ────────────
      if (headerIdx < 0) {
        colMap.name = 0;
        const sampleLen = Math.min(rawRows.length, 30);
        const numCount  = {};
        for (let ri = 0; ri < sampleLen; ri++) {
          rawRows[ri].forEach((cell, ci) => {
            if (ci > 0 && cell && !isNaN(parseFloat(cell.replace(/[^0-9.]/g, '')))) {
              numCount[ci] = (numCount[ci] || 0) + 1;
            }
          });
        }
        let maxN = 0;
        for (const [ci, n] of Object.entries(numCount)) {
          if (n > maxN) { maxN = n; colMap.price = Number(ci); }
        }
        const numCols = Math.max(...rawRows.slice(0, sampleLen).map(r => r.length), 0);
        if (numCols >= 3 && colMap.price !== 1) colMap.category    = 1;
        if (numCols >= 4)                        colMap.description = 2;
      }

      // ── Step 3: determine category seed from sheet name ─────────────────
      const GENERIC_SHEETS = ['sheet1','sheet 1','sheet2','sheet3','menu','data','items','all'];
      const sheetCat = !GENERIC_SHEETS.includes(sheetName.toLowerCase())
        ? toTitleCase(sheetName) : 'General';
      let currentCategory = sheetCat;
      const startRow = headerIdx >= 0 ? headerIdx + 1 : 0;

      // ── Step 4: parse data rows ──────────────────────────────────────────
      for (let ri = startRow; ri < rawRows.length; ri++) {
        const row      = rawRows[ri];
        const nonEmpty = row.filter(c => c.length > 0);
        if (!nonEmpty.length) continue;

        const hasNumeric = nonEmpty.some(c => !isNaN(parseFloat(c.replace(/[^0-9.]/g, ''))));
        if (nonEmpty.length <= 2 && !hasNumeric) {
          const candidate = row.find(c => c.length > 1) || '';
          if (candidate.length < 60) {
            const heading = detectCategoryHeading(candidate);
            currentCategory = heading || (candidate ? toTitleCase(candidate) : currentCategory);
            continue;
          }
        }

        const nameVal = (colMap.name >= 0 ? row[colMap.name] : row[0]) || '';
        if (nameVal.length < 2 || !isPrintable(nameVal)) continue;

        const catRaw    = colMap.category    >= 0 ? row[colMap.category]    : '';
        const subcatRaw = colMap.subcategory >= 0 ? row[colMap.subcategory] : '';
        const priceRaw  = colMap.price       >= 0 ? row[colMap.price]       : '';
        const descRaw   = colMap.description >= 0 ? row[colMap.description] : '';
        const tagsRaw   = colMap.tags        >= 0 ? row[colMap.tags]        : '';
        const sizeRaw   = colMap.size        >= 0 ? row[colMap.size]        : '';

        const price = parseFloat((priceRaw || '0').replace(/[^0-9.]/g, '')) || 0;
        rawPrices.push(priceRaw);

        items.push({
          id:          crypto.randomUUID(),
          name:        nameVal,
          category:    catRaw ? toTitleCase(catRaw) : currentCategory,
          subcategory: subcatRaw ? toTitleCase(subcatRaw) : '',
          price,
          description: isPrintable(descRaw) ? descRaw : '',
          tags:        tagsRaw.split(/[,;|]/).map(t => t.trim()).filter(Boolean),
          size:        isPrintable(sizeRaw) ? sizeRaw : '',
        });
      }
    });

    const detectedCurrency = detectCurrency([...rawPrices, ...allHeaders]);
    return { items, detectedCurrency };
  } catch (err) {
    console.error('XLSX parse error:', err.message);
    return { items: [], detectedCurrency: null };
  }
}

/** Parse a PDF (text layer only) */
async function parsePdfFile(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const buffer   = fs.readFileSync(filePath);
    const data     = await pdfParse(buffer);
    const items    = parseTextToItems(data.text);
    // Detect currency from the raw text (before price stripping)
    const detectedCurrency = detectCurrency(data.text.split(/\s+/).filter(w => w.length < 12));
    return { items, detectedCurrency };
  } catch {
    return { items: [], detectedCurrency: null };
  }
}

// ── Input validation helpers ──────────────────────────────────────────────────

const VALID_HEX_COLOR    = /^#[0-9a-fA-F]{6}$/;
const VALID_FONT_STYLES  = ['modern','classic','playful','elegant','bold'];
const VALID_BG_STYLES    = ['dark','light','warm','cool','nature'];
const VALID_LAYOUTS      = ['logo-left','logo-right','logo-center','name-only','logo-only','stacked'];
const VALID_CURRENCIES   = [
  'USD','EUR','GBP','JPY','CNY','INR','AUD','CAD','CHF','HKD','SGD','SEK','NOK','DKK',
  'NZD','MXN','BRL','ZAR','KRW','TRY','RUB','PHP','IDR','THB','MYR','PKR','BDT','VND',
  'AED','SAR','QAR','KWD','BHD','OMR','EGP','NGN','KES','GHS','XAF','XOF','ETB','TZS',
  'UGX','RWF','MAD','DZD','TND','LYD','NAD','BWP','ZWL','ZMW','MWK','MZN','AOA','CDF',
  'GMD','GNF','SLE','LRD','CVE','BIF','SOS','SSP','ERN','DJF','KMF','SCR','MUR','MGA',
  'SDG','STN','LSL','SZL',
];

/** Trim and cap a string field; returns '' on bad input */
function sanitizeStr(v, maxLen = 300) {
  if (v == null) return '';
  return String(v).trim().slice(0, maxLen);
}

/** Return v if it is a valid #rrggbb hex color, otherwise return fallback */
function sanitizeColor(v, fallback = '') {
  const s = sanitizeStr(v, 7);
  return VALID_HEX_COLOR.test(s) ? s : fallback;
}

/** Validate and return a branding object with sanitized fields */
function sanitizeBranding(body) {
  const {
    brandColor, logoUrl, coverImage, tagline, fontStyle, bgStyle,
    showLogo, showName, headerLayout,
    textColor, headingColor, bgColor, cardBg, priceColor,
  } = body || {};

  // logoUrl / coverImage: allow empty string or a data: URI (base64 image) up to ~10 MB encoded
  const rawLogo = sanitizeStr(logoUrl, 14_000_000); // ~10 MB base64
  const safeLogoUrl = (!rawLogo || rawLogo.startsWith('data:image/') || rawLogo.startsWith('/uploads/'))
    ? rawLogo : '';
  const rawCover = sanitizeStr(coverImage, 14_000_000);
  const safeCoverImage = (!rawCover || rawCover.startsWith('data:image/') || rawCover.startsWith('http://') || rawCover.startsWith('https://') || rawCover.startsWith('/uploads/'))
    ? rawCover : '';

  return {
    brandColor:   sanitizeColor(brandColor, '#2dd4bf'),
    logoUrl:      safeLogoUrl,
    coverImage:   safeCoverImage,
    tagline:      sanitizeStr(tagline, 200),
    fontStyle:    VALID_FONT_STYLES.includes(fontStyle)  ? fontStyle  : 'modern',
    bgStyle:      VALID_BG_STYLES.includes(bgStyle)      ? bgStyle    : 'dark',
    showLogo:     showLogo  !== undefined ? Boolean(showLogo)  : true,
    showName:     showName  !== undefined ? Boolean(showName)  : true,
    headerLayout: VALID_LAYOUTS.includes(headerLayout)   ? headerLayout : 'logo-left',
    textColor:    sanitizeColor(textColor),
    headingColor: sanitizeColor(headingColor),
    bgColor:      sanitizeColor(bgColor),
    cardBg:       sanitizeColor(cardBg),
    priceColor:   sanitizeColor(priceColor),
    phone:           sanitizeStr(body.phone, 50),
    email:           sanitizeStr(body.email, 200),
    address:         sanitizeStr(body.address, 500),
    website:         sanitizeStr(body.website, 500),
    socialInstagram: sanitizeStr(body.socialInstagram, 500),
    socialFacebook:  sanitizeStr(body.socialFacebook, 500),
    socialTwitter:   sanitizeStr(body.socialTwitter, 500),
    socialWhatsapp:  sanitizeStr(body.socialWhatsapp, 500),
    socialTiktok:    sanitizeStr(body.socialTiktok, 500),
    socialYoutube:   sanitizeStr(body.socialYoutube, 500),
    tablesEnabled:   Number(body.tablesEnabled || 0),
  };
}

/** Sanitize a single menu item from user input */
function sanitizeItem(it) {
  return {
    id:          sanitizeStr(it.id, 36) || crypto.randomUUID(),
    name:        sanitizeStr(it.name, 200),
    category:    sanitizeStr(it.category, 100) || 'General',
    subcategory: sanitizeStr(it.subcategory, 100) || '',
    price:       Math.max(0, parseFloat(it.price) || 0),
    description: sanitizeStr(it.description, 500),
    tags:        Array.isArray(it.tags) ? it.tags.map(t => sanitizeStr(t, 50)).filter(Boolean).slice(0, 20) : [],
    size:        sanitizeStr(it.size, 100),
    imageUrl:    sanitizeStr(it.imageUrl, 2000),
    rating:      Math.max(0, Math.min(5, parseFloat(it.rating) || 0)),
  };
}

// ── QR Code generation ────────────────────────────────────────────────────────

/** Generate QR code for a menu URL with version tracking */
async function generateQRCode(menuId, version = 1) {
  const menuUrl = `${HOST}/menu.html?id=${menuId}&v=${version}`;
  const qrDataUrl = await QRCode.toDataURL(menuUrl, {
    width: 300, 
    margin: 2,
    color: { dark: '#0d1b2a', light: '#f0fdf9' },
  });
  return qrDataUrl;
}

// Schema migrations will be handled first, then prepared statements will be created later

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/upload  – upload a file, parse it, create a new menu draft
app.post('/api/upload', requireAnyAuth, upload.single('menuFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const ext  = path.extname(req.file.originalname).toLowerCase();
    let items  = [];
    let detectedCurrency = null;

    if (ext === '.csv') {
      const result = await parseCsvFile(req.file.path);
      items = result.items;
      detectedCurrency = result.detectedCurrency;
    } else if (ext === '.pdf') {
      const result = await parsePdfFile(req.file.path);
      items = result.items;
      detectedCurrency = result.detectedCurrency;
    } else if (ext === '.xlsx' || ext === '.xls') {
      const result = await parseXlsxFile(req.file.path);
      items = result.items;
      detectedCurrency = result.detectedCurrency;
    } else {
      const text = fs.readFileSync(req.file.path, 'utf8');
      items = parseTextToItems(text);
      detectedCurrency = detectCurrency(text.split(/\s+/).filter(w => w.length < 12));
    }

    res.json({
      filename:         req.file.originalname,
      storedAs:         req.file.filename,
      itemCount:        items.length,
      detectedCurrency,
      items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menus  – save a reviewed set of items and get back a QR code
app.post('/api/menus', requireAnyAuth, requireOwnerOrManager, async (req, res) => {
  try {
    const { restaurantName, items, currency } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'No menu items provided.' });

    const safeName     = sanitizeStr(restaurantName, 200) || 'My Restaurant';
    const safeCurrency = VALID_CURRENCIES.includes(currency) ? currency : 'USD';
    const branding     = sanitizeBranding(req.body);
    const safeItems    = items.map(sanitizeItem).filter(it => it.name.length >= 2);

    const menuId = crypto.randomUUID();
    
    // Generate QR code with version 1
    const qrDataUrl = await generateQRCode(menuId, 1);
    
    // Save menu with QR code
    await saveMenuTx(menuId, safeName, safeCurrency, branding, safeItems, qrDataUrl);

    // Associate with customer when created via customer auth
    if (req.isCustomer) {
      await pool.query('UPDATE menus SET customer_id = $1 WHERE id = $2', [req.customer.id, menuId]);

      // Auto-assign trial subscription to new menus (first menu gets 7-day trial)
      try {
        const { rows: trialPlan } = await pool.query("SELECT id FROM subscription_plans WHERE name='trial' LIMIT 1");
        if (trialPlan.length > 0) {
          const trialNow = new Date().toISOString();
          const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await pool.query(`
            INSERT INTO subscriptions (menu_id, plan_id, status, start_date, trial_end, created_at)
            VALUES ($1, $2, 'trial', $3, $4, $3)
            ON CONFLICT (menu_id) DO NOTHING
          `, [menuId, trialPlan[0].id, trialNow, trialEnd]);
        }
      } catch (trialErr) {
        console.warn('Trial subscription auto-assign failed:', trialErr.message);
      }
    }

    const menuUrl = `${HOST}/menu.html?id=${menuId}&v=1`;

    res.json({ menuId, menuUrl, qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/menus  – list saved menus (scoped to customer or all for admin)
app.get('/api/menus', requireAnyAuth, async (req, res) => {
  const start = performance.now();
  
  try {
    let rows;
    if (req.isCustomer) {
      // Customers see only their own menus
      const { rows: customerRows } = await pool.query(`
        SELECT id, restaurant_name, created_at, total_scans, qr_version, last_scan_at,
          (SELECT COUNT(*) FROM menu_items WHERE menu_id = menus.id) AS item_count
        FROM menus WHERE customer_id = $1 ORDER BY created_at DESC
      `, [req.customer.id]);
      rows = customerRows;
    } else {
      rows = await dbListMenus();
    }
    
    const responseTime = performance.now() - start;
    if (responseTime > 50) {
      console.log(`⚡ Slow query - getMenus: ${responseTime.toFixed(2)}ms`);
    }
    
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map(r => ({
      id:             r.id,
      restaurantName: r.restaurant_name,
      itemCount:      r.item_count || 0,
      createdAt:      r.created_at,
      totalScans:     r.total_scans || 0,
      qrVersion:      r.qr_version || 1,
      lastScanAt:     r.last_scan_at || null,
    })));
  } catch (error) {
    console.error('❌ Error fetching menus:', error);
    res.status(500).json({ error: 'Failed to fetch menus' });
  }
});

// GET /api/menus/:id  – get a single menu (optimized with caching)
app.get('/api/menus/:id', async (req, res) => {
  const { id } = req.params;
  const start = performance.now();
  
  // Handle demo menu - no database lookup needed
  if (id === 'demo') {
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hour cache for demo
    return res.json({
      id: 'demo',
      restaurantName: 'Bella Vista Restaurant',
      currency: 'USD',
      brandColor: '#222222',
      logoUrl: '',
      tagline: 'Authentic Italian Cuisine',
      fontStyle: 'elegant',
      bgStyle: 'light',
      showLogo: 1,
      showName: 1,  
      headerLayout: 'logo-left',
      textColor: '',
      headingColor: '',
      bgColor: '',
      cardBg: '',
      priceColor: '',
      phone: '+1 (555) 123-4567',
      email: 'hello@bellavista.com',
      address: '123 Main St, New York, NY 10001',
      website: 'https://bellavista.com',
      socialInstagram: 'https://instagram.com/bellavista',
      socialFacebook: 'https://facebook.com/bellavista',
      socialTwitter: '',
      socialWhatsapp: '',
      socialTiktok: '',
      socialYoutube: '',
      createdAt: new Date().toISOString(),
      items: [
        {
          id: 'demo-1',
          name: 'Margherita Pizza',
          category: 'Pizza',
          price: 18.00,
          description: 'Fresh mozzarella, basil, San Marzano tomato sauce on our signature wood-fired crust',
          tags: ['vegetarian', 'classic'],
          size: 'Large (12")',
          sortOrder: 1
        },
        {
          id: 'demo-2', 
          name: 'Caesar Salad',
          category: 'Salads',
          price: 12.50,
          description: 'Crispy romaine lettuce, parmesan cheese, house-made croutons with classic Caesar dressing',
          tags: ['vegetarian'],
          size: 'Regular',
          sortOrder: 2
        },
        {
          id: 'demo-3',
          name: 'Grilled Salmon',
          category: 'Main Course', 
          price: 26.00,
          description: 'Atlantic salmon fillet with seasonal roasted vegetables and lemon herb butter',
          tags: ['healthy', 'gluten-free'],
          size: '8oz',
          sortOrder: 3
        },
        {
          id: 'demo-4',
          name: 'Tiramisu',
          category: 'Desserts',
          price: 8.50,
          description: 'Traditional Italian dessert with mascarpone, coffee-soaked ladyfingers and cocoa',
          tags: ['classic', 'coffee'],
          size: 'Individual',
          sortOrder: 4
        },
        {
          id: 'demo-5',
          name: 'Bruschetta',
          category: 'Appetizers',
          price: 9.00,
          description: 'Toasted artisan bread topped with fresh tomatoes, basil, garlic and extra virgin olive oil',
          tags: ['vegetarian', 'vegan'],
          size: '3 pieces',
          sortOrder: 5
        },
        {
          id: 'demo-6',
          name: 'House Wine',
          category: 'Beverages',
          price: 7.50,
          description: 'Italian red or white wine by the glass',
          tags: ['alcohol'],
          size: '5oz glass',
          sortOrder: 6
        }
      ]
    });
  }
  
  try {
    // Check cache first
    const cached = getCachedMenu(id);
    if (cached) {
      console.log(`🎯 Cache hit for menu: ${id}`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json(cached);
    }
    
    // Database lookup with optimized prepared statements
    const menu = await dbGetMenu(id);
    if (!menu) {
      // Check for QR redirect
      const redir = await pool.query(
        'SELECT target_menu_id FROM qr_redirects WHERE source_menu_id = $1',
        [id]
      );
      if (redir.rows.length > 0) {
        const targetId = redir.rows[0].target_menu_id;
        const targetMenu = await dbGetMenu(targetId);
        if (targetMenu) {
          const targetItems = await dbGetItems(targetId);
          const menuData = buildMenuResponse(targetMenu, targetItems);
          setCachedMenu(id, menuData);
          res.setHeader('Cache-Control', 'public, max-age=300');
          return res.json(menuData);
        }
      }
      return res.status(404).json({ error: 'Menu not found.' });
    }
    
    const rawItems = await dbGetItems(id);
    const responseTime = performance.now() - start;
    
    if (responseTime > 100) {
      console.log(`⚡ Slow menu query for ${id}: ${responseTime.toFixed(2)}ms`);
    }
    
    const menuData = buildMenuResponse(menu, rawItems);
    
    // Cache the result
    setCachedMenu(id, menuData);
    
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minute cache
    res.json(menuData);
    
  } catch (error) {
    console.error(`❌ Error fetching menu ${id}:`, error);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

// GET /api/menus/:id/export-csv  – download menu items as CSV
app.get('/api/menus/:id/export-csv', requireAnyAuth, async (req, res) => {
  try {
    const menu = await dbGetMenu(req.params.id);
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    if (req.isCustomer && !await assertMenuOwnership(req.params.id, req.customer.id, res)) return;
    const { rows } = await pool.query(
      'SELECT * FROM menu_items WHERE menu_id = $1 ORDER BY category, subcategory, sort_order',
      [req.params.id]
    );
    const escapeCsv = v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = 'name,category,subcategory,price,description,size,tags';
    const lines = rows.map(r => {
      const tags = JSON.parse(r.tags || '[]').join('|');
      return [r.name, r.category, r.subcategory || '', r.price, r.description || '', r.size || '', tags]
        .map(escapeCsv).join(',');
    });
    const csv = [header, ...lines].join('\r\n');
    const safeName = (menu.restaurant_name || 'menu').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_menu.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('❌ CSV export error:', error);
    res.status(500).json({ error: 'Failed to export menu' });
  }
});

// PUT /api/menus/:id  – update an existing menu (items + branding)
app.put('/api/menus/:id', requireAnyAuth, async (req, res) => {
  try {
    const menu = await dbGetMenu(req.params.id);
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    if (req.isCustomer && !await assertMenuOwnership(req.params.id, req.customer.id, res)) return;

    const { restaurantName, items, currency } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'No menu items provided.' });

    const safeName     = sanitizeStr(restaurantName, 200) || menu.restaurant_name;
    const safeCurrency = VALID_CURRENCIES.includes(currency) ? currency : (menu.currency || 'USD');
    const branding     = sanitizeBranding(req.body);
    const safeItems    = items.map(sanitizeItem).filter(it => it.name.length >= 2);
    await updateMenuTx(req.params.id, safeName, safeCurrency, branding, safeItems);

    // Use existing QR code and version (don't auto-regenerate on updates)
    const qrVersion = menu.qr_version || 1;
    const qrDataUrl = menu.qr_code || '';
    const menuUrl = `${HOST}/menu.html?id=${req.params.id}&v=${qrVersion}`;

    res.json({ 
      menuId: req.params.id, 
      menuUrl, 
      qrDataUrl,
      message: 'Menu updated successfully. Use "Regenerate QR Code" if you need a new QR version.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/menus/:id
app.delete('/api/menus/:id', requireAnyAuth, requireOwnerOrManager, async (req, res) => {
  const menu = await dbGetMenu(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found.' });
  if (req.isCustomer && !await assertMenuOwnership(req.params.id, req.customer.id, res)) return;
  await pool.query('DELETE FROM menus WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/menus/:id/analytics - Get scan analytics for a menu
app.get('/api/menus/:id/analytics', requireAnyAuth, async (req, res) => {
  try {
    const menuId = req.params.id;
    const menu = await dbGetMenu(menuId);
    
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    if (req.isCustomer && !await assertMenuOwnership(menuId, req.customer.id, res)) return;
    
    // Get scan statistics
    const recentScans = await dbGetRecentScans(String(menuId), 10);
    const scansStats = await dbGetScansStats(String(menuId));
    
    res.json({
      menuId,
      totalScans: menu.total_scans || 0,
      lastScanAt: menu.last_scan_at || null,
      qrVersion: menu.qr_version || 1,
      updatedAt: menu.updated_at || menu.created_at,
      recentScans: recentScans.map(scan => ({
        scannedAt: scan.scanned_at,
        userAgent: scan.user_agent,
        referrer: scan.referrer
      })),
      dailyStats: scansStats.map(stat => ({
        date: stat.date,
        scans: stat.scans
      }))
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menus/:id/regenerate-qr - Regenerate QR code with new version
app.post('/api/menus/:id/regenerate-qr', requireAnyAuth, async (req, res) => {
  try {
    const menuId = req.params.id;
    const menu = await dbGetMenu(menuId);
    
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    if (req.isCustomer && !await assertMenuOwnership(menuId, req.customer.id, res)) return;
    
    const newVersion = (menu.qr_version || 1) + 1;
    const qrDataUrl = await generateQRCode(menuId, newVersion);
    const now = new Date().toISOString();
    
    await dbRegenerateQR(
      String(qrDataUrl),
      String(now),
      String(menuId)
    );
    
    const menuUrl = `${HOST}/menu.html?id=${menuId}&v=${newVersion}`;
    
    res.json({
      success: true,
      qrVersion: newVersion,
      qrDataUrl,
      menuUrl
    });
  } catch (err) {
    console.error('QR regeneration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── QR Redirect (Link / Reprogram) ─────────────────────────────────────────

// POST /api/qr-redirects - Create a redirect from a decoded QR menu ID to a target menu
app.post('/api/qr-redirects', requireAnyAuth, async (req, res) => {
  try {
    const { sourceMenuId, targetMenuId, label } = req.body;
    if (!sourceMenuId || !targetMenuId) {
      return res.status(400).json({ error: 'sourceMenuId and targetMenuId are required.' });
    }
    if (sourceMenuId === targetMenuId) {
      return res.status(400).json({ error: 'Source and target cannot be the same.' });
    }
    // Verify target menu exists
    const target = await dbGetMenu(targetMenuId);
    if (!target) return res.status(404).json({ error: 'Target menu not found.' });
    if (req.isCustomer && !await assertMenuOwnership(targetMenuId, req.customer.id, res)) return;

    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO qr_redirects (source_menu_id, target_menu_id, label, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_menu_id) DO UPDATE SET target_menu_id = $2, label = $3`,
      [String(sourceMenuId), String(targetMenuId), String(label || ''), now]
    );

    // Clear cache for the source ID so redirect takes effect
    menuCache.delete(sourceMenuId);

    res.json({ success: true, sourceMenuId, targetMenuId });
  } catch (err) {
    console.error('QR redirect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qr-redirects - List all QR redirects
app.get('/api/qr-redirects', requireAnyAuth, async (req, res) => {
  try {
    let query, params;
    if (req.isCustomer) {
      query = `SELECT r.*, m.restaurant_name AS target_name
               FROM qr_redirects r
               LEFT JOIN menus m ON r.target_menu_id = m.id
               WHERE m.customer_id = $1
               ORDER BY r.created_at DESC`;
      params = [req.customer.id];
    } else {
      query = `SELECT r.*, m.restaurant_name AS target_name
               FROM qr_redirects r
               LEFT JOIN menus m ON r.target_menu_id = m.id
               ORDER BY r.created_at DESC`;
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/qr-redirects/:id - Remove a redirect
app.delete('/api/qr-redirects/:id', requireAnyAuth, async (req, res) => {
  try {
    if (req.isCustomer) {
      const { rows: ownerCheck } = await pool.query(
        `SELECT r.id FROM qr_redirects r
         JOIN menus m ON m.id = r.source_menu_id
         WHERE r.id = $1 AND m.customer_id = $2`,
        [req.params.id, req.customer.id]
      );
      if (!ownerCheck.length) return res.status(403).json({ error: 'Access denied.' });
    }
    const { rows } = await pool.query(
      'DELETE FROM qr_redirects WHERE id = $1 RETURNING source_menu_id',
      [req.params.id]
    );
    if (rows.length > 0) menuCache.delete(rows[0].source_menu_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Table Management ──────────────────────────────────────────────────────────

// GET /api/menus/:id/tables - List tables for a menu
app.get('/api/menus/:id/tables', requireAnyAuth, async (req, res) => {
  try {
    if (req.isCustomer && !await assertMenuOwnership(req.params.id, req.customer.id, res)) return;
    const { rows } = await pool.query(
      'SELECT * FROM menu_tables WHERE menu_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/menus/:id/tables - Create a table + generate its QR
app.post('/api/menus/:id/tables', requireAnyAuth, async (req, res) => {
  try {
    const menuId = req.params.id;
    const label = sanitizeStr(req.body.label, 100) || 'Table';
    const menu = await dbGetMenu(menuId);
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    if (req.isCustomer && !await assertMenuOwnership(menuId, req.customer.id, res)) return;

    const QRCode = require('qrcode');
    const HOST = process.env.HOST || `http://localhost:${PORT}`;
    const tableUrl = `${HOST}/menu.html?id=${menuId}&table=${encodeURIComponent(label)}`;
    const qrCode = await QRCode.toDataURL(tableUrl, {
      width: 512, margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const { rows } = await pool.query(
      `INSERT INTO menu_tables (menu_id, label, qr_code, created_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [menuId, label, qrCode, new Date().toISOString()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/menus/:id/tables/:tableId - Delete a table
app.delete('/api/menus/:id/tables/:tableId', requireAnyAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_tables WHERE id = $1 AND menu_id = $2',
      [req.params.tableId, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Table Alerts ──────────────────────────────────────────────────────────────

// POST /api/menus/:id/alerts - Customer sends alert from table
app.post('/api/menus/:id/alerts', async (req, res) => {
  try {
    const menuId = req.params.id;
    const tableLabel = sanitizeStr(req.body.table, 100);
    const message = sanitizeStr(req.body.message, 300) || 'Service requested';
    if (!tableLabel) return res.status(400).json({ error: 'Table label required.' });

    // Check tables are enabled for this menu
    const menu = await dbGetMenu(menuId);
    if (!menu || !menu.tables_enabled) return res.status(403).json({ error: 'Table alerts not enabled.' });

    const { rows } = await pool.query(
      `INSERT INTO table_alerts (menu_id, table_label, message, status, created_at)
       VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [menuId, tableLabel, message, new Date().toISOString()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/menus/:id/alerts - Admin views alerts
app.get('/api/menus/:id/alerts', requireAnyAuth, async (req, res) => {
  try {
    if (req.isCustomer && !await assertMenuOwnership(req.params.id, req.customer.id, res)) return;
    const { rows } = await pool.query(
      `SELECT * FROM table_alerts WHERE menu_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/alerts/:id/dismiss - Admin/customer dismisses an alert
app.put('/api/alerts/:id/dismiss', requireAnyAuth, async (req, res) => {
  try {
    if (req.isCustomer) {
      const { rows: ownerCheck } = await pool.query(
        `SELECT ta.id FROM table_alerts ta
         JOIN menus m ON m.id = ta.menu_id
         WHERE ta.id = $1 AND m.customer_id = $2`,
        [req.params.id, req.customer.id]
      );
      if (!ownerCheck.length) return res.status(403).json({ error: 'Access denied.' });
    }
    await pool.query(
      `UPDATE table_alerts SET status = 'dismissed' WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
})

// GET /api/alerts/pending - All pending alerts across all menus (for polling)
app.get('/api/alerts/pending', requireAnyAuth, async (req, res) => {
  try {
    let rows;
    if (req.isCustomer) {
      ({ rows } = await pool.query(
        `SELECT ta.*, m.restaurant_name FROM table_alerts ta
         LEFT JOIN menus m ON m.id = ta.menu_id
         WHERE ta.status = 'pending' AND m.customer_id = $1
         ORDER BY ta.created_at DESC LIMIT 50`,
        [req.customer.id]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT ta.*, m.restaurant_name FROM table_alerts ta
         LEFT JOIN menus m ON m.id = ta.menu_id
         WHERE ta.status = 'pending'
         ORDER BY ta.created_at DESC LIMIT 50`
      ));
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Orders ────────────────────────────────────────────────────────────────────

// POST /api/menus/:id/orders - Customer submits an order
app.post('/api/menus/:id/orders', async (req, res) => {
  try {
    const menuId = req.params.id;
    const menu = await dbGetMenu(menuId);
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });

    const items = Array.isArray(req.body.items) ? req.body.items.map(it => ({
      name: sanitizeStr(it.name, 200),
      qty: Math.max(1, Math.min(100, parseInt(it.qty) || 1)),
      price: Math.max(0, parseFloat(it.price) || 0),
    })) : [];
    if (!items.length) return res.status(400).json({ error: 'No items.' });

    const tableLabel = sanitizeStr(req.body.table, 100) || '';
    const total = items.reduce((s, it) => s + it.price * it.qty, 0);
    const currency = sanitizeStr(req.body.currency, 10) || menu.currency || 'USD';
    const customerName = sanitizeStr(req.body.customer_name, 200) || '';
    const customerPhone = sanitizeStr(req.body.customer_phone, 20) || '';

    const { rows } = await pool.query(
      `INSERT INTO orders (menu_id, table_label, items, total, currency, status, customer_name, customer_phone, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8) RETURNING *`,
      [menuId, tableLabel, JSON.stringify(items), total, currency, customerName, customerPhone, new Date().toISOString()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/menus/:id/orders - Admin/customer views orders
app.get('/api/menus/:id/orders', requireAnyAuth, async (req, res) => {
  try {
    if (req.isCustomer && !await assertMenuOwnership(req.params.id, req.customer.id, res)) return;
    const status = req.query.status || 'pending';
    const { rows } = await pool.query(
      `SELECT * FROM orders WHERE menu_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100`,
      [req.params.id, status]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/orders/:id/status - Admin/customer updates order status
app.put('/api/orders/:id/status', requireAnyAuth, async (req, res) => {
  try {
    if (req.isCustomer) {
      // Verify the order belongs to one of this customer's menus
      const { rows: ownerCheck } = await pool.query(
        `SELECT o.id FROM orders o
         JOIN menus m ON m.id = o.menu_id
         WHERE o.id = $1 AND m.customer_id = $2`,
        [req.params.id, req.customer.id]
      );
      if (!ownerCheck.length) return res.status(403).json({ error: 'Access denied.' });
    }
    const newStatus = sanitizeStr(req.body.status, 20) || 'completed';
    await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2`,
      [newStatus, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
})

// ── Item Ratings ──────────────────────────────────────────────────────────────

// POST /api/items/:itemId/rate - Customer rates an item
app.post('/api/items/:itemId/rate', async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const rating = Math.max(1, Math.min(5, parseInt(req.body.rating) || 0));
    if (!rating) return res.status(400).json({ error: 'Rating 1-5 required.' });

    const rawIp = req.ip || req.connection.remoteAddress || '';
    const ipHash = crypto.createHash('sha256').update(rawIp + 'rating-salt').digest('hex').slice(0, 16);

    // Get the menu_id from menu_items
    const itemRow = await pool.query('SELECT menu_id FROM menu_items WHERE id = $1', [itemId]);
    if (!itemRow.rows.length) return res.status(404).json({ error: 'Item not found.' });
    const menuId = itemRow.rows[0].menu_id;

    // Upsert rating (one per IP per item)
    await pool.query(
      `INSERT INTO item_ratings (item_id, menu_id, rating, ip_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id, ip_hash) DO UPDATE SET rating = $3, created_at = $5`,
      [itemId, menuId, rating, ipHash, new Date().toISOString()]
    );

    // Calculate new average
    const avg = await pool.query(
      'SELECT ROUND(AVG(rating)::numeric, 1) as avg, COUNT(*) as cnt FROM item_ratings WHERE item_id = $1',
      [itemId]
    );
    const newAvg = parseFloat(avg.rows[0].avg) || 0;
    const count = parseInt(avg.rows[0].cnt) || 0;

    // Update denormalized rating on menu_items
    await pool.query('UPDATE menu_items SET rating = $1 WHERE id = $2', [newAvg, itemId]);
    menuCache.delete(menuId);

    res.json({ avgRating: newAvg, ratingCount: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Subscription Management ───────────────────────────────────────────────────

// GET /api/subscription-plans - Get all subscription plans (public - active only)
app.get('/api/subscription-plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/subscription-plans - Admin: Get ALL plans (including inactive)
app.get('/api/admin/subscription-plans', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM subscription_plans ORDER BY sort_order');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/subscription-plans - Admin: Create plan
app.post('/api/admin/subscription-plans', requireRole('super_admin'), async (req, res) => {
  try {
    const name = sanitizeStr(req.body.name, 50);
    const displayName = sanitizeStr(req.body.display_name, 100);
    const price = parseFloat(req.body.price) || 0;
    const annualPrice = parseFloat(req.body.annual_price) || 0;
    const interval = sanitizeStr(req.body.interval, 20) || 'monthly';
    const menuLimit = parseInt(req.body.menu_limit) || 1;
    const locationLimit = parseInt(req.body.location_limit) || 1;
    const features = Array.isArray(req.body.features) ? req.body.features.map(f => sanitizeStr(f, 200)) : [];
    const sortOrder = parseInt(req.body.sort_order) || 0;

    if (!name || !displayName) return res.status(400).json({ error: 'name and display_name required.' });

    const now = new Date().toISOString();
    const { rows } = await pool.query(`
      INSERT INTO subscription_plans (name, display_name, price, annual_price, interval, menu_limit, location_limit, features, is_active, sort_order, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10) RETURNING *
    `, [name, displayName, price, annualPrice, interval, menuLimit, locationLimit, JSON.stringify(features), sortOrder, now]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Plan name already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/subscription-plans/:id - Admin: Update plan
app.put('/api/admin/subscription-plans/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const updates = [];
    const values = [];
    let p = 1;

    if (req.body.display_name !== undefined) { updates.push(`display_name = $${p++}`); values.push(sanitizeStr(req.body.display_name, 100)); }
    if (req.body.price !== undefined) { updates.push(`price = $${p++}`); values.push(parseFloat(req.body.price) || 0); }
    if (req.body.annual_price !== undefined) { updates.push(`annual_price = $${p++}`); values.push(parseFloat(req.body.annual_price) || 0); }
    if (req.body.interval !== undefined) { updates.push(`interval = $${p++}`); values.push(sanitizeStr(req.body.interval, 20)); }
    if (req.body.menu_limit !== undefined) { updates.push(`menu_limit = $${p++}`); values.push(parseInt(req.body.menu_limit) || 1); }
    if (req.body.location_limit !== undefined) { updates.push(`location_limit = $${p++}`); values.push(parseInt(req.body.location_limit) || 1); }
    if (req.body.is_active !== undefined) { updates.push(`is_active = $${p++}`); values.push(req.body.is_active ? 1 : 0); }
    if (req.body.sort_order !== undefined) { updates.push(`sort_order = $${p++}`); values.push(parseInt(req.body.sort_order) || 0); }
    if (Array.isArray(req.body.features)) { updates.push(`features = $${p++}`); values.push(JSON.stringify(req.body.features.map(f => sanitizeStr(f, 200)))); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    values.push(req.params.id);

    const { rowCount } = await pool.query(`UPDATE subscription_plans SET ${updates.join(', ')} WHERE id = $${p}`, values);
    if (!rowCount) return res.status(404).json({ error: 'Plan not found.' });

    const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/subscription-plans/:id - Admin: Delete plan (only if unused)
app.delete('/api/admin/subscription-plans/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const { rows: usage } = await pool.query('SELECT COUNT(*) FROM subscriptions WHERE plan_id = $1', [req.params.id]);
    if (parseInt(usage[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete plan with active subscriptions. Deactivate it instead.' });
    }
    await pool.query('DELETE FROM subscription_plans WHERE id = $1', [req.params.id]);
    res.json({ message: 'Plan deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Promo Code Endpoints ──────────────────────────────────────────────────────

// GET /api/admin/promo-codes - Admin: list all promo codes
app.get('/api/admin/promo-codes', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM promo_codes ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/promo-codes - Admin: create promo code
app.post('/api/admin/promo-codes', requireRole('super_admin'), async (req, res) => {
  try {
    const { code, description, discount_type, discount_value, applicable_plans, max_uses, expires_at, is_active } = req.body || {};
    if (!code || discount_value === undefined) return res.status(400).json({ error: 'code and discount_value required.' });
    const now = new Date().toISOString();
    const { rows } = await pool.query(`
      INSERT INTO promo_codes (code, description, discount_type, discount_value, applicable_plans, max_uses, uses_count, expires_at, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9) RETURNING *
    `, [
      sanitizeStr(code, 50).toUpperCase(),
      sanitizeStr(description || '', 500),
      ['percentage', 'fixed'].includes(discount_type) ? discount_type : 'percentage',
      parseFloat(discount_value) || 0,
      JSON.stringify(Array.isArray(applicable_plans) ? applicable_plans.map(Number) : []),
      parseInt(max_uses) || 0,
      expires_at || null,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      now
    ]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Promo code already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/promo-codes/:id - Admin: update promo code
app.put('/api/admin/promo-codes/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const updates = []; const values = []; let p = 1;
    const { description, discount_type, discount_value, applicable_plans, max_uses, expires_at, is_active } = req.body || {};
    if (description !== undefined) { updates.push(`description = $${p++}`); values.push(sanitizeStr(description, 500)); }
    if (discount_type !== undefined && ['percentage', 'fixed'].includes(discount_type)) { updates.push(`discount_type = $${p++}`); values.push(discount_type); }
    if (discount_value !== undefined) { updates.push(`discount_value = $${p++}`); values.push(parseFloat(discount_value) || 0); }
    if (applicable_plans !== undefined) { updates.push(`applicable_plans = $${p++}`); values.push(JSON.stringify(Array.isArray(applicable_plans) ? applicable_plans.map(Number) : [])); }
    if (max_uses !== undefined) { updates.push(`max_uses = $${p++}`); values.push(parseInt(max_uses) || 0); }
    if (expires_at !== undefined) { updates.push(`expires_at = $${p++}`); values.push(expires_at || null); }
    if (is_active !== undefined) { updates.push(`is_active = $${p++}`); values.push(is_active ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    values.push(req.params.id);
    const { rowCount } = await pool.query(`UPDATE promo_codes SET ${updates.join(', ')} WHERE id = $${p}`, values);
    if (!rowCount) return res.status(404).json({ error: 'Promo code not found.' });
    const { rows } = await pool.query('SELECT * FROM promo_codes WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/promo-codes/:id - Admin: delete promo code
app.delete('/api/admin/promo-codes/:id', requireRole('super_admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM promo_codes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Promo code deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/public/validate-promo - Validate a promo code (no auth)
app.post('/api/public/validate-promo', async (req, res) => {
  try {
    const { code, plan_id } = req.body || {};
    if (!code) return res.json({ valid: false, error: 'Code required.' });
    const { rows } = await pool.query(
      `SELECT * FROM promo_codes WHERE UPPER(code) = UPPER($1) AND is_active = 1`,
      [sanitizeStr(code, 50)]
    );
    if (!rows.length) return res.json({ valid: false, error: 'Invalid promo code.' });
    const promo = rows[0];
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.json({ valid: false, error: 'This promo code has expired.' });
    if (promo.max_uses > 0 && promo.uses_count >= promo.max_uses) return res.json({ valid: false, error: 'This promo code has reached its usage limit.' });
    if (plan_id) {
      const applicablePlans = Array.isArray(promo.applicable_plans) ? promo.applicable_plans : [];
      if (applicablePlans.length > 0 && !applicablePlans.includes(parseInt(plan_id))) {
        return res.json({ valid: false, error: 'This promo code is not valid for the selected plan.' });
      }
    }
    res.json({ valid: true, code: promo.code, discount_type: promo.discount_type, discount_value: promo.discount_value, description: promo.description });
  } catch (err) { res.status(500).json({ valid: false, error: err.message }); }
});

// GET /api/admin/payments - Admin: List all payments across all subscriptions
app.get('/api/admin/payments', requireAuth, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    let where = '';
    const params = [];
    if (status !== 'all') { where = 'WHERE p.status = $1'; params.push(status); }
    const { rows } = await pool.query(`
      SELECT p.*, s.menu_id, m.restaurant_name, sp.display_name as plan_name
      FROM payments p
      JOIN subscriptions s ON p.subscription_id = s.id
      JOIN menus m ON s.menu_id = m.id
      JOIN subscription_plans sp ON s.plan_id = sp.id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT 500
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/admin/payments/:id - Admin: Update payment status
app.put('/api/admin/payments/:id', requireAuth, async (req, res) => {
  try {
    const status = sanitizeStr(req.body.status, 20);
    const notes = sanitizeStr(req.body.notes, 500);
    const now = new Date().toISOString();
    const updates = [];
    const values = [];
    let p = 1;
    if (status) { updates.push(`status = $${p++}`); values.push(status); }
    if (notes !== undefined) { updates.push(`notes = $${p++}`); values.push(notes); }
    if (status === 'completed') { updates.push(`paid_at = $${p++}`); values.push(now); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    values.push(req.params.id);
    await pool.query(`UPDATE payments SET ${updates.join(', ')} WHERE id = $${p}`, values);
    // When completed: activate subscription and advance next_billing_date
    if (status === 'completed') {
      const { rows: pmtRows } = await pool.query(
        `SELECT p.subscription_id, sp.interval
         FROM payments p
         JOIN subscriptions s ON p.subscription_id = s.id
         JOIN subscription_plans sp ON s.plan_id = sp.id
         WHERE p.id = $1`,
        [req.params.id]
      );
      if (pmtRows.length) {
        const { subscription_id, interval } = pmtRows[0];
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + (interval === 'year' ? 365 : 30));
        const nextBillingDate = nextDate.toISOString();
        await pool.query(
          `UPDATE subscriptions SET status = 'active', end_date = $1, next_billing_date = $1, updated_at = $2 WHERE id = $3`,
          [nextBillingDate, now, subscription_id]
        );
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/payments - Admin: Create a new payment record
app.post('/api/admin/payments', requireAuth, async (req, res) => {
  try {
    const subId = parseInt(req.body.subscription_id);
    const amount = parseFloat(req.body.amount);
    const currency = sanitizeStr(req.body.currency, 10) || 'USD';
    const paymentMethod = sanitizeStr(req.body.payment_method, 50) || 'manual';
    const status = sanitizeStr(req.body.status, 20) || 'pending';
    const notes = sanitizeStr(req.body.notes, 500) || '';
    const now = new Date().toISOString();
    if (!subId || isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'subscription_id and valid amount are required.' });
    }
    const { rows: subRows } = await pool.query(
      `SELECT s.id, sp.interval FROM subscriptions s
       JOIN subscription_plans sp ON s.plan_id = sp.id WHERE s.id = $1`,
      [subId]
    );
    if (!subRows.length) return res.status(404).json({ error: 'Subscription not found.' });
    const paidAt = status === 'completed' ? now : null;
    const { rows } = await pool.query(
      `INSERT INTO payments (subscription_id, amount, currency, payment_method, status, paid_at, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [subId, amount, currency, paymentMethod, status, paidAt, notes, now]
    );
    // Activate subscription when payment is immediately completed
    if (status === 'completed') {
      const { interval } = subRows[0];
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + (interval === 'year' ? 365 : 30));
      const nextBillingDate = nextDate.toISOString();
      await pool.query(
        `UPDATE subscriptions SET status = 'active', end_date = $1, next_billing_date = $1, updated_at = $2 WHERE id = $3`,
        [nextBillingDate, now, subId]
      );
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/subscriptions - Admin: List all subscriptions
app.get('/api/subscriptions', requireAuth, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    const where = status === 'all' ? '' : 'WHERE s.status = $1';
    const params = status === 'all' ? [] : [status];
    const { rows } = await pool.query(`
      SELECT 
        s.*,
        sp.display_name as plan_name,
        sp.price as plan_price,
        sp.interval as plan_interval,
        sp.menu_limit,
        sp.location_limit,
        sp.features,
        m.restaurant_name,
        m.email,
        m.total_scans
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      JOIN menus m ON s.menu_id = m.id
      ${where}
      ORDER BY s.created_at DESC
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/subscriptions/:id - Get subscription details
app.get('/api/subscriptions/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        s.*,
        sp.display_name as plan_name,
        sp.price as plan_price,
        sp.interval as plan_interval,
        sp.menu_limit,
        sp.location_limit,
        sp.features,
        m.restaurant_name
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      JOIN menus m ON s.menu_id = m.id
      WHERE s.id = $1
    `, [req.params.id]);
    
    if (!rows.length) return res.status(404).json({ error: 'Subscription not found.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/menus/:id/subscription - Get subscription for a menu
app.get('/api/menus/:id/subscription', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        s.*, 
        sp.display_name as plan_name, 
        sp.price as plan_price,
        sp.menu_limit,
        sp.location_limit,
        sp.features
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE s.menu_id = $1
    `, [req.params.id]);
    
    if (!rows.length) {
      // Auto-assign Starter plan if no subscription exists
      const { rows: starterPlan } = await pool.query(
        "SELECT id FROM subscription_plans WHERE name = 'starter' LIMIT 1"
      );
      
      if (starterPlan.length) {
        const now = new Date().toISOString();
        const { rows: newSub } = await pool.query(`
          INSERT INTO subscriptions (menu_id, plan_id, status, start_date, created_at)
          VALUES ($1, $2, 'active', $3, $3)
          ON CONFLICT (menu_id) DO NOTHING
          RETURNING *
        `, [req.params.id, starterPlan[0].id, now]);
        
        if (newSub.length) {
          const { rows: fullSub } = await pool.query(`
            SELECT 
              s.*, 
              sp.display_name as plan_name, 
              sp.price as plan_price,
              sp.menu_limit,
              sp.location_limit,
              sp.features
            FROM subscriptions s
            JOIN subscription_plans sp ON s.plan_id = sp.id
            WHERE s.id = $1
          `, [newSub[0].id]);
          
          return res.json(fullSub[0]);
        }
      }
      
      return res.status(404).json({ error: 'No subscription found.' });
    }
    
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/subscriptions - Admin: Create subscription
app.post('/api/subscriptions', requireAuth, async (req, res) => {
  try {
    const menuId = sanitizeStr(req.body.menu_id, 100);
    const planId = parseInt(req.body.plan_id) || 0;
    
    if (!menuId || !planId) {
      return res.status(400).json({ error: 'menu_id and plan_id required.' });
    }
    
    // Check if subscription already exists
    const existing = await pool.query('SELECT id FROM subscriptions WHERE menu_id = $1', [menuId]);
    if (existing.rows.length) {
      return res.status(400).json({ error: 'Subscription already exists for this menu.' });
    }
    
    const now = new Date().toISOString();
    const { rows } = await pool.query(`
      INSERT INTO subscriptions (menu_id, plan_id, status, start_date, created_at)
      VALUES ($1, $2, 'active', $3, $3) RETURNING *
    `, [menuId, planId, now]);
    
    // Initialize usage tracking
    await pool.query(`
      INSERT INTO usage_tracking (menu_id, menus_count, locations_count, scans_count, updated_at)
      VALUES ($1, 1, 1, 0, $2)
      ON CONFLICT (menu_id) DO NOTHING
    `, [menuId, now]);
    
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/subscriptions/:id - Admin: Update subscription (upgrade/downgrade)
app.put('/api/subscriptions/:id', requireAuth, async (req, res) => {
  try {
    const subId = req.params.id;
    const planId = parseInt(req.body.plan_id);
    const status = sanitizeStr(req.body.status, 20);
    const cancelAtEnd = req.body.cancel_at_end ? 1 : 0;
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (planId) {
      updates.push(`plan_id = $${paramCount++}`);
      values.push(planId);
    }
    
    if (status) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    
    if (req.body.cancel_at_end !== undefined) {
      updates.push(`cancel_at_end = $${paramCount++}`);
      values.push(cancelAtEnd);
    }
    
    if (req.body.end_date) {
      updates.push(`end_date = $${paramCount++}`);
      values.push(req.body.end_date);
    }
    
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update.' });
    }
    
    updates.push(`updated_at = $${paramCount++}`);
    values.push(new Date().toISOString());
    values.push(subId);
    
    await pool.query(
      `UPDATE subscriptions SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );
    
    // Log payment if plan changed
    if (planId) {
      const { rows: planRows } = await pool.query('SELECT price FROM subscription_plans WHERE id = $1', [planId]);
      if (planRows.length && planRows[0].price > 0) {
        await pool.query(`
          INSERT INTO payments (subscription_id, amount, currency, payment_method, status, created_at)
          VALUES ($1, $2, 'USD', 'upgrade', 'pending', $3)
        `, [subId, planRows[0].price, new Date().toISOString()]);
      }
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/subscriptions/:id - Admin: Cancel subscription
app.delete('/api/subscriptions/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE subscriptions SET status = 'cancelled', cancel_at_end = 1, updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/subscriptions/:id/payments - Get payment history
app.get('/api/subscriptions/:id/payments', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM payments WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/subscriptions/:id/payments - Admin: Record payment
app.post('/api/subscriptions/:id/payments', requireAuth, async (req, res) => {
  try {
    const subId = req.params.id;
    const amount = parseFloat(req.body.amount) || 0;
    const currency = sanitizeStr(req.body.currency, 10) || 'USD';
    const paymentMethod = sanitizeStr(req.body.payment_method, 50) || 'manual';
    const status = sanitizeStr(req.body.status, 20) || 'completed';
    const notes = sanitizeStr(req.body.notes, 500) || '';
    const now = new Date().toISOString();
    
    const { rows } = await pool.query(`
      INSERT INTO payments (subscription_id, amount, currency, payment_method, status, paid_at, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `, [subId, amount, currency, paymentMethod, status, now, notes, now]);
    
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/menus/:id/usage - Get usage stats for a menu
app.get('/api/menus/:id/usage', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM usage_tracking WHERE menu_id = $1
    `, [req.params.id]);
    
    if (!rows.length) {
      // Create initial usage tracking
      const now = new Date().toISOString();
      const { rows: newRows } = await pool.query(`
        INSERT INTO usage_tracking (menu_id, menus_count, locations_count, scans_count, updated_at)
        VALUES ($1, 1, 1, 0, $2) RETURNING *
      `, [req.params.id, now]);
      return res.json(newRows[0]);
    }
    
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Customer Subscription Management ──────────────────────────────────────────

// GET /api/customers/subscriptions - Get customer's subscriptions for all menus
app.get('/api/customers/subscriptions', requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    
    // Get all menus for this customer with their subscriptions
    const { rows } = await pool.query(`
      SELECT 
        m.id as menu_id,
        m.restaurant_name,
        s.id as subscription_id,
        s.status,
        s.start_date,
        s.end_date,
        s.trial_end,
        s.next_billing_date,
        sp.id as plan_id,
        sp.name as plan_name,
        sp.display_name as plan_display_name,
        sp.price as plan_price,
        sp.interval,
        sp.menu_limit,
        sp.location_limit,
        sp.features,
        u.menus_count,
        u.locations_count,
        u.scans_count
      FROM menus m
      LEFT JOIN subscriptions s ON m.id = s.menu_id
      LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
      LEFT JOIN usage_tracking u ON m.id = u.menu_id
      WHERE m.customer_id = $1
      ORDER BY m.created_at DESC
    `, [customerId]);
    
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/customers/payments - Get payment history for the authenticated customer
app.get('/api/customers/payments', requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const { rows } = await pool.query(`
      SELECT p.id, p.amount, p.currency, p.payment_method, p.status, p.paid_at, p.notes, p.created_at,
             s.menu_id, sp.display_name as plan_name, m.restaurant_name
      FROM payments p
      JOIN subscriptions s ON p.subscription_id = s.id
      JOIN menus m ON s.menu_id = m.id
      LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE m.customer_id = $1
      ORDER BY p.created_at DESC
      LIMIT 20
    `, [customerId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/customers/subscription/change - Customer: Change subscription plan
app.post('/api/customers/subscription/change', requireCustomerAuth, requireCustomerOwner, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const menuId = sanitizeStr(req.body.menu_id, 100);
    const planId = parseInt(req.body.plan_id);
    
    if (!menuId || !planId) {
      return res.status(400).json({ error: 'menu_id and plan_id required.' });
    }
    
    // Verify the menu belongs to this customer
    const { rows: menuRows } = await pool.query(
      'SELECT id FROM menus WHERE id = $1 AND customer_id = $2',
      [menuId, customerId]
    );
    
    if (!menuRows.length) {
      return res.status(403).json({ error: 'You do not have permission to modify this menu.' });
    }
    
    // Get the new plan details
    const { rows: planRows } = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = 1',
      [planId]
    );
    
    if (!planRows.length) {
      return res.status(404).json({ error: 'Subscription plan not found.' });
    }
    
    const newPlan = planRows[0];
    const now = new Date().toISOString();
    
    // Check if subscription exists
    const { rows: existingSub } = await pool.query(
      'SELECT id, plan_id FROM subscriptions WHERE menu_id = $1',
      [menuId]
    );
    
    if (existingSub.length) {
      // Update existing subscription
      const subId = existingSub[0].id;
      const oldPlanId = existingSub[0].plan_id;
      
      await pool.query(`
        UPDATE subscriptions 
        SET plan_id = $1, status = 'active', updated_at = $2 
        WHERE id = $3
      `, [planId, now, subId]);
      
      // Log payment if upgrading to paid plan
      if (newPlan.price > 0) {
        await pool.query(`
          INSERT INTO payments (subscription_id, amount, currency, payment_method, status, notes, created_at)
          VALUES ($1, $2, 'USD', 'customer_upgrade', 'pending', $3, $4)
        `, [
          subId,
          newPlan.price,
          `Plan changed from plan_id ${oldPlanId} to ${planId}`,
          now
        ]);
      }
      
      res.json({ 
        success: true, 
        message: 'Subscription updated successfully',
        subscription_id: subId,
        plan: newPlan
      });
    } else {
      // Create new subscription
      const { rows: newSub } = await pool.query(`
        INSERT INTO subscriptions (menu_id, plan_id, status, start_date, created_at)
        VALUES ($1, $2, 'active', $3, $3) RETURNING id
      `, [menuId, planId, now]);
      
      const subId = newSub[0].id;
      
      // Initialize usage tracking
      await pool.query(`
        INSERT INTO usage_tracking (menu_id, menus_count, locations_count, scans_count, updated_at)
        VALUES ($1, 1, 1, 0, $2)
        ON CONFLICT (menu_id) DO NOTHING
      `, [menuId, now]);
      
      // Log payment if it's a paid plan
      if (newPlan.price > 0) {
        await pool.query(`
          INSERT INTO payments (subscription_id, amount, currency, payment_method, status, notes, created_at)
          VALUES ($1, $2, 'USD', 'customer_signup', 'pending', 'New subscription', $3)
        `, [subId, newPlan.price, now]);
      }
      
      res.json({ 
        success: true, 
        message: 'Subscription created successfully',
        subscription_id: subId,
        plan: newPlan
      });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/customers/subscription/cancel - Customer: Cancel subscription
app.post('/api/customers/subscription/cancel', requireCustomerAuth, requireCustomerOwner, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const menuId = sanitizeStr(req.body.menu_id, 100);
    
    if (!menuId) {
      return res.status(400).json({ error: 'menu_id required.' });
    }
    
    // Verify the menu belongs to this customer
    const { rows: menuRows } = await pool.query(
      'SELECT id FROM menus WHERE id = $1 AND customer_id = $2',
      [menuId, customerId]
    );
    
    if (!menuRows.length) {
      return res.status(403).json({ error: 'You do not have permission to modify this menu.' });
    }
    
    // Get subscription
    const { rows: subRows } = await pool.query(
      'SELECT id, plan_id FROM subscriptions WHERE menu_id = $1',
      [menuId]
    );
    
    if (!subRows.length) {
      return res.status(404).json({ error: 'No subscription found.' });
    }
    
    const now = new Date().toISOString();
    
    // Set to cancel at end of period (downgrade to starter)
    const { rows: starterPlan } = await pool.query(
      "SELECT id FROM subscription_plans WHERE name = 'starter' LIMIT 1"
    );
    
    if (starterPlan.length) {
      await pool.query(`
        UPDATE subscriptions 
        SET plan_id = $1, cancel_at_end = 1, updated_at = $2 
        WHERE id = $3
      `, [starterPlan[0].id, now, subRows[0].id]);
      
      res.json({ 
        success: true, 
        message: 'Subscription will be downgraded to Starter (Free) plan.'
      });
    } else {
      res.status(500).json({ error: 'Unable to process cancellation.' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Payment Gateway Integration ───────────────────────────────────────────────

// Helper: load a gateway's config from settings
async function getGatewayConfig(name) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [`integration_${name}`]);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
}

// Helper: activate subscription after a confirmed payment
async function activateSubscriptionPayment(menuId, planId, amount, currency, method, paymentRef, notes) {
  const { rows: planRows } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
  if (!planRows.length) throw new Error('Plan not found');
  const plan = planRows[0];

  const now = new Date();
  const billing = new Date(now);
  if ((plan.interval || 'month') === 'year') billing.setFullYear(billing.getFullYear() + 1);
  else billing.setMonth(billing.getMonth() + 1);
  const billingISO = billing.toISOString();
  const nowISO = now.toISOString();

  const { rows: existing } = await pool.query('SELECT id FROM subscriptions WHERE menu_id = $1', [menuId]);
  let subId;
  if (existing.length) {
    subId = existing[0].id;
    await pool.query(
      `UPDATE subscriptions SET plan_id=$1, status='active', end_date=$2, next_billing_date=$2, updated_at=$3 WHERE id=$4`,
      [planId, billingISO, nowISO, subId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO subscriptions (menu_id, plan_id, status, start_date, end_date, next_billing_date, created_at, updated_at) VALUES ($1,$2,'active',$3,$4,$4,$3,$3) RETURNING id`,
      [menuId, planId, nowISO, billingISO]
    );
    subId = ins.rows[0].id;
    await pool.query(
      `INSERT INTO usage_tracking (menu_id, menus_count, locations_count, scans_count, updated_at) VALUES ($1,1,1,0,$2) ON CONFLICT (menu_id) DO NOTHING`,
      [menuId, nowISO]
    );
  }

  await pool.query(
    `INSERT INTO payments (subscription_id, amount, currency, payment_method, payment_id, status, paid_at, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$6)`,
    [subId, amount, currency || 'USD', method, paymentRef, nowISO, notes || '']
  );
  return subId;
}

// GET /api/public/plans – All active subscription plans (no auth required)
app.get('/api/public/plans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, display_name, price, annual_price, interval, menu_limit, location_limit, features, sort_order
       FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order ASC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// East African country codes for gateway routing
const EA_COUNTRIES = new Set(['KE','TZ','UG','RW','BI','ET','SO','SS','ER','DJ','SD']);

// GET /api/payments/gateways – Public keys for enabled payment gateways
// Returns ALL enabled gateways so checkout always shows available options
app.get('/api/payments/gateways', async (req, res) => {  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('integration_flutterwave','integration_paypal','integration_clickpesa','integration_bank_transfer')"
    );
    const gateways = {};
    for (const r of rows) {
      try {
        const cfg = JSON.parse(r.value);
        if (!cfg.enabled) continue;
        const name = r.key.replace('integration_', '');
        // Only expose public-facing keys – never secret keys
        if (name === 'flutterwave') gateways.flutterwave = { public_key: cfg.public_key, environment: cfg.environment || 'live' };
        if (name === 'paypal')      gateways.paypal      = { client_id: cfg.client_id,   environment: cfg.environment || 'live' };
        if (name === 'clickpesa')   gateways.clickpesa   = { merchant_id: cfg.merchant_id, environment: cfg.environment || 'live' };
        if (name === 'bank_transfer') gateways.bank_transfer = { bank_name: cfg.bank_name, account_name: cfg.account_name, account_number: cfg.account_number, swift_code: cfg.swift_code, routing_number: cfg.routing_number, instructions: cfg.instructions };
      } catch(e) { /* skip malformed */ }
    }
    res.json(gateways);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/flutterwave/verify – Verify a Flutterwave transaction + activate subscription
app.post('/api/payments/flutterwave/verify', requireCustomerAuth, async (req, res) => {
  const { transaction_id, menu_id, plan_id } = req.body;
  if (!transaction_id || !menu_id || !plan_id)
    return res.status(400).json({ error: 'transaction_id, menu_id, plan_id required.' });

  const customerId = req.customer.id;
  const { rows: menuRows } = await pool.query('SELECT id FROM menus WHERE id=$1 AND customer_id=$2', [menu_id, customerId]);
  if (!menuRows.length) return res.status(403).json({ error: 'Unauthorized.' });

  try {
    const cfg = await getGatewayConfig('flutterwave');
    if (!cfg?.enabled || !cfg.secret_key) return res.status(400).json({ error: 'Flutterwave not configured.' });

    // Idempotency: reject duplicate transaction IDs
    const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [String(transaction_id)]);
    if (dup.length) return res.status(409).json({ error: 'Transaction already processed.' });

    const verifyRes = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transaction_id)}/verify`, {
      headers: { Authorization: `Bearer ${cfg.secret_key}`, 'Content-Type': 'application/json' }
    });
    const vd = await verifyRes.json();

    if (vd.status !== 'success' || vd.data?.status !== 'successful')
      return res.status(400).json({ error: 'Payment not successful.', detail: vd.message });

    const subId = await activateSubscriptionPayment(
      menu_id, parseInt(plan_id),
      vd.data.amount, vd.data.currency,
      'flutterwave', String(transaction_id),
      `Flutterwave tx ${transaction_id}`
    );
    res.json({ success: true, subscription_id: subId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/paypal/create-order – Create a PayPal order for a plan
app.post('/api/payments/paypal/create-order', requireCustomerAuth, async (req, res) => {
  const { plan_id, menu_id } = req.body;
  if (!plan_id || !menu_id) return res.status(400).json({ error: 'plan_id and menu_id required.' });

  const customerId = req.customer.id;
  const { rows: menuRows } = await pool.query('SELECT id FROM menus WHERE id=$1 AND customer_id=$2', [menu_id, customerId]);
  if (!menuRows.length) return res.status(403).json({ error: 'Unauthorized.' });

  try {
    const cfg = await getGatewayConfig('paypal');
    if (!cfg?.enabled || !cfg.client_id || !cfg.client_secret) return res.status(400).json({ error: 'PayPal not configured.' });

    const { rows: planRows } = await pool.query('SELECT * FROM subscription_plans WHERE id=$1', [plan_id]);
    if (!planRows.length) return res.status(404).json({ error: 'Plan not found.' });
    const plan = planRows[0];

    const base = cfg.environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(500).json({ error: 'PayPal auth failed.' });

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: Number(plan.price).toFixed(2) },
          description: `${plan.display_name} Plan – RestOrder`,
          custom_id: `${menu_id}:${plan_id}`
        }]
      })
    });
    const orderData = await orderRes.json();
    if (!orderData.id) return res.status(500).json({ error: 'Failed to create PayPal order.', detail: orderData });

    res.json({ order_id: orderData.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/paypal/capture-order – Capture approved PayPal order + activate subscription
app.post('/api/payments/paypal/capture-order', requireCustomerAuth, async (req, res) => {
  const { order_id, menu_id, plan_id } = req.body;
  if (!order_id || !menu_id || !plan_id) return res.status(400).json({ error: 'order_id, menu_id, plan_id required.' });

  const customerId = req.customer.id;
  const { rows: menuRows } = await pool.query('SELECT id FROM menus WHERE id=$1 AND customer_id=$2', [menu_id, customerId]);
  if (!menuRows.length) return res.status(403).json({ error: 'Unauthorized.' });

  try {
    const cfg = await getGatewayConfig('paypal');
    if (!cfg?.enabled || !cfg.client_id || !cfg.client_secret) return res.status(400).json({ error: 'PayPal not configured.' });

    const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [order_id]);
    if (dup.length) return res.status(409).json({ error: 'Order already captured.' });

    const base = cfg.environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(500).json({ error: 'PayPal auth failed.' });

    const captureRes = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(order_id)}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
    });
    const captureData = await captureRes.json();
    if (captureData.status !== 'COMPLETED') return res.status(400).json({ error: 'Capture failed.', detail: captureData });

    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
    const amount   = parseFloat(capture?.amount?.value || '0');
    const currency = capture?.amount?.currency_code || 'USD';

    const subId = await activateSubscriptionPayment(
      menu_id, parseInt(plan_id), amount, currency,
      'paypal', order_id, `PayPal order ${order_id}`
    );
    res.json({ success: true, subscription_id: subId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /webhooks/flutterwave – Flutterwave async payment webhook
app.post('/webhooks/flutterwave', express.json(), async (req, res) => {
  // Always respond 200 quickly to satisfy webhook retries
  res.json({ status: 'ok' });
  try {
    const cfg = await getGatewayConfig('flutterwave');
    if (!cfg?.enabled) return;

    // Verify webhook hash if configured
    const hash = req.headers['verif-hash'];
    if (cfg.webhook_secret && hash !== cfg.webhook_secret) return;

    const { event, data } = req.body || {};
    if (event === 'charge.completed' && data?.status === 'successful') {
      const { tx_ref, id: txId } = data;
      // tx_ref format written by the client: menuId:planId:timestamp
      const parts = String(tx_ref || '').split(':');
      if (parts.length >= 2) {
        const [menu_id, plan_id] = parts;
        const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [String(txId)]);
        if (!dup.length) {
          await activateSubscriptionPayment(menu_id, parseInt(plan_id), data.amount, data.currency, 'flutterwave', String(txId), `Webhook FW tx ${txId}`);
        }
      }
    }
  } catch(e) { /* silent – already responded 200 */ }
});

// POST /api/payments/clickpesa/create-order-public – Initiate a ClickPesa payment request
app.post('/api/payments/clickpesa/create-order-public', express.json(), async (req, res) => {
  try {
    const cfg = await getGatewayConfig('clickpesa');
    if (!cfg?.enabled || !cfg.api_key) return res.status(400).json({ error: 'ClickPesa not configured.' });

    const { plan_id, promo_code, email, name } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'plan_id required.' });

    // Resolve plan price
    const { rows: planRows } = await pool.query('SELECT id, price, display_name FROM subscription_plans WHERE id=$1', [plan_id]);
    if (!planRows.length) return res.status(400).json({ error: 'Plan not found.' });
    let amount = parseFloat(planRows[0].price);

    // Apply promo if provided
    if (promo_code) {
      const { rows: promoRows } = await pool.query(
        "SELECT * FROM promo_codes WHERE UPPER(code)=$1 AND active=true AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR current_uses < max_uses)",
        [String(promo_code).toUpperCase()]
      );
      if (promoRows.length) {
        const p = promoRows[0];
        amount = p.discount_type === 'percentage' ? amount * (1 - p.discount_value / 100) : Math.max(0, amount - p.discount_value);
      }
    }
    amount = Math.max(0, parseFloat(amount.toFixed(2)));

    const reference = `${Date.now()}:${plan_id}:${Date.now()}`;
    const cpBase = cfg.environment === 'sandbox' ? 'https://sandbox.clickpesa.com' : 'https://api.clickpesa.com';

    const cpRes = await fetch(`${cpBase}/v1/payment-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.api_key}` },
      body: JSON.stringify({
        merchant_id: cfg.merchant_id,
        amount: amount,
        currency: 'USD',
        reference: reference,
        description: `RestOrder ${planRows[0].display_name} Plan`,
        callback_url: cfg.callback_url || `${req.protocol}://${req.get('host')}/webhooks/clickpesa`,
        customer_email: email || '',
        customer_name: name || ''
      })
    });
    const cpData = await cpRes.json();

    if (cpData.redirect_url || cpData.payment_url) {
      res.json({ redirect_url: cpData.redirect_url || cpData.payment_url, reference: reference });
    } else if (cpData.reference || cpData.id) {
      res.json({ reference: cpData.reference || cpData.id || reference });
    } else {
      res.json({ reference: reference, message: 'Payment request created. Complete via ClickPesa.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to initiate ClickPesa payment.' });
  }
});

// POST /webhooks/clickpesa – ClickPesa async payment webhook
app.post('/webhooks/clickpesa', express.json(), async (req, res) => {
  res.json({ status: 'ok' });
  try {
    const cfg = await getGatewayConfig('clickpesa');
    if (!cfg?.enabled) return;

    const { reference, status, amount, currency } = req.body || {};
    if (status === 'COMPLETED' && reference) {
      // reference format: menuId:planId:timestamp
      const parts = String(reference || '').split(':');
      if (parts.length >= 2) {
        const [menu_id, plan_id] = parts;
        const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [String(reference)]);
        if (!dup.length) {
          await activateSubscriptionPayment(menu_id, parseInt(plan_id), parseFloat(amount) || 0, currency || 'USD', 'clickpesa', String(reference), `Webhook ClickPesa ref ${reference}`);
        }
      }
    }
  } catch(e) { /* silent – already responded 200 */ }
});

// POST /webhooks/paypal – PayPal IPN / Webhook notification
app.post('/webhooks/paypal', express.json(), async (req, res) => {
  res.json({ status: 'ok' });
  try {
    const cfg = await getGatewayConfig('paypal');
    if (!cfg?.enabled) return;

    const eventType = req.body?.event_type;
    const resource = req.body?.resource;

    // Verify webhook signature if webhook_id is configured
    if (cfg.webhook_id) {
      const ppBase = cfg.environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const authRes = await fetch(`${ppBase}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64') },
        body: 'grant_type=client_credentials'
      });
      const authData = await authRes.json();
      if (authData.access_token) {
        const verifyRes = await fetch(`${ppBase}/v1/notifications/verify-webhook-signature`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authData.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_algo: req.headers['paypal-auth-algo'],
            cert_url: req.headers['paypal-cert-url'],
            transmission_id: req.headers['paypal-transmission-id'],
            transmission_sig: req.headers['paypal-transmission-sig'],
            transmission_time: req.headers['paypal-transmission-time'],
            webhook_id: cfg.webhook_id,
            webhook_event: req.body
          })
        });
        const verifyData = await verifyRes.json();
        if (verifyData.verification_status !== 'SUCCESS') return;
      }
    }

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' && resource) {
      const orderId = resource.supplementary_data?.related_ids?.order_id || resource.id;
      const amount = parseFloat(resource.amount?.value || '0');
      const currency = resource.amount?.currency_code || 'USD';
      const customId = resource.custom_id || '';
      // custom_id format: menuId:planId
      const parts = String(customId).split(':');
      if (parts.length >= 2) {
        const [menu_id, plan_id] = parts;
        const { rows: dup } = await pool.query('SELECT id FROM payments WHERE payment_id=$1', [String(orderId)]);
        if (!dup.length) {
          await activateSubscriptionPayment(menu_id, parseInt(plan_id), amount, currency, 'paypal', String(orderId), `Webhook PayPal order ${orderId}`);
        }
      }
    }
  } catch(e) { /* silent – already responded 200 */ }
});

// ── Staff Management ──────────────────────────────────────────────────────────

// POST /api/staff/login – Staff member login
app.post('/api/staff/login', loginLimiter, doubleCsrfProtection, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Invalid email address.' });

    const { rows } = await pool.query(
      `SELECT sm.*, sm.customer_id AS owner_id
       FROM staff_members sm
       WHERE sm.email = $1`,
      [cleanEmail]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });

    const staff = rows[0];
    if (staff.status !== 'active') {
      return res.status(401).json({ error: 'Your account has been disabled. Contact your manager.' });
    }

    const match = await bcrypt.compare(password, staff.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = await createStaffSession(staff.id, staff.email, staff.name, staff.role, staff.customer_id);

    res.cookie('customerToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: SESSION_TTL,
    });

    res.json({
      token,
      staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
      redirectTo: staff.role === 'manager' ? '/menu-editor' : '/staff-panel',
      expiresIn: SESSION_TTL,
    });
  } catch (err) {
    console.error('Staff login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff – List staff for the authenticated business owner
app.get('/api/staff', requireCustomerAuth, requireCustomerOwner, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, status, created_at FROM staff_members WHERE customer_id = $1 ORDER BY created_at ASC',
      [req.customer.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/staff – Create a staff member (owner only)
app.post('/api/staff', requireCustomerAuth, requireCustomerOwner, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (!['manager', 'waiter', 'cashier'].includes(role)) {
      return res.status(400).json({ error: 'Role must be manager, waiter, or cashier.' });
    }
    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Invalid email address.' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const cleanName = sanitizeInput(name, 200);

    // Check staff limit
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) FROM staff_members WHERE customer_id = $1', [req.customer.id]
    );
    if (parseInt(countRows[0].count) >= 50) {
      return res.status(400).json({ error: 'Staff limit reached (50 members maximum).' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();

    const { rows } = await pool.query(
      `INSERT INTO staff_members (customer_id, name, email, password_hash, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)
       RETURNING id, name, email, role, status, created_at`,
      [req.customer.id, cleanName, cleanEmail, passwordHash, role, now]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'An account with this email already exists.' });
    console.error('Create staff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/staff/:id – Update a staff member (owner only)
app.put('/api/staff/:id', requireCustomerAuth, requireCustomerOwner, async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);
    const { name, role, status, password } = req.body || {};

    const { rows: owned } = await pool.query(
      'SELECT id FROM staff_members WHERE id = $1 AND customer_id = $2',
      [staffId, req.customer.id]
    );
    if (!owned.length) return res.status(403).json({ error: 'Staff member not found.' });

    const updates = []; const values = []; let p = 1;
    if (name)   { updates.push(`name = $${p++}`);   values.push(sanitizeInput(name, 200)); }
    if (role   && ['manager','waiter','cashier'].includes(role))   { updates.push(`role = $${p++}`);   values.push(role); }
    if (status && ['active','disabled'].includes(status)) { updates.push(`status = $${p++}`); values.push(status); }
    if (password) {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      updates.push(`password_hash = $${p++}`);
      values.push(await bcrypt.hash(password, 12));
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

    updates.push(`updated_at = $${p++}`);
    values.push(new Date().toISOString());
    values.push(staffId);

    const { rows } = await pool.query(
      `UPDATE staff_members SET ${updates.join(', ')} WHERE id = $${p} RETURNING id, name, email, role, status, created_at, updated_at`,
      values
    );

    // Invalidate sessions immediately when staff is disabled
    if (status === 'disabled') {
      for (const [token, sess] of customerSessions.entries()) {
        if (sess.isStaff && sess.staffId === staffId) customerSessions.delete(token);
      }
      await pool.query('DELETE FROM customer_sessions WHERE staff_id = $1', [staffId]);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update staff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/staff/:id – Remove a staff member (owner only)
app.delete('/api/staff/:id', requireCustomerAuth, requireCustomerOwner, async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);

    const { rows: owned } = await pool.query(
      'SELECT id FROM staff_members WHERE id = $1 AND customer_id = $2',
      [staffId, req.customer.id]
    );
    if (!owned.length) return res.status(403).json({ error: 'Staff member not found.' });

    // Invalidate all active sessions for this staff member
    for (const [token, sess] of customerSessions.entries()) {
      if (sess.isStaff && sess.staffId === staffId) customerSessions.delete(token);
    }

    await pool.query('DELETE FROM staff_members WHERE id = $1', [staffId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete staff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Customer menu list (customer-scoped) ────────────────────────────────────
// GET /api/customer/menus – List menus belonging to the authenticated customer
app.get('/api/customer/menus', requireCustomerAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.restaurant_name, m.currency, m.qr_code, m.qr_version,
              m.total_scans, m.last_scan_at, m.created_at, m.updated_at,
              COUNT(mi.id)::int AS item_count
       FROM menus m
       LEFT JOIN menu_items mi ON mi.menu_id = m.id
       WHERE m.customer_id = $1
       GROUP BY m.id
       ORDER BY m.created_at DESC`,
      [req.customer.id]
    );
    res.json(rows.map(r => ({
      id:             r.id,
      restaurantName: r.restaurant_name,
      itemCount:      r.item_count || 0,
      createdAt:      r.created_at,
      totalScans:     r.total_scans || 0,
      qrVersion:      r.qr_version || 1,
      lastScanAt:     r.last_scan_at || null,
      qrDataUrl:      r.qr_code || '',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Settings API ────────────────────────────────────────────────────────────
// GET /api/admin/settings – All settings (secrets masked for non-super_admin)
app.get('/api/admin/settings', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM app_settings ORDER BY key');
    const out = {};
    const isSA = req.adminUser?.role === 'super_admin';
    const SECRET_FIELDS = new Set(['api_secret','secret_key','encryption_key','client_secret','pass','secret']);
    for (const row of rows) {
      let val; try { val = JSON.parse(row.value); } catch(e) { val = row.value; }
      if (!isSA && val && typeof val === 'object') {
        val = {...val};
        for (const f of SECRET_FIELDS) { if (f in val && val[f]) val[f] = '••••••••'; }
      }
      out[row.key] = val;
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/admin/settings – Update settings (super_admin only)
app.put('/api/admin/settings', requireRole('super_admin'), async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid payload.' });
    const now = new Date().toISOString();
    const updatedBy = req.adminUser?.email || 'unknown';
    const ALLOWED_KEY = /^[a-zA-Z0-9_]{1,60}$/;
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_KEY.test(key)) continue;
      if (value === '[UNCHANGED]') continue;
      const stored = typeof value === 'object' ? JSON.stringify(value) : String(value).slice(0, 4000);
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=$3, updated_by=$4`,
        [key, stored, now, updatedBy]
      );
    }
    // Re-initialize Firebase Admin SDK if its settings were updated
    if ('integration_firebase' in updates) {
      reinitFirebaseAdmin().catch(e => console.warn('Firebase reinit error:', e.message));
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/currency – Public: currency config for customer-facing pages
app.get('/api/settings/currency', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('default_currency','currency_geo_detect')"
    );
    const result = { default_currency: 'USD', currency_geo_detect: true };
    for (const r of rows) {
      if (r.key === 'default_currency') result.default_currency = r.value;
      if (r.key === 'currency_geo_detect') result.currency_geo_detect = r.value === 'true';
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API 404 handler ───────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// ── Global error handler (returns JSON for /api routes) ───────────────────────
app.use((err, req, res, next) => {
  if (req.path.startsWith('/api')) {
    const status = err.status || err.statusCode || 500;
    // csrf-csrf throws with code 'EBADCSRFTOKEN' or name 'ForbiddenError'
    if (err.code === 'EBADCSRFTOKEN' || err.name === 'ForbiddenError' || status === 403) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token. Please refresh the page and try again.' });
    }
    console.error('API error:', err);
    return res.status(status).json({ error: err.message || 'Internal server error.' });
  }
  next(err);
});

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  await initDB();
  await loadCustomerSessionsFromDB();
  app.listen(PORT, () => {
    console.log(`\n  MenuAdmin MVP running at http://localhost:${PORT}`);
    console.log(`  Admin panel   : http://localhost:${PORT}/admin.html`);
    console.log(`  Customer menu : http://localhost:${PORT}/menu.html?id=<menuId>`);
    console.log(`  Database      : PostgreSQL (${process.env.DATABASE_URL ? 'connected' : 'no DATABASE_URL'})\n`);
  });
})();
