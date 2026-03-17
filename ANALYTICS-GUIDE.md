# Analytics & Dynamic QR Code System - v1.6.0

## Overview
Complete scan analytics and dynamic QR code management system for tracking menu engagement and managing QR code versions.

## Features Added

### 1. Scan Analytics Tracking
- **Automatic Scan Recording**: Every menu view is automatically tracked
- **Data Captured**:
  - Timestamp of scan
  - User agent (device/browser)
  - IP address
  - Referrer URL
  - Total scan count per menu
  - Last scan timestamp

### 2. Dynamic QR Codes
- **Version Tracking**: Each menu has a QR version number
- **Unique URLs**: QR codes include version parameter (`?id=menu-id&v=1`)
- **Regeneration**: Admins can generate new QR codes to invalidate old ones
- **Persistent Storage**: QR codes saved in database for consistent display

### 3. Menu Update Behavior
- **Cache Invalidation**: Menu cache cleared automatically on updates
- **Timestamp Tracking**: `updated_at` field records last modification
- **QR Preservation**: Updating menu content doesn't change QR code
- **Manual Regeneration**: Use "Regenerate QR Code" button to create new version

## API Endpoints

### GET `/api/menus/:id/analytics`
Get comprehensive analytics for a menu.

**Authentication**: Required

**Response**:
```json
{
  "menuId": "abc-123",
  "totalScans": 156,
  "lastScanAt": "2024-01-15T10:30:00.000Z",
  "qrVersion": 2,
  "updatedAt": "2024-01-15T08:00:00.000Z",
  "recentScans": [
    {
      "scannedAt": "2024-01-15T10:30:00.000Z",
      "userAgent": "Mozilla/5.0...",
      "ipAddress": "192.168.1.1",
      "referrer": "https://google.com"
    }
  ],
  "dailyStats": [
    {
      "date": "2024-01-15",
      "scans": 23
    }
  ]
}
```

### POST `/api/menus/:id/regenerate-qr`
Generate new QR code version for a menu.

**Authentication**: Required

**Use Cases**:
- Invalidate old printed QR codes
- Create new QR after menu restructuring
- Track different marketing campaigns

**Response**:
```json
{
  "success": true,
  "qrVersion": 3,
  "qrDataUrl": "data:image/png;base64,...",
  "menuUrl": "https://your-domain.com/menu.html?id=abc-123&v=3"
}
```

## Database Schema

### New Table: `menu_scans`
```sql
CREATE TABLE menu_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  referrer TEXT
);
```

### New Columns in `menus` Table
- `qr_version` (INTEGER): Current QR code version, increments on regeneration
- `qr_code` (TEXT): Base64 data URL of QR code image
- `total_scans` (INTEGER): Cached total scan count for quick access
- `last_scan_at` (TEXT): ISO timestamp of most recent scan
- `updated_at` (TEXT): ISO timestamp of last menu modification

## Admin Dashboard Integration

### Display Analytics
```javascript
// Fetch analytics data
const response = await fetch(`/api/menus/${menuId}/analytics`, {
  headers: { 'X-Admin-Auth': adminToken }
});
const analytics = await response.json();

// Display total scans
console.log(`Total Scans: ${analytics.totalScans}`);

// Show daily chart
analytics.dailyStats.forEach(day => {
  console.log(`${day.date}: ${day.scans} scans`);
});

// List recent scans
analytics.recentScans.forEach(scan => {
  console.log(`Scan at ${scan.scannedAt} from ${scan.ipAddress}`);
});
```

### Regenerate QR Code
```javascript
// Regenerate QR code
const response = await fetch(`/api/menus/${menuId}/regenerate-qr`, {
  method: 'POST',
  headers: { 'X-Admin-Auth': adminToken }
});
const result = await response.json();

// Display new QR code
document.getElementById('qr-image').src = result.qrDataUrl;
console.log(`New QR version: ${result.qrVersion}`);
```

## How It Works

### Menu Creation (POST /api/menus)
1. Generate QR code with version 1
2. Store QR data URL in database
3. Initialize scan counters to 0
4. Set creation timestamp

### Menu Updates (PUT /api/menus/:id)
1. Update menu content and branding
2. Clear menu cache for fresh data
3. Update `updated_at` timestamp
4. **Keep existing QR code version**
5. Return existing QR code to admin

### Scan Recording (/menu.html)
1. Customer visits menu URL
2. Middleware intercepts request
3. Records scan event in `menu_scans` table
4. Increments `total_scans` counter
5. Updates `last_scan_at` timestamp
6. Serves menu.html normally

### QR Regeneration (POST /api/menus/:id/regenerate-qr)
1. Increment `qr_version` by 1
2. Generate new QR code with updated version
3. Store new QR data URL
4. Update `updated_at` timestamp
5. Return new QR code to admin

## Analytics Queries

### 30-Day Scan Statistics
Automatically groups scans by date for the last 30 days:
```sql
SELECT 
  DATE(scanned_at) as date,
  COUNT(*) as scans
FROM menu_scans 
WHERE menu_id = ? AND scanned_at >= datetime('now', '-30 days')
GROUP BY DATE(scanned_at)
ORDER BY date DESC
```

### Recent Scan Details
Get the 10 most recent scans with full details:
```sql
SELECT * FROM menu_scans 
WHERE menu_id = ? 
ORDER BY scanned_at DESC 
LIMIT 10
```

## Privacy & Performance

### Privacy Considerations
- IP addresses are stored for analytics only
- Consider privacy regulations (GDPR, CCPA) in your region
- User agents help understand device usage patterns
- Referrers show marketing effectiveness

### Performance Optimizations
- Scan recording is non-blocking (errors logged, not thrown)
- `total_scans` cached on menus table for quick access
- Analytics queries use indexes on `menu_id` and `scanned_at`
- Cache invalidation ensures fresh menu data after updates

## Version History

### v1.6.0 - Analytics & Dynamic QR System
- ✅ Scan analytics tracking with detailed metrics
- ✅ Dynamic QR codes with version management
- ✅ Cache invalidation on menu updates
- ✅ Automatic scan recording middleware
- ✅ 30-day statistics with daily breakdown
- ✅ Recent scan history with device details
- ✅ Manual QR code regeneration
- ✅ Preserved QR versions on menu edits

## Future Enhancements (Optional)

- **Admin Dashboard UI**: Visual charts for analytics
- **Export Analytics**: CSV/Excel export for scan data
- **Geographic Tracking**: Map view of scan locations
- **Campaign Tracking**: UTM parameters in QR URLs
- **QR Design Options**: Custom colors, logos in QR codes
- **Webhook Alerts**: Notify on scan milestones
- **A/B Testing**: Multiple QR versions with performance comparison
