CREATE TABLE vendors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tax_id TEXT,
  contact_email TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO vendors (name, tax_id, contact_email) VALUES
  ('Acme Office Supplies', 'PH-123-456-789', 'billing@acme-supplies.ph'),
  ('Manila Electric Company', 'PH-987-654-321', 'billing@meralco.ph'),
  ('Philippine Long Distance Telephone', 'PH-555-123-456', 'billing@pldt.ph'),
  ('Jollibee Corporate Services', 'PH-777-888-999', 'accounts@jollibee.com.ph'),
  ('San Miguel Distribution', 'PH-111-222-333', 'invoices@sanmiguel.com.ph');
