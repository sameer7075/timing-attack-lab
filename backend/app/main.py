"""FastAPI application: the simulated authentication server and lab API.

Run from the repository root:
    uvicorn backend.app.main:app --reload
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from .attacks import manager as attack_manager
from .auth import attempt_login
from .benchmark import run_benchmark
from .sessions import PIN_LENGTH_MAX, PIN_LENGTH_MIN, Session, store

app = FastAPI(
    title="Timing Attack Lab",
    version="1.0.0",
    description="A deliberately leaky login server, its constant-time patch, and the tools to compare them.",
)

_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)


# ---------------------------------------------------------------- errors
# The contract asks for a uniform {"error": "..."} body everywhere.

@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    message = first.get("msg", "invalid request")
    return JSONResponse({"error": f"{field}: {message}" if field else message}, status_code=400)


# ---------------------------------------------------------------- models

class CreateSessionBody(BaseModel):
    pin_length: int = Field(6, ge=PIN_LENGTH_MIN, le=PIN_LENGTH_MAX)
    amplify_ms: float = Field(2.0, ge=0, le=20)


class LoginBody(BaseModel):
    session_id: str = Field(..., max_length=64)
    guess: str = Field(..., max_length=PIN_LENGTH_MAX)


class ConfigBody(BaseModel):
    amplify_ms: Optional[float] = Field(None, ge=0, le=20)
    jitter_ms: Optional[float] = Field(None, ge=0, le=50)
    rate_limit_per_min: Optional[int] = Field(None, ge=1, le=10000)
    lockout_after: Optional[int] = Field(None, ge=1, le=10000)
    oracle_mode: Optional[bool] = None


class AttackBody(BaseModel):
    session_id: str = Field(..., max_length=64)
    target: Literal["vulnerable", "secure"] = "vulnerable"
    samples: int = Field(15, ge=1, le=100)
    use_server_time: bool = False


class BenchmarkBody(BaseModel):
    samples: int = Field(25, ge=3, le=60)


def _session_or_404(session_id: str) -> Session:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(404, "unknown or expired session")
    return session


# ---------------------------------------------------------------- routes

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "sessions": len(store), "running_attacks": attack_manager.running_count()}


@app.post("/api/session", status_code=201)
def create_session(body: CreateSessionBody | None = None) -> dict:
    body = body or CreateSessionBody()
    return store.create(body.pin_length, body.amplify_ms).public_view()


@app.get("/api/session/{session_id}")
def get_session(session_id: str) -> dict:
    return _session_or_404(session_id).status_view()


@app.put("/api/session/{session_id}/config")
def update_config(session_id: str, body: ConfigBody) -> dict:
    session = _session_or_404(session_id)
    # Only fields sent in the body change. An explicit null for the two
    # nullable fields switches that countermeasure off.
    changes = body.model_dump(exclude_unset=True)
    for key in ("amplify_ms", "jitter_ms", "oracle_mode"):
        if key in changes and changes[key] is None:
            raise HTTPException(400, f"{key} cannot be null")
    session.apply_config(changes)
    return session.config.as_dict()


def _login(body: LoginBody, target: Literal["vulnerable", "secure"]) -> JSONResponse:
    session = _session_or_404(body.session_id)
    outcome = attempt_login(session, body.guess, target)
    if outcome.error:
        return JSONResponse({"error": outcome.error}, status_code=outcome.status_code)
    payload: dict = {"success": outcome.success}
    if session.config.oracle_mode and outcome.server_time_ns is not None:
        payload["server_time_us"] = round(outcome.server_time_ns / 1000)
    return JSONResponse(payload, status_code=outcome.status_code)


# Plain `def` (not async) so the deliberate sleeps run in the threadpool
# instead of blocking the event loop.
@app.post("/api/login/vulnerable")
def login_vulnerable(body: LoginBody) -> JSONResponse:
    return _login(body, "vulnerable")


@app.post("/api/login/secure")
def login_secure(body: LoginBody) -> JSONResponse:
    return _login(body, "secure")


@app.post("/api/attack/start", status_code=202)
def start_attack(body: AttackBody) -> dict:
    session = _session_or_404(body.session_id)
    if body.use_server_time and not session.config.oracle_mode:
        raise HTTPException(400, "use_server_time needs oracle_mode switched on for this session")
    try:
        job = attack_manager.start(session, body.target, body.samples, body.use_server_time)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except OverflowError as exc:
        raise HTTPException(503, str(exc))
    return {"attack_id": job.attack_id}


@app.get("/api/attack/{attack_id}")
def attack_status(attack_id: str) -> dict:
    job = attack_manager.get(attack_id)
    if job is None:
        raise HTTPException(404, "unknown attack_id")
    return job.view()


@app.post("/api/attack/{attack_id}/stop")
def stop_attack(attack_id: str) -> dict:
    job = attack_manager.stop(attack_id)
    if job is None:
        raise HTTPException(404, "unknown attack_id")
    return {"attack_id": attack_id, "stopping": job.status == "running"}


@app.post("/api/session/{session_id}/benchmark")
def benchmark(session_id: str, body: BenchmarkBody | None = None) -> dict:
    session = _session_or_404(session_id)
    return run_benchmark(session, (body or BenchmarkBody()).samples)


# ---------------------------------------------------------------- frontend
# When the React build exists (frontend/dist), serve it from the same origin
# so one deployment hosts both the UI and the API.

_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        candidate = (_DIST / path).resolve()
        if path and candidate.is_file() and _DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
