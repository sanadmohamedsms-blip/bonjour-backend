-- =============================================
-- BONJOUR TEAM - Complete Database Setup
-- Run this in your Supabase SQL Editor
-- =============================================

-- 1. BRANCHES
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_select" ON branches FOR SELECT USING (
  id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 2. USERS (extends auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  full_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'staff' CHECK (role IN ('admin','manager','staff')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (id = auth.uid());
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (id = auth.uid());

-- 3. ISLANDS
CREATE TABLE IF NOT EXISTS islands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number_of_gondolas INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE islands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "islands_branch_access" ON islands FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 4. GONDOLAS
CREATE TABLE IF NOT EXISTS gondolas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  island_id UUID NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  number_of_shelves INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gondolas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gondolas_branch_access" ON gondolas FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 5. SHELVES
CREATE TABLE IF NOT EXISTS shelves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  gondola_id UUID NOT NULL REFERENCES gondolas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shelves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shelves_branch_access" ON shelves FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 6. PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  barcode TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_branch_access" ON products FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 7. EXPIRATIONS
CREATE TABLE IF NOT EXISTS expirations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  expiration_date DATE NOT NULL,
  quantity INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expirations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expirations_branch_access" ON expirations FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 8. PRODUCT LOCATIONS
CREATE TABLE IF NOT EXISTS product_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  island_id UUID REFERENCES islands(id),
  gondola_id UUID REFERENCES gondolas(id),
  shelf_id UUID REFERENCES shelves(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE product_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_locations_branch_access" ON product_locations FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- 9. ISLAND PLANOGRAMS
CREATE TABLE IF NOT EXISTS island_planograms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  island_id UUID NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  planogram_data JSONB NOT NULL DEFAULT '{}',
  suggestion_data JSONB,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE island_planograms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "island_planograms_branch_access" ON island_planograms FOR ALL USING (
  branch_id IN (SELECT branch_id FROM users WHERE id = auth.uid())
);

-- =============================================
-- STORAGE BUCKETS
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT DO NOTHING;

CREATE POLICY "product_images_upload" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_select" ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_islands_updated_at BEFORE UPDATE ON islands FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_gondolas_updated_at BEFORE UPDATE ON gondolas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_shelves_updated_at BEFORE UPDATE ON shelves FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_expirations_updated_at BEFORE UPDATE ON expirations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_product_locations_updated_at BEFORE UPDATE ON product_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_island_planograms_updated_at BEFORE UPDATE ON island_planograms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- SEED: Default branch for new users
-- =============================================
INSERT INTO branches (id, name, address)
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Branch', 'Main Store')
ON CONFLICT DO NOTHING;

-- =============================================
-- DONE! All tables, RLS policies, storage, and triggers created.
-- =============================================
