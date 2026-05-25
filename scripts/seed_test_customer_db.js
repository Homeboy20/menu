require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
(async ()=>{
  try{
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.connect();
    const email = process.argv[2] || 'local.seed@example.com';
    const password = process.argv[3] || 'Password1';
    const businessName = process.argv[4] || 'Seeded Local Bistro';
    // check existing
    const { rows: exists } = await pool.query('SELECT id FROM customers WHERE email = $1 LIMIT 1', [email]);
    if (exists.length) {
      console.log('Customer already exists:', email);
      process.exit(0);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const { rows } = await pool.query('INSERT INTO customers (email, password_hash, business_name, status, created_at) VALUES ($1,$2,$3,\'active\',$4) RETURNING id,email', [email, passwordHash, businessName, now]);
    const customer = rows[0];
    const menuId = crypto.randomUUID();
    // minimal menu insert matching server expectations
    await pool.query("INSERT INTO menus (id, restaurant_name, currency, brand_color, customer_id, created_at, updated_at, qr_version) VALUES ($1,$2,'USD','#c2410c',$3,$4,$4,1)", [menuId, businessName, customer.id, now]);
    console.log('Seeded customer:', { email: customer.email, password, businessName, defaultMenuId: menuId });
    await pool.end();
  }catch(e){
    console.error('Seed failed:', e.message || e);
    process.exit(1);
  }
})();
