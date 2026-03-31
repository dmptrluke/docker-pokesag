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
WORKDIR /code

COPY --from=build /code .

ENV NODE_ENV=production \
    DB_HOST=db \
    DB_NAME=pokesag \
    DB_USER=pokesag \
    DB_PASS=pokesag \
    DB_PORT=5432

HEALTHCHECK --start-period=30s --interval=10s --timeout=5s \
    CMD ["node", "/code/healthcheck.mjs"]

CMD ["node", "/code/app.mjs"]
EXPOSE 8000/tcp
