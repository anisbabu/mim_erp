-- V31 — Link each customer to the employee (salesperson) who looks after them.
ALTER TABLE customer ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES employee(id);
CREATE INDEX IF NOT EXISTS idx_customer_salesperson ON customer(salesperson_id);
