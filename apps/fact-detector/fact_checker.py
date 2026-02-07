import json
import logging

from google import genai

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a real-time fact-checking assistant. Your job is to identify "
    "factual claims, statistics, numbers, or verifiable assertions in a "
    "transcript excerpt, and classify each as TRUE, FALSE, or UNCERTAIN."
)

EXTRACTION_PROMPT = """Analyze the following transcript excerpt from a live audio stream.

Instructions:
1. Identify all factual claims, statistics, numbers, or verifiable assertions.
2. For each claim, determine its accuracy: TRUE, FALSE, or UNCERTAIN.
3. For FALSE claims, provide a brief correction.
4. For UNCERTAIN claims, explain why verification is difficult.
5. Ignore opinions, greetings, filler words, and non-factual statements.

Respond ONLY with a valid JSON array. Each element must have these fields:
- "claim": the exact or paraphrased claim from the transcript
- "verdict": one of "TRUE", "FALSE", or "UNCERTAIN"
- "explanation": a brief explanation or correction (1-2 sentences)

If there are no factual claims, return an empty array: []

Transcript:
---
{transcript}
---"""


class FactChecker:
    """Sends transcript chunks to Gemini for claim extraction and verification."""

    def __init__(self, api_key, model_name="gemini-2.0-flash"):
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name
        logger.info("FactChecker initialized with model: %s", model_name)

    def check(self, transcript_text):
        """Extract and verify factual claims from transcript text.

        Args:
            transcript_text: Raw transcript string to analyze.

        Returns:
            List of dicts, each with keys: claim, verdict, explanation.
            Returns an empty list if no claims found or on error.
        """
        text = transcript_text.strip()
        if not text:
            return []

        prompt = EXTRACTION_PROMPT.format(transcript=text)

        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config={
                    "system_instruction": SYSTEM_PROMPT,
                },
            )
            return self._parse_response(response.text)
        except Exception as e:
            logger.error("Gemini API error: %s", e)
            return []

    def _parse_response(self, raw_text):
        """Parse the JSON array from Gemini's response."""
        cleaned = raw_text.strip()

        # Strip markdown code fences if Gemini wraps the JSON
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        try:
            claims = json.loads(cleaned)
            if not isinstance(claims, list):
                logger.warning("Gemini returned non-list JSON: %s", type(claims))
                return []

            validated = []
            for item in claims:
                if not isinstance(item, dict):
                    continue
                if "claim" not in item or "verdict" not in item:
                    continue
                if item["verdict"] not in ("TRUE", "FALSE", "UNCERTAIN"):
                    continue
                validated.append({
                    "claim": item["claim"],
                    "verdict": item["verdict"],
                    "explanation": item.get("explanation", ""),
                })
            return validated

        except json.JSONDecodeError:
            logger.warning("Failed to parse Gemini response as JSON")
            logger.debug("Raw response: %s", raw_text[:500])
            return []
