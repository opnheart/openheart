#!/usr/bin/env python3
"""
OpenHeart Daemon - Main Entry Point

This daemon monitors keystroke patterns to detect user stress/focus states
and exposes this information via a Unix socket for the OpenClaw plugin.

Usage:
    python daemon/main.py [--dev]
"""

import os
import sys
import signal
import argparse
import logging
from pathlib import Path
from threading import Thread, Event

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from server import BiometricServer
from keystroke import KeystrokeAnalyzer

# Configuration
OPENHEART_DIR = Path.home() / ".openheart"
PID_FILE = OPENHEART_DIR / "daemon.pid"
LOG_FILE = OPENHEART_DIR / "openheart.log"
STATE_FILE = OPENHEART_DIR / "state.json"
SOCKET_PATH = OPENHEART_DIR / "state.sock"

# Global shutdown event
shutdown_event = Event()


def setup_logging(dev_mode: bool = False) -> logging.Logger:
    """Configure logging for the daemon."""
    OPENHEART_DIR.mkdir(parents=True, exist_ok=True)
    
    level = logging.DEBUG if dev_mode else logging.INFO
    
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler() if dev_mode else logging.NullHandler()
        ]
    )
    
    return logging.getLogger("openheart")


def write_pid_file():
    """Write current process ID to file."""
    PID_FILE.write_text(str(os.getpid()))


def cleanup_pid_file():
    """Remove PID file on shutdown."""
    if PID_FILE.exists():
        PID_FILE.unlink()


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    logger = logging.getLogger("openheart")
    logger.info(f"Received signal {signum}, shutting down...")
    shutdown_event.set()


def main():
    parser = argparse.ArgumentParser(description="OpenHeart Biometric Daemon")
    parser.add_argument("--dev", action="store_true", help="Enable development mode (verbose logging)")
    args = parser.parse_args()
    
    # Setup
    logger = setup_logging(args.dev)
    logger.info("=" * 50)
    logger.info("OpenHeart Daemon starting...")
    logger.info(f"PID: {os.getpid()}")
    logger.info(f"Socket: {SOCKET_PATH}")
    logger.info(f"State file: {STATE_FILE}")
    logger.info("=" * 50)
    
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    # Write PID file
    write_pid_file()
    
    try:
        # Initialize components
        server = BiometricServer(
            socket_path=SOCKET_PATH,
            state_file=STATE_FILE,
            logger=logger
        )
        
        analyzer = KeystrokeAnalyzer(
            on_state_update=server.update_state,
            logger=logger
        )
        
        # Start server in background thread
        server_thread = Thread(target=server.start, daemon=True)
        server_thread.start()
        logger.info("Socket server started")
        
        # Start keystroke monitoring (blocks until shutdown)
        logger.info("Starting keystroke monitoring...")
        logger.info("Press Ctrl+C to stop")
        
        analyzer.start(shutdown_event)
        
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        raise
    finally:
        cleanup_pid_file()
        logger.info("Daemon stopped")


if __name__ == "__main__":
    main()
