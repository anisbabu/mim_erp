package com.mim.erp.auth;

import java.util.Set;
import java.util.UUID;

public class AuthDtos {
    public record LoginRequest(String username, String password) {}
    public record LoginResponse(String token, String username, String fullName,
                                String role, Set<UUID> shopIds) {}
    public record CreateUserRequest(String username, String password, String fullName,
                                    String role, Set<UUID> shopIds) {}
    public record UserView(UUID id, String username, String fullName, String role,
                           boolean active, Set<UUID> shopIds) {}
    public record UpdateUserRequest(String username, String password, String fullName, String role, Set<UUID> shopIds, Boolean active) {}
}
