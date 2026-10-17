FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /diskord ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o /backfill-attachments ./cmd/backfill-attachments

FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /diskord .
COPY --from=builder /backfill-attachments .
EXPOSE 8080
CMD ["./diskord"]
