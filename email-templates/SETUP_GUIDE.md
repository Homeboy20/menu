# Email Marketing Setup Guide - RestOrder

This guide will help you set up the 14-day trial email nurture sequence using ConvertKit, Mailchimp, or ActiveCampaign.

---

## Option 1: ConvertKit (Recommended - Easiest)

### Why ConvertKit?
- ✅ Free up to 1,000 subscribers
- ✅ Visual automation builder
- ✅ Great deliverability rates
- ✅ Built for creators/SaaS

### Setup Steps:

**1. Create ConvertKit Account**
- Go to [convertkit.com](https://convertkit.com)
- Sign up for free account
- Verify email

**2. Create Email Sequence**
1. Click "Sequences" → "New Sequence"
2. Name it: "14-Day Trial Nurture"
3. Add 7 emails (Day 0, 1, 3, 5, 7, 10, 14)

**3. Import Email Templates**
1. For each email in `/email-templates/`:
   - Click "Add email"
   - Set delay (0, 1, 3, 5, 7, 10, 14 days)
   - Copy subject line from .txt file
   - Paste body content
   - Replace merge tags:
     - `{{first_name}}` → stays the same (ConvertKit uses this)
     - `{{business_name}}` → `{{company}}`
     - `{{trial_end_date}}` → add custom field
     - `{{email}}` → `{{subscriber.email_address}}`

**4. Set Up Automation**
1. Click "Automations" → "New Automation"
2. Name it: "Trial Signup Flow"
3. Trigger: "Subscriber is added via form or API"
4. Action: "Subscribe to sequence: 14-Day Trial Nurture"

**5. Create Form (Optional)**
1. Click "Forms" → "New Form"
2. Choose "Inline" or "Modal"
3. Add fields: Email, First Name, Company
4. Embed on thank-you page

**6. API Integration (Automatic Signup)**

Add to your registration success handler:

```javascript
// After successful registration
fetch('https://api.convertkit.com/v3/forms/YOUR_FORM_ID/subscribe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    api_key: 'YOUR_API_KEY',  // Get from ConvertKit → Settings → API
    email: customerEmail,
    first_name: contactName,
    fields: {
      company: businessName,
      trial_end_date: trialEndDate.toLocaleDateString(),
      signup_date: new Date().toLocaleDateString()
    }
  })
});
```

**7. Test the Sequence**
1. Add yourself as a subscriber
2. Check first email arrives immediately
3. Verify merge tags are replaced correctly
4. Wait 24 hours to test Day 1 email

---

## Option 2: Mailchimp (Popular Choice)

### Why Mailchimp?
- ✅ Free up to 500 subscribers
- ✅ Familiar interface
- ✅ Good analytics
- ✅ Integrates with everything

### Setup Steps:

**1. Create Mailchimp Account**
- Go to [mailchimp.com](https://mailchimp.com)
- Sign up for free plan
- Complete setup wizard

**2. Create Audience**
1. Go to "Audience" → "Manage Audience" → "Settings"
2. Add custom fields:
   - FNAME (First Name)
   - COMPANY (Business Name)
   - TRIALEND (Trial End Date)
   - PHONE (Phone Number)

**3. Create Email Automation**
1. Go to "Automations" → "Create" → "Custom"
2. Name: "14-Day Trial Sequence"
3. Trigger: "When someone subscribes"

**4. Add Emails to Automation**
1. Click "Add email" for each day
2. Set delay:
   - Email 1: Immediately
   - Email 2: 1 day after previous
   - Email 3: 2 days after previous (total: 3 days)
   - Email 4: 2 days after previous (total: 5 days)
   - Email 5: 2 days after previous (total: 7 days)
   - Email 6: 3 days after previous (total: 10 days)
   - Email 7: 4 days after previous (total: 14 days)

**5. Import Email Content**
For each email:
1. Click "Design Email"
2. Choose "Code your own" or "Text"
3. Copy content from `/email-templates/day-X-*.txt`
4. Replace merge tags:
   - `{{first_name}}` → `*|FNAME|*`
   - `{{business_name}}` → `*|COMPANY|*`
   - `{{email}}` → `*|EMAIL|*`
   - `{{trial_end_date}}` → `*|TRIALEND|*`

**6. API Integration**

```javascript
// Add to registration endpoint
const mailchimpAPI = 'YOUR_API_KEY';
const listID = 'YOUR_LIST_ID';
const serverPrefix = 'us1'; // First part of your API key

fetch(`https://${serverPrefix}.api.mailchimp.com/3.0/lists/${listID}/members`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${mailchimpAPI}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email_address: customerEmail,
    status: 'subscribed',
    merge_fields: {
      FNAME: contactName.split(' ')[0],
      COMPANY: businessName,
      TRIALEND: trialEndDate,
      PHONE: phone
    }
  })
});
```

---

## Option 3: ActiveCampaign (Most Powerful)

### Why ActiveCampaign?
- ✅ Advanced automation
- ✅ CRM features
- ✅ Lead scoring
- ✅ Best for scale

### Setup Steps:

**1. Create Account**
- Start 14-day trial at [activecampaign.com](https://activecampaign.com)
- Paid plans start at $29/month

**2. Create List**
1. Go to "Lists" → "Add a list"
2. Name: "Trial Users"

**3. Create Custom Fields**
1. Settings → Fields
2. Add: Business Name, Trial End Date, Phone

**4. Import Automation**
1. Automations → Create Automation
2. Choose "Start from scratch"
3. Trigger: "Subscribes to list: Trial Users"
4. Add "Wait" conditions (1 day, 2 days, etc.)
5. Add "Send Email" actions

**5. Create Emails**
- Use template builder or HTML
- Import content from `/email-templates/`
- Use personalization tags: `%FIRSTNAME%`, `%BUSINESS_NAME%`

**6. API Integration**

```javascript
fetch('https://YOUR_ACCOUNT.api-us1.com/api/3/contact/sync', {
  method: 'POST',
  headers: {
    'Api-Token': 'YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    contact: {
      email: customerEmail,
      firstName: contactName.split(' ')[0],
      phone: phone,
      fieldValues: [
        { field: '1', value: businessName },
        { field: '2', value: trialEndDate }
      ]
    }
  })
});
```

---

## General Best Practices

### Email Deliverability
1. **Set up SPF/DKIM records**
   - Add to your DNS settings
   - Improves inbox placement

2. **Use your own domain**
   - emails@restorder.online (better than convertkit.com)
   - Builds trust

3. **Warm up your sending domain**
   - Start with small batches
   - Gradually increase volume

### Testing
1. **Send test emails to yourself**
   - Check formatting
   - Verify links work
   - Test on mobile

2. **A/B test subject lines**
   - Test 2-3 variants
   - Track open rates
   - Use winner for all

3. **Monitor metrics**
   - Open rate: Target 25%+
   - Click rate: Target 10%+
   - Unsubscribe: Keep below 0.5%

### Optimization
1. **Track conversions**
   - Use UTM parameters in links
   - Monitor which emails drive signups
   - Double down on winners

2. **Segment by behavior**
   - Engaged vs. non-engaged
   - Feature usage
   - Business type (restaurant, cafe, bar)

3. **Personalize content**
   - Use business name
   - Reference their specific use case
   - Send industry-specific tips

---

## Quick Start Checklist

- [ ] Choose email platform (ConvertKit recommended)
- [ ] Create account and verify email
- [ ] Import 7 email templates
- [ ] Set up automation sequence
- [ ] Configure merge tags/personalization
- [ ] Add API integration to registration flow
- [ ] Send test emails to yourself
- [ ] Verify all links work
- [ ] Check mobile display
- [ ] Launch automation
- [ ] Monitor first week of sends
- [ ] Optimize based on data

---

## Support Resources

**ConvertKit:**
- [API Docs](https://developers.convertkit.com/)
- [Help Center](https://help.convertkit.com/)

**Mailchimp:**
- [API Docs](https://mailchimp.com/developer/)
- [Marketing API](https://mailchimp.com/developer/marketing/api/)

**ActiveCampaign:**
- [API Docs](https://developers.activecampaign.com/)
- [Automation Guide](https://help.activecampaign.com/hc/en-us/categories/360000189080)

---

## Need Help?

If you need assistance setting up email automation:
1. Reply to any RestOrder email
2. Live chat at restorder.online
3. Email: support@restorder.online

We can help with:
- API integration
- Template customization
- Deliverability issues
- A/B testing setup
