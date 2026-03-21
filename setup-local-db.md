# 🗄️ Local PostgreSQL Setup Guide

## Step 1: Install PostgreSQL

### Windows Installation:
1. **Download**: https://www.postgresql.org/download/windows/
2. **Run installer** (PostgreSQL 16+ recommended)
3. **During installation:**
   - Set password for `postgres` user (remember this!)
   - Default port: `5432` (keep default)
   - Install Stack Builder: Optional

### Verify Installation:
```powershell
# Check if PostgreSQL is running
Get-Service -Name "postgresql*"

# Check version
psql --version
```

---

## Step 2: Create Database

### Option A: Using pgAdmin (GUI)
1. Open **pgAdmin** (installed with PostgreSQL)
2. Connect to local PostgreSQL server
3. Right-click "Databases" → Create → Database
4. Name: `restorder`
5. Click Save

### Option B: Using Command Line
```powershell
# Login to PostgreSQL (enter password when prompted)
psql -U postgres

# Inside psql:
CREATE DATABASE restorder;
\l  # List databases to verify
\q  # Quit
```

---

## Step 3: Update .env File

Your current `.env` has:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/restorder
```

**Update the password** to match what you set during PostgreSQL installation:
```
DATABASE_URL=postgresql://postgres:YOUR_ACTUAL_PASSWORD@localhost:5432/restorder
```

---

## Step 4: Start the Server

### Option 1: Development Mode (with auto-reload)
```powershell
npm run dev
```

### Option 2: Production Mode
```powershell
npm start
```

### Option 3: Direct Node
```powershell
node server.js
```

**The server will:**
- ✅ Connect to PostgreSQL
- ✅ Auto-create all tables (menus, menu_items, orders, etc.)
- ✅ Start on http://localhost:3000

---

## Step 5: Access Your Local Webapp

Once server starts successfully:

- **Landing Page**: http://localhost:3000/index.html
- **Admin Panel**: http://localhost:3000/admin.html
- **Menu (demo)**: http://localhost:3000/menu.html?id=demo

---

## 🔧 Troubleshooting

### Error: "ECONNREFUSED ::1:5432"
**Problem**: PostgreSQL not running

**Solution**:
```powershell
# Start PostgreSQL service
Start-Service postgresql*

# Or check status
Get-Service postgresql*
```

### Error: "password authentication failed"
**Problem**: Wrong password in DATABASE_URL

**Solution**: Update `.env` with correct PostgreSQL password

### Error: "database 'restorder' does not exist"
**Problem**: Database not created

**Solution**: Run `CREATE DATABASE restorder;` in psql

---

## 🎯 Quick Start (After PostgreSQL Installed)

```powershell
# 1. Start PostgreSQL (if not running)
Start-Service postgresql*

# 2. Create database (one-time)
psql -U postgres -c "CREATE DATABASE restorder;"

# 3. Update .env with your PostgreSQL password

# 4. Start server
cd "f:\backup files\menu"
npm start

# 5. Open browser
start http://localhost:3000/index.html
```

---

## 💡 Development Tips

### View Database Contents:
```powershell
# Connect to restorder database
psql -U postgres -d restorder

# Inside psql:
\dt                    # List all tables
SELECT * FROM menus;   # View menus
SELECT * FROM menu_items; # View items
\q                     # Quit
```

### Reset Database:
```powershell
psql -U postgres -c "DROP DATABASE restorder;"
psql -U postgres -c "CREATE DATABASE restorder;"
# Tables will auto-recreate on next server start
```

### Connection String Format:
```
postgresql://username:password@host:port/database

Example:
postgresql://postgres:mypassword123@localhost:5432/restorder
```

---

## 🚀 Workflow: Local Review Before Deploy

1. **Make changes** to code
2. **Test locally**: http://localhost:3000
3. **Check database** if needed (psql)
4. **Commit when satisfied**:
   ```powershell
   git add .
   git commit -m "Description"
   ```
5. **Push to deploy**:
   ```powershell
   git push origin main
   ```

---

## ⚠️ Important Notes

- **Production Database**: Your Coolify deployment uses a different PostgreSQL instance (not your local one)
- **Local data ≠ Production data**: Local testing won't affect live users
- **Backups**: Local database is for testing only
- **Security**: Never commit `.env` file with real passwords to Git

---

## 📚 Additional Resources

- PostgreSQL Docs: https://www.postgresql.org/docs/
- pgAdmin Guide: https://www.pgadmin.org/docs/
- psql Commands: https://www.postgresql.org/docs/current/app-psql.html
