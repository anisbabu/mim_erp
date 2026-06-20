package com.mim.erp.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.HashSet;

/** Seeds an initial ADMIN on first run so you can log in and create other users. */
@Component
public class AdminBootstrap implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final String adminUsername;
    private final String adminPassword;

    public AdminBootstrap(AppUserRepository users, PasswordEncoder encoder,
                          @Value("${mim.bootstrap.admin-username}") String adminUsername,
                          @Value("${mim.bootstrap.admin-password}") String adminPassword) {
        this.users = users; this.encoder = encoder;
        this.adminUsername = adminUsername; this.adminPassword = adminPassword;
    }

    @Override
    public void run(String... args) {
        if (users.existsByRole("ADMIN")) return;
        AppUser admin = new AppUser();
        admin.setUsername(adminUsername);
        admin.setPasswordHash(encoder.encode(adminPassword));
        admin.setFullName("System Administrator");
        admin.setRole("ADMIN");
        admin.setShopIds(new HashSet<>());
        users.save(admin);
        log.warn("Created initial admin user '{}'. CHANGE THE PASSWORD after first login.", adminUsername);
    }
}
