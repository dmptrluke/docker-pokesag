FROM node:12-alpine

WORKDIR /code
COPY package*.json ./
RUN npm install

COPY . .

RUN npx webpack --config client/webpack.config.js

EXPOSE 8000

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432

CMD ["/code/wait-for", "db:5432", "--", "node", "/code/app.js"]
