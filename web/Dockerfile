FROM node:24-alpine

ARG BUILD_MODE=production
ENV NODE_ENV=$BUILD_MODE

WORKDIR /code
COPY ["package.json", "package-lock.json*", "./"]
RUN npm ci

COPY . .

RUN npm run-script build-${BUILD_MODE}

ENV DB_HOST=pokesag_db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432

USER guest

HEALTHCHECK --start-period=30s --interval=10s --timeout=5s CMD node /code/healthcheck.js

CMD ["/code/wait-for", "db:5432", "--", "node", "/code/app.mjs"]
EXPOSE 8000/tcp
