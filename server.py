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
from pydantic import BaseModel
import time
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

store: dict[str, dict] = {}
TTL = 300  # 5 min expiry with no update


class LocationUpdate(BaseModel):
    lat: float
    lng: float
    acc: float = 0.0


@app.post("/location/{token}")
def update_location(token: str, body: LocationUpdate):
    if len(token) > 64:
        raise HTTPException(400, "Invalid token")
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
    entry = store.get(token)
    if not entry or entry["expires_at"] < time.time():
        raise HTTPException(404, "Session not found or expired")
    return {
        "lat": entry["lat"], "lng": entry["lng"],
        "acc": entry["acc"], "updated_at": entry["updated_at"],
    }


@app.delete("/location/{token}")
def stop_sharing(token: str):
    store.pop(token, None)
    return {"ok": True}


@app.get("/health")
def health():
    return {"ok": True, "sessions": len(store)}


# Serve static files last so API routes take priority
app.mount("/", StaticFiles(directory=os.path.dirname(__file__), html=True), name="static")
