package main

import "os"

type Config struct {
	BuilderBackendURL  string
	WorkflowBackendURL string
	MinioEndpoint      string
	MinioAccessKey     string
	MinioSecretKey     string
	MinioSecure        bool
	AuditBucket        string
}

func loadConfig() Config {
	return Config{
		BuilderBackendURL:  getenv("BUILDER_BACKEND_URL", "http://builder-backend:8080"),
		WorkflowBackendURL: getenv("WORKFLOW_BACKEND_URL", "http://workflow-backend:8082"),
		MinioEndpoint:      getenv("MINIO_ENDPOINT", "minio:9000"),
		MinioAccessKey:     getenv("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey:     getenv("MINIO_SECRET_KEY", "minioadmin"),
		MinioSecure:        false,
		AuditBucket:        "audit-logs",
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
