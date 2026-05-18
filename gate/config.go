package main

import "os"

type Config struct {
	BuilderBackendURL  string
	WorkflowBackendURL string
	LiteLLMURL         string // LLM proxy target (:8083 → this)
	MinioEndpoint      string
	MinioAccessKey     string
	MinioSecretKey     string
	MinioSecure        bool
	AuditBucket        string
	DatabaseURL        string
	HMACKey            string
}

func loadConfig() Config {
	return Config{
		BuilderBackendURL:  getenv("BUILDER_BACKEND_URL", "http://builder-backend:8080"),
		WorkflowBackendURL: getenv("WORKFLOW_BACKEND_URL", "http://workflow-backend:8082"),
		LiteLLMURL:         getenv("LITELLM_URL", "http://litellm:4000"),
		MinioEndpoint:      getenv("MINIO_ENDPOINT", "minio:9000"),
		MinioAccessKey:     getenv("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey:     getenv("MINIO_SECRET_KEY", "minioadmin"),
		MinioSecure:        false,
		AuditBucket:        "audit-logs",
		DatabaseURL:        getenv("DATABASE_URL", "postgres://atom:atom@platform-db:5432/atom"),
		HMACKey:            getenv("AUDIT_HMAC_KEY", "atom-audit-hmac-key-change-in-prod"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
