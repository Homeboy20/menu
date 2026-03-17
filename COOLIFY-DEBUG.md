# Coolify Production Debug Guide

## Environment Variable Issues

### 1. Check Coolify Environment Variables
In Coolify dashboard → Your App → Environment Variables:

```
NODE_ENV=production
PORT=3000
HOST=https://your-actual-domain.com
ADMIN_SECRET_HASH=$2b$12$PFrqLgUEjxy4pCRI5UEl8Ogc3ZU/5fK0ASCR2ESiEODis0cwwogMW
SESSION_TTL_MS=28800000
LOGIN_RATE_LIMIT=10
```

### 2. Common Fixes

**Issue: $ characters getting escaped**
If bcrypt hash is malformed, try wrapping in quotes:
```
ADMIN_SECRET_HASH="$2b$12$PFrqLgUEjxy4pCRI5UEl8Ogc3ZU/5fK0ASCR2ESiEODis0cwwogMW"
```

**Issue: Environment not loading**
- Click "Restart Application" in Coolify after changing env vars
- Check application logs for startup warnings
- Verify no .env file is being loaded (production should use Coolify's env vars)

### 3. Debug Steps

1. **Check Environment Status**:
   ```
   curl https://your-domain.com/api/debug/env
   ```

2. **View Application Logs** in Coolify to see:
   ```
   🔍 Environment Debug:
     NODE_ENV: production
     ADMIN_SECRET_HASH length: 60
     ADMIN_SECRET_HASH starts with $2: true
   ```

3. **Test Authentication**:
   ```
   curl -X POST https://your-domain.com/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"secret":"Tryme2ifucan"}'
   ```

4. **Check Login Logs** for detailed debug output:
   ```
   🔐 Login attempt: { hasSecret: true, adminHashLength: 60 }
   🔍 Bcrypt comparison result: true/false
   ✅ Login successful / ❌ Login failed
   ```

### 4. Alternative Hash Generation

If environment issues persist, generate hash directly in Coolify terminal:

```bash
node -e "require('bcrypt').hash('Tryme2ifucan',12).then(h=>console.log(h))"
```

Copy the output to `ADMIN_SECRET_HASH` environment variable.

### 5. Remove Debug Code

Once working, remove debug endpoints in production by setting:
```
NODE_ENV=production
DEBUG_MODE=false
```