FROM node:22-alpine

ARG BUILD_MODE=production

WORKDIR /code
COPY ["package.json", "package-lock.json*", "./"]
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

RUN npm run-script build-${BUILD_MODE}

ENV NODE_ENV=$BUILD_MODE

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432

USER guest

HEALTHCHECK --start-period=30s --interval=10s --timeout=5s CMD node /code/healthcheck.mjs

CMD ["/code/wait-for", "db:5432", "--", "node", "/code/app.mjs"]
EXPOSE 8000/tcp
