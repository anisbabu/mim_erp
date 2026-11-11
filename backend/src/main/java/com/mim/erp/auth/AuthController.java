package com.mim.erp.auth;

import com.mim.erp.audit.AuditService;
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
    private final AuditService audit;

    public AuthController(AppUserRepository users, PasswordEncoder encoder,
                          JwtService jwt, CurrentUserService currentUser, AuditService audit) {
        this.users = users; this.encoder = encoder;
        this.jwt = jwt; this.currentUser = currentUser;
        this.audit = audit;
    }

    @PostMapping("/login")
    public AuthDtos.LoginResponse login(@RequestBody AuthDtos.LoginRequest req) {
        // every outcome goes to the activity log; the attempted password never does
        AppUser u = users.findByUsername(req.username()).orElse(null);
        if (u == null) {
            audit.loginFailed(null, req.username(), "unknown_user");
            throw new ApiException("Invalid username or password");
        }
        if (!u.isActive()) {
            audit.loginFailed(u, req.username(), "account_disabled");
            throw new ApiException("Your account is disabled. Please contact the IT head.");
        }
        if (req.password() == null || !encoder.matches(req.password(), u.getPasswordHash())) {
            audit.loginFailed(u, req.username(), "wrong_password");
            throw new ApiException("Invalid username or password");
        }
        audit.login(u);
        return new AuthDtos.LoginResponse(jwt.issue(u), u.getUsername(),
            u.getFullName(), u.getRole(), u.getShopIds());
    }

    /**
     * Tokens are stateless, so signing out is the client dropping its token; this call only records
     * it in the activity log. A token that simply expires leaves no logout entry.
     */
    @PostMapping("/logout")
    public void logout() {
        AuthPrincipal p = currentUser.principal();
        audit.logout(p.userId(), p.username(), p.fullName(), p.role());
    }

    /** Profile of the currently authenticated user (drives the UI). */
    @GetMapping("/me")
    public AuthDtos.LoginResponse me() {
        AppUser u = currentUser.me();
        return new AuthDtos.LoginResponse(null, u.getUsername(),
            u.getFullName(), u.getRole(), u.getShopIds());
    }
}
