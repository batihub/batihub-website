from pydantic import with_config
import asyncio
from sqlalchemy import  Integer, Text, String, Boolean
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base, Mapped, mapped_column
from operator import index
import logging
##########from sqlalchemy.testing.schema import mapped_column
from sqlalchemy.orm import mapped_column
import os  ##########
"""

databaseforfastapi=# INSERT INTO "postsP" (title , content , is_published)
databaseforfastapi-# VALUES('FROM PSQL' , 'aaaaaaaaaaaaaaaaaaaaaaaaaaasssss' , true);
INSERT 0 1

"""

#####DATABASE_URL = "postgresql+asyncpg://postgres:1234@localhost:5432/databaseforfastapi"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:1234@localhost:5432/databaseforfastapi")

#########-------------------------

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "asyncpg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

#########-------------------------
engine_postgres = create_async_engine (DATABASE_URL, echo=True) #echo=True in SQLAlchemy makes the engine print all the
                                                                # SQL statements it executes.debugging testing etc but not production
AsyncSessionLocal = sessionmaker(
    bind=engine_postgres,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    #### autocommit=False  this one is old not valid for sqlalchemy 2.0+ ((remove it))
)
Base = declarative_base()

#class Base(declarative_base):
#   pass

class PostPostgres(Base):
    __tablename__ = "postsP"          ## left side for python right side for SQL content:Mapped[str] (py) = (sql)  mapped_column[Text] since python has no Text type it uses str for it
    id : Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title : Mapped[str] = mapped_column(String, index=True)
    content : Mapped[str] = mapped_column(Text)
    is_published : Mapped[bool] = mapped_column(Boolean, default=True)

    #def __repr__(self) -> str:
    #    return f"User(id={self.id!r}, name={self.name!r}, fullname={self.fullname!r})"


async def init_db_postgres():
    async with engine_postgres.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # dont go like bind=engine_postgres when using run_sync it automatically binds the connections


async def get_db_postgres():
    """
       Usage in FastAPI:
           async def endpoint(db: AsyncSession = Depends(get_db_postgres)):
               ...
       The context manager ensures the session is closed automatically.
       """
    async with AsyncSessionLocal() as db:
        try:
            yield db
        except Exception as e:
            await db.rollback()
            raise e
        finally:
            await db.close()