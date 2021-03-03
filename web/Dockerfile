FROM node:14-alpine

ARG BUILD_MODE=production
ENV NODE_ENV=$BUILD_MODE

RUN groupadd -r abc -g 1005 && useradd --no-log-init -u 1000 -r -g abc abc

WORKDIR /code
COPY ["package.json", "package-lock.json*", "./"]
RUN npm ci

COPY . .

RUN npm run-script build-${BUILD_MODE}

EXPOSE 8000

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432

USER abc:abc

CMD ["/code/wait-for", "db:5432", "--", "node", "/code/app.js"]
EXPOSE 8000/tcp
