ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS deps

FROM python:3.12-alpine

# Switch apk to aliyun mirror
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

RUN apk add --no-cache libpq ffmpeg

WORKDIR /app

COPY --from=deps /app/.venv /app/.venv

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini config.toml ./

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
