# RestOrder Website Navigation Structure

## Main Navigation (Header)

All pages include consistent header navigation:

```
[Logo: RestOrder] 
  - Home | Features | Pricing | About | Contact
  [Start Free Trial Button]
```

### Routes Configuration

Clean URLs configured in server.js (no .html extension):

| URL Path | File | Description |
|----------|------|-------------|
| `/` | index.html | Landing page with hero, features, pricing preview |
| `/features` | features.html | Feature showcase (9 features + use cases) |
| `/pricing` | pricing.html | Pricing plans & comparison table |
| `/about` | about.html | Company story, stats, values |
| `/contact` | contact.html | Contact form and info |
| `/faq` | faq.html | 20 FAQs across 5 categories |
| `/register` | register.html | Sign up form |
| `/login` | customer-login.html | Login form |
| `/dashboard` | customer-dashboard.html | Customer dashboard (auth required) |
| `/admin` | admin.html | Admin panel (auth required) |
| `/menu` | menu.html | Public menu view (requires ?id=menuId) |
| `/privacy` | privacy.html | Privacy Policy (route ready) |
| `/terms` | terms.html | Terms of Service (route ready) |

## Footer Navigation

All public pages include consistent footer with 3 columns:

### Column 1: Product
- Features → `/features`
- Pricing → `/pricing`
- Demo → `/menu?id=demo`
- Get Started → `/register`
- Sign In → `/login`

### Column 2: Company
- About Us → `/about`
- Contact → `/contact`
- FAQ → `/faq`

### Column 3: Legal
- Privacy Policy → `/privacy`
- Terms of Service → `/terms`

## Page-Specific Navigation

### Landing Page (/)
- In-page anchors: `#features`, `#demo`, `#pricing`, `#testimonials`
- CTA buttons throughout → `/register`
- "View Demo" → `/menu?id=demo`

### Features Page (/features)
- CTA → `/register`
- Use case cards (4 business types)

### Pricing (/pricing)
- Monthly/Annual toggle
- 3 plan CTAsall → `/register`
- FAQ section

### About (/about)
- Company story
- Stats showcase
- Values grid

### Contact (/contact)
- Contact form
- Email/phone display
- CTA → `/register`

### FAQ (/faq)
- 5 categories with Q&As
- "Contact Support" CTA → `/contact`

## External Links

- Demo Menu: `/menu?id=demo` (opens actual demo menu)
- Live Chat: Crisp widget (cuando configured)
- Email: support@restorder.online
- Sales: sales@restorder.online

## Mobile Navigation

- Hamburger menu (☰) on screens < 768px
- Slide-in mobile menu with all main links
- Mobile-optimized CTAs

## Cross-Page Linking

Every page cross-links to related content:

```
Landing → Features, Pricing, About, Contact, FAQ, Register
Features → Pricing, Register  
Pricing → Features, Register, FAQ
About → Contact, Register
Contact → FAQ, Register
FAQ → Contact, Register
```

## Call-to-Action Flow

Primary user journey:
```
Landing → Features → Pricing → Register → Dashboard
       ↘ Demo Menu ↗
```

Secondary flows:
```
Landing → About → Contact
Landing → FAQ → Contact  
Landing → Pricing → Register
```

## Search Engine Optimization

All pages include:
- Unique `<title>` tags
- Meta descriptions
- Canonical URLs
- Open Graph tags (ready)
- Semantic HTML5 structure

## Accessibility

- Skip to content links (ready to add)
- ARIA labels on navigation
- Keyboard navigation support
- Focus indicators
- Alt text on images

## Admin/Customer Pages

Separate navigation for authenticated users:

### Customer Dashboard
- My Menus
- Analytics
- Account Settings
- Logout → `/login`

### Admin Panel
- Menus
- Customers
- Subscriptions
- Analytics
- Logout → `/admin`

## Status

✅ Public pages: Fully functional
✅ Clean URLs: Configured in server.js
✅ Cross-linking: Implemented
✅ Mobile responsive: All pages
⏸️ Privacy/Terms: Routes ready, pages need creation
⏸️ Blog/Docs: Future enhancement

## Testing Navigation

Start server:
```bash
npm start
```

Test URLs:
```
http://localhost:3000/
http://localhost:3000/features
http://localhost:3000/pricing
http://localhost:3000/about
http://localhost:3000/contact
http://localhost:3000/faq
http://localhost:3000/register
http://localhost:3000/login
```

All links use clean URLs (no .html) and are mobile-responsive.

---

**Last Updated:** March 21, 2026  
**Version:** 1.45.0
