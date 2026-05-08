# Build AgentScope Studio from source.
# Pin via STUDIO_GIT_REF (default: main).

FROM node:20-slim AS builder

ARG STUDIO_GIT_REF=main

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${STUDIO_GIT_REF} \
    https://github.com/agentscope-ai/agentscope-studio.git .

RUN npm ci || npm install
RUN npm run build

# ----------------------------------------

FROM node:20-slim

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder /src/package*.json ./
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Studio's CLI entry — verify against the cloned repo's package.json "bin" or "scripts.start"
# If "as_studio" is the npm-published binary, it should be available via the installed deps.
CMD ["node", "/app/dist/server/src/index.js"]
