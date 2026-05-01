CREATE TABLE contractors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  contractor_id INT REFERENCES contractors(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL, -- 'admin', 'site_engineer', 'foreman'
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE sites (
  id SERIAL PRIMARY KEY,
  contractor_id INT REFERENCES contractors(id),
  name TEXT NOT NULL,
  address TEXT,
  project_type TEXT, -- 'biogas plant', 'power plant', 'RCC building'
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE workers (
  id SERIAL PRIMARY KEY,
  contractor_id INT REFERENCES contractors(id),
  name TEXT NOT NULL,
  phone TEXT,
  rate NUMERIC(12,2), -- per day or per hour
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE activities (
  id SERIAL PRIMARY KEY,
  contractor_id INT REFERENCES contractors(id),
  site_id INT REFERENCES sites(id),
  title TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  location TEXT,
  trade TEXT, -- 'RCC shuttering','RCC concreting','bar-bending', etc.
  due_date DATE,
  status TEXT DEFAULT 'in_progress', -- 'in_progress','completed'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE approvals (
  id SERIAL PRIMARY KEY,
  activity_id INT REFERENCES activities(id),
  approved_by_worker_id INT REFERENCES workers(id),
  approved_at TIMESTAMP DEFAULT NOW(),
  photo_url TEXT,
  comment TEXT
);

CREATE TABLE costs (
  id SERIAL PRIMARY KEY,
  activity_id INT REFERENCES activities(id),
  labour_hours NUMERIC(12,2),
  labour_rate NUMERIC(12,2),
  labour_amount NUMERIC(12,2),
  material_amount NUMERIC(12,2),
  other_amount NUMERIC(12,2),
  total_cost NUMERIC(12,2),
  revenue NUMERIC(12,2),
  profit NUMERIC(12,2),
  profit_percent NUMERIC(5,2)
);