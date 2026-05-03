#!/bin/bash
# One-click build + push + deploy to remote server.
#
# Usage:
#   ./scripts/deploy.sh              # build + deploy
#   ./scripts/deploy.sh --skip-build # deploy with current :latest images (skip build)

set -e

SKIP_BUILD=false
for arg in "$@"; do
    [ "$arg" == "--skip-build" ] && SKIP_BUILD=true
done

if [ ! -f .env.deploy ]; then
    echo "❌ .env.deploy not found. Copy .env.deploy.example and fill in values."
    exit 1
fi
source .env.deploy

BACKEND_VERSION=$(grep -m1 '^version = ' backend/pyproject.toml | sed 's/version = "\(.*\)"/\1/')
FRONTEND_VERSION=$(grep '"version"' frontend/package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

# NOTE: Nginx is managed by the shared stillume-nginx stack.
# Config generation / cert renewal happens in the stillume-nginx project.

# Build and push
if [ "$SKIP_BUILD" = false ]; then
    bash scripts/build.sh
fi

# Prepare remote directories
echo "📂 Preparing remote directories..."
ssh ${SERVER_HOST} "mkdir -p ${SERVER_DIR}/data/postgres ${SERVER_DIR}/data/audio"

# Upload compose file and app config
echo "📤 Uploading configs..."
scp docker-compose-remote.yml ${SERVER_HOST}:${SERVER_DIR}/docker-compose.yml
scp backend/config.toml ${SERVER_HOST}:${SERVER_DIR}/config.toml

# Write compose vars to .env on server (non-secret — secrets go in .env.app)
ssh ${SERVER_HOST} bash << EOF
set -e
cd ${SERVER_DIR}
cat > .env << 'ENVEOF'
ALIYUN_REGISTRY=${ALIYUN_REGISTRY}
ALIYUN_NAMESPACE=${ALIYUN_NAMESPACE}
BACKEND_TAG=${BACKEND_VERSION}
FRONTEND_TAG=${FRONTEND_VERSION}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ENVEOF

# Check .env.app exists (must be created manually on first deploy)
if [ ! -f .env.app ]; then
    echo ""
    echo "⚠️  .env.app not found on server. Create it before the app can start:"
    echo "   scp backend/.env.example ${SERVER_HOST}:${SERVER_DIR}/.env.app"
    echo "   ssh ${SERVER_HOST} 'vim ${SERVER_DIR}/.env.app'  # fill in secrets"
    echo ""
fi

docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
EOF

echo "✅ Deployed — backend:${BACKEND_VERSION}  frontend:${FRONTEND_VERSION} → https://${DOMAIN_NAME}"
