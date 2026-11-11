package com.mim.erp.auth;

import java.util.UUID;

/**
 * Lightweight principal placed in the SecurityContext by the JWT filter.
 * {@code fullName} is the display name at sign-in (null on tokens issued before it was added).
 */
public record AuthPrincipal(UUID userId, String username, String role, String fullName) {}
