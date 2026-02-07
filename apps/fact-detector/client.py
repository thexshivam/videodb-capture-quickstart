import asyncio
import logging
import requests
import signal
import sys

from videodb.capture import CaptureClient

BACKEND_URL = "http://localhost:5002"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fact-detector-client")


async def init_session():
    """Request the backend to create a capture session."""
    try:
        print(f"[INIT] Connecting to backend at {BACKEND_URL}...")
        resp = requests.post(f"{BACKEND_URL}/init-session", json={}, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.ConnectionError:
        print(f"[ERROR] Cannot connect to backend at {BACKEND_URL}")
        print("  Make sure the backend is running: python backend.py")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Failed to init session: {e}")
        sys.exit(1)


async def run_capture(token, session_id):
    """Run the CaptureClient to stream system audio for fact-checking."""
    print("\n[CAPTURE] Starting Capture Client...")

    client = CaptureClient(client_token=token)

    stop_event = asyncio.Event()
    cleanup_done = asyncio.Event()

    def handle_signal():
        print("\n[SIGNAL] Received stop signal, initiating shutdown...")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal)
        except NotImplementedError:
            pass

    try:
        # Request OS permissions
        print("[CAPTURE] Requesting permissions...")
        await client.request_permission("microphone")
        await client.request_permission("screen_capture")

        # Discover available channels
        print("[CAPTURE] Discovering channels...")
        channels = await client.list_channels()

        mic = channels.mics.default
        display = channels.displays.default
        system_audio = channels.system_audio.default

        selected_channels = [c for c in [mic, display, system_audio] if c]
        if not selected_channels:
            print("[ERROR] No capture channels found.")
            return

        print(f"[CAPTURE] Starting with {len(selected_channels)} channel(s):")
        for ch in selected_channels:
            print(f"  - {ch.type}: {ch.id}")

        # Start capture
        await client.start_capture_session(
            capture_session_id=session_id,
            channels=selected_channels,
            primary_video_channel_id=display.id if display else None,
        )

        print("[CAPTURE] Recording... Press Ctrl+C to stop.\n")

        # Wait for stop signal
        await stop_event.wait()

    except asyncio.CancelledError:
        print("\n[CAPTURE] Cancelled.")
    except KeyboardInterrupt:
        print("\n[CAPTURE] Stopped by user.")
    except Exception as e:
        print(f"[ERROR] Capture error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if client:
            print("\n[CLEANUP] Stopping capture...")
            binary_already_exited = False

            try:
                print("  Sending stop signal to server...")
                await asyncio.wait_for(client.stop_capture(), timeout=5.0)
                print("  Stop signal sent.")
                print("  Waiting for server to finalize...")
                await asyncio.sleep(3)
                print("  Capture stopped.")
            except asyncio.TimeoutError:
                print("  Stop timed out (binary may have already exited).")
                binary_already_exited = True
                await asyncio.sleep(3)
            except Exception as e:
                print(f"  Error during stop: {e}")
                await asyncio.sleep(3)
            finally:
                if binary_already_exited:
                    print("  Skipping shutdown (binary already terminated).")
                else:
                    try:
                        print("  Shutting down client...")
                        await asyncio.wait_for(client.shutdown(), timeout=3.0)
                        print("  Client shutdown complete.")
                    except asyncio.TimeoutError:
                        print("  Shutdown timed out.")
                    except Exception as e:
                        print(f"  Shutdown error: {e}")

        cleanup_done.set()
        print("\n[DONE] Cleanup complete.")


async def main():
    print("=" * 60)
    print("  FACT DETECTOR - Capture Client")
    print("=" * 60)

    session_data = await init_session()
    token = session_data["token"]
    session_id = session_data["session_id"]

    print("[INIT] Session created.")
    print(f"  Token: {token[:10]}...")
    print(f"  Session ID: {session_id}\n")

    try:
        await run_capture(token, session_id)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[WARN] Force quit. Session may be left orphaned.")
        sys.exit(1)
