import uuid
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_config import app_config
from app.config import settings
from app.storage.db import get_db
from app.storage.enums import CredentialProvider
from app.storage.models.account import Account
from app.storage.models.account_credential import AccountCredential

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "session"


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


def _signer() -> TimestampSigner:
    return TimestampSigner(settings.session_secret)


def create_session_token(account_id: uuid.UUID) -> str:
    return _signer().sign(str(account_id)).decode()


def verify_session_token(token: str) -> uuid.UUID:
    max_age = app_config.auth.session_max_age_seconds
    try:
        raw = _signer().unsign(token, max_age=max_age)
        return uuid.UUID(raw.decode())
    except (SignatureExpired, BadSignature, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
        ) from exc


def _set_session_cookie(response: Response, account_id: uuid.UUID) -> None:
    token = create_session_token(account_id)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=app_config.auth.session_max_age_seconds,
        secure=False,  # set True in production (HTTPS)
    )


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AccountOut(BaseModel):
    id: uuid.UUID
    name: str
    # Returned on login/register so the Next.js Server Action can forward it
    # into the browser cookie (Next.js cannot see Set-Cookie from upstream).
    session_token: str | None = None


# ---------------------------------------------------------------------------
# Dependency: resolve current account from session cookie
# ---------------------------------------------------------------------------


async def get_current_account(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Account:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    account_id = verify_session_token(token)
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")
    return account


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountOut:
    # Check email not already registered
    existing = await db.execute(
        select(AccountCredential).where(
            AccountCredential.provider == CredentialProvider.EMAIL,
            AccountCredential.identifier == body.email,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    account = Account(name=body.name)
    db.add(account)
    await db.flush()  # get account.id before creating credential

    credential = AccountCredential(
        account_id=account.id,
        provider=CredentialProvider.EMAIL,
        identifier=body.email,
        password=hashed,
    )
    db.add(credential)
    await db.commit()
    await db.refresh(account)

    token = create_session_token(account.id)
    _set_session_cookie(response, account.id)
    return AccountOut(id=account.id, name=account.name, session_token=token)


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountOut:
    result = await db.execute(
        select(AccountCredential).where(
            AccountCredential.provider == CredentialProvider.EMAIL,
            AccountCredential.identifier == body.email,
        )
    )
    credential = result.scalar_one_or_none()
    if credential is None or credential.password is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not bcrypt.checkpw(body.password.encode(), credential.password.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    account_result = await db.execute(select(Account).where(Account.id == credential.account_id))
    account = account_result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")

    token = create_session_token(account.id)
    _set_session_cookie(response, account.id)
    return AccountOut(id=account.id, name=account.name, session_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME)


@router.get("/me")
async def me(
    account: Annotated[Account, Depends(get_current_account)],
) -> AccountOut:
    return AccountOut(id=account.id, name=account.name)
