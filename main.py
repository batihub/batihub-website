from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

# All models must be imported before init_db so SQLModel.metadata registers them
import models.models  # noqa: F401

from core.database import init_db
from routers import tweet, chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    print("Portfolio Backend running — database initialised")
    yield
    print("Portfolio Backend shutting down")


app = FastAPI(title="Kingo's Portfolio API", lifespan=lifespan)

# TODO: replace with your actual frontend origin before going to production
origins = [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:63342",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tweet.router)
app.include_router(chat.router)
