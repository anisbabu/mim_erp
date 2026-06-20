package com.mim.erp.common;

/** Business-rule violation surfaced to the client as HTTP 422. */
public class ApiException extends RuntimeException {
    public ApiException(String message) { super(message); }
}
