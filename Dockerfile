FROM node:22.14.0-bookworm-slim

WORKDIR /app

# Install exactly the locked dependency tree, including build-time dependencies.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000 2567

CMD ["npm", "run", "start"]
