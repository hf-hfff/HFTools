# ---------- 构建阶段：安装依赖并构建静态产物 ----------
# 注：pnpm 12 的平台二进制在 node:20 (musl) 上段错误，改用与本地开发一致的 node:24
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.3.4 --registry=https://registry.npmmirror.com
# 与本地开发一致使用国内镜像源，加速依赖下载
ENV npm_config_registry=https://registry.npmmirror.com
WORKDIR /repo

# 先复制依赖清单（含 workspace 中另一包的 package.json 以通过 frozen-lockfile 校验），充分利用镜像层缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server-node/package.json ./server-node/package.json
COPY frontend/package.json ./frontend/package.json

# 仅安装 frontend 依赖（纯 JS 依赖，无需原生编译工具链；overlayfs 上 hardlink 会 EXDEV，强制 copy）
RUN pnpm install --frozen-lockfile --filter @hftools/frontend --config.package-import-method=copy

COPY frontend/ ./frontend/
RUN pnpm --filter @hftools/frontend run build

# ---------- 运行阶段：nginx 托管静态文件并反向代理 /api ----------
FROM nginx:alpine
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
