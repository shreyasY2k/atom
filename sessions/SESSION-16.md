## SESSION-16 — CI/CD Image Build: GitLab Private

### Goal
Extend `atom deploy` so the Docker image is built and pushed inside a **GitLab CI pipeline**
running in a **private repo**, instead of on the developer's local machine. GitHub and public
repos are explicitly out of scope — they will be added as a fast-follow once this path is
proven end-to-end.

The entire ATOM monorepo and all agent repos live on GitLab (private) via the `gl_origin`
remote. This is the only build path being implemented in this session.

### Git Remote Topology

```
atom/                          ← monorepo root
  git remote gl_origin         → gitlab.com/yourorg/atom.git  (private)

atom/atom-sdk/                 ← SDK subdirectory (separate GitLab project)
  git remote gl_origin         → gitlab.com/yourorg/atom-sdk.git  (private)
  GitLab Container Registry    → registry.gitlab.com/yourorg/atom-sdk
  Published image tags         → :latest, :v0.1.0, :v0.2.0, ...
```

The `atom-sdk` GitLab project maintains its own CI pipeline that builds and pushes
`registry.gitlab.com/yourorg/atom-sdk:latest` (and a semver tag) on every merge to `main`.
Agent Dockerfiles inherit `FROM` this image. When atom-sdk is updated, teams just bump their
`FROM` tag — no token injection, no secret management in agent pipelines.

### atom-sdk Base Image Pipeline

```yaml
# atom-sdk/.gitlab-ci.yml  (lives in the atom-sdk GitLab project)
stages: [build]

build-base-image:
  stage: build
  image: docker:24
  services: [docker:24-dind]
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/'
  script:
    - docker login $CI_REGISTRY -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD
    - |
      TAG=${CI_COMMIT_TAG:-latest}
      docker build -t $CI_REGISTRY_IMAGE:$TAG -t $CI_REGISTRY_IMAGE:latest .
      docker push $CI_REGISTRY_IMAGE:$TAG
      docker push $CI_REGISTRY_IMAGE:latest
```

```dockerfile
# atom-sdk/Dockerfile  (the base image definition)
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Install atom-sdk and its core dependencies
COPY . /atom-sdk-src
RUN pip install --no-cache-dir /atom-sdk-src

# Verify install
RUN python -c "import agentscope; print('atom-sdk OK')"
```

### How atom-cli reads the SDK image location

`atom_agent.yaml` gains a `sdk_image` field. `atom create agent` sets this automatically
by reading `gl_origin` from the `atom-sdk/` subdirectory:

```go
// atom-cli/internal/scaffold/sdk_origin.go
func resolveSDKImage(atomRoot string) (string, error) {
    // Run: git -C <atomRoot>/atom-sdk remote get-url gl_origin
    // Returns: https://gitlab.com/yourorg/atom-sdk.git
    // Converts to: registry.gitlab.com/yourorg/atom-sdk
    out, err := exec.Command("git", "-C",
        filepath.Join(atomRoot, "atom-sdk"),
        "remote", "get-url", "gl_origin",
    ).Output()
    if err != nil {
        return "", fmt.Errorf("atom-sdk gl_origin not set: %w", err)
    }
    return gitURLToRegistry(strings.TrimSpace(string(out))), nil
}

// gitlab.com/yourorg/atom-sdk.git → registry.gitlab.com/yourorg/atom-sdk
func gitURLToRegistry(gitURL string) string {
    u := strings.TrimSuffix(gitURL, ".git")
    u = strings.Replace(u, "gitlab.com/", "registry.gitlab.com/", 1)
    u = strings.Replace(u, "https://", "", 1)
    return u
}
```

### What changes

#### `atom_agent.yaml` — new `ci` block
```yaml
agent_id: "uuid"
domain_id: "uuid"
image: my-loan-agent
registry: registry.gitlab.com/myorg/myrepo

ci:
  provider: gitlab          # gitlab | local (default) — github not yet supported
  origin: gl_origin         # git remote name that points to THIS agent's repo
  branch: main
  registry_secret: GL_REGISTRY_TOKEN   # env var name atom-cli reads

# Resolved automatically by atom create agent from atom-sdk/gl_origin
# Update the tag here to upgrade the SDK version for this agent
sdk_image: registry.gitlab.com/yourorg/atom-sdk:latest
```

#### `atom deploy` flow (updated)
```
atom deploy
  └─ read atom_agent.yaml
  └─ if ci.provider == "local"  →  existing docker build + push (unchanged)
  └─ if ci.provider == "gitlab" →
        1. Resolve GitLab project ID from gl_origin remote URL
        2. atom-cli calls GitLab API:
              POST /projects/:id/pipeline
              variables: ATOM_BUILD=true, ATOM_IMAGE_TAG=<git-sha>,
                         SDK_IMAGE=<sdk_image from atom_agent.yaml>
        3. Poll pipeline status every 30s:
              GET /projects/:id/pipelines/:pipeline_id
        4. On success  → image ref = registry.gitlab.com/org/repo/agent:sha
                       → submit deployment to atom-studio (unchanged from here)
        5. On failure  → print failed job log URL, exit non-zero
  └─ if ci.provider == "github" →  ERROR: not yet supported
```

#### Credential prompting (first run)
```
atom deploy
  ✗ No GitLab credentials found.
  Enter GitLab personal access token (scope: api): ****
  Enter GitLab project ID or full path: myorg/myrepo
  Credentials saved to ~/.atom/credentials (chmod 600)
```
Stored in `~/.atom/credentials` (TOML), never in `atom_agent.yaml`.

#### GitLab CI template (`atom-ci-gitlab.yml`)
Committed to the agent repo automatically by `atom create agent`. The runner logs into
**two** registries: the atom-sdk registry (to pull the base image) and the agent repo's
own registry (to push the built agent image). Both use `CI_REGISTRY_*` variables which
GitLab injects automatically for any project in the same GitLab instance — no extra
credentials needed.

```yaml
# .gitlab-ci.yml  (generated by atom create agent)
stages: [build]

atom-build:
  stage: build
  image: docker:24
  services: [docker:24-dind]
  variables:
    DOCKER_BUILDKIT: "1"
  rules:
    - if: '$ATOM_BUILD == "true"'
  before_script:
    # Log in once — CI_REGISTRY_USER / CI_REGISTRY_PASSWORD grant read access
    # to all projects the pipeline's bot token can see on the same GitLab instance.
    # This covers BOTH pulling registry.gitlab.com/yourorg/atom-sdk (base image)
    # AND pushing registry.gitlab.com/yourorg/my-agent (built image).
    - docker login $CI_REGISTRY -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$ATOM_IMAGE_TAG .
    - docker push $CI_REGISTRY_IMAGE:$ATOM_IMAGE_TAG
```

> **Why one login works for both:** GitLab issues a job token scoped to the current group.
> If `atom-sdk` and the agent repo are under the same group/org, `CI_REGISTRY_PASSWORD`
> (the job token) has pull access to `atom-sdk`'s registry automatically. If they are in
> different top-level groups, a group-level deploy token needs to be added once — `atom deploy`
> will detect this and prompt accordingly.

#### Generated agent `Dockerfile`
```dockerfile
# Dockerfile  (generated by atom create agent)
# sdk_image tag is pinned in atom_agent.yaml — bump it to upgrade atom-sdk
ARG SDK_IMAGE=registry.gitlab.com/yourorg/atom-sdk:latest
FROM ${SDK_IMAGE}

WORKDIR /app

# Only agent-specific dependencies here — atom-sdk already in base image
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
CMD ["python", "agent.py"]
```

`atom deploy` passes `--build-arg SDK_IMAGE=<sdk_image from atom_agent.yaml>` when invoking
`docker build` locally, and injects `SDK_IMAGE` as a CI variable when triggering the GitLab
pipeline — so the pinned tag in `atom_agent.yaml` is always the single source of truth.

### Acceptance Criteria
- [ ] `atom deploy` with `ci.provider: gitlab` triggers a real pipeline in a **private** GitLab repo, polls until complete, and submits the image ref to atom-studio on success
- [ ] `atom create agent` reads `atom-sdk/gl_origin`, derives the registry URL, and writes `sdk_image` into the scaffolded `atom_agent.yaml`
- [ ] Generated `Dockerfile` uses `ARG SDK_IMAGE` / `FROM ${SDK_IMAGE}` — no credentials baked into the image
- [ ] Generated `.gitlab-ci.yml` uses a single `docker login $CI_REGISTRY` and passes `SDK_IMAGE` as a build arg — works for same-group repos with zero extra config
- [ ] `atom deploy` detects cross-group registry access failure and prompts user to configure a group deploy token, with a direct link to the GitLab settings page
- [ ] atom-sdk pipeline builds and pushes `:latest` + semver tag on every merge to `main`
- [ ] `atom sdk upgrade [tag]` subcommand updates `sdk_image` in `atom_agent.yaml` and prints a diff
- [ ] Credentials (GitLab PAT for pipeline trigger API) stored only in `~/.atom/credentials` (chmod 600), never in `atom_agent.yaml` or any tracked file
- [ ] Error messages clearly distinguish: missing credentials / pipeline trigger failure / image pull auth failure / build failure / poll timeout
- [ ] `ci.provider: github` returns a clear unsupported error — no partial implementation
- [ ] Local build path (`ci.provider: local`) unchanged and unaffected

### Files to create / modify
```
atom-sdk/
  Dockerfile                        ← base image definition
  .gitlab-ci.yml                    ← builds + pushes :latest and semver tags

atom-cli/
  cmd/atom/deploy.go                ← ci.provider branching + SDK_IMAGE build-arg injection
  cmd/atom/create.go                ← read atom-sdk gl_origin → derive registry URL → write sdk_image
  cmd/atom/sdk.go                   ← new: `atom sdk upgrade [tag]` subcommand
  internal/ci/gitlab.go             ← pipeline trigger + poll + cross-group registry detection
  internal/ci/credentials.go        ← read/write ~/.atom/credentials (TOML, chmod 600)
  internal/scaffold/sdk_origin.go   ← gitURLToRegistry helper
  templates/gitlab-ci.yml           ← embedded .gitlab-ci.yml template for generated agent repos
  templates/Dockerfile.agent        ← embedded agent Dockerfile template (ARG SDK_IMAGE / FROM)

docs/CI_BUILD.md                    ← new: GitLab CI build guide, SDK versioning, upgrade path
                                       (GitHub section stubbed with "coming soon" note)
```

---
