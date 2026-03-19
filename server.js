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

// In-memory session store: token → { createdAt }
// Good enough for a single-process app; swap for Redis in multi-instance deploys.
const sessions = new Map();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(token); return false; }
  return true;
}

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
      scriptSrc:     ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'unsafe-inline'"],   // allow onclick/oninput/onchange handlers
      styleSrc:      ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:        ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc:    ["'self'"],
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
  const token = req.headers['x-admin-token'] || req.cookies?.adminToken;
  if (isValidSession(token)) return next();
  res.status(401).json({ error: 'Unauthorised. Please log in.' });
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

const pool = new Pool({
  connectionString: _pgConnStr,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: { rejectUnauthorized: false },
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

    console.log('  ✓ PostgreSQL schema ready');
  } finally {
    client.release();
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
       qr_version, qr_code, total_scans, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
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
        (id, menu_id, name, category, price, description, tags, size, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          String(item.id || crypto.randomUUID()),
          String(menuId),
          String(item.name),
          String(item.category || 'General'),
          Number(item.price || 0),
          String(item.description || ''),
          JSON.stringify(tags),
          String(item.size || ''),
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
      updated_at=$26
      WHERE id=$27`,
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
        new Date().toISOString(),
        String(menuId)
      ]);

    await client.query('DELETE FROM menu_items WHERE menu_id=$1', [menuId]);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tags = Array.isArray(item.tags) ? item.tags : [];
      await client.query(`INSERT INTO menu_items
        (id, menu_id, name, category, price, description, tags, size, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          String(item.id || crypto.randomUUID()),
          String(menuId),
          String(item.name),
          String(item.category || 'General'),
          Number(item.price || 0),
          String(item.description || ''),
          JSON.stringify(tags),
          String(item.size || ''),
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
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Static routes ──────────────────────────────────────────────────────────────

// Health check endpoint for deployment platforms
app.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: '1.11.0'
  });
});

// GET /  – serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Auth routes ────────────────────────────────────────────────────────────────

// POST /api/auth/login  { secret } → { token }
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { secret } = req.body || {};
  console.log('🔐 Login attempt:', {
    hasSecret: !!secret,
    secretType: typeof secret,
    secretLength: secret?.length || 0,
    hasAdminHash: !!ADMIN_SECRET_HASH,
    adminHashLength: ADMIN_SECRET_HASH.length,
    adminHashPrefix: ADMIN_SECRET_HASH.substring(0, 10)
  });
  
  if (!secret || typeof secret !== 'string') {
    console.log('❌ Login failed: No secret provided');
    return res.status(400).json({ error: 'Password is required.' });
  }
  
  // bcrypt.compare is constant-time and resistant to timing attacks
  const match = ADMIN_SECRET_HASH
    ? await bcrypt.compare(secret, ADMIN_SECRET_HASH)
    : false;
    
  console.log('🔍 Bcrypt comparison result:', match);
  
  if (!match) {
    console.log('❌ Login failed: Password mismatch');
    return res.status(401).json({ error: 'Invalid password.' });
  }
  
  console.log('✅ Login successful');
  const token = createSession();
  res.json({ token, expiresIn: SESSION_TTL });
});

// POST /api/auth/logout  – invalidate current session token
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// GET /api/auth/check  – verify token is still valid (used by UI on page load)
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-admin-token'];
  res.json({ authenticated: isValidSession(token) });
});

// POST /api/auth/change-password  – change the admin password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const match = await bcrypt.compare(currentPassword, ADMIN_SECRET_HASH);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  ADMIN_SECRET_HASH = newHash;

  // Persist the new hash to .env
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (/^ADMIN_SECRET_HASH=.*/m.test(envContent)) {
      envContent = envContent.replace(/^ADMIN_SECRET_HASH=.*/m, 'ADMIN_SECRET_HASH=' + newHash);
    } else {
      envContent += (envContent.endsWith('\n') ? '' : '\n') + 'ADMIN_SECRET_HASH=' + newHash + '\n';
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (err) {
    console.error('⚠ Could not update .env file:', err.message);
    // Hash is still updated in memory, so the change is effective until restart
  }

  // Invalidate all existing sessions so the user must re-login with the new password
  sessions.clear();

  res.json({ ok: true });
});

// GET /api/health  – health check for containers/monitoring
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      version: require('./package.json').version 
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

          const catRaw      = get(row, 'category', 'cat', 'section', 'type', 'course', 'group', 'subcategory');
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
    const CAT_KEYS   = ['category','cat','section','type','course','group',
                         'subcategory','sub category','sub-category','division'];
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
      let colMap    = { name: -1, category: -1, price: -1, description: -1, tags: -1, size: -1 };

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

        const catRaw   = colMap.category    >= 0 ? row[colMap.category]    : '';
        const priceRaw = colMap.price       >= 0 ? row[colMap.price]       : '';
        const descRaw  = colMap.description >= 0 ? row[colMap.description] : '';
        const tagsRaw  = colMap.tags        >= 0 ? row[colMap.tags]        : '';
        const sizeRaw  = colMap.size        >= 0 ? row[colMap.size]        : '';

        const price = parseFloat((priceRaw || '0').replace(/[^0-9.]/g, '')) || 0;
        rawPrices.push(priceRaw);

        items.push({
          id:          crypto.randomUUID(),
          name:        nameVal,
          category:    catRaw ? toTitleCase(catRaw) : currentCategory,
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
    brandColor, logoUrl, tagline, fontStyle, bgStyle,
    showLogo, showName, headerLayout,
    textColor, headingColor, bgColor, cardBg, priceColor,
  } = body || {};

  // logoUrl: allow empty string or a data: URI (base64 image) up to ~10 MB encoded
  const rawLogo = sanitizeStr(logoUrl, 14_000_000); // ~10 MB base64
  const safeLogoUrl = (!rawLogo || rawLogo.startsWith('data:image/') || rawLogo.startsWith('/uploads/'))
    ? rawLogo : '';

  return {
    brandColor:   sanitizeColor(brandColor, '#2dd4bf'),
    logoUrl:      safeLogoUrl,
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
  };
}

/** Sanitize a single menu item from user input */
function sanitizeItem(it) {
  return {
    id:          sanitizeStr(it.id, 36) || crypto.randomUUID(),
    name:        sanitizeStr(it.name, 200),
    category:    sanitizeStr(it.category, 100) || 'General',
    price:       Math.max(0, parseFloat(it.price) || 0),
    description: sanitizeStr(it.description, 500),
    tags:        Array.isArray(it.tags) ? it.tags.map(t => sanitizeStr(t, 50)).filter(Boolean).slice(0, 20) : [],
    size:        sanitizeStr(it.size, 100),
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
app.post('/api/upload', requireAuth, upload.single('menuFile'), async (req, res) => {
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
app.post('/api/menus', requireAuth, async (req, res) => {
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

    const menuUrl = `${HOST}/menu.html?id=${menuId}&v=1`;

    res.json({ menuId, menuUrl, qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/menus  – list all saved menus
app.get('/api/menus', async (_req, res) => {
  const start = performance.now();
  
  try {
    const rows = await dbListMenus();
    const responseTime = performance.now() - start;
    
    if (responseTime > 50) {
      console.log(`⚡ Slow query - getAllMenus: ${responseTime.toFixed(2)}ms`);
    }
    
    res.setHeader('Cache-Control', 'public, max-age=300');
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
      return res.status(404).json({ error: 'Menu not found.' });
    }
    
    const rawItems = await dbGetItems(id);
    const responseTime = performance.now() - start;
    
    if (responseTime > 100) {
      console.log(`⚡ Slow menu query for ${id}: ${responseTime.toFixed(2)}ms`);
    }
    
    const menuData = {
      id:             menu.id,
      restaurantName: menu.restaurant_name,
      currency:       menu.currency || 'USD',
      brandColor:     menu.brand_color || '#2dd4bf',
      logoUrl:        menu.logo_url || '',
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
    createdAt:      menu.created_at,
    items: rawItems.map(it => ({
      id:          it.id,
      name:        it.name,
      category:    it.category,
      price:       it.price,
      description: it.description,
      tags:        JSON.parse(it.tags || '[]'),
      size:        it.size || '',
    }))
    };
    
    // Cache the result
    setCachedMenu(id, menuData);
    
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minute cache
    res.json(menuData);
    
  } catch (error) {
    console.error(`❌ Error fetching menu ${id}:`, error);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

// PUT /api/menus/:id  – update an existing menu (items + branding)
app.put('/api/menus/:id', requireAuth, async (req, res) => {
  try {
    const menu = await dbGetMenu(req.params.id);
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });

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
app.delete('/api/menus/:id', requireAuth, async (req, res) => {
  const menu = await dbGetMenu(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found.' });
  await pool.query('DELETE FROM menus WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/menus/:id/analytics - Get scan analytics for a menu
app.get('/api/menus/:id/analytics', requireAuth, async (req, res) => {
  try {
    const menuId = req.params.id;
    const menu = await dbGetMenu(menuId);
    
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    
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
app.post('/api/menus/:id/regenerate-qr', requireAuth, async (req, res) => {
  try {
    const menuId = req.params.id;
    const menu = await dbGetMenu(menuId);
    
    if (!menu) return res.status(404).json({ error: 'Menu not found.' });
    
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

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`\n  MenuAdmin MVP running at http://localhost:${PORT}`);
    console.log(`  Admin panel   : http://localhost:${PORT}/admin.html`);
    console.log(`  Customer menu : http://localhost:${PORT}/menu.html?id=<menuId>`);
    console.log(`  Database      : PostgreSQL (${process.env.DATABASE_URL ? 'connected' : 'no DATABASE_URL'})\n`);
  });
})();
