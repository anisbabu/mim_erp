package com.mim.erp.auth;

import com.mim.erp.common.ApiException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final CurrentUserService currentUser;

    public AuthController(AppUserRepository users, PasswordEncoder encoder,
                          JwtService jwt, CurrentUserService currentUser) {
        this.users = users; this.encoder = encoder;
        this.jwt = jwt; this.currentUser = currentUser;
    }

    @PostMapping("/login")
    public AuthDtos.LoginResponse login(@RequestBody AuthDtos.LoginRequest req) {
        AppUser u = users.findByUsername(req.username())
            .orElseThrow(() -> new ApiException("Invalid username or password"));
        if (!u.isActive())
            throw new ApiException("Your account is disabled. Please contact the IT head.");
        if (!encoder.matches(req.password(), u.getPasswordHash()))
            throw new ApiException("Invalid username or password");
        return new AuthDtos.LoginResponse(jwt.issue(u), u.getUsername(),
            u.getFullName(), u.getRole(), u.getShopIds());
    }

    /** Profile of the currently authenticated user (drives the UI). */
    @GetMapping("/me")
    public AuthDtos.LoginResponse me() {
        AppUser u = currentUser.me();
        return new AuthDtos.LoginResponse(null, u.getUsername(),
            u.getFullName(), u.getRole(), u.getShopIds());
    }
}
