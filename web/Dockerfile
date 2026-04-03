# Build

FROM dhi.io/node:22-alpine3.22-dev AS build
ARG BUILD_MODE=production
WORKDIR /code
COPY ["package.json", "package-lock.json*", "./"]
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
RUN npm run-script build-${BUILD_MODE}

# Application (distroless)

FROM dhi.io/node:22-alpine3.22
COPY --from=ghcr.io/dmptrluke/healthcheck@sha256:3e9025c3550d94f35f1c565f8e71f89c9492fa4e79e440292ab776a144c460bb /healthcheck /usr/local/bin/healthcheck
WORKDIR /code

COPY --from=build /code .

ENV NODE_ENV=production \
    DB_HOST=db \
    DB_NAME=pokesag \
    DB_USER=pokesag \
    DB_PASS=pokesag \
    DB_PORT=5432

HEALTHCHECK --start-period=30s --interval=10s --timeout=5s \
    CMD ["healthcheck", "http", "127.0.0.1:8000", "/"]

CMD ["node", "/code/app.mjs"]
EXPOSE 8000/tcp
