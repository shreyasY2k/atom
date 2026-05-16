FROM golang:1.22-alpine AS builder
RUN apk --no-cache add git ca-certificates
WORKDIR /build
# Copy source + module definition together so go mod tidy can resolve imports.
COPY go.mod go.sum* *.go ./
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o gate .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /build/gate .
EXPOSE 8080 8082
ENTRYPOINT ["/app/gate"]
