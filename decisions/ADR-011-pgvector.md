# ADR-011 — pgvector for Vector Storage

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

atom-memory needs a vector store for agent long-term semantic memory (embedding-based retrieval).

Options:
- Dedicated vector database (Weaviate, Qdrant, Chroma, Pinecone)
- pgvector extension on existing Postgres

## Decision

Use **pgvector** as an extension on the existing Postgres 16 instance.

atom-memory stores embeddings in a `memory_vectors` table with an `ivfflat` or `hnsw` index.
Retrieval uses `<=>` cosine distance operator.

## Rationale

- Postgres is already in the stack; adding pgvector avoids a seventh stateful service.
- For the expected scale (agents with thousands of memory entries, not billions), pgvector
  HNSW indexes provide excellent recall and sub-100ms retrieval.
- Single operational surface: backups, monitoring, and access control for vectors use the
  same Postgres tooling.
- pgvector is production-ready and used by many BFSI-adjacent production deployments.

## Scale Limit

If a single agent's memory corpus exceeds ~5M vectors, or if cross-agent retrieval becomes
a requirement, migrating to a dedicated vector DB (Qdrant is the preferred candidate due to
its Rust binary and Rust/Python SDKs) is a natural next step. This would require only
changes to atom-memory's backend adapter, not the API.

## Consequences

- **Positive:** No additional infrastructure; operational simplicity; ACID transactions
  for memory write consistency.
- **Negative:** Not as performant as dedicated vector DBs at extreme scale.
  Not suited for billion-vector corpora.

---

