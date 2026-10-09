FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Зависимости ставятся отдельным слоем, чтобы обновление кода не скачивало их заново
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY shared ./shared
COPY db ./db
COPY public ./public
COPY scripts ./scripts

# Сборка остановится, если не хватает шрифтов или библиотек 3D
RUN node scripts/check-vendor.js

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
