"""Authentication primitives for the local SchemaCraft application.

The browser UI is intentionally served only on the loopback interface, but a
loopback binding is not an authentication boundary: another local process can
still contact the port.  This module supplies the short-lived capability used
by the splash window and the HttpOnly session cookie required by data APIs.

Passwords are one-way hashed with bcrypt.  Record data is not passed through
bcrypt because password hashing is deliberately irreversible and therefore
cannot be used as application-data encryption.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Any

import bcrypt

BCRYPT_ROUNDS = 12
SESSION_COOKIE_NAME = "schemacraft_session"
SESSION_LIFETIME_SECONDS = 12 * 60 * 60


def bcrypt_hash_password(password: str, *, rounds: int = BCRYPT_ROUNDS) -> str:
    """Return an encoded bcrypt hash for a validated plaintext password."""

    if not isinstance(password, str):
        raise TypeError("password must be text")
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        raise ValueError("bcrypt passwords cannot exceed 72 UTF-8 bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=rounds)).decode("ascii")


def bcrypt_verify_password(password: Any, encoded_hash: str) -> bool:
    """Safely verify a candidate without exposing malformed-hash errors."""

    try:
        candidate = str(password or "").encode("utf-8")
        if len(candidate) > 72:
            return False
        return bcrypt.checkpw(candidate, encoded_hash.encode("ascii"))
    except (TypeError, ValueError, UnicodeError):
        return False


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def cookie_token(cookie_header: str | None) -> str:
    """Extract the SchemaCraft session token from an HTTP Cookie header."""

    if not cookie_header:
        return ""
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except (TypeError, ValueError):
        return ""
    morsel = cookie.get(SESSION_COOKIE_NAME)
    return morsel.value if morsel is not None else ""


@dataclass
class _Session:
    user_name: str
    expires_at: float


class BrowserSessionManager:
    """Own one launch capability and the authenticated browser sessions."""

    def __init__(self, *, lifetime_seconds: int = SESSION_LIFETIME_SECONDS) -> None:
        self.lifetime_seconds = max(300, int(lifetime_seconds))
        self.startup_token = secrets.token_urlsafe(32)
        self._startup_token_active = True
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.RLock()

    def startup_token_matches(self, candidate: Any) -> bool:
        """Return True only for the unconsumed per-process launch token."""

        text = str(candidate or "")
        with self._lock:
            return self._startup_token_active and secrets.compare_digest(
                text,
                self.startup_token,
            )

    def create_session(self, user_name: str, startup_token: Any) -> str:
        """Consume the launch token and return a new random browser token."""

        clean_user = " ".join(str(user_name or "").split())[:160]
        if not clean_user:
            raise ValueError("user_name is required")
        with self._lock:
            if not self.startup_token_matches(startup_token):
                raise PermissionError("invalid or expired startup token")
            self._startup_token_active = False
            self._sessions.clear()
            token = secrets.token_urlsafe(48)
            self._sessions[_token_digest(token)] = _Session(
                user_name=clean_user,
                expires_at=time.monotonic() + self.lifetime_seconds,
            )
            return token

    def authenticated_user(self, cookie_header: str | None) -> str:
        """Return the current user for a valid cookie, otherwise an empty string."""

        token = cookie_token(cookie_header)
        if not token:
            return ""
        digest = _token_digest(token)
        now = time.monotonic()
        with self._lock:
            session = self._sessions.get(digest)
            if session is None:
                return ""
            if session.expires_at <= now:
                self._sessions.pop(digest, None)
                return ""
            session.expires_at = now + self.lifetime_seconds
            return session.user_name

    def invalidate_all(self) -> None:
        """Revoke every authenticated browser session."""

        with self._lock:
            self._sessions.clear()

    def set_cookie_header(self, token: str) -> str:
        """Build the local HttpOnly SameSite session cookie header."""

        return (
            f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; "
            f"SameSite=Strict; Max-Age={self.lifetime_seconds}"
        )

    def clear_cookie_header(self) -> str:
        """Expire the browser cookie when the desktop application closes."""

        return (
            f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; "
            "SameSite=Strict; Max-Age=0"
        )


class AuthenticationThrottle:
    """Bound repeated password attempts without storing submitted secrets."""

    def __init__(self, *, base_delay: float = 0.2, maximum_delay: float = 3.0) -> None:
        self.base_delay = max(0.0, float(base_delay))
        self.maximum_delay = max(self.base_delay, float(maximum_delay))
        self._failures = 0
        self._lock = threading.Lock()

    def wait_before_attempt(self) -> None:
        """Apply a capped exponential delay after prior failures."""

        with self._lock:
            failures = self._failures
        if failures:
            time.sleep(min(self.maximum_delay, self.base_delay * (2 ** (failures - 1))))

    def record(self, success: bool) -> None:
        """Reset the throttle after success or increment it after failure."""

        with self._lock:
            self._failures = 0 if success else min(self._failures + 1, 8)
