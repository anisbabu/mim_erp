package com.mim.erp.hr;

import com.mim.erp.common.ApiException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/hr/employees")
public class EmployeeController {

    private final EmployeeRepository repo;

    public EmployeeController(EmployeeRepository repo) { this.repo = repo; }

    @GetMapping
    public List<Employee> list() { return repo.findAllByOrderByCode(); }

    @GetMapping("/{id}")
    public Employee one(@PathVariable UUID id) {
        return repo.findById(id).orElseThrow(() -> new ApiException("Employee not found"));
    }

    @PostMapping
    public Employee create(@RequestBody Employee in) {
        if (in.getCode() == null || in.getCode().isBlank())
            throw new ApiException("Employee code is required");
        if (in.getName() == null || in.getName().isBlank())
            throw new ApiException("Employee name is required");
        in.setId(null);
        return repo.save(in);
    }

    @PutMapping("/{id}")
    public Employee update(@PathVariable UUID id, @RequestBody Employee in) {
        Employee e = repo.findById(id).orElseThrow(() -> new ApiException("Employee not found"));
        e.setCode(in.getCode());
        e.setName(in.getName());
        e.setNameBn(in.getNameBn());
        e.setDesignation(in.getDesignation());
        e.setDesignationBn(in.getDesignationBn());
        e.setShopId(in.getShopId());
        e.setMobile(in.getMobile());
        e.setAddress(in.getAddress());
        e.setJoiningDate(in.getJoiningDate());
        e.setSalaryType(in.getSalaryType());
        e.setBasicSalary(in.getBasicSalary());
        e.setHouseRent(in.getHouseRent());
        e.setMedical(in.getMedical());
        e.setTransport(in.getTransport());
        e.setOtherAllowance(in.getOtherAllowance());
        e.setOvertimeRate(in.getOvertimeRate());
        e.setActive(in.isActive());
        return repo.save(e);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable UUID id) {
        try { repo.deleteById(id); }
        catch (DataIntegrityViolationException ex) {
            throw new ApiException("Cannot delete — this employee has payroll records. Deactivate instead.");
        }
    }
}
