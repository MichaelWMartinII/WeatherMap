"""
server.py — WeatherMap: static files + live location relay on one port (8282)

Static:  GET /*              → serves files from this directory
Relay:   POST /location/{token}  → update position
         GET  /location/{token}  → poll position
         DEL  /location/{token}  → stop sharing
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import time
import os
import re

app = FastAPI()
ALLOWED_ORIGINS = (
    [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()]
    or [
        "https://weathermap.michaelwmartinjr.com",
        "http://localhost:8282",
        "http://127.0.0.1:8282",
    ]
)
TOKEN_RE = re.compile(r"^[a-f0-9]{24}$")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

store: dict[str, dict] = {}
TTL = 300  # 5 min expiry with no update


class LocationUpdate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    acc: float = Field(default=0.0, ge=0, le=10000)


def validate_token(token: str) -> None:
    if not TOKEN_RE.fullmatch(token):
        raise HTTPException(400, "Invalid token")


@app.post("/location/{token}")
def update_location(token: str, body: LocationUpdate):
    validate_token(token)
    now = time.time()
    store[token] = {
        "lat": body.lat, "lng": body.lng, "acc": body.acc,
        "updated_at": now, "expires_at": now + TTL,
    }
    expired = [k for k, v in store.items() if v["expires_at"] < now]
    for k in expired:
        del store[k]
    return {"ok": True, "expires_in": TTL}


@app.get("/location/{token}")
def get_location(token: str):
    validate_token(token)
    entry = store.get(token)
    if not entry or entry["expires_at"] < time.time():
        raise HTTPException(404, "Session not found or expired")
    return {
        "lat": entry["lat"], "lng": entry["lng"],
        "acc": entry["acc"], "updated_at": entry["updated_at"],
    }


@app.delete("/location/{token}")
def stop_sharing(token: str):
    validate_token(token)
    store.pop(token, None)
    return {"ok": True}


@app.get("/health")
def health():
    return {"ok": True, "sessions": len(store)}


# Serve static files last so API routes take priority
app.mount("/", StaticFiles(directory=os.path.dirname(__file__), html=True), name="static")
