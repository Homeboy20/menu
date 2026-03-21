# RestOrder v1.44.x - Post-Deployment Checklist

This checklist ensures all conversion optimization features are properly configured and working.

---

## 🔧 Phase 1: Backend Setup (Required)

### Database Migration
- [ ] **Run promo code migration**
  ```bash
  psql $DATABASE_URL < migrations/add_promo_codes.sql
  ```
- [ ] **Verify columns added**
  ```sql
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'customers' 
  AND column_name IN ('promo_code', 'discount_percent', 'discount_months');
  ```
- [ ] **Check promo codes table**
  ```sql
  SELECT * FROM promo_codes;
  ```
- [ ] **Test promo code in registration**
  - Register with code: `TRIAL50`
  - Check response includes: `promoApplied: true`
  - Verify database record has discount fields populated

### Server Restart
- [ ] **Stop current server**
  ```bash
  taskkill /F /IM node.exe  # Windows
  # OR
  pkill node  # Linux/Mac
  ```
- [ ] **Start with updated code**
  ```bash
  npm start
  ```
- [ ] **Verify server running**
  - Visit: http://localhost:3000
  - Check console: "Server running on port 3000"

---

## 💬 Phase 2: Live Chat Setup (30 minutes)

### Create Crisp Account
- [ ] **Sign up at [crisp.chat](https://crisp.chat)**
  - Choose free plan (unlimited)
  - Verify email

### Get Website ID
- [ ] **Create new website**
  - Settings → Websites → Add Website
  - Name: "RestOrder"
  - URL: https://restorder.online
- [ ] **Copy Website ID**
  - Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
  - Found in: Settings → Setup → Website ID

### Update index.html
- [ ] **Replace placeholder ID**
  ```html
  <!-- Line ~1851 in index.html -->
  window.CRISP_WEBSITE_ID = "YOUR_CRISP_WEBSITE_ID";
  ```
  Replace `YOUR_CRISP_WEBSITE_ID` with actual ID

### Configure Chat Widget
- [ ] **Customize appearance**
  - Settings → Appearance
  - Color: #c2410c (RestOrder orange)
  - Position: Bottom right
  - Language: English

- [ ] **Set up team**
  - Settings → Team
  - Add team members
  - Set availability hours

- [ ] **Create saved replies**
  - Settings → Saved Replies
  - Add common responses:
    - "How do I set up my menu?"
    - "What's the difference between plans?"
    - "Can I cancel anytime?"

### Test Chat Widget
- [ ] **Open homepage in browser**
- [ ] **Verify chat bubble appears (bottom right)**
- [ ] **Click chat icon - should open**
- [ ] **Send test message**
- [ ] **Check triggers after 5 seconds**
- [ ] **Test on mobile device**

---

## 📧 Phase 3: Email Marketing Setup (60 minutes)

### Choose Platform
- [ ] **Select one:**
  - ✅ ConvertKit (recommended for SaaS)
  - ✅ Mailchimp (popular, familiar)
  - ✅ ActiveCampaign (advanced features)

### Follow Setup Guide
- [ ] **Read: `/email-templates/SETUP_GUIDE.md`**
- [ ] **Create account on chosen platform**
- [ ] **Import 7 email templates:**
  - Day 0: Welcome
  - Day 1: Success Story
  - Day 3: Engagement
  - Day 5: Social Proof
  - Day 7: Value/ROI
  - Day 10: Urgency
  - Day 14: Last Chance

### Configure Automation
- [ ] **Create sequence (14-day trial nurture)**
- [ ] **Set email delays correctly**
- [ ] **Replace merge tags** ({{first_name}}, {{business_name}}, etc.)
- [ ] **Add links to all CTAs**
- [ ] **Enable automation**

### API Integration
- [ ] **Get API key from platform**
- [ ] **Add to environment variables**
  ```bash
  # Add to .env file
  EMAIL_API_KEY=your_api_key_here
  EMAIL_LIST_ID=your_list_id_here
  ```
- [ ] **Add API call to registration endpoint**
  - Location: `server.js` line ~1315 (after successful registration)
  - Use code from SETUP_GUIDE.md

### Testing
- [ ] **Send test sequence to yourself**
- [ ] **Check Day 0 email arrives immediately**
- [ ] **Verify all links work**
- [ ] **Test on mobile and desktop**
- [ ] **Check spam folder (none should be there)**
- [ ] **Verify unsubscribe link works**

---

## 🔬 Phase 4: A/B Testing Setup (30 minutes)

### Verify A/B Framework Loaded
- [ ] **Open browser console (F12)**
- [ ] **Type: `getABTestResults()`**
- [ ] **Should see table of tests**

### Enable First Test
- [ ] **Edit `/public/js/ab-testing.js`**
- [ ] **Find `heroHeadline` test (line ~25)**
- [ ] **Set `enabled: true`**
- [ ] **Save file**
- [ ] **Refresh page**
- [ ] **Verify headline changes (50% chance)**

### Test Variant Switching
- [ ] **Force variant A:**
  ```javascript
  forceVariant('heroHeadline', 'variant-a')
  ```
- [ ] **Page reloads with variant A**
- [ ] **Force control:**
  ```javascript
  forceVariant('heroHeadline', 'control')
  ```
- [ ] **Clear assignments:**
  ```javascript
  clearABTests()
  ```

### Setup Google Analytics (if not already)
- [ ] **Create GA4 property**
  - Go to [analytics.google.com](https://analytics.google.com)
  - Create new property
  - Get Measurement ID (G-XXXXXXXXXX)

- [ ] **Add GA4 to index.html** (in <head>):
  ```html
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-XXXXXXXXXX');
  </script>
  ```

- [ ] **Verify tracking in GA4**
  - Admin → Data Streams → Web
  - Check "Realtime" report shows activity

### Monitor A/B Test Events
- [ ] **In GA4: Reports → Engagement → Events**
- [ ] **Look for:**
  - `ab_test_assigned` (variant assignments)
  - `ab_test_conversion` (conversions by variant)
  - `cta_click` (CTA button clicks)

---

## 🎨 Phase 5: Visual Verification (15 minutes)

### Landing Page Check
- [ ] **Hero section:**
  - [ ] Headline uses loss aversion ("Stop Losing $3,600")
  - [ ] Star ratings visible (⭐⭐⭐⭐⭐ 4.9/5)
  - [ ] CTA says "Start 14-Day FREE Trial"
  - [ ] Trust badges show below CTA
  - [ ] Hero stats updated with new copy

- [ ] **Urgency bar (top):**
  - [ ] Shows "LIMITED OFFER: 50% OFF"
  - [ ] Countdown timer ticking
  - [ ] "X spots left this month" visible
  - [ ] Close button works
  - [ ] Doesn't reappear after closing

- [ ] **Trust bar:**
  - [ ] Shows 4 business logos
  - [ ] Includes bar and juice bar examples

- [ ] **Pricing section:**
  - [ ] Professional plan shows ~~$99~~ $39
  - [ ] Enterprise shows ~~$249~~ $99
  - [ ] "SAVE $720/year" badges visible
  - [ ] 30-Day Money-Back Guarantee in large text

- [ ] **Testimonials:**
  - [ ] 3 testimonials visible
  - [ ] ROI metrics in bold (+$4,200/mo, etc.)
  - [ ] Includes bar owner (Tom Chen)

### Exit Intent Popup
- [ ] **Trigger popup:**
  - Move mouse to top of screen (to leave)
  - Or scroll to top quickly
  - Or wait 30 seconds
- [ ] **Popup shows:**
  - [ ] "50% OFF" in large text
  - [ ] "Don't Miss" headline
  - [ ] CTA button: "Claim My 50% Discount Now"
  - [ ] 30-Day Guarantee mentioned
- [ ] **Close button works**
- [ ] **Doesn't show again in same session**
- [ ] **ESC key closes popup**

### Mobile Check
- [ ] **Open on mobile device or Chrome DevTools (F12 → Toggle device toolbar)**
- [ ] **Urgency bar displays properly**
- [ ] **Hero section readable**
- [ ] **Pricing cards stack vertically**
- [ ] **Exit popup fits screen**
- [ ] **Chat widget accessible (bottom right)**

---

## 🔐 Phase 6: Promo Code Testing (15 minutes)

### Test Registration with Promo Code
- [ ] **Open incognito/private window**
- [ ] **Go to registration page:** http://localhost:3000/register
- [ ] **Fill out form:**
  - Email: test+promo@example.com
  - Password: TestPass123
  - Business: Test Cafe
  - Contact: Test User

- [ ] **Add promo code field to form** (if not already there):
  ```html
  <input type="text" name="promoCode" placeholder="Promo Code (optional)">
  ```

- [ ] **Enter promo code: `TRIAL50`**
- [ ] **Submit form**
- [ ] **Check response:**
  ```json
  {
    "customer": {...},
    "promoApplied": true,
    "promoDetails": {
      "discount": 50,
      "months": 3,
      "description": "50% off for 3 months"
    }
  }
  ```

### Test Invalid Promo Code
- [ ] **Enter: `INVALID123`**
- [ ] **Should still register successfully**
- [ ] **But `promoApplied: false`**

### Test in Database
- [ ] **Query customer record:**
  ```sql
  SELECT email, promo_code, discount_percent, discount_months 
  FROM customers 
  WHERE email = 'test+promo@example.com';
  ```
- [ ] **Verify fields populated correctly**

### Test All Valid Codes
- [ ] `TRIAL50` - 50% off for 3 months
- [ ] `EXIT50` - 50% off for 3 months
- [ ] `LAUNCH25` - 25% off for 6 months
- [ ] `ANNUAL20` - 20% off for 12 months

---

## 📊 Phase 7: Analytics Setup (30 minutes)

### Event Tracking
- [ ] **Test CTA click tracking:**
  - Click "Start 14-Day FREE Trial" button
  - Check console: "[Analytics] cta_click"
  - Verify in GA4 Events

- [ ] **Test conversion tracking:**
  - Complete registration
  - Check console: "[Analytics] ab_test_conversion"
  - Verify in GA4

- [ ] **Test exit popup tracking:**
  - Trigger exit popup
  - Check console shows "exit_intent" event

### Create GA4 Custom Reports
- [ ] **Conversions Dashboard:**
  - Reports → Library → Create new report
  - Add metrics: Sign-ups, Trial conversions, Promo usage
  - Add dimensions: Source, Campaign, Promo code

- [ ] **A/B Test Dashboard:**
  - Add event: ab_test_assigned
  - Group by: test_name, variant
  - Metric: Count

---

## ✅ Phase 8: Final Validation (30 minutes)

### Full User Journey Test
- [ ] **Clear browser cookies**
- [ ] **Visit homepage**
  - [ ] Urgency bar appears
  - [ ] Chat widget loads (bottom right)
  - [ ] A/B test assigns variant
- [ ] **Scroll down**
  - [ ] Trust bar visible
  - [ ] Features section loaded
  - [ ] Pricing displays correctly
  - [ ] Testimonials with ROI metrics
- [ ] **Try to exit**
  - [ ] Exit popup appears
  - [ ] 50% OFF offer shown
- [ ] **Click "Start 14-Day FREE Trial"**
  - [ ] Redirects to registration
  - [ ] Form includes promo code field
- [ ] **Register with promo code**
  - [ ] Code: EXIT50
  - [ ] Registration succeeds
  - [ ] Redirect to dashboard
  - [ ] Email sequence starts (check inbox)

### Performance Check
- [ ] **Run Lighthouse audit (Chrome DevTools)**
  - Performance: >85
  - Accessibility: >90
  - Best Practices: >90
  - SEO: >90

- [ ] **Check page load time**
  - Network tab → Reload
  - Should be <3 seconds

- [ ] **Verify no console errors**
  - F12 → Console
  - Should be clean (no red errors)

### Cross-Browser Testing
- [ ] **Chrome** (desktop)
- [ ] **Firefox** (desktop)
- [ ] **Safari** (Mac/iPhone)
- [ ] **Edge** (Windows)
- [ ] **Mobile Chrome** (Android)

---

## 📈 Phase 9: Monitor & Optimize (Ongoing)

### Week 1: Watch the Data
- [ ] **Check email metrics daily:**
  - Open rate: >25%
  - Click rate: >10%
  - Unsubscribe: <0.5%

- [ ] **Monitor A/B test results:**
  - Need 100+ visitors per variant minimum
  - Look for 10%+ improvement
  - Calculate statistical significance

- [ ] **Review chat conversations:**
  - Common questions?
  - Pain points?
  - Objections?

### Week 2: First Optimizations
- [ ] **Update underperforming emails**
  - Low open rate? Test new subject line
  - Low click rate? Improve CTA
  - High unsubscribe? Reduce frequency

- [ ] **Declare A/B test winner**
  - If statistically significant (p < 0.05)
  - Implement winning variant for 100% traffic
  - Start next test

- [ ] **Adjust promo codes**
  - Too many signups with discount? Reduce offer
  - Not enough? Increase visibility
  - Track promo code ROI

### Month 1: Scale What Works
- [ ] **Double down on winners:**
  - Winning headline → Use in ads
  - Best performing email → Create similar
  - Most popular pricing tier → Feature more

- [ ] **Launch advanced tests:**
  - Pricing tiers (add PRO+ decoy)
  - Free trial length (7 vs 14 vs 30 days)
  - Guarantee strength (20% vs 30% increase)

---

## 🆘 Troubleshooting

### Chat Widget Not Showing
1. Check Website ID is correct
2. Clear browser cache
3. Check console for errors
4. Verify script loaded: `typeof $crisp !== 'undefined'`

### Emails Not Sending
1. Check API key is valid
2. Verify list/audience ID correct
3. Check email platform dashboard for errors
4. Test API endpoint directly

### A/B Tests Not Running
1. Check enabled: true in config
2. Clear cookies: `clearABTests()`
3. Check console for errors
4. Verify script loaded after DOM ready

### Promo Codes Not Working
1. Run database migration
2. Check columns exist: `\d customers`
3. Verify server restarted
4. Check request body includes promoCode

### Exit Popup Not Triggering
1. Test each trigger individually:
   - Mouse leave viewport
   - Scroll to top quickly
   - Wait 30 seconds
2. Check sessionStorage: `sessionStorage.getItem('exitPopupShown')`
3. Clear and test again

---

## 📞 Support

Need help with implementation?
- 📧 Email: support@restorder.online
- 💬 Live Chat: restorder.online
- 📚 Docs: /IMPLEMENTATION_SUMMARY.md

---

**Last Updated:** March 21, 2026
**Version:** 1.44.2
**Status:** Ready for Production ✅
