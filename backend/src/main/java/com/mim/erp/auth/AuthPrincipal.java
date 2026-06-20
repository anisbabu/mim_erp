package com.mim.erp.auth;

import java.util.UUID;

/** Lightweight principal placed in the SecurityContext by the JWT filter. */
public record AuthPrincipal(UUID userId, String username, String role) {}
