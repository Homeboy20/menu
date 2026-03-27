# RestOrder — Restaurant Digital Menu SaaS

A full-featured digital menu SaaS platform for restaurants. QR-code access, mobile-first customer experience, multi-tenant admin dashboard, subscription billing, and Firebase authentication.

## ✨ What's New (v1.54.42)

- **🔥 Firebase Integration** — Admin can configure Firebase (Google Sign-In + Phone OTP) entirely from the Settings dashboard. Paste the Firebase config script to auto-populate all SDK fields. No server restart needed for public SDK changes.
- **📱 Mobile Menu UI** — App-style category icon boxes, "Categories" / "Menu" section headings, compact card layout on mobile (≤480px).
- **🧭 Floating Bottom Nav** — Pill-shaped floating navigation bar with frosted glass, spring entrance animation, sliding active-tab blob, and icon pop animation.
- **🖼️ Cover Banner Upload** — Admins can upload or paste a URL for a full-width banner image shown at the top of the customer menu.

---

## 🌟 Features

### Customer Experience
- **Mobile-First Menu** — App-style UI with square category icons, floating nav, and smooth sheet-based modals
- **Light / Dark Theme** — Persisted per-device with smooth transitions
- **Search & Filter** — Real-time search, category tabs, subcategory pills
- **Cart & Ordering** — Inline quantity controls, cart sheet, WhatsApp order dispatch
- **Item Ratings** — Tap-to-rate stars per item, averaged server-side
- **Multi-Currency** — 30+ currencies including African & Middle Eastern markets
- **QR Code Access** — Scan and view any menu instantly
- **Table Mode** — Table label + "Call Waiter" button via URL param

### Authentication
- **Customer Accounts** — Email/password registration + login
- **Firebase Google Sign-In** — One-tap Google authentication on login & register
- **Firebase Phone OTP** — SMS verification via Firebase Auth
- **Admin Login** — Bcrypt-hashed passwords, JWT sessions, role-based access (admin / super_admin)
- **Login Security** — Rate limiting, account lockout after failed attempts

### Admin Dashboard
- **Multi-Tenant** — Each restaurant has isolated menus, branding, and settings
- **Menu Management** — Add / edit / delete items; size variants, tags, images
- **CSV Bulk Import** — Upload CSV or paste a URL; preview before import
- **Brand Customization** — Logo, cover banner, brand color, fonts, header layout (6 styles), background palette
- **Integrations Panel** — Payment gateways (Stripe, PayPal, Flutterwave, Paystack, MTN MoMo), email provider, webhooks, **Firebase**
- **Firebase Config Panel** — Paste config script → auto-fill all 7 SDK fields; Admin SDK credentials stored securely in DB
- **Analytics** — Order volume, revenue, popular items
- **Subscription System** — Trial, Pro, Enterprise plans with promo codes
- **User Management** — Admin user CRUD with role assignment

### Technical
- **Node.js / Express** backend, **PostgreSQL** database (connection pooling)
- **Security** — Helmet CSP (Firebase domains allowed), CSRF protection, bcrypt, rate limiting, input validation/sanitization, OWASP Top 10 aware
- **Firebase Admin SDK** — Re-initialized from DB without server restart on public-SDK changes; requires restart only for Admin SDK credential changes
- **Progressive Web App** — Service worker (`sw.js`), offline support, installable
- **Docker Ready** — `Dockerfile` + `docker-compose.yml` included
- **Coolify Compatible** — Deployment checklist and debug guide included

---

## 🚀 Quick Start

### Local Development

1. **Clone & Install**
   ```bash
   git clone https://github.com/Homeboy20/menu.git
   cd menu
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env — set DATABASE_URL and SESSION_SECRET at minimum
   ```

3. **Database Setup**
   ```bash
   # Windows PowerShell
   .\setup-local.ps1
   # Or manually: createdb restorder && node server.js
   ```

4. **Start Server**
   ```bash
   npm start
   ```

5. **Access**
   | URL | Purpose |
   |-----|---------|
   | `http://localhost:3000/` | Landing page |
   | `http://localhost:3000/admin.html` | Admin login |
   | `http://localhost:3000/menu.html?id=MENU_ID` | Customer menu |
   | `http://localhost:3000/customer-login.html` | Customer login |

### Docker
```bash
docker-compose up -d
```

---

## 🔥 Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Add a **Web app** → copy the config snippet
3. In the Admin Dashboard → **Settings → Integrations → Firebase**
4. Paste the config snippet → click **Parse & Fill Fields**
5. Add Service Account credentials (for Phone OTP token verification)
6. Toggle **Enabled** → **Save**

Optional env-var fallback (if not using the admin UI):
```
FIREBASE_PROJECT_ID=
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_APP_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | PostgreSQL (pg pool) |
| Auth | bcrypt, JWT, Firebase Admin SDK |
| Security | Helmet, express-rate-limit, csurf |
| File Parsing | XLSX, csv-parser |
| Frontend | Vanilla JS, CSS3 (no framework) |
| PWA | Service Worker, Web App Manifest |
| Deployment | Docker, Coolify |

---

## 📄 Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/menus/:id` | Public menu data |
| POST | `/api/auth/login` | Admin authentication |
| GET/PUT | `/api/admin/settings` | Platform settings (super_admin) |
| GET | `/api/firebase-config` | Public Firebase SDK config |
| POST | `/api/customers/firebase-auth` | Firebase token → customer session |
| POST | `/api/menus/:id/orders` | Place an order |
| GET | `/api/analytics/...` | Order analytics |

---

## 🎨 Customization

8 background palettes × 5 font families × unlimited brand colors. All branding (logo, banner, colors, fonts) is applied live without a page reload. Dark mode adapts all brand-generated styles automatically.

---

## 🔒 Security

- Passwords: bcrypt (12 rounds)
- Sessions: signed, HTTP-only cookies with TTL
- CSRF: double-submit cookie pattern
- Rate limiting on auth and order endpoints
- Content Security Policy via Helmet (Firebase SDK domains whitelisted)
- Input sanitization on all user-supplied fields
- Login lockout after repeated failures

---

## 📝 License

MIT License — free for commercial use.

---

Built with ❤️ for restaurant owners who want beautiful, functional digital menus.