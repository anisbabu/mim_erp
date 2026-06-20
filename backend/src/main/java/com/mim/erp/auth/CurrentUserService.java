package com.mim.erp.auth;

import com.mim.erp.common.ApiException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class CurrentUserService {

    private final AppUserRepository users;

    public CurrentUserService(AppUserRepository users) { this.users = users; }

    public AuthPrincipal principal() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AuthPrincipal p))
            throw new ApiException("Not authenticated");
        return p;
    }

    /** The full user record (with assigned shops) for the current request. */
    public AppUser me() {
        return users.findById(principal().userId())
            .orElseThrow(() -> new ApiException("User no longer exists"));
    }
}
