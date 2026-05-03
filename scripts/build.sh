#!/bin/bash
# Build and push app images.
# Requires base images in the registry (run build-base.sh first if deps changed).
#
# Usage: ./scripts/build.sh

set -e

if [ ! -f .env.deploy ]; then
    echo "❌ .env.deploy not found. Copy .env.deploy.example and fill in values."
    exit 1
fi
source .env.deploy

BACKEND_BASE="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/talking-text-backend-base"
FRONTEND_BASE="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/talking-text-frontend-base"
BACKEND="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/talking-text-backend"
FRONTEND="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/talking-text-frontend"

BACKEND_VERSION=$(grep -m1 '^version = ' backend/pyproject.toml | sed 's/version = "\(.*\)"/\1/')
FRONTEND_VERSION=$(grep '"version"' frontend/package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

echo "📦 Building backend:${BACKEND_VERSION}..."
docker build --platform linux/amd64 \
    --build-arg BASE_IMAGE=${BACKEND_BASE}:latest \
    -t ${BACKEND}:${BACKEND_VERSION} \
    -t ${BACKEND}:latest \
    -f backend/docker/Dockerfile \
    backend/

echo "📦 Building frontend:${FRONTEND_VERSION}..."
docker build --platform linux/amd64 \
    --build-arg BASE_IMAGE=${FRONTEND_BASE}:latest \
    -t ${FRONTEND}:${FRONTEND_VERSION} \
    -t ${FRONTEND}:latest \
    -f frontend/docker/Dockerfile \
    frontend/

echo "☁️  Pushing backend..."
docker push ${BACKEND}:${BACKEND_VERSION}
docker push ${BACKEND}:latest

echo "☁️  Pushing frontend..."
docker push ${FRONTEND}:${FRONTEND_VERSION}
docker push ${FRONTEND}:latest

echo "✅ Built and pushed — backend:${BACKEND_VERSION}  frontend:${FRONTEND_VERSION}"
