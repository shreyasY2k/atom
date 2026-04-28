# Stage 1: build
FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /gate ./cmd/gate

# Stage 2: minimal runtime (distroless)
FROM gcr.io/distroless/static-debian12
COPY --from=builder /gate /gate
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/gate"]
