# SESSION-07 — atom-studio: Backend + Auth + Domains

**Prerequisites:** SESSION-06 complete
**Goal:** Build the atom-studio FastAPI backend from scratch — project setup, JWT auth, domain management API, and the React frontend skeleton with login page.
**Estimated time:** 1.5 days

---

## Context

atom-studio is a **new service built from scratch** (ADR-015). It is NOT a fork of
agentscope-studio. agentscope-studio is a Node.js visualization tool — it has no Python
backend, no auth, and no management APIs.

atom-studio has two parts:
- `atom-studio/backend/` — FastAPI (Python), port 3001
- `atom-studio/frontend/` — React + Vite + shadcn/ui, port 3000 (prod nginx) / 5173 (dev)

The backend uses the **same RS256 key pair** as GATE. Tokens issued by atom-studio backend
are validated by GATE — one key pair, one trust root.

---

## Part 1 — Backend

### 1. Project scaffold

The `atom-studio/backend/` directory with `pyproject.toml` and `Dockerfile` already exists
as stubs. Install and verify:

```bash
cd atom-studio/backend
pip install -e ".[dev]"
uvicorn atom_studio.main:app --reload --port 3001
# Should start (even with stub — will error on the raise, that's expected until we implement)
```

### 2. Config (`src/atom_studio/config.py`)

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str
    jwt_private_key_path: str
    jwt_public_key_path: str
    atom_encryption_key: str          # AES-GCM key for encrypting LiteLLM virtual keys
    atom_llm_url: str = "http://atom-llm:4000"
    atom_runtime_url: str = "http://atom-runtime:8090"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

### 3. Database (`src/atom_studio/database.py`)

```python
import asyncpg
from contextlib import asynccontextmanager
from .config import get_settings

_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(get_settings().database_url, min_size=2, max_size=10)
    return _pool

@asynccontextmanager
async def db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn
```

### 4. Auth module (`src/atom_studio/auth/`)

**`router.py`** — endpoints:
- `POST /api/auth/register` — email + password → insert to `users` table (bcrypt hash)
- `POST /api/auth/login` → `{ access_token, refresh_token, token_type }`
- `POST /api/auth/refresh` → new access token
- `POST /api/auth/logout` → revoke refresh token (Redis blocklist)
- `GET  /api/auth/me` → current user profile

**`service.py`** — business logic:
```python
def hash_password(password: str) -> str: ...
def verify_password(plain: str, hashed: str) -> bool: ...
def create_access_token(user_id: str, role: str) -> str:
    # RS256 JWT signed with platform private key
    # payload: { sub: user_id, type: "human", role, iat, exp, iss: "atom-studio" }
def create_refresh_token(user_id: str) -> str: ...
def decode_token(token: str) -> dict: ...    # validates with public key
```

**`middleware.py`** — FastAPI dependency:
```python
async def require_auth(token: str = Depends(oauth2_scheme)) -> dict:
    # Decodes + validates JWT, returns claims dict
    # Raises 401 if invalid/expired

async def require_admin(claims: dict = Depends(require_auth)) -> dict:
    if claims["role"] != "admin":
        raise HTTPException(403, "Admin required")
    return claims
```

**JWT payload for human users:**
```json
{
  "sub": "user-{uuid}",
  "type": "human",
  "role": "admin|developer",
  "iat": 1234567890,
  "exp": 1234568790,
  "iss": "atom-studio"
}
```

This is validated by GATE using the platform public key — same key pair, no extra config.

### 5. Domains module (`src/atom_studio/domains/`)

**`router.py`** — endpoints:
- `GET    /api/domains`          — list all domains
- `POST   /api/domains`          — create domain `{ name, description }`
- `GET    /api/domains/{id}`     — get domain + agent count
- `PATCH  /api/domains/{id}`     — update name/description
- `DELETE /api/domains/{id}`     — soft-delete (`is_active=false`)

All endpoints require `Depends(require_auth)`.

### 6. User management (`src/atom_studio/auth/users_router.py`)

- `GET    /api/users`                — list users (admin only)
- `POST   /api/users/invite`         — create user with temp password (admin only)
- `PATCH  /api/users/{id}/role`      — change role admin ↔ developer (admin only)
- `PATCH  /api/users/{id}/deactivate` — deactivate user

### 7. Main app (`src/atom_studio/main.py`)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import get_pool
from .auth.router import router as auth_router
from .auth.users_router import router as users_router
from .domains.router import router as domains_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()   # warm connection pool on startup
    yield

app = FastAPI(title="ATOM Studio API", version="0.1.0", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(auth_router,    prefix="/api/auth",    tags=["auth"])
app.include_router(users_router,   prefix="/api/users",   tags=["users"])
app.include_router(domains_router, prefix="/api/domains", tags=["domains"])

@app.get("/healthz")
async def health(): return {"status": "ok"}
```

---

## Part 2 — Frontend

### 8. Bootstrap the React project

```bash
cd atom-studio/frontend
npm install    # installs from the existing package.json stub
```

Install shadcn/ui:
```bash
npx shadcn-ui@latest init
# Choose: TypeScript, Tailwind, src/components/ui, CSS variables
npx shadcn-ui@latest add button input label card form toast badge table
```

### 9. API client (`src/lib/api.ts`)

```typescript
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
})

// Attach access token to every request
api.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-refresh on 401
api.interceptors.response.use(
  r => r,
  async error => {
    if (error.response?.status === 401) {
      await useAuthStore.getState().refresh()
      return api.request(error.config)
    }
    return Promise.reject(error)
  }
)

export default api
```

### 10. Auth store (`src/lib/auth.ts`)

```typescript
import { create } from 'zustand'
import api from './api'

interface AuthState {
  user: User | null
  accessToken: string | null
  login: (email: string, password: string) => Promise<void>
  refresh: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>(set => ({
  user: null,
  accessToken: localStorage.getItem('access_token'),
  login: async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password })
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    set({ accessToken: data.access_token })
    const me = await api.get('/api/auth/me')
    set({ user: me.data })
  },
  refresh: async () => {
    const rt = localStorage.getItem('refresh_token')
    const { data } = await api.post('/api/auth/refresh', { refresh_token: rt })
    localStorage.setItem('access_token', data.access_token)
    set({ accessToken: data.access_token })
  },
  logout: () => {
    localStorage.clear()
    set({ user: null, accessToken: null })
  },
}))
```

### 11. Pages to build in this session

**Login page** (`src/pages/Login.tsx`)
- Email + password form using shadcn Form + Input + Button
- On success → redirect to `/domains`
- On error → show toast

**Domains page** (`src/pages/Domains.tsx`)
- Table of domains: name, description, agent count, owner, created date
- "New Domain" button → modal with name + description fields
- Click row → navigate to `/domains/:id` (stub — wired in SESSION-08)

**Layout** (`src/components/app/Layout.tsx`)
- Sidebar with: Domains, Agents (greyed out — SESSION-08), HITL (greyed out), Audit Log (greyed out)
- Top bar: user avatar, role badge, logout
- Route guard: redirect to `/login` if no token

---

## Acceptance Criteria

- [ ] `uvicorn atom_studio.main:app --port 3001` starts without error
- [ ] `GET /healthz` → `{ "status": "ok" }`
- [ ] `POST /api/auth/register` → creates user in `users` table
- [ ] `POST /api/auth/login` → returns `{ access_token, refresh_token }`
- [ ] `GET /api/auth/me` with valid token → returns user profile
- [ ] `GET /api/auth/me` without token → 401
- [ ] `POST /api/domains` → creates domain, returns domain with UUID
- [ ] `GET /api/domains` → returns list
- [ ] `DELETE /api/domains/{id}` → sets `is_active=false`
- [ ] Frontend login page renders at `http://localhost:5173`
- [ ] Login → redirects to domains list, shows domains from backend
- [ ] Unauthenticated route access → redirects to `/login`
- [ ] `pytest src/` — auth and domain tests pass

---

## Claude Code Starter Prompt

```
You are implementing SESSION-07 of ATOM — building atom-studio backend (FastAPI) and
frontend (React + Vite) from scratch.

Context:
- atom-studio/ has backend/ and frontend/ stub directories already
- Postgres is running (from SESSION-01) with schema from SESSION-02
- The same RS256 key pair used by GATE is used here (.keys/jwt_private.pem + jwt_public.pem)
- Do NOT touch agentscope-studio/ — that is a separate visualization tool, not modified

Backend tasks (atom-studio/backend/):
1. Implement src/atom_studio/config.py — Pydantic Settings from env
2. Implement src/atom_studio/database.py — asyncpg connection pool with context manager
3. Implement src/atom_studio/auth/ — register, login, refresh, logout, me endpoints
   - Passwords: bcrypt via passlib
   - Tokens: RS256 via python-jose, signed with JWT_PRIVATE_KEY_PATH
   - Access token: 15min, payload: {sub, type:"human", role, iss:"atom-studio"}
   - Refresh token: 7 days, stored hash in Redis for revocation
4. Implement src/atom_studio/domains/ — full CRUD, soft-delete
5. Implement src/atom_studio/auth/users_router.py — user management (admin only)
6. Implement src/atom_studio/main.py — FastAPI app wiring all routers + CORS + lifespan
7. Write tests in src/tests/ for auth and domain endpoints

Frontend tasks (atom-studio/frontend/):
1. npm install
2. npx shadcn-ui@latest init + add button input label card form toast badge table
3. Implement src/lib/api.ts — axios instance with auth interceptor + auto-refresh
4. Implement src/lib/auth.ts — Zustand store with login/refresh/logout
5. Implement Login page with shadcn Form
6. Implement Domains page with Table + New Domain modal
7. Implement Layout with sidebar + route guard

After implementing, run both services and test the full login → view domains flow.
```
