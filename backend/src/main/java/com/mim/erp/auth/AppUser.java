package com.mim.erp.auth;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

@Entity @Table(name = "app_user")
@Getter @Setter
public class AppUser {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String username;
    private String passwordHash;
    private String fullName;
    private String fullNameBn;
    private String mobile;
    private String role;            // SALESPERSON | MANAGER | ACCOUNTANT | ADMIN
    private boolean active = true;
    /** ADMIN who may also read the activity log. Set only by migration / SQL, never through the API. */
    @Column(name = "super_admin")
    private boolean superAdmin = false;

    /** Shops this user is assigned to. Empty for ADMIN/ACCOUNTANT (company-wide). */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_shop", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "shop_id")
    private Set<UUID> shopIds = new HashSet<>();

    public boolean isSuperAdmin() { return superAdmin; }
}
