import logging
from typing import Union, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, Boolean
from postgreq_database import PostPostgres

async def create_post_postgres(db:AsyncSession, title:str, content:str, is_published:bool=True) -> Optional[PostPostgres]:
    try:
        new_post = PostPostgres(title=title, content=content, is_published=is_published)
        db.add(new_post)
        await db.commit()
        await db.refresh(new_post)  ####### object is stale(missing id and timestamps) Necessary: To retrieve the database-generated primary key (id) and timestamps before returning the object
        return new_post
    except Exception as e:
        await db.rollback()
        logging.error(f"error when adding to database {e}")

async def get_all_posts_postgres(db:AsyncSession) -> Optional[List[PostPostgres]]:
    try:
        q = select(PostPostgres).order_by(PostPostgres.id)    #############################
        result = await db.execute(q)
        return result.scalars().all()
        #row = result.first()w post : {e}")
        return None
        #print(row)  # Might output: (<Post object at 0x...>,)  returns a tuple
    except Exception as e:
        logging.error(f"error when fetching all posts : {e}")
        return None

async def delete_post_by_id_postgres(db:AsyncSession, post_id: int) -> bool:
    try:
        post = await get_post_by_id_postgres(db=db, post_id = post_id)
        if post is not None:
            await db.delete(post)
            await db.commit()
            return True
    except Exception as e:
        logging.error(f"error when deleting post by id {post_id} : {e}")
        return False

async def get_post_by_id_postgres(db:AsyncSession, post_id:int) -> Optional[PostPostgres]:
    try:
        q = select(PostPostgres).where(PostPostgres.id == post_id)    ##########################
        post = await db.execute(q)
        return post.scalars().first()
    except Exception as e:
        logging.error(f"error when fetching post id {post_id} : {e}")
        return None

async def update_post_by_id_postgres(db:AsyncSession,post_id:int ,update_data:dict) -> bool:
    post = await get_post_by_id_postgres(db=db, post_id=post_id)
    if post:
        for key, value in update_data.items():
            setattr(post, key, value)
        try:
            await db.commit()
            await db.refresh(post)
            return True
        except  Exception as e:
            await db.rollback()
            logging.error(f"error when updating post {post_id} : {e}")
            return False
