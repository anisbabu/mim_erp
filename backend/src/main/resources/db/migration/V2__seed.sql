-- =====================================================================
-- V2 — Seed: Chart of Accounts + base master data
-- =====================================================================

-- ---- Chart of Accounts (minimal but complete for the flows) ----
INSERT INTO account (code, name, type) VALUES
 ('1000','Cash','ASSET'),
 ('1100','Accounts Receivable','ASSET'),
 ('1200','Inventory','ASSET'),
 ('1300','Petty Cash','ASSET'),
 ('2000','Accounts Payable','LIABILITY'),
 ('3000','Owner Equity','EQUITY'),
 ('4000','Sales Revenue','INCOME'),
 ('5000','Cost of Goods Sold','EXPENSE'),
 ('5100','Inventory Loss (Damage/Count)','EXPENSE'),
 ('5200','Shop Expenses','EXPENSE');

-- ---- Warehouses ----
INSERT INTO warehouse (code, name) VALUES
 ('WH1','Warehouse 1'),('WH2','Warehouse 2'),('WH3','Warehouse 3'),
 ('WH4','Warehouse 4'),('WH5','Warehouse 5');

-- ---- Shops (2 hardware, 3 board) ----
INSERT INTO shop (code, name, primary_line, monthly_target, petty_cash_float) VALUES
 ('SHOP1','Shop 1','BOARD',    500000, 10000),
 ('SHOP2','Shop 2','BOARD',    500000, 10000),
 ('SHOP3','Shop 3','BOARD',    500000, 10000),
 ('SHOP4','Shop 4','HARDWARE', 300000, 10000),
 ('SHOP5','Shop 5','HARDWARE', 300000, 10000);

-- ---- Sample products ----
INSERT INTO product (sku, name, type, thickness_mm, price_lower, price_upper) VALUES
 ('BRD-18','Plywood Board 18mm','BOARD',18, 1300, 1500),
 ('BRD-12','Plywood Board 12mm','BOARD',12,  950, 1150),
 ('BRD-06','Plywood Board 6mm', 'BOARD', 6,  600,  750);
INSERT INTO product (sku, name, type, price_lower, price_upper) VALUES
 ('HW-HINGE','Door Hinge 4in','HARDWARE', 40,  70),
 ('HW-SCREW','Wood Screw 2in (box)','HARDWARE', 120, 180);
