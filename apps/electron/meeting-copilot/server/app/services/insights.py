"""
Video Indexing Service

This service is responsible for:
1. Indexing videos in VideoDB for searchability
2. Future: Generate insights once VideoDB adds native summarization
"""
import logging
import videodb
from app.core.config import settings

logger = logging.getLogger(__name__)


def index_video(video_id: str, api_key: str) -> bool:
    """
    Index a video in VideoDB for spoken word search.
    
    Args:
        video_id: The VideoDB video ID (e.g., "m-xxx")
        api_key: The user's VideoDB API key
        
    Returns:
        True if indexing succeeded, False otherwise
    """
    try:
        logger.info(f"[Index] Starting indexing for video: {video_id}")
        
        # Connect to VideoDB (only pass base_url if explicitly set)
        connect_kwargs = {"api_key": api_key}
        if settings.VIDEODB_API_URL:
            connect_kwargs["base_url"] = settings.VIDEODB_API_URL
        conn = videodb.connect(**connect_kwargs)

        # Get the video
        coll = conn.get_collection()
        video = coll.get_video(video_id)

        if not video:
            logger.error(f"[Index] Video not found: {video_id}")
            return False
        
        # Index spoken words (enables transcript-based search)
        logger.info(f"[Index] Indexing spoken words for video: {video_id}")
        video.index_spoken_words()
        
        logger.info(f"[Index] ✅ Successfully indexed video: {video_id}")
        return True
        
    except Exception as e:
        logger.exception(f"[Index] Failed to index video {video_id}: {e}")
        return False


def generate_insights(video_id: str, api_key: str) -> list:
    """
    Generate insights/summary for a video using VideoDB text generation.
    
    Args:
        video_id: The VideoDB video ID (e.g., "m-xxx")
        api_key: The user's VideoDB API key
        
    Returns:
        List of insight strings, or None if generation failed or no transcript
    """
    try:
        logger.info(f"[Insights] Starting insight generation for video: {video_id}")
        
        # Connect to VideoDB (only pass base_url if explicitly set)
        connect_kwargs = {"api_key": api_key}
        if settings.VIDEODB_API_URL:
            connect_kwargs["base_url"] = settings.VIDEODB_API_URL
        conn = videodb.connect(**connect_kwargs)

        # Get the video
        coll = conn.get_collection()
        video = coll.get_video(video_id)

        if not video:
            logger.error(f"[Insights] Video not found: {video_id}")
            return None
        
        # Fetch transcript
        try:
            transcript_text = video.get_transcript_text()
        except Exception as e:
            logger.warning(f"[Insights] Failed to get transcript: {e}")
            transcript_text = None
        
        # Check if transcript exists
        if not transcript_text or len(transcript_text.strip()) == 0:
            logger.info(f"[Insights] No transcript available for video: {video_id}. Skipping insight generation.")
            return None
        
        # Construct prompt for rich markdown report
        prompt = f"""Analyze the following meeting transcript and generate a comprehensive meeting report in markdown format.

**Output Structure:**
## 📋 Meeting Summary
A brief 2-3 sentence executive summary of the meeting.

## 🎯 Key Discussion Points
- Bullet points of the main topics discussed

## 💡 Key Decisions
- Any decisions that were made during the meeting
---

Transcript:
{transcript_text}"""

        # Call text generation using SDK method
        logger.info(f"[Insights] Calling text generation via SDK for video: {video_id}")
        result = coll.generate_text(prompt=prompt, model_name="ultra")
        
        # SDK returns Union[str, dict]. Handle both cases.
        if isinstance(result, str):
            generated_text = result
        elif isinstance(result, dict):
            # SDK returns {'output': '...'} - check common keys
            generated_text = result.get("output") or result.get("text") or result.get("data", {}).get("text", "")
        else:
            generated_text = ""
        
        if not generated_text:
            logger.warning(f"[Insights] Empty response from text generation SDK")
            return None
        
        # Return raw markdown as a single-item list for backward compatibility
        # Frontend will handle rendering
        logger.info(f"[Insights] ✅ Generated markdown report for video: {video_id}")
        return [generated_text.strip()]
        
    except Exception as e:
        logger.exception(f"[Insights] Failed to generate insights for video {video_id}: {e}")
        return None
