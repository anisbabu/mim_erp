package com.mim.erp.hr;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity @Table(name = "employee")
@Getter @Setter
public class Employee {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String designation;
    private String designationBn;
    @Column(name = "shop_id") private UUID shopId;
    private String mobile;
    private String address;
    private LocalDate joiningDate;

    // salary structure
    private String salaryType = "MONTHLY";   // MONTHLY | DAILY
    private BigDecimal basicSalary = BigDecimal.ZERO;   // monthly basic, or daily wage rate
    private BigDecimal houseRent = BigDecimal.ZERO;
    private BigDecimal medical = BigDecimal.ZERO;
    private BigDecimal transport = BigDecimal.ZERO;
    private BigDecimal otherAllowance = BigDecimal.ZERO;
    private BigDecimal overtimeRate = BigDecimal.ZERO;  // per hour
    private boolean active = true;

    /** Convenience: monthly gross = basic + all allowances. */
    @Transient
    public BigDecimal getGrossSalary() {
        return basicSalary.add(houseRent).add(medical).add(transport).add(otherAllowance);
    }
}
