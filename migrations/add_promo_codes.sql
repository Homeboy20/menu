-- Add promo code tracking columns to customers table
-- Run this migration to enable promo code functionality

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50),
ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_months INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS promo_applied_at TIMESTAMP;

-- Create index for promo code lookups
CREATE INDEX IF NOT EXISTS idx_customers_promo_code ON customers(promo_code);

-- Add comment to document the columns
COMMENT ON COLUMN customers.promo_code IS 'Promotional code used during signup (e.g., TRIAL50, EXIT50)';
COMMENT ON COLUMN customers.discount_percent IS 'Discount percentage applied (e.g., 50 for 50% off)';
COMMENT ON COLUMN customers.discount_months IS 'Number of months discount is valid for';
COMMENT ON COLUMN customers.promo_applied_at IS 'Timestamp when promo code was applied';

-- Update existing rows to have default values
UPDATE customers 
SET promo_code = NULL, 
    discount_percent = 0, 
    discount_months = 0,
    promo_applied_at = NULL
WHERE promo_code IS NULL;

-- Optional: Create promo_codes table for better management
CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL,
  discount_months INTEGER NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT true,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  valid_from TIMESTAMP,
  valid_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for active promo code lookups
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(code, active);

-- Insert default promo codes
INSERT INTO promo_codes (code, discount_percent, discount_months, description, active, max_uses, valid_until)
VALUES 
  ('TRIAL50', 50, 3, '50% off for 3 months - Trial users', true, NULL, '2026-12-31'),
  ('EXIT50', 50, 3, '50% off for 3 months - Exit intent popup', true, NULL, '2026-12-31'),
  ('LAUNCH25', 25, 6, '25% off for 6 months - Launch promotion', true, 1000, '2026-06-30'),
  ('ANNUAL20', 20, 12, '20% off annual plan', true, NULL, '2026-12-31')
ON CONFLICT (code) DO NOTHING;

-- Track promo code usage
CREATE TABLE IF NOT EXISTS promo_usage (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  promo_code VARCHAR(50) NOT NULL,
  discount_percent INTEGER NOT NULL,
  discount_months INTEGER NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  source VARCHAR(100) -- e.g., 'exit_popup', 'landing_page', 'email'
);

-- Create indexes for analytics
CREATE INDEX IF NOT EXISTS idx_promo_usage_customer ON promo_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_code ON promo_usage(promo_code);
CREATE INDEX IF NOT EXISTS idx_promo_usage_date ON promo_usage(applied_at);

-- Add trigger to update promo_codes usage count
CREATE OR REPLACE FUNCTION increment_promo_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE promo_codes 
  SET current_uses = current_uses + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE code = NEW.promo_code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_promo_usage
AFTER INSERT ON promo_usage
FOR EACH ROW
EXECUTE FUNCTION increment_promo_usage();

-- Verification queries
-- Check if migration succeeded:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customers' AND column_name IN ('promo_code', 'discount_percent', 'discount_months');
-- SELECT * FROM promo_codes;
