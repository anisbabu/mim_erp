package com.mim.erp.master;

import com.mim.erp.common.ApiException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/master")
public class MasterController {

    private final ProductRepository products;
    private final WarehouseRepository warehouses;
    private final SupplierRepository suppliers;
    private final ShopRepository shops;
    private final CustomerRepository customers;

    public MasterController(ProductRepository products, WarehouseRepository warehouses,
                            SupplierRepository suppliers, ShopRepository shops,
                            CustomerRepository customers) {
        this.products = products; this.warehouses = warehouses;
        this.suppliers = suppliers; this.shops = shops; this.customers = customers;
    }

    // ---- reads ----
    @GetMapping("/products")   public List<Product>   products()   { return products.findAll(); }
    @GetMapping("/warehouses") public List<Warehouse> warehouses() { return warehouses.findAll(); }
    @GetMapping("/suppliers")  public List<Supplier>  suppliers()  { return suppliers.findAll(); }
    @GetMapping("/shops")      public List<Shop>      shops()      { return shops.findAll(); }
    @GetMapping("/customers")  public List<Customer>  customers()  { return customers.findAll(); }

    // ---- create ----
    @PostMapping("/products")  public Product   saveProduct(@RequestBody Product p)   { return products.save(p); }
    @PostMapping("/suppliers") public Supplier  saveSupplier(@RequestBody Supplier s) { return suppliers.save(s); }
    @PostMapping("/customers") public Customer  saveCustomer(@RequestBody Customer c) {
        if ("PARTY".equals(c.getType()) && c.getCreditLimit() == null)
            throw new ApiException("Party customers need a credit limit");
        return customers.save(c);
    }
    @PostMapping("/warehouses") public Warehouse saveWarehouse(@RequestBody Warehouse w) { return warehouses.save(w); }
    @PostMapping("/shops")      public Shop      saveShop(@RequestBody Shop s)           { return shops.save(s); }

    // ---- update ----
    @PutMapping("/shops/{id}")
    public Shop updateShop(@PathVariable UUID id, @RequestBody Shop in) {
        Shop s = shops.findById(id).orElseThrow(() -> new ApiException("Shop not found"));
        s.setCode(in.getCode());
        s.setName(in.getName());
        s.setNameBn(in.getNameBn());
        s.setPrimaryLine(in.getPrimaryLine());
        s.setAddress(in.getAddress());
        s.setMobile(in.getMobile());
        s.setLocation(in.getLocation());
        s.setMonthlyTarget(in.getMonthlyTarget());
        s.setPettyCashFloat(in.getPettyCashFloat());
        return shops.save(s);
    }

    @PutMapping("/warehouses/{id}")
    public Warehouse updateWarehouse(@PathVariable UUID id, @RequestBody Warehouse in) {
        Warehouse w = warehouses.findById(id).orElseThrow(() -> new ApiException("Warehouse not found"));
        w.setCode(in.getCode());
        w.setName(in.getName());
        w.setNameBn(in.getNameBn());
        w.setAddress(in.getAddress());
        return warehouses.save(w);
    }

    @PutMapping("/products/{id}")
    public Product updateProduct(@PathVariable UUID id, @RequestBody Product in) {
        Product p = products.findById(id).orElseThrow(() -> new ApiException("Product not found"));
        p.setSku(in.getSku()); p.setName(in.getName()); p.setNameBn(in.getNameBn()); p.setType(in.getType());
        p.setThicknessMm(in.getThicknessMm()); p.setUnit(in.getUnit());
        p.setPriceLower(in.getPriceLower()); p.setPriceUpper(in.getPriceUpper());
        p.setSupplierId(in.getSupplierId()); p.setCategory(in.getCategory()); p.setColor(in.getColor());
        p.setFullName(in.getFullName());
        p.setActive(in.isActive());
        return products.save(p);
    }

    @PutMapping("/suppliers/{id}")
    public Supplier updateSupplier(@PathVariable UUID id, @RequestBody Supplier in) {
        Supplier s = suppliers.findById(id).orElseThrow(() -> new ApiException("Supplier not found"));
        s.setCode(in.getCode()); s.setName(in.getName()); s.setNameBn(in.getNameBn());
        s.setMobile(in.getMobile()); s.setAddress(in.getAddress());
        return suppliers.save(s);
    }

    @PutMapping("/customers/{id}")
    public Customer updateCustomer(@PathVariable UUID id, @RequestBody Customer in) {
        Customer c = customers.findById(id).orElseThrow(() -> new ApiException("Customer not found"));
        c.setCode(in.getCode()); c.setName(in.getName()); c.setNameBn(in.getNameBn()); c.setType(in.getType());
        c.setMobile(in.getMobile()); c.setAddress(in.getAddress());
        c.setCreditLimit(in.getCreditLimit()); c.setCreditDays(in.getCreditDays());
        c.setDeliveryAddress(in.getDeliveryAddress());
        c.setDeliveryLandmark(in.getDeliveryLandmark());
        c.setDeliveryContactName(in.getDeliveryContactName());
        c.setDeliveryContactPhone(in.getDeliveryContactPhone());
        c.setDeliveryNote(in.getDeliveryNote());
        c.setDeliveryMapLink(in.getDeliveryMapLink());
        return customers.save(c);
    }

    // ---- delete (guards against rows still referenced by transactions) ----
    @DeleteMapping("/shops/{id}")
    public void deleteShop(@PathVariable UUID id) { guardedDelete(() -> shops.deleteById(id), "shop"); }

    @DeleteMapping("/warehouses/{id}")
    public void deleteWarehouse(@PathVariable UUID id) { guardedDelete(() -> warehouses.deleteById(id), "warehouse"); }

    @DeleteMapping("/products/{id}")
    public void deleteProduct(@PathVariable UUID id) { guardedDelete(() -> products.deleteById(id), "product"); }

    @DeleteMapping("/suppliers/{id}")
    public void deleteSupplier(@PathVariable UUID id) { guardedDelete(() -> suppliers.deleteById(id), "supplier"); }

    @DeleteMapping("/customers/{id}")
    public void deleteCustomer(@PathVariable UUID id) { guardedDelete(() -> customers.deleteById(id), "customer"); }

    private void guardedDelete(Runnable delete, String what) {
        try {
            delete.run();
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException("Cannot delete this " + what + " — it is already used by other records. Deactivate it instead.");
        }
    }
}
