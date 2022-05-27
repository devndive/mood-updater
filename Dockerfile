FROM node:18-alpine as base
ENV NODE_ENV production

# Build application
FROM base as build

WORKDIR /app

ADD package.json package-lock.json ./
RUN npm install

# Final image
FROM base

ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app/node_modules /app/node_modules/
COPY --from=build /app/package.json /app/package-lock.json /app/
ADD ./index.ts /app/

CMD ["npx", "ts-node", "-T", "index.ts"]
