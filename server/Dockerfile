# Multi-stage: build statically-linked Go binary, ship in distroless.
FROM golang:1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
# No shell in distroless — the binary's own -healthcheck flag is the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/server", "-healthcheck"]
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/server"]
