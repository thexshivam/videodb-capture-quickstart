from fastapi import APIRouter, HTTPException, Request, Depends, Header, BackgroundTasks
from sqlalchemy.orm import Session
from app.services.videodb import videodb_service
from app.services.insights import index_video, generate_insights
from app.core.config import settings
from app.db.database import get_db
from app.db.models import User, Recording
import json
import logging
import videodb
from videodb._constants import RTStreamChannelType

router = APIRouter()
logger = logging.getLogger(__name__)

def get_current_user(x_access_token: str = Header(None), db: Session = Depends(get_db)):
    """
    Dependency to validate access_token and return the User.
    This replaces the previous simple API Key check.
    """
    if not x_access_token:
        raise HTTPException(status_code=401, detail="Missing Access Token")
    
    user = db.query(User).filter(User.access_token == x_access_token).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid Access Token")
    
    return user

@router.get("/config")
def get_server_config(user: User = Depends(get_current_user)):
    """
    Get the server's dynamic configuration.
    Secured by Access Token (UUID).
    """
    config = {
        "webhook_url": settings.WEBHOOK_URL,
        "api_port": settings.API_PORT,
    }
    # Only include base_url if explicitly set
    if settings.VIDEODB_API_URL:
        config["backend_base_url"] = settings.VIDEODB_API_URL
    return config

@router.get("/")
def home():
    """Health Check"""
    return {"status": "ok", "message": "Meeting Copilot Modular Server Running"}

@router.post("/token")
async def generate_token(request: Request, user: User = Depends(get_current_user)):
    """
    Generate a session token for the current user.
    """
    try:
        # Use the securely stored API Key from the database
        user_api_key = user.api_key
        
        user_id = f"user-{user.id}" 
        # Ideally, read from request body if available
        try:
            body = await request.json()
            if "user_id" in body:
                user_id = body["user_id"]
        except:
            pass

        # Call service with the User's specific API Key
        token_data = videodb_service.create_session_token_with_metadata(
            user_id, 
            override_api_key=user_api_key
        )
        
        if not token_data:
            raise HTTPException(status_code=500, detail="Failed to generate session token via Recorder API")
            
        return token_data

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Error in token endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Recording Lifecycle Endpoints ============

@router.post("/recordings/start")
async def start_recording(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Create a new recording entry when session starts.
    Status: recording
    """
    try:
        body = await request.json()
        session_id = body.get("session_id")
        
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        
        # Check if already exists
        existing = db.query(Recording).filter(Recording.session_id == session_id).first()
        if existing:
            logger.info(f"[Recording] Session {session_id} already exists, returning existing")
            return {"id": existing.id, "session_id": existing.session_id, "status": existing.status}
        
        recording = Recording(
            session_id=session_id,
            status="recording"
        )
        db.add(recording)
        db.commit()
        db.refresh(recording)
        
        logger.info(f"[Recording] ▶️ Started recording for session: {session_id}")
        return {"id": recording.id, "session_id": recording.session_id, "status": recording.status}
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"[Recording] Error starting: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recordings/{session_id}/stop")
async def stop_recording(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Update recording status to 'processing' when session stops.
    """
    recording = db.query(Recording).filter(Recording.session_id == session_id).first()
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    recording.status = "processing"
    db.commit()
    
    logger.info(f"[Recording] ⏳ Session {session_id} now processing")
    return {"id": recording.id, "session_id": recording.session_id, "status": recording.status}


def process_indexing_background(recording_id: int, video_id: str, api_key: str):
    """
    Background task to index a recording and generate insights.
    """
    from app.db.database import SessionLocal

    db = SessionLocal()
    try:
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if not recording:
            logger.error(f"[Index BG] Recording {recording_id} not found")
            return

        # Update status to processing
        recording.insights_status = "processing"
        db.commit()
        logger.info(f"[Index BG] Starting indexing for recording {recording_id}")

        # Index the video (for searchability)
        success = index_video(video_id, api_key)

        if not success:
            recording.insights_status = "failed"
            db.commit()
            logger.warning(f"[Index BG] ❌ Failed to index video {video_id}")
            return

        logger.info(f"[Index BG] ✅ Indexed video {video_id} successfully")

        # Generate insights
        logger.info(f"[Index BG] Starting insight generation for recording {recording_id}")
        insights = generate_insights(video_id, api_key)

        if insights and len(insights) > 0:
            recording.insights = json.dumps(insights)
            recording.insights_status = "ready"
            logger.info(f"[Index BG] ✅ Generated {len(insights)} insights for video {video_id}")
        else:
            # No insights (likely no transcript), but indexing succeeded
            recording.insights_status = "ready"
            logger.info(f"[Index BG] Video indexed but no insights generated (no transcript or empty)")

        db.commit()

    except Exception as e:
        logger.exception(f"[Index BG] Error processing: {e}")
        try:
            recording = db.query(Recording).filter(Recording.id == recording_id).first()
            if recording:
                recording.insights_status = "failed"
                db.commit()
        except:
            pass
    finally:
        db.close()


def start_realtime_transcription_with_ws(
    capture_session_id: str,
    api_key: str,
    mic_ws_connection_id: str = None,
    sys_audio_ws_connection_id: str = None,
    max_retries: int = 150,
    retry_delay: float = 2.0
):
    """
    Background task to start real-time transcription for a capture session.

    Polls for RTStreams to exist (they're created after capture_session.active),
    then calls startTranscript with the provided WebSocket connection IDs.

    Args:
        capture_session_id: The capture session ID (cap-xxx)
        api_key: VideoDB API key
        mic_ws_connection_id: WebSocket connection ID for mic transcripts
        sys_audio_ws_connection_id: WebSocket connection ID for system audio transcripts
        max_retries: Max attempts to poll for RTStreams
        retry_delay: Seconds between poll attempts
    """
    import time

    try:
        logger.info(f"[Transcript] Starting transcription for session: {capture_session_id}")
        logger.info(f"[Transcript] Mic WS ID: {mic_ws_connection_id}, SysAudio WS ID: {sys_audio_ws_connection_id}")

        # Connect to VideoDB (only pass base_url if explicitly set)
        connect_kwargs = {"api_key": api_key}
        if settings.VIDEODB_API_URL:
            connect_kwargs["base_url"] = settings.VIDEODB_API_URL
        conn = videodb.connect(**connect_kwargs)

        # Poll for capture session to have RTStreams
        mics = []
        system_audios = []

        for attempt in range(max_retries):
            try:
                cap = conn.get_capture_session(capture_session_id)
                if not cap:
                    logger.warning(f"[Transcript] Attempt {attempt + 1}: Session not found yet")
                    time.sleep(retry_delay)
                    continue

                logger.info(f"[Transcript] Attempt {attempt + 1}: Session status: {cap.status}")

                # Try to get RTStreams
                mics = cap.get_rtstream(RTStreamChannelType.mic)
                system_audios = cap.get_rtstream(RTStreamChannelType.system_audio)

                if mics or system_audios:
                    logger.info(f"[Transcript] ✅ Found RTStreams: {len(mics)} mic, {len(system_audios)} sys_audio")
                    break
                else:
                    logger.info(f"[Transcript] Attempt {attempt + 1}: No RTStreams yet, waiting...")
                    time.sleep(retry_delay)

            except Exception as e:
                logger.warning(f"[Transcript] Attempt {attempt + 1} error: {e}")
                time.sleep(retry_delay)

        if not mics and not system_audios:
            logger.error(f"[Transcript] Failed to find RTStreams after {max_retries} attempts")
            return

        # Start transcription on mic stream with WebSocket connection ID
        if mics and mic_ws_connection_id:
            mic_stream = mics[0]
            logger.info(f"[Transcript] Starting transcript on mic: {mic_stream.id} with ws_connection_id: {mic_ws_connection_id}")
            mic_stream.start_transcript(ws_connection_id=mic_ws_connection_id)
            logger.info(f"[Transcript] ✅ Mic transcription started")
        elif mics:
            logger.info(f"[Transcript] Mic stream found but no ws_connection_id provided, skipping")

        # Start transcription on system audio stream with WebSocket connection ID
        if system_audios and sys_audio_ws_connection_id:
            sys_stream = system_audios[0]
            logger.info(f"[Transcript] Starting transcript on sys_audio: {sys_stream.id} with ws_connection_id: {sys_audio_ws_connection_id}")
            sys_stream.start_transcript(ws_connection_id=sys_audio_ws_connection_id)
            logger.info(f"[Transcript] ✅ System audio transcription started")
        elif system_audios:
            logger.info(f"[Transcript] System audio stream found but no ws_connection_id provided, skipping")

    except Exception as e:
        logger.exception(f"[Transcript] Failed to start transcription for {capture_session_id}: {e}")


@router.post("/start-transcription")
async def start_transcription(
    request: Request,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user)
):
    """
    Start real-time transcription for a capture session with frontend WebSocket connection IDs.

    The frontend creates WebSocket connections using the videodb SDK, gets the connection IDs,
    then calls this endpoint. The backend polls for RTStreams and starts transcription,
    routing events to the frontend's WebSocket connections.

    Request body:
    {
        "session_id": "cap-xxx",
        "mic_ws_connection_id": "ws-xxx",      // Optional
        "sys_audio_ws_connection_id": "ws-yyy" // Optional
    }
    """
    try:
        body = await request.json()
        session_id = body.get("session_id")
        mic_ws_connection_id = body.get("mic_ws_connection_id")
        sys_audio_ws_connection_id = body.get("sys_audio_ws_connection_id")

        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")

        if not mic_ws_connection_id and not sys_audio_ws_connection_id:
            raise HTTPException(status_code=400, detail="At least one ws_connection_id is required")

        logger.info(f"[API] Starting transcription for session {session_id}")
        logger.info(f"[API] Mic WS: {mic_ws_connection_id}, SysAudio WS: {sys_audio_ws_connection_id}")

        # Start transcription in background (will poll for RTStreams)
        background_tasks.add_task(
            start_realtime_transcription_with_ws,
            session_id,
            user.api_key,
            mic_ws_connection_id,
            sys_audio_ws_connection_id
        )

        return {
            "status": "started",
            "session_id": session_id,
            "message": "Transcription startup initiated. Will poll for RTStreams and start when ready."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[API] Error starting transcription: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/capture-session")
async def create_capture_session(request: Request, user: User = Depends(get_current_user)):
    """
    Create a new capture session on VideoDB.
    This must be called before starting a recording with the CaptureClient.

    Returns the session_id (cap-xxx) that should be passed to startCaptureSession().

    Optional: ws_connection_id can be passed to receive capture session events on a WebSocket.
    """
    try:
        user_api_key = user.api_key

        # Get optional parameters from request body
        callback_url = None
        metadata = None
        ws_connection_id = None
        try:
            body = await request.json()
            callback_url = body.get("callback_url")
            metadata = body.get("metadata")
            ws_connection_id = body.get("ws_connection_id")
        except:
            pass

        # Use webhook URL from settings if not provided
        if not callback_url:
            callback_url = settings.WEBHOOK_URL

        end_user_id = f"user-{user.id}"

        logger.info(f"Creating capture session for user {end_user_id} with callback: {callback_url}, ws_connection_id: {ws_connection_id}")

        session_data = videodb_service.create_capture_session(
            end_user_id=end_user_id,
            callback_url=callback_url,
            metadata=metadata,
            ws_connection_id=ws_connection_id,
            override_api_key=user_api_key
        )

        if not session_data:
            raise HTTPException(status_code=500, detail="Failed to create capture session")

        logger.info(f"Created capture session: {session_data.get('session_id')}")
        return session_data

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error creating capture session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/webhook")
async def handle_webhook(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Handle incoming webhook events from VideoDB.
    Key event: capture_session.exported - video is ready for playback.
    """
    try:
        try:
            body = await request.json()
        except Exception:
            # Handle health checks or empty requests gracefully
            return {"status": "ok", "received": True}

        print("\n--- 🔔 Webhook Event ---")

        event_type = body.get('event', 'unknown')
        print(f"Event: {event_type}")
        print(f"Payload: {body}")

        data = body.get("data", {})
        capture_session_id = body.get("capture_session_id")

        # Handle capture_session.exported - final video is ready
        if event_type == "capture_session.exported":
            video_id = data.get("exported_video_id")
            stream_url = data.get("stream_url")
            player_url = data.get("player_url")
            session_id = capture_session_id

            if video_id:
                # Try to find existing recording by session_id (created on start)
                recording = db.query(Recording).filter(Recording.session_id == session_id).first()

                if recording:
                    recording.video_id = video_id
                    recording.stream_url = stream_url
                    recording.player_url = player_url
                    recording.status = "available"
                    recording.insights_status = "pending"
                    db.commit()
                    print(f"✅ Recording available: {recording.video_id}")
                else:
                    # Create new recording if not found
                    recording = Recording(
                        video_id=video_id,
                        stream_url=stream_url,
                        player_url=player_url,
                        session_id=session_id,
                        status="available",
                        insights_status="pending"
                    )
                    db.add(recording)
                    db.commit()
                    db.refresh(recording)
                    print(f"✅ Recording created: {recording.video_id}")

                # Trigger video indexing in background
                # Use most recent user (handles re-registration with new API key)
                user = db.query(User).order_by(User.id.desc()).first()
                if user and user.api_key and recording.video_id:
                    background_tasks.add_task(
                        process_indexing_background,
                        recording.id,
                        recording.video_id,
                        user.api_key
                    )
                    print(f"🔍 Scheduled video indexing for recording: {recording.id}")
            else:
                print(f"⚠️ No video_id in completed event data")

        # Handle capture_session.active - session is now active with RTStreams
        # Note: Transcription is started by frontend via POST /api/start-transcription
        elif event_type == "capture_session.active":
            print(f"📋 Capture session active: {capture_session_id}")
            rtstreams = data.get("rtstreams", [])
            print(f"   RTStreams: {[r.get('name') for r in rtstreams]}")
            print(f"   ℹ️ Frontend should call /api/start-transcription with WebSocket connection IDs")

        # Handle transcript events (logged for debugging, delivered via client-side WebSocket)
        elif event_type in ["transcript", "transcript.segment", "rtstream.transcript"]:
            text = body.get("text") or data.get("text", "")
            is_final = body.get("is_final") or data.get("is_final", False)
            source = body.get("source") or data.get("source") or "unknown"
            print(f"🎤 Transcript [{source}] (final={is_final}): {text[:100]}...")

        # Log other capture session events for debugging
        elif event_type.startswith("capture_session."):
            print(f"📋 Capture session event: {event_type}")

        print("---------------------------------\n")
        return {"status": "ok", "received": True}
    except Exception as e:
        print(f"Error processing webhook: {e}")
        raise HTTPException(status_code=500, detail="Error processing webhook")

@router.get("/recordings")
async def get_recordings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Fetch all completed recordings with their insight status.
    """
    recordings = db.query(Recording).all()
    # Convert to dict to include all fields
    result = []
    for r in recordings:
        result.append({
            "id": r.id,
            "video_id": r.video_id,
            "stream_url": r.stream_url,
            "player_url": r.player_url,
            "session_id": r.session_id,
            "duration": r.duration,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "status": r.status or "recording",
            "insights": json.loads(r.insights) if r.insights else None,
            "insights_status": r.insights_status or "pending"
        })
    return result

@router.get("/recordings/{recording_id}")
async def get_recording(recording_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Fetch a single recording with its insights.
    """
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    return {
        "id": recording.id,
        "video_id": recording.video_id,
        "stream_url": recording.stream_url,
        "player_url": recording.player_url,
        "session_id": recording.session_id,
        "duration": recording.duration,
        "created_at": recording.created_at.isoformat() if recording.created_at else None,
        "status": recording.status or "recording",
        "insights": json.loads(recording.insights) if recording.insights else None,
        "insights_status": recording.insights_status or "pending"
    }

