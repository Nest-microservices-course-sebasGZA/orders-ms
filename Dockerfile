FROM node:21-alpine3.19

WORKDIR /usr/src/app

COPY package.json ./
COPY pnpm-lock.yaml ./


RUN npm i -g pnpm@9.0.0
RUN pnpm install

COPY . .

EXPOSE 3002

