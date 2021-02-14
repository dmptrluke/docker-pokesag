FROM node:12-alpine

WORKDIR /code

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8000

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASSWORD=pokesag

CMD ["/code/wait-for", "db:5432", "--", "node", "/code/app.js"]