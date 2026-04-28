# SESSION-07 — atom-studio Auth + Domain Management

**Prerequisites:** SESSION-06 complete  
**Goal:** Add JWT authentication and domain management to atom-studio, built on the existing agentscope-studio stack.  
**Estimated time:** 1.5 days

---

## Tasks

1. **Inspect agentscope-studio stack**  
   Check `atom-studio/` for existing backend framework (FastAPI or Flask) and frontend
   framework (Vue/React). Note versions and entry points in `atom-studio/UPSTREAM_DIFF.md`.

2. **Auth backend** (`atom-studio/src/atom_auth/`)
   
   `auth.py`:
   - `POST /api/auth/register` — create user in Postgres (bcrypt password hash).
   - `POST /api/auth/login` — validate password, issue RS256 JWT (access: 15min, refresh: 7d).
   - `POST /api/auth/refresh` — validate refresh token, issue new access token.
   - `POST /api/auth/logout` — revoke refresh token.
   - `GET /api/auth/me` — return current user profile.
   
   JWT payload:
   ```json
   { "sub": "user-uuid", "type": "human", "role": "admin|developer",
     "iat": ..., "exp": ..., "iss": "atom-studio" }
   ```

3. **Auth middleware** — FastAPI dependency that validates the JWT on protected routes.
   Add to all routes except `/api/auth/*` and health endpoints.

4. **Domain API** (`atom-studio/src/atom_domains/`)
   - `GET    /api/domains`              — list domains
   - `POST   /api/domains`              — create domain
   - `GET    /api/domains/{id}`         — get domain
   - `PATCH  /api/domains/{id}`         — update name/description
   - `DELETE /api/domains/{id}`         — soft-delete (is_active=false)

5. **User management API** (`atom-studio/src/atom_users/`)
   - `GET    /api/users`                — list users (admin only)
   - `POST   /api/users/invite`         — create inactive user with temp password
   - `PATCH  /api/users/{id}/role`      — change role (admin only)

6. **Frontend: Auth pages** (using the existing stack's component patterns)
   - Login page (`/login`)
   - Store access token in `sessionStorage`, refresh token in `httpOnly` cookie.
   - Redirect unauthenticated requests to `/login`.
   - Add user avatar + logout button to the header component.

7. **Frontend: Domain list page** (`/domains`)
   - Table of domains with name, agent count, owner.
   - Create domain modal.
   - Domain detail page with agent list (stub — wired in SESSION-08).

8. **Navigation structure**: add Domains, Agents, HITL, Audit Log to the sidebar.

---

## Technologies

| Technology | Rationale |
|---|---|
| bcrypt (passlib) | Industry standard for password hashing |
| python-jose / PyJWT | RS256 JWT generation and validation in Python |
| FastAPI | Existing agentscope-studio backend framework (confirm on inspection) |
| Existing frontend stack | Keep agentscope-studio's existing stack (Vue or React) |

---

## Acceptance Criteria

- [ ] `POST /api/auth/register` → creates user in `users` table.
- [ ] `POST /api/auth/login` with correct credentials → returns `{ access_token, refresh_token }`.
- [ ] Request to `GET /api/domains` without token → 401.
- [ ] `POST /api/domains` → creates domain, returns domain object with UUID.
- [ ] Frontend login page renders and redirects to dashboard on success.
- [ ] Studio runs on `http://localhost:3000` inside the kind cluster.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-07 of ATOM — auth and domain management in atom-studio.

Context:
- atom-studio/ is a fork of agentscope-studio. First, inspect it to understand the existing
  backend framework (FastAPI or Flask) and frontend stack (Vue or React).
- Postgres schema is already deployed (users, domains tables from SESSION-02).
- We must build ON TOP of the existing stack without replacing it.

Tasks:
1. Inspect atom-studio/ — find the backend entrypoint and frontend framework. Note in UPSTREAM_DIFF.md.
2. Add auth module to the backend:
   - POST /api/auth/register (bcrypt hash password, insert to users table)
   - POST /api/auth/login (verify bcrypt, issue RS256 JWT: access 15min, refresh 7d)
   - POST /api/auth/refresh (validate refresh, issue new access token)
   - GET /api/auth/me (return current user)
3. Add JWT validation middleware/dependency to protect all existing + new routes
4. Add domain CRUD endpoints: GET/POST /api/domains, GET/PATCH/DELETE /api/domains/{id}
5. Add user management: GET /api/users (admin only), PATCH /api/users/{id}/role
6. Frontend: add login page using the existing component framework
7. Frontend: add domain list page with create domain modal
8. Frontend: add auth token handling (access token in memory/sessionStorage, refresh cookie)
9. Update the sidebar navigation to include: Domains, Agents, HITL Queue, Audit Log

Run the studio and verify login + domain creation works end-to-end.
```

---

