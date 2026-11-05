# ==============================================================================
# Stage 1: Angular 22 Builder (Zoneless + Telemetry Suppressed)
# ==============================================================================
FROM node:24-alpine AS builder

ENV NG_CLI_ANALYTICS=false
ENV CI=true

WORKDIR /workspace/rc-web-client

COPY package.json angular.json ./
COPY scripts/ ./scripts/
RUN npm install --no-audit --no-fund

COPY . .
RUN node scripts/verify-telemetry.mjs && \
    npx ng config cli.analytics false && \
    npm run build -- --configuration=production

# ==============================================================================
# Stage 2: Hardened Non-Root NGINX Runtime (Zero Egress & CSP Enforced)
# ==============================================================================
FROM nginxinc/nginx-unprivileged:alpine AS runtime

USER root
RUN mkdir -p /schemas/v1 && chown -R nginx:nginx /schemas /usr/share/nginx/html /etc/nginx/conf.d

USER nginx

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /workspace/rc-web-client/dist/rc-web-client/browser/ /usr/share/nginx/html/
COPY --from=builder --chown=nginx:nginx /workspace/rc-web-client/public/schemas/ /schemas/

EXPOSE 80 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
