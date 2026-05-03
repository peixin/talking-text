#!/bin/bash
# Build and push base images (deps layer).
# Run this only when pyproject.toml / poetry.lock or package.json / pnpm-lock.yaml change.
#
# Usage:
#   ./scripts/build-base.sh           # build & push to Aliyun
#   ./scripts/build-base.sh --local   # build with :local tag (for docker-compose.yml)

set -e

LOCAL=false
for arg in "$@"; do
    [ "$arg" == "--local" ] && LOCAL=true
done

if [ "$LOCAL" = false ]; then
    if [ ! -f .env.deploy ]; then
        echo "❌ .env.deploy not found. Copy .env.deploy.example and fill in values."
        exit 1
    fi
    source .env.deploy
    BACKEND_BASE="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/talking-text-backend-base"
    FRONTEND_BASE="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/talking-text-frontend-base"
    PLATFORM="--platform linux/amd64"
else
    BACKEND_BASE="talking-text-backend-base"
    FRONTEND_BASE="talking-text-frontend-base"
    PLATFORM=""
fi

echo "🔨 Building backend base image..."
docker build $PLATFORM \
    -t ${BACKEND_BASE}:latest \
    -f backend/docker/Dockerfile.base \
    backend/

echo "🔨 Building frontend base image..."
docker build $PLATFORM \
    -t ${FRONTEND_BASE}:latest \
    -f frontend/docker/Dockerfile.base \
    frontend/

if [ "$LOCAL" = false ]; then
    echo "☁️  Pushing backend base..."
    docker push ${BACKEND_BASE}:latest

    echo "☁️  Pushing frontend base..."
    docker push ${FRONTEND_BASE}:latest
    echo "✅ Base images pushed to registry."
else
    docker tag ${BACKEND_BASE}:latest talking-text-backend-base:local
    docker tag ${FRONTEND_BASE}:latest talking-text-frontend-base:local
    echo "✅ Base images tagged as :local for docker-compose.yml."
fi
