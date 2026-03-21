# RestOrder Subscription Management System

## Overview
Complete subscription management system for monetizing the RestOrder SaaS platform. Includes database schema, API endpoints, admin UI, and plan enforcement.

## Version
**v1.38.0** - Released March 21, 2026

## Database Schema

### subscription_plans
Stores available subscription tiers and their features.

| Column          | Type    | Description                                |
|-----------------|---------|---------------------------------------------|
| id              | SERIAL  | Primary key                                 |
| name            | TEXT    | Internal plan name (starter, professional)  |
| display_name    | TEXT    | Customer-facing name                        |
| price           | REAL    | Monthly price in USD                        |
| interval        | TEXT    | Billing interval (monthly, yearly)          |
| menu_limit      | INTEGER | Max number of menus (999 = unlimited)       |
| location_limit  | INTEGER | Max number of locations (999 = unlimited)   |
| features        | JSONB   | Array of feature descriptions               |
| is_active       | INTEGER | 1 = active, 0 = disabled                    |
| sort_order      | INTEGER | Display order                               |
| created_at      | TEXT    | ISO timestamp                               |

**Default Plans:**
- **Starter** - FREE: 1 menu, 1 location, basic features
- **Professional** - $39/mo: 5 menus, 3 locations, advanced features
- **Enterprise** - $99/mo: Unlimited menus/locations, all features

### subscriptions
Tracks active subscriptions for each restaurant/menu.

| Column         | Type    | Description                               |
|----------------|---------|-------------------------------------------|
| id             | SERIAL  | Primary key                               |
| menu_id        | TEXT    | References menus(id), UNIQUE              |
| plan_id        | INTEGER | References subscription_plans(id)         |
| status         | TEXT    | active, cancelled, expired, trial         |
| start_date     | TEXT    | ISO timestamp when subscription started   |
| end_date       | TEXT    | ISO timestamp when subscription ends      |
| trial_end      | TEXT    | ISO timestamp when trial period ends      |
| cancel_at_end  | INTEGER | 1 = cancel at period end, 0 = auto-renew |
| created_at     | TEXT    | ISO timestamp                             |
| updated_at     | TEXT    | ISO timestamp of last update              |

### payments
Records all payment transactions and billing history.

| Column          | Type    | Description                              |
|-----------------|---------|------------------------------------------|
| id              | SERIAL  | Primary key                              |
| subscription_id | INTEGER | References subscriptions(id)             |
| amount          | REAL    | Payment amount                           |
| currency        | TEXT    | Currency code (USD, EUR, etc.)           |
| payment_method  | TEXT    | manual, stripe, paypal, etc.             |
| payment_id      | TEXT    | External payment processor ID            |
| status          | TEXT    | pending, completed, failed, refunded     |
| paid_at         | TEXT    | ISO timestamp of successful payment      |
| notes           | TEXT    | Additional payment notes                 |
| created_at      | TEXT    | ISO timestamp                            |

### usage_tracking
Monitors resource usage against plan limits.

| Column           | Type    | Description                            |
|------------------|---------|----------------------------------------|
| id               | SERIAL  | Primary key                            |
| menu_id          | TEXT    | References menus(id), UNIQUE           |
| menus_count      | INTEGER | Total menus created                    |
| locations_count  | INTEGER | Total locations/tables                 |
| scans_count      | INTEGER | Total QR code scans                    |
| updated_at       | TEXT    | ISO timestamp of last update           |

## API Endpoints

### Subscription Plans

#### GET /api/subscription-plans
Get all active subscription plans.

**Authentication:** None (public)

**Response:**
```json
[
  {
    "id": 1,
    "name": "starter",
    "display_name": "Starter",
    "price": 0,
    "interval": "monthly",
    "menu_limit": 1,
    "location_limit": 1,
    "features": ["Digital Menu", "QR Code Generation", ...],
    "is_active": 1,
    "sort_order": 1,
    "created_at": "2026-03-21T00:00:00.000Z"
  }
]
```

### Subscriptions

#### GET /api/subscriptions
List all subscriptions (admin only).

**Authentication:** Required  
**Query Parameters:**
- `status` - Filter by status (active, cancelled, expired, trial)

**Response:**
```json
[
  {
    "id": 1,
    "menu_id": "abc-123",
    "plan_id": 2,
    "status": "active",
    "plan_name": "Professional",
    "plan_price": 39,
    "restaurant_name": "Joe's Pizza",
    "total_scans": 1250,
    "start_date": "2026-03-01T00:00:00.000Z",
    ...
  }
]
```

#### GET /api/subscriptions/:id
Get subscription details (admin only).

**Authentication:** Required

**Response:**
```json
{
  "id": 1,
  "menu_id": "abc-123",
  "plan_name": "Professional",
  "plan_price": 39,
  "menu_limit": 5,
  "location_limit": 3,
  "features": [...],
  "status": "active",
  "restaurant_name": "Joe's Pizza",
  ...
}
```

#### GET /api/menus/:id/subscription
Get subscription for a specific menu.

**Authentication:** Optional (but recommended)

**Response:** Same as GET /api/subscriptions/:id

**Note:** Auto-assigns Starter plan if no subscription exists.

#### POST /api/subscriptions
Create a new subscription (admin only).

**Authentication:** Required

**Request Body:**
```json
{
  "menu_id": "abc-123",
  "plan_id": 2
}
```

**Response:** Created subscription object

#### PUT /api/subscriptions/:id
Update subscription (upgrade/downgrade/cancel) (admin only).

**Authentication:** Required

**Request Body:**
```json
{
  "plan_id": 3,
  "status": "active",
  "cancel_at_end": 0,
  "end_date": "2026-04-01T00:00:00.000Z"
}
```

**Response:**
```json
{
  "success": true
}
```

**Note:** Automatically creates pending payment record when upgrading.

#### DELETE /api/subscriptions/:id
Cancel subscription (admin only).

**Authentication:** Required

**Response:**
```json
{
  "success": true
}
```

**Note:** Sets status to 'cancelled' and cancel_at_end to 1.

### Payments

#### GET /api/subscriptions/:id/payments
Get payment history for a subscription (admin only).

**Authentication:** Required

**Response:**
```json
[
  {
    "id": 1,
    "subscription_id": 1,
    "amount": 39,
    "currency": "USD",
    "payment_method": "stripe",
    "payment_id": "pi_abc123",
    "status": "completed",
    "paid_at": "2026-03-01T00:00:00.000Z",
    "notes": "Monthly subscription payment",
    "created_at": "2026-03-01T00:00:00.000Z"
  }
]
```

#### POST /api/subscriptions/:id/payments
Record a payment (admin only).

**Authentication:** Required

**Request Body:**
```json
{
  "amount": 39,
  "currency": "USD",
  "payment_method": "manual",
  "status": "completed",
  "notes": "Cash payment received"
}
```

**Response:** Created payment object

### Usage Tracking

#### GET /api/menus/:id/usage
Get usage statistics for a menu.

**Authentication:** Optional

**Response:**
```json
{
  "id": 1,
  "menu_id": "abc-123",
  "menus_count": 3,
  "locations_count": 2,
  "scans_count": 1250,
  "updated_at": "2026-03-21T00:00:00.000Z"
}
```

## Admin UI

### Subscriptions Dashboard
Access at: `http://localhost:3000/subscriptions.html`

**Features:**
- Overview stats: Total subscriptions, Active, Monthly revenue, Cancelled
- Filter by subscription status
- Search by restaurant name or menu ID
- Real-time subscription list with plan details
- Click to view detailed subscription information

**Subscription Details Modal:**
- Restaurant and menu information
- Current plan details with limits
- Subscription status and dates
- Feature list
- Payment history timeline
- Quick actions: Upgrade plan, Cancel subscription

## Plan Limits Enforcement

### Middleware: checkSubscriptionLimit
Automatically enforces plan limits on protected routes.

**Checks:**
1. Subscription exists and is active
2. Menu creation doesn't exceed plan limit
3. Feature access matches plan tier

**Usage:**
```javascript
app.post('/api/menus', requireAuth, checkSubscriptionLimit, async (req, res) => {
  // Create menu logic
});
```

**Error Responses:**
```json
{
  "error": "Subscription is not active. Please renew your subscription.",
  "subscription_status": "expired"
}
```

```json
{
  "error": "You have reached your plan limit of 5 menu(s). Please upgrade to create more.",
  "current_plan": "Professional",
  "limit": 5,
  "current_count": 5
}
```

## Subscription Lifecycle

### New Restaurant
1. Restaurant signs up → Creates first menu
2. Auto-assigned **Starter** plan (FREE)
3. Usage tracking initialized (1 menu, 1 location, 0 scans)

### Upgrade
1. Admin selects new plan in UI
2. PUT /api/subscriptions/:id updates plan_id
3. Payment record created with status "pending"
4. Usage limits updated based on new plan

### Downgrade
1. Admin selects lower plan
2. System checks if current usage exceeds new limits
3. If within limits: Immediate downgrade
4. If exceeds limits: Schedule for next billing cycle

### Cancellation
1. Admin clicks "Cancel Subscription"
2. Status set to "cancelled"
3. cancel_at_end set to 1
4. Access continues until end_date
5. After end_date: Status becomes "expired"

### Renewal
1. Manual: Admin records payment → Updates end_date
2. Automatic (future): Stripe webhook → Creates payment record → Extends subscription

## Integration Guide

### Check Subscription in Your Code
```javascript
// Get subscription for menu
const subscription = await pool.query(`
  SELECT s.*, sp.menu_limit, sp.features
  FROM subscriptions s
  JOIN subscription_plans sp ON s.plan_id = sp.id
  WHERE s.menu_id = $1 AND s.status = 'active'
`, [menuId]);

if (subscription.rows.length === 0) {
  return res.status(403).json({ error: 'No active subscription' });
}

const plan = subscription.rows[0];
if (plan.menu_limit <= currentMenuCount) {
  return res.status(403).json({ error: 'Plan limit reached' });
}
```

### Update Usage Tracking
```javascript
// After creating a menu
await pool.query(`
  UPDATE usage_tracking 
  SET menus_count = menus_count + 1, updated_at = $1 
  WHERE menu_id = $2
`, [new Date().toISOString(), menuId]);
```

### Record Payment
```javascript
// After successful Stripe payment
await pool.query(`
  INSERT INTO payments (subscription_id, amount, currency, payment_method, payment_id, status, paid_at, created_at)
  VALUES ($1, $2, $3, 'stripe', $4, 'completed', $5, $5)
`, [subId, amount, 'USD', stripePaymentId, new Date().toISOString()]);

// Extend subscription
await pool.query(`
  UPDATE subscriptions 
  SET end_date = $1, updated_at = $2 
  WHERE id = $3
`, [nextBillingDate, new Date().toISOString(), subId]);
```

## Future Enhancements

### Phase 2
- [ ] Stripe integration for automatic billing
- [ ] Email notifications for renewals/expirations
- [ ] Proration for mid-cycle upgrades/downgrades
- [ ] Annual billing option with discount
- [ ] Trial period support (7-14 days)

### Phase 3
- [ ] Customer self-service portal
- [ ] Invoice generation (PDF)
- [ ] Usage analytics and trends
- [ ] Custom enterprise plans
- [ ] Referral/affiliate program

### Phase 4
- [ ] Multi-currency support
- [ ] Tax calculation (Stripe Tax)
- [ ] Dunning management (failed payments)
- [ ] Subscription forecasting
- [ ] Advanced reporting dashboard

## Testing

### Manual Testing Checklist
- [x] Server starts without errors
- [x] Subscription tables created with seed data
- [x] API endpoints return correct data
- [x] Admin UI loads and displays subscriptions
- [x] Subscription details modal works
- [x] Plan limits middleware functions

### API Testing Examples
```bash
# Get all plans
curl http://localhost:3000/api/subscription-plans

# Get subscriptions (requires auth)
curl -H "x-admin-token: YOUR_TOKEN" \
  http://localhost:3000/api/subscriptions?status=active

# Get menu subscription
curl http://localhost:3000/api/menus/abc-123/subscription

# Record payment (requires auth)
curl -X POST \
  -H "x-admin-token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":39,"currency":"USD","payment_method":"manual","status":"completed"}' \
  http://localhost:3000/api/subscriptions/1/payments
```

## Troubleshooting

### Subscription tables not created
**Issue:** Server starts but `/api/subscription-plans` returns empty array

**Solution:**
1. Check PostgreSQL connection in .env
2. Verify initDB() runs on startup
3. Check server logs for SQL errors
4. Manually run seed query from server.js

### Plan limits not enforced
**Issue:** Can create more menus than plan allows

**Solution:**
1. Apply `checkSubscriptionLimit` middleware to route
2. Verify subscription status is "active"
3. Check usage_tracking table is updated

### Admin UI shows no subscriptions
**Issue:** Subscriptions page loads but table is empty

**Solution:**
1. Check browser console for errors
2. Verify admin authentication is valid
3. Ensure `/api/subscriptions` endpoint returns data
4. Check filter status matches existing subscriptions

## Support
For issues or questions about the subscription system:
- Check server logs for error messages
- Verify database schema matches documentation
- Test API endpoints with curl/Postman
- Review commit e93d34d for implementation details

---

**Version:** 1.38.0  
**Last Updated:** March 21, 2026  
**Author:** RestOrder Development Team
