# Restaurant Digital Menu System

A complete digital menu solution for restaurants with QR code generation, responsive design, and admin dashboard.

## 🌟 Features

### Customer Experience
- **Responsive Design** - Works on mobile, tablet, and desktop
- **Light/Dark Theme Toggle** - User preference with localStorage
- **Search & Filter** - Find items quickly by name or category
- **Multiple Currencies** - Support for global currencies including African markets
- **QR Code Access** - Scan and view menus instantly

### Admin Dashboard
- **Secure Authentication** - Bcrypt password hashing + session management
- **File Upload Support** - Parse Excel (.xlsx), CSV, and PDF menus
- **Brand Customization** - Colors, fonts, layout (6 header styles)
- **Logo Upload** - Custom restaurant branding
- **Menu Management** - Add, edit, delete items with size information

### Technical
- **Node.js/Express** backend with SQLite database
- **Security Hardened** - Helmet CSP, rate limiting, input validation  
- **Production Ready** - Comprehensive error handling, logging
- **Mobile-First** - Progressive enhancement for all screen sizes

## 🚀 Quick Start

1. **Clone & Install**
   ```bash
   git clone https://github.com/Homeboy20/menu.git
   cd menu
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start Server**
   ```bash
   npm start
   # or
   node server.js
   ```

4. **Access**
   - Customer Menu: `http://localhost:3000/menu.html?id=YOUR_MENU_ID`
   - Admin Dashboard: `http://localhost:3000/admin.html`
   - Default admin password: `Tryme2ifucan`

## 📱 Screenshots

- Responsive design adapts from 430px mobile to 1300px+ desktop
- Light/dark theme with smooth transitions
- Category filtering with accent colors
- Search drawer with real-time filtering

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite with better-sqlite3
- **Authentication**: bcrypt, express-session
- **Security**: Helmet, express-rate-limit
- **Parsing**: XLSX, csv-parser, pdfjs-dist
- **Frontend**: Vanilla JS, CSS3 with smooth animations

## 📄 API Endpoints

- `GET /api/menus/:id` - Fetch menu data
- `POST /api/auth/login` - Admin authentication
- `POST /api/menus` - Create/update menus
- `POST /api/upload` - File upload for parsing
- `GET /api/qr/:id` - Generate QR codes

## 🎨 Customization

The system includes 8 background presets, 5 font families, and unlimited color customization through the admin panel. Brand colors automatically adapt to light/dark themes.

## 🔒 Security Features

- Password hashing with bcrypt (12 rounds)
- Rate limiting on authentication endpoints
- Content Security Policy with Helmet
- Input sanitization and validation
- Session management with TTL

## 📝 License

MIT License - Feel free to use for commercial purposes.

---

Built with ❤️ for restaurant owners who want beautiful, functional digital menus.