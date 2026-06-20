package com.mim.erp.auth;

import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService service;

    public UserController(UserService service) { this.service = service; }

    @GetMapping
    public List<AuthDtos.UserView> list() {
        return service.list().stream().map(u -> new AuthDtos.UserView(
            u.getId(), u.getUsername(), u.getFullName(), u.getRole(),
            u.isActive(), u.getShopIds())).toList();
    }

    @PostMapping
    public AuthDtos.UserView create(@RequestBody AuthDtos.CreateUserRequest req) {
        AppUser u = service.create(req.username(), req.password(), req.fullName(),
            req.role(), req.shopIds());
        return new AuthDtos.UserView(u.getId(), u.getUsername(), u.getFullName(),
            u.getRole(), u.isActive(), u.getShopIds());
    }

    @PutMapping("/{id}")
    public AuthDtos.UserView update(@PathVariable UUID id,
                                    @RequestBody AuthDtos.UpdateUserRequest req) {
        AppUser u = service.update(id, req.username(), req.password(), req.fullName(), req.role(), req.shopIds(), req.active());
        return new AuthDtos.UserView(u.getId(), u.getUsername(), u.getFullName(),
            u.getRole(), u.isActive(), u.getShopIds());
    }
}
