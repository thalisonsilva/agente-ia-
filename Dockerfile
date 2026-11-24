# Etapa 1: compila o TypeScript
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Etapa 2: imagem final, só com o necessário para rodar
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY empresa.md ./
# Os protocolos ficam em /app/data (monte um Volume da Railway nesse caminho)
RUN mkdir -p /app/data
CMD ["node", "dist/index.js"]
