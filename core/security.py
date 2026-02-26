import os
import jwt
from typing import Optional
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from dotenv import load_dotenv

from models.models import UserRole
from schemas.schemas import UserSession

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set. Add it to your .env file.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# ── Password hashing ──────────────────────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

# ── JWT ───────────────────────────────────────────────────────────────────────

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> Optional[dict]:
    """Shared decode logic. Returns payload dict or None on any failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.PyJWTError:
        return None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserSession:
    """Strict — raises 401 if token is missing or invalid. Use on protected routes."""
    payload = _decode_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Could not validate credentials")

    username: str = payload.get("sub")
    user_role: str = payload.get("role")
    user_id: int = payload.get("id")

    if not username or not user_role or user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    return UserSession(id=user_id, username=username, role=user_role)


async def get_optional_user(
    token: Optional[str] = Depends(oauth2_scheme_optional),
) -> Optional[UserSession]:
    """Soft — returns None instead of raising for guests. Use on public routes."""
    if not token:
        return None
    payload = _decode_token(token)
    if payload is None:
        return None

    username: str = payload.get("sub")
    user_role: str = payload.get("role")
    user_id: int = payload.get("id")

    if not username or not user_role or user_id is None:
        return None

    return UserSession(id=user_id, username=username, role=user_role)


# ── Role-based access control ─────────────────────────────────────────────────

ROLE_HIERARCHY = {
    UserRole.ROOT: 3,
    UserRole.ADMIN: 2,
    UserRole.INTERN: 1,
}

class RoleChecker:
    def __init__(self, required_role: UserRole):
        self.required_role = required_role

    def __call__(self, user: UserSession = Depends(get_current_user)) -> UserSession:
        if ROLE_HIERARCHY[user.role] < ROLE_HIERARCHY[self.required_role]:
            raise HTTPException(status_code=403, detail="Insufficient permissions for this action")
        return user
