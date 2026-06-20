package com.mim.erp.auth;

import com.mim.erp.common.ApiException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class UserService {

    private final AppUserRepository users;
    private final PasswordEncoder encoder;

    public UserService(AppUserRepository users, PasswordEncoder encoder) {
        this.users = users; this.encoder = encoder;
    }

    @Transactional
    public AppUser create(String username, String password, String fullName,
                          String role, Set<UUID> shopIds) {
        if (username == null || username.isBlank())
            throw new ApiException("Username is required");
        if (password == null || password.length() < 6)
            throw new ApiException("Password must be at least 6 characters");
        if (users.findByUsername(username).isPresent())
            throw new ApiException("Username already taken");

        Set<UUID> shops = shopIds == null ? new HashSet<>() : shopIds;

        // shop-assignment rules per role
        switch (role) {
            case "SALESPERSON" -> {
                if (shops.size() != 1)
                    throw new ApiException("A salesperson must be assigned to exactly one shop");
            }
            case "MANAGER" -> {
                if (shops.isEmpty())
                    throw new ApiException("A manager must be assigned to at least one shop");
            }
            case "ADMIN", "ACCOUNTANT" -> shops = new HashSet<>(); // company-wide, no binding
            default -> throw new ApiException("Unknown role: " + role);
        }

        AppUser u = new AppUser();
        u.setUsername(username);
        u.setPasswordHash(encoder.encode(password));
        u.setFullName(fullName);
        u.setRole(role);
        u.setShopIds(shops);
        return users.save(u);
    }

    @Transactional
    public AppUser update(UUID id, String username, String password, String fullName, String role, Set<UUID> shopIds, Boolean active) {
        AppUser u = users.findById(id)
            .orElseThrow(() -> new ApiException("User not found"));

        if (username != null && !username.isBlank() && !username.equals(u.getUsername())) {
            if (users.findByUsername(username).isPresent())
                throw new ApiException("Username already taken");
            u.setUsername(username);
        }

        Set<java.util.UUID> shops = shopIds == null ? new HashSet<>() : shopIds;
        switch (role) {
            case "SALESPERSON" -> {
                if (shops.size() != 1)
                    throw new ApiException("A salesperson must be assigned to exactly one shop");
            }
            case "MANAGER" -> {
                if (shops.isEmpty())
                    throw new ApiException("A manager must be assigned to at least one shop");
            }
            case "ADMIN", "ACCOUNTANT" -> shops = new HashSet<>();
            default -> throw new ApiException("Unknown role: " + role);
        }
        if (password != null && password.length() >= 6)
            u.setPasswordHash(encoder.encode(password));
        else if (password != null && !password.isEmpty())
            throw new ApiException("Password must be at least 6 characters");
        if (fullName != null) u.setFullName(fullName);
        u.setRole(role);
        u.setShopIds(shops);
        if (active != null) u.setActive(active);
        return users.save(u);
    }

    public List<AppUser> list() { return users.findAllByOrderByUsername(); }
}
