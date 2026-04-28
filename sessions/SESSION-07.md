# SESSION-07 — atom-studio: Backend + Auth + Domains

**Prerequisites:** SESSION-06 complete
**Goal:** Build the atom-studio FastAPI backend from scratch — config, database, JWT auth, domain management, and the React frontend skeleton with login and domain pages.
**Estimated time:** 1.5 days

---

## Context

atom-studio is a **new service built from scratch** (ADR-015). It is NOT a fork of
agentscope-studio. agentscope-studio is a pure Node.js visualization tool — it has no
Python backend, no auth, and no management APIs. Do not touch it.

atom-studio has two parts:
- `atom-studio/backend/` — FastAPI (Python), port 3001
- `atom-studio/frontend/` — React + Vite + shadcn/ui, port 5173 (dev) / 3000 (prod nginx)

The backend uses the **same RS256 key pair as GATE**. Tokens issued here are validated by
GATE — one key pair, one trust root, no extra configuration.

### Domain creation must provision a LiteLLM team

When a domain is created in atom-studio, the backend immediately calls
`POST http://atom-llm:4000/atom/provision_domain` to create the corresponding LiteLLM team.
The `litellm_team_id` returned (which equals the domain UUID we sent) is stored on the domain.

If the LiteLLM provisioning call fails, the domain INSERT is rolled back. A domain without
a LiteLLM team is invalid — agents cannot be created in it.

---

## Part 1 — Backend

### 1. Verify project scaffold

```bash
cd atom-studio/backend
pip install -e ".[dev]"
```

### 2. Config (`src/atom_studio/config.py`)

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pathlib import Path

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url:                  str
    redis_url:                     str
    jwt_private_key_path:          str
    jwt_public_key_path:           str
    atom_encryption_key:           str   # hex-encoded 32-byte AES-GCM key
    atom_llm_url:                  str = "http://atom-llm:4000"
    atom_runtime_url:              str = "http://atom-runtime:8090"
    access_token_expire_minutes:   int = 15
    refresh_token_expire_days:     int = 7

    @property
    def jwt_private_key(self) -> str:
        return Path(self.jwt_private_key_path).read_text()

    @property
    def jwt_public_key(self) -> str:
        return Path(self.jwt_public_key_path).read_text()

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

### 3. Database (`src/atom_studio/database.py`)

```python
import asyncpg
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from .config import get_settings

_pool: asyncpg.Pool | None = None

async def init_pool():
    global _pool
    _pool = await asyncpg.create_pool(
        get_settings().database_url,
        min_size=2,
        max_size=10,
    )

async def get_pool() -> asyncpg.Pool:
    if _pool is None:
        await init_pool()
    return _pool

@asynccontextmanager
async def get_conn() -> AsyncGenerator[asyncpg.Connection, None]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn
```

### 4. Auth module (`src/atom_studio/auth/`)

**`service.py`**:

```python
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
from ..config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(user_id: str, role: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub":  user_id,
        "type": "human",
        "role": role,
        "iat":  int(now.timestamp()),
        "exp":  int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
        "iss":  "atom-studio",
    }
    return jwt.encode(payload, settings.jwt_private_key, algorithm="RS256")

def create_refresh_token() -> str:
    # Opaque random token — hash stored in Redis
    return secrets.token_hex(32)

def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_public_key, algorithms=["RS256"])
    except JWTError as e:
        raise ValueError(str(e))
```

**`middleware.py`**:

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from .service import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

async def require_auth(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        claims = decode_token(token)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(e))
    if claims.get("type") != "human":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not a human token")
    return claims

async def require_admin(claims: dict = Depends(require_auth)) -> dict:
    if claims.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin role required")
    return claims
```

**`router.py`** — endpoints:

```
POST /api/auth/register    { email, password, full_name }  → { user }
POST /api/auth/login       { email, password }             → { access_token, refresh_token }
POST /api/auth/refresh     { refresh_token }               → { access_token }
POST /api/auth/logout      { refresh_token }               → 204
GET  /api/auth/me                                          → { user }
```

Refresh tokens are stored as `sha256(token)` in Redis with TTL = refresh_token_expire_days.
On logout, delete the Redis key. On refresh, verify the key exists then rotate.

### 5. Domains module (`src/atom_studio/domains/`)

**`service.py`** — domain creation (critical: must provision LiteLLM team):

```python
import httpx
from ..config import get_settings
from ..database import get_conn

async def create_domain(name: str, description: str, owner_id: str) -> dict:
    settings = get_settings()

    async with get_conn() as conn:
        async with conn.transaction():
            # Step 1: insert domain
            domain = await conn.fetchrow("""
                INSERT INTO domains (name, description, owner_id)
                VALUES ($1, $2, $3)
                RETURNING id, name, description, owner_id, created_at
            """, name, description, owner_id)

            # Step 2: provision LiteLLM team
            # Use domain.id as team_id — same UUID, no extra lookup ever needed
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{settings.atom_llm_url}/atom/provision_domain",
                        json={
                            "domain_id":   str(domain["id"]),
                            "domain_name": name,
                        },
                    )
                    resp.raise_for_status()
                    litellm_data = resp.json()
            except Exception as e:
                # Roll back via transaction context manager raising
                raise RuntimeError(f"LiteLLM team provisioning failed: {e}")

            # Step 3: store litellm_team_id
            await conn.execute("""
                UPDATE domains SET litellm_team_id = $1 WHERE id = $2
            """, litellm_data["team_id"], domain["id"])

    return {**dict(domain), "litellm_team_id": litellm_data["team_id"]}
```

**`router.py`** — endpoints:

```
GET    /api/domains                  list domains (auth required)
POST   /api/domains                  create domain + provision LiteLLM team
GET    /api/domains/{id}             get domain detail + agent count
PATCH  /api/domains/{id}             update name/description
DELETE /api/domains/{id}             soft-delete + deprovision LiteLLM team
```

### 6. Users module (`src/atom_studio/auth/users_router.py`)

```
GET    /api/users                    list users (admin only)
POST   /api/users/invite             create user with temp password (admin only)
PATCH  /api/users/{id}/role          change role (admin only)
PATCH  /api/users/{id}/deactivate    deactivate user (admin only)
```

### 7. Main app (`src/atom_studio/main.py`)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_pool
from .auth.router import router as auth_router
from .auth.users_router import router as users_router
from .domains.router import router as domains_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield

app = FastAPI(title="ATOM Studio API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,    prefix="/api/auth",    tags=["auth"])
app.include_router(users_router,   prefix="/api/users",   tags=["users"])
app.include_router(domains_router, prefix="/api/domains", tags=["domains"])

@app.get("/healthz")
async def health():
    return {"status": "ok"}
```

---

## Part 2 — Frontend

### 8. Bootstrap React project

```bash
cd atom-studio/frontend
npm install
npx shadcn-ui@latest init
# Choose: TypeScript, Tailwind CSS, src/components/ui, CSS variables: yes

# Add components needed in this session
npx shadcn-ui@latest add button input label card form toast badge table dialog
```

### 9. Vite config (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws':  { target: 'ws://localhost:3001', ws: true },
    },
  },
})
```

### 10. API client (`src/lib/api.ts`)

```typescript
import axios from 'axios'
import { useAuthStore } from './auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
})

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  r => r,
  async error => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true
      try {
        await useAuthStore.getState().refresh()
        return api.request(error.config)
      } catch {
        useAuthStore.getState().logout()
      }
    }
    return Promise.reject(error)
  }
)

export default api
```

### 11. Auth store (`src/lib/auth.ts`)

```typescript
import { create } from 'zustand'
import api from './api'

interface User { id: string; email: string; full_name: string; role: string }

interface AuthState {
  user:        User | null
  accessToken: string | null
  login:       (email: string, password: string) => Promise<void>
  refresh:     () => Promise<void>
  logout:      () => void
}

export const useAuthStore = create<AuthState>(set => ({
  user:        null,
  accessToken: localStorage.getItem('access_token'),

  login: async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password })
    localStorage.setItem('access_token',  data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    set({ accessToken: data.access_token })
    const me = await api.get('/api/auth/me')
    set({ user: me.data })
  },

  refresh: async () => {
    const rt = localStorage.getItem('refresh_token')
    if (!rt) throw new Error('no refresh token')
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

### 12. Route guard (`src/components/app/RequireAuth.tsx`)

```typescript
import { Navigate, useLocation } from '@tanstack/react-router'
import { useAuthStore } from '../../lib/auth'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.accessToken)
  const location = useLocation()
  if (!token) return <Navigate to="/login" search={{ from: location.href }} />
  return <>{children}</>
}
```

### 13. Pages to build in this session

**Login page** (`src/pages/Login.tsx`)
- shadcn Form with email + password fields
- On success → navigate to `/domains`
- On error → shadcn Toast with error message

**Layout** (`src/components/app/Layout.tsx`)
- Left sidebar navigation:
  - Domains (active)
  - Agents (disabled, greyed — enabled in SESSION-08)
  - HITL Queue (disabled — SESSION-09)
  - Audit Log (disabled — SESSION-14)
- Top bar: user full_name, role badge (admin/developer), logout button

**Domains page** (`src/pages/Domains.tsx`)
- Table columns: Name, Description, Agent count, Owner, Created, Actions
- "New Domain" button → dialog modal with name + description fields
- On create: POST /api/domains, show toast on success, refresh table
- Click row name → `/domains/:id` (stub page for now — just shows domain name)

---

## Acceptance Criteria

- [ ] `uvicorn atom_studio.main:app --port 3001` starts without error
- [ ] `GET /healthz` → `{ "status": "ok" }`
- [ ] `POST /api/auth/register` → user inserted in `users` table with bcrypt hash
- [ ] `POST /api/auth/login` → returns `{ access_token, refresh_token }`
- [ ] `GET /api/auth/me` with valid token → user profile
- [ ] `GET /api/auth/me` without token → 401
- [ ] `POST /api/domains` → inserts domain AND calls `/atom/provision_domain` on atom-llm
- [ ] `SELECT litellm_team_id FROM domains WHERE name='test'` → non-null value
- [ ] `GET http://localhost:4000/team/info?team_id={domain_id}` → LiteLLM team exists
- [ ] `DELETE /api/domains/{id}` → sets `is_active=false` AND calls `/atom/deprovision_domain`
- [ ] If atom-llm is unreachable, `POST /api/domains` returns 502 and domain is NOT in Postgres
- [ ] `npm run dev` in frontend starts on port 5173
- [ ] Login page renders, login succeeds, redirects to domains list
- [ ] Domains list shows domains from backend
- [ ] New Domain modal creates domain and it appears in table
- [ ] Unauthenticated access to `/domains` redirects to `/login`
- [ ] `pytest src/tests/ -v` — auth and domain tests pass

---

## Claude Code Starter Prompt

```
You are implementing SESSION-07 of ATOM — building atom-studio from scratch.

atom-studio is a new service, NOT a fork of agentscope-studio.
agentscope-studio is a separate Node.js visualization tool we do not touch.

Backend (atom-studio/backend/):
Tech: FastAPI + asyncpg + passlib/bcrypt + python-jose RS256 + pydantic-settings

1. Implement config.py — Pydantic Settings, exposes jwt_private_key and jwt_public_key properties
2. Implement database.py — asyncpg pool with get_conn() context manager
3. Implement auth/service.py:
   - hash_password / verify_password (bcrypt)
   - create_access_token: RS256, reads private key from JWT_PRIVATE_KEY_PATH
     payload: { sub, type:"human", role, iat, exp, iss:"atom-studio" }
   - create_refresh_token: secrets.token_hex(32), hash stored in Redis
   - decode_token: validates with public key
4. Implement auth/middleware.py — require_auth and require_admin FastAPI dependencies
5. Implement auth/router.py — register, login, refresh, logout, me
6. Implement auth/users_router.py — list, invite, change role, deactivate (admin only)
7. Implement domains/service.py — create_domain():
   - INSERT into domains (transaction)
   - POST http://atom-llm:4000/atom/provision_domain { domain_id, domain_name }
   - On failure: raise (transaction rolls back automatically)
   - UPDATE domains SET litellm_team_id = response.team_id
   Also implement: list_domains, get_domain, update_domain, delete_domain
   delete_domain: set is_active=false AND call DELETE /atom/deprovision_domain
8. Implement domains/router.py — full CRUD, all require require_auth
9. Implement main.py — FastAPI app wiring all routers + CORS + lifespan pool init
10. Write tests in src/tests/: test_auth.py and test_domains.py

Frontend (atom-studio/frontend/):
1. npm install
2. npx shadcn-ui@latest init + add button input label card form toast badge table dialog
3. vite.config.ts with proxy /api → localhost:3001
4. src/lib/api.ts — axios with auth interceptor + auto-refresh on 401
5. src/lib/auth.ts — Zustand store with login/refresh/logout
6. src/components/app/RequireAuth.tsx — redirect to /login if no token
7. src/components/app/Layout.tsx — sidebar + top bar
8. src/pages/Login.tsx — shadcn Form, on success navigate to /domains
9. src/pages/Domains.tsx — table + New Domain modal

After implementing, test the full flow:
  1. Register a user
  2. Login → get token
  3. Create a domain
  4. Verify litellm_team_id is set in Postgres
  5. Verify team exists in LiteLLM: GET /team/info?team_id={domain_id}
```
