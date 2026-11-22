export const AUTH_API_URL = "/api/auth";
export const AUTH_LOGIN_PATH = "/api/auth/login";
export const AUTH_SIGNUP_PATH = "/api/auth/signup";
export const AUTH_LOGOUT_PATH = "/api/auth/logout";

export const TOKEN_STORAGE_KEY = "rc_auth_token";
/** Retained for backward compatibility when reading or clearing older sessions. */
export const LEGACY_TOKEN_STORAGE_KEY = "token";
export const USER_STORAGE_KEY = "rc_user";
/** Prevents automatic token restoration on reload after an explicit logout. */
export const LOGGED_OUT_STORAGE_KEY = "rc_logged_out";
