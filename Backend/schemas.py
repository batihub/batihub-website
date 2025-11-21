from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session

class PostBase(BaseModel):
    title: str
    content: str
    is_published:bool= True

class PostOut(PostBase):
    id: int

    class Config:
        #orm_mode =True  ## old version V1
        # Configuration for Pydantic V2
        from_attributes = True

class PostUpdate(BaseModel):
    # All fields are optional, enabling partial updates
    title: Optional[str] = None
    content: Optional[str] = None
    is_published: Optional[bool] = None

    class Config:
        #orm_mode =True  ## old version V1
        # Configuration for Pydantic V2
        from_attributes = True