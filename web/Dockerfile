FROM node:14-alpine

ARG BUILD_MODE=production
ENV NODE_ENV=$BUILD_MODE

WORKDIR /code
COPY ["package.json", "package-lock.json*", "./"]
RUN npm ci

COPY . .

RUN npm run-script build-${BUILD_MODE}

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432

USER guest

CMD ["/code/wait-for", "db:5432", "--", "node", "/code/app.js"]
EXPOSE 8000/tcp
