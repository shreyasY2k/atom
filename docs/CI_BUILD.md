# CI/CD Image Build Guide

This document covers how `atom deploy` builds and pushes agent Docker images via GitLab CI.
GitHub support is coming soon — see the stub at the bottom.

---

## Architecture overview

```
atom-sdk GitLab repo                    Agent GitLab repo
  .gitlab-ci.yml                          .gitlab-ci.yml (generated)
  Dockerfile                              Dockerfile (generated)
       ↓ push to main / tag                    ↓ atom deploy triggers
  registry.gitlab.com/org/atom-sdk:latest  registry.gitlab.com/org/my-agent:<sha>
                    ↑                                    ↑
            FROM ${SDK_IMAGE}  ─────────────────────────┘
```

All build steps run **inside GitLab CI** — no Docker on the developer's machine is required for the GitLab path.

---

## atom-sdk base image

`atom-sdk/.gitlab-ci.yml` builds and pushes the base image on every merge to `main` and on semver tags:

| Event | Tag pushed |
|---|---|
| Merge to `main` | `:latest` |
| Git tag `v0.2.0` | `:v0.2.0` + `:latest` |

The base image installs `agentscope` (the atom-sdk fork) so agent images only need to install their own dependencies.

### Upgrading atom-sdk in an agent

```bash
# Inside the agent project directory:
atom sdk upgrade v0.2.0      # pins sdk_image: registry.../atom-sdk:v0.2.0
atom sdk upgrade             # resets to :latest
```

This rewrites the `sdk_image` field in `atom_agent.yaml` and prints a diff.

---

## atom_agent.yaml — CI configuration

`atom create` generates `atom_agent.yaml` in the project root. The `ci` block controls how `atom deploy` builds the image:

```yaml
agent_id: ""          # fill in from atom-studio
domain_id: ""         # fill in from atom-studio
image: my-agent
registry: ""          # e.g. registry.gitlab.com/yourorg/my-agent

ci:
  provider: gitlab    # local | gitlab  (github: coming soon)
  origin: gl_origin   # git remote pointing to this repo on GitLab
  branch: main
  registry_secret: GL_REGISTRY_TOKEN

sdk_image: "registry.gitlab.com/yourorg/atom-sdk:latest"
```

### `ci.provider` values

| Value | Behaviour |
|---|---|
| `local` | `docker build` on the developer's machine (default if gl_origin not configured) |
| `gitlab` | Trigger a GitLab CI pipeline; poll until complete |
| `github` | **Not yet supported** — returns an error |

---

## First-time GitLab deploy

```
$ atom deploy

✗ No GitLab credentials found.
Enter GitLab personal access token (scope: api): ****
  Credentials saved to ~/.atom/credentials (chmod 600)

→ Triggering GitLab CI pipeline on https://gitlab.com/org/my-agent (branch: main, tag: a1b2c3d) ...
  Pipeline: https://gitlab.com/org/my-agent/-/pipelines/42
  Image:    registry.gitlab.com/org/my-agent:a1b2c3d (available after build)
→ Waiting for pipeline to complete (up to 30 min) ...
  [gitlab] pipeline running…
✓ GitLab CI build complete

Submitting deployment to http://localhost:3001 ...
✓ Deployment submitted
  Image:  registry.gitlab.com/org/my-agent:a1b2c3d
  Status: pending HITL approval
```

The PAT is stored in `~/.atom/credentials` (JSON, mode 0600) and reused on subsequent runs. It is never written to `atom_agent.yaml` or any tracked file.

---

## Cross-group registry access

If `sdk_image` and the agent repo are in **different top-level GitLab groups**, the job token issued to the pipeline may not have pull access to the atom-sdk registry.

`atom deploy` detects this and prints a warning before triggering the build:

```
⚠  sdk_image group "platform-team" ≠ agent group "myorg" — if the build fails pulling
   the base image, add a group deploy token at:
   https://gitlab.com/groups/platform-team/-/settings/repository#js-deploy-tokens
```

Steps to fix:
1. Go to the atom-sdk GitLab group → **Settings → Repository → Deploy tokens**
2. Create a token with `read_registry` scope
3. Add it as a CI/CD variable `ATOM_SDK_REGISTRY_TOKEN` in your agent group
4. Update `.gitlab-ci.yml` to log in with that token before `docker build`

---

## SDK versioning workflow

```
# 1. atom-sdk team merges a fix → :latest updates automatically in CI
# 2. Agent team reviews the change
atom sdk upgrade v0.3.0        # pin to specific release
git add atom_agent.yaml && git commit -m "chore: bump atom-sdk to v0.3.0"
atom deploy                    # next build uses the new tag
```

---

## GitHub support

GitHub Actions as a build provider (`ci.provider: github`) is **not yet implemented**.
Using it returns:

```
Error: ci.provider "github" is not yet supported — use "local" or "gitlab"
```

GitHub will be added as a fast-follow once the GitLab path is stable.
