# ---------- 构建阶段：安装全量依赖并编译 TypeScript ----------
# 注：pnpm 12 的平台二进制在 node:20 (musl) 上段错误，改用与本地开发一致的 node:24
FROM node:24-alpine AS build
# better-sqlite3 / bcrypt 原生模块的编译工具链（两者均内置 musl 预编译，正常无需编译，此处兜底）
RUN apk add --no-cache python3 make g++ && npm install -g pnpm@12.3.4 --registry=https://registry.npmmirror.com
# 与本地开发一致使用国内镜像源，加速依赖下载
ENV npm_config_registry=https://registry.npmmirror.com
WORKDIR /repo

# 先复制依赖清单（含 workspace 中另一包的 package.json 以通过 frozen-lockfile 校验），充分利用镜像层缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server-node/package.json ./server-node/package.json
COPY frontend/package.json ./frontend/package.json

# 仅安装 server-node 依赖（hoisted 布局便于跨阶段复制；overlayfs 上 hardlink 会 EXDEV，强制 copy）
RUN pnpm install --frozen-lockfile --filter @hftools/server-node --config.node-linker=hoisted --config.package-import-method=copy

COPY server-node/ ./server-node/
# 直接调用 tsc 二进制编译（hoisted 布局下 pnpm run 的 bin 链接在容器 overlayfs 上会 EXDEV，故绕过）
RUN ./node_modules/.bin/tsc -p server-node/tsconfig.json

# ---------- 生产依赖阶段：干净环境单独安装生产依赖 ----------
# 说明：同一容器内二次 install（--prod 裁剪）在容器文件系统上会触发 EXDEV 链接错误，故独立成阶段
FROM node:24-alpine AS deps
RUN npm install -g pnpm@12.3.4 --registry=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server-node/package.json ./server-node/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile --filter @hftools/server-node --prod --config.node-linker=hoisted --config.package-import-method=copy

# ---------- 运行阶段：仅生产依赖 + dist ----------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/server-node/dist ./dist
COPY server-node/package.json ./
# prompt/熊猫动图等静态资产（tsc 不拷贝非 TS 文件，须显式 COPY）
COPY server-node/assets ./assets

# SQLite 数据目录（compose 中以卷持久化）
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3001
CMD ["node", "dist/index.js"]
