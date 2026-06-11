from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.groups import router as groups_router
from app.api.health import router as health_router
from app.api.ingest import router as ingest_router
from app.api.learner import router as learner_router
from app.api.session import router as session_router
from app.api.share import router as share_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(learner_router)
api_router.include_router(session_router)
api_router.include_router(groups_router)
api_router.include_router(ingest_router)
api_router.include_router(share_router)
