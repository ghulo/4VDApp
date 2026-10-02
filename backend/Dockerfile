# The backend as one small image: build with the dev tools, run without them.
# Works the same on Render, any Docker host, or this laptop:
#   docker build -t 4vd-backend backend
#   docker run --env-file backend/.env -p 3000:3000 4vd-backend

# ---------- Build: compile TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- Run: compiled code and production packages only ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Never run as root inside the container.
USER node
EXPOSE 3000

# Bring the database up to date, then start. Migrations take a lock, so two
# instances starting together can't apply the same one twice.
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/server.js"]
