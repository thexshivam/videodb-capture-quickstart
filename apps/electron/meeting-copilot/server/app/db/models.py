from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime
from app.db.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    api_key = Column(String) # The secure VideoDB API Key
    access_token = Column(String, unique=True, index=True) # The secure UUID token

class Recording(Base):
    __tablename__ = "recordings"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(String)
    stream_url = Column(String)
    player_url = Column(String)
    session_id = Column(String, index=True) # For cross-referencing and webhook matching
    duration = Column(Integer)
    created_at = Column(DateTime, default=datetime.now)  # Local time for grouping
    status = Column(String, default="recording")  # recording, processing, available
    # Insight fields
    insights = Column(Text, nullable=True)  # JSON string of insight bullets
    insights_status = Column(String, default="pending")  # pending, processing, ready, failed


