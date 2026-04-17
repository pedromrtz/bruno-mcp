FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/collections /app/bruno_collections

CMD ["node", "--loader", "ts-node/esm/transpile-only", "src/index.ts"]
