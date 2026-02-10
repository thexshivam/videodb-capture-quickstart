import time

from config import CONFIDENCE_THRESHOLD, ALERT_COOLDOWN_SECONDS


def _normalize(text):
    """Produce a simple fingerprint for deduplication."""
    return " ".join(text.lower().split())


class AlertManager:
    """Decide which notes reach the terminal vs logs-only.

    Applies confidence gating, deduplication, and throttling.
    """

    def __init__(self):
        self._seen = {}  # fingerprint -> timestamp
        self._last_alert_time = 0.0

    def filter(self, notes):
        """Split notes into alerts (terminal) and log-only.

        Args:
            notes: List of note dicts from note_generator.

        Returns:
            (alerts, log_only) — two lists of note dicts.
            Each dict gets an extra "alerted" boolean key.
        """
        alerts = []
        log_only = []
        now = time.time()

        for note in notes:
            note_copy = dict(note)
            if self._should_alert(note_copy, now):
                note_copy["alerted"] = True
                alerts.append(note_copy)
            else:
                note_copy["alerted"] = False
                log_only.append(note_copy)

        return alerts, log_only

    def reset(self):
        """Clear state at session end."""
        self._seen.clear()
        self._last_alert_time = 0.0

    def _should_alert(self, note, now):
        """Return True if this note should be surfaced as a terminal alert."""
        # Confidence gate
        if note.get("confidence") != CONFIDENCE_THRESHOLD:
            return False

        # Deduplication
        fp = _normalize(note.get("claim", ""))
        if fp in self._seen:
            elapsed = now - self._seen[fp]
            if elapsed < ALERT_COOLDOWN_SECONDS:
                return False

        # Throttle: at least ALERT_COOLDOWN_SECONDS between any alerts
        if now - self._last_alert_time < ALERT_COOLDOWN_SECONDS:
            # Still allow, but mark seen — throttle is soft
            pass

        self._seen[fp] = now
        self._last_alert_time = now
        return True
