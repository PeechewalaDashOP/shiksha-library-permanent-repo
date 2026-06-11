-- ============================================================
-- SHIKSHA LIBRARY - SUPABASE DATABASE SETUP
-- Paste this entire file in Supabase → SQL Editor → Run
-- ============================================================

-- 1. PLANS TABLE (admin can update prices here)
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  duration TEXT NOT NULL,
  shift TEXT NOT NULL,
  section TEXT NOT NULL,
  price INTEGER NOT NULL,
  original_price INTEGER,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert all plans with correct prices
INSERT INTO plans (id, name, duration, shift, section, price, original_price, description) VALUES
  ('monthly-morning-regular',    'Morning Shift',       '1 Month',  'Morning',  'Regular', 500,  null, '6:00 AM – 2:00 PM'),
  ('monthly-evening-regular',    'Evening Shift',       '1 Month',  'Evening',  'Regular', 600,  null, '2:00 PM – 10:00 PM'),
  ('monthly-fullday-regular',    'Full Day',            '1 Month',  'Full Day', 'Regular', 1000, null, '24×7 Access'),
  ('monthly-morning-prime',      'Prime Morning Shift', '1 Month',  'Morning',  'Prime',   600,  null, '6:00 AM – 2:00 PM · Fixed Seat'),
  ('monthly-evening-prime',      'Prime Evening Shift', '1 Month',  'Evening',  'Prime',   700,  null, '2:00 PM – 10:00 PM · Fixed Seat'),
  ('monthly-fullday-prime',      'Prime Full Day',      '1 Month',  'Full Day', 'Prime',   1200, null, '24×7 Access · Fixed Seat'),
  ('15days-morning-regular',     'Morning Shift',       '15 Days',  'Morning',  'Regular', 300,  null, '6:00 AM – 2:00 PM'),
  ('15days-evening-regular',     'Evening Shift',       '15 Days',  'Evening',  'Regular', 350,  null, '2:00 PM – 10:00 PM'),
  ('15days-fullday-regular',     'Full Day',            '15 Days',  'Full Day', 'Regular', 600,  null, '24×7 Access'),
  ('15days-morning-prime',       'Prime Morning Shift', '15 Days',  'Morning',  'Prime',   350,  null, '6:00 AM – 2:00 PM · Fixed Seat'),
  ('15days-evening-prime',       'Prime Evening Shift', '15 Days',  'Evening',  'Prime',   400,  null, '2:00 PM – 10:00 PM · Fixed Seat'),
  ('3month-morning-regular',     'Morning Shift',       '3 Months', 'Morning',  'Regular', 1200, 1500, '6:00 AM – 2:00 PM · Save ₹300'),
  ('3month-evening-regular',     'Evening Shift',       '3 Months', 'Evening',  'Regular', 1500, 1800, '2:00 PM – 10:00 PM · Save ₹300'),
  ('3month-fullday-regular',     'Full Day',            '3 Months', 'Full Day', 'Regular', 2700, 3000, '24×7 Access · Save ₹300'),
  ('3month-morning-prime',       'Prime Morning Shift', '3 Months', 'Morning',  'Prime',   1500, 1800, '6:00 AM – 2:00 PM · Fixed Seat · Save ₹300'),
  ('3month-evening-prime',       'Prime Evening Shift', '3 Months', 'Evening',  'Prime',   1800, 2100, '2:00 PM – 10:00 PM · Fixed Seat · Save ₹300'),
  ('3month-fullday-prime',       'Prime Full Day',      '3 Months', 'Full Day', 'Prime',   3300, 3600, '24×7 Access · Fixed Seat · Save ₹300');

-- 2. STUDENTS TABLE
CREATE TABLE students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  exam_target TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. MEMBERSHIPS TABLE
CREATE TABLE memberships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id),
  fixed_seat BOOLEAN DEFAULT false,
  amount_paid INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. PAYMENTS TABLE (full payment log)
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id),
  membership_id UUID REFERENCES memberships(id),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  plan_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. ROW LEVEL SECURITY (students can only see their own data)
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Plans are public readable
CREATE POLICY "Plans are viewable by everyone" ON plans FOR SELECT USING (true);

-- Students can read/update their own profile
CREATE POLICY "Students can view own profile" ON students FOR SELECT USING (auth.uid() = auth_user_id);
CREATE POLICY "Students can update own profile" ON students FOR UPDATE USING (auth.uid() = auth_user_id);

-- Students can see their own memberships
CREATE POLICY "Students can view own memberships" ON memberships
  FOR SELECT USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));

-- Students can see their own payments
CREATE POLICY "Students can view own payments" ON payments
  FOR SELECT USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));

-- Service role can do everything (used by Netlify functions)
CREATE POLICY "Service role full access students" ON students FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access memberships" ON memberships FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access payments" ON payments FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- DONE! Your database is ready.
-- ============================================================
