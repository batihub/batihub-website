from fastapi import FastAPI, HTTPException, Depends ,status , Path ,Form
from sqlalchemy.ext.asyncio import  AsyncSession
from starlette.responses import JSONResponse
import crud_postgres
import schemas
import postgreq_database
from postgreq_database import get_db_postgres
from schemas import PostUpdate
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title = "Blog Api")

# --- CORS CONFIGURATION ---
origins = [
    "http://localhost:3000", # Example if you use React/Vite
    "http://127.0.0.1:8080", # Another common local port
    "*" # called a wildcard to say that all are allowed DANGER: Use "*" only for development/testing
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, # Replace with "*" for testing, or specific frontend origins
    allow_credentials=True,
    allow_methods=["*"], #  wildcard Allows GET, POST, PUT, PATCH, DELETE
    allow_headers=["*"], #  wildcard
)
# --------------------------
@app.on_event("startup")
async def startup_event():
    # This calls the function that creates the tables
    await postgreq_database.init_db_postgres()

@app.get("/posts" , response_model=list[schemas.PostOut]) ########### list[schemas.PostOut]
async def get_all_posts(db:AsyncSession = Depends(get_db_postgres)):
    all_posts = await crud_postgres.get_all_posts_postgres(db = db)
    return all_posts or []       ##################

@app.get("/posts/{post_id}", response_model= schemas.PostOut)
async def get_post(db:AsyncSession = Depends(get_db_postgres), post_id:int= Path(gt=0)): ########### schemas.PostOut
    post = await crud_postgres.get_post_by_id_postgres(db = db, post_id= post_id)
    if post is not None:
        return post
    raise HTTPException(detail={"status" :"not found" , "content": ""}, status_code=status.HTTP_404_NOT_FOUND)

@app.post("/posts", response_model=schemas.PostOut , status_code= status.HTTP_201_CREATED)
async def create_post(new_post: schemas.PostBase, db:AsyncSession = Depends(get_db_postgres)):
    new_post = await crud_postgres.create_post_postgres(db=db,title= new_post.title, content= new_post.content, is_published=new_post.is_published)
    if new_post:
        return new_post
    else:
        raise HTTPException(detail={"status": "unsuccess" , "content": ""}, status_code=status.HTTP_400_BAD_REQUEST)

@app.patch("/posts/{post_id}")
async def update_post_by_id (post_update: schemas.PostUpdate, post_id: int = Path(gt=0), db:AsyncSession = Depends(get_db_postgres)):

    #you're seeing that PydanticJsonSchemaWarning because the dependency you are using for the database session, schemas.PostBase, is a Python class or type object,
    #and Pydantic cannot serialize a class object into the JSON format required for the OpenAPI documentation (/openapi.json).
    #This is a common issue when setting up database dependencies in FastAPI, and the fix is always to use a function instead of a class directly in the Depends() call.
    #Since I don't have your full project structure, I will show you how to structure the dependency function (get_db)
    #and how to correctly integrate it into your main.py and schemas.py files to resolve the warning.

    ### you need to move all non-default arguments to the beginning of the parameter list

    update_data = post_update.model_dump(exclude_unset=True)

    post = await crud_postgres.get_post_by_id_postgres(db=db, post_id=post_id)
    if post is  None:
        raise HTTPException(detail={"status" : "not found" , "content" : "post id not found"}, status_code=status.HTTP_404_NOT_FOUND)
    if not update_data:
        return JSONResponse(content={"status": "success", "content": "no fields provided for update"}, status_code=status.HTTP_200_OK)

    updated_post = await crud_postgres.update_post_by_id_postgres(db= db, post_id= post_id, update_data = update_data)
    if updated_post:
        return JSONResponse(content={"status": "success", "content": "post updated"}, status_code=status.HTTP_200_OK)
    return JSONResponse(content={"status" : "unsuccess" , "content" : "update failed at the database level"}, status_code=status.HTTP_400_BAD_REQUEST)

@app.delete("/posts/{post_id}")
async def delete_post(db:AsyncSession = Depends(get_db_postgres), post_id: int = Path(gt=0)):
    post = await crud_postgres.get_post_by_id_postgres(db=db ,post_id=post_id)
    if post is  None:
        raise HTTPException(detail={"status" : "not found" , "content" : ""}, status_code=status.HTTP_404_NOT_FOUND)
    result = await crud_postgres.delete_post_by_id_postgres(db= db, post_id= post_id)
    if result:
        return JSONResponse(content={"status": "success", "content": ""}, status_code=status.HTTP_200_OK)

    return JSONResponse(content={"status" : "unsuccess" , "content" : ""}, status_code=status.HTTP_400_BAD_REQUEST)
