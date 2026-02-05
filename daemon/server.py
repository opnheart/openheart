"""
OpenHeart Unix Socket Server

Provides real-time biometric state to the OpenClaw plugin via Unix domain socket.
Falls back to JSON file for compatibility.
"""

import os
import json
import socket
import time
import logging
from pathlib import Path
from threading import Lock
from typing import Callable, Optional


class BiometricServer:
    """
    Unix socket server that exposes current biometric state.
    
    Features:
    - <1ms latency for state reads
    - Automatic file fallback
    - Thread-safe state updates
    """
    
    def __init__(
        self,
        socket_path: Path,
        state_file: Path,
        logger: Optional[logging.Logger] = None
    ):
        self.socket_path = socket_path
        self.state_file = state_file
        self.logger = logger or logging.getLogger(__name__)
        self._lock = Lock()
        
        # Current state
        self._state = {
            "stress_index": 0.0,
            "flow_state": "UNKNOWN",
            "timestamp": int(time.time() * 1000),
            "ttl_seconds": 30,
            "daemon_pid": os.getpid(),
            "confidence": 0.0,
            "source": "initialization"
        }
        
        # Write initial state to file
        self._write_state_file()
    
    def update_state(
        self,
        stress_index: float,
        flow_state: str,
        confidence: float = 1.0,
        source: str = "keystroke"
    ):
        """
        Update the current biometric state (thread-safe).
        
        Args:
            stress_index: Normalized stress level [0.0, 1.0]
            flow_state: One of CALM, NORMAL, STRESSED, DEEP_FLOW, UNKNOWN
            confidence: Confidence in this reading [0.0, 1.0]
            source: Source of this reading (keystroke, mouse, calendar)
        """
        with self._lock:
            self._state = {
                "stress_index": round(max(0.0, min(1.0, stress_index)), 2),
                "flow_state": flow_state,
                "timestamp": int(time.time() * 1000),
                "ttl_seconds": 30,
                "daemon_pid": os.getpid(),
                "confidence": round(confidence, 2),
                "source": source
            }
            
            # Also write to file as fallback
            self._write_state_file()
    
    def _write_state_file(self):
        """Write current state to JSON file (fallback for socket failures)."""
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.state_file, "w") as f:
                json.dump(self._state, f, indent=2)
        except Exception as e:
            self.logger.error(f"Failed to write state file: {e}")
    
    def _get_state_json(self) -> bytes:
        """Get current state as JSON bytes (thread-safe)."""
        with self._lock:
            return json.dumps(self._state).encode("utf-8")
    
    def start(self):
        """
        Start the Unix socket server.
        
        This method blocks and should be run in a separate thread.
        """
        # Remove stale socket file
        if self.socket_path.exists():
            self.socket_path.unlink()
        
        # Create socket directory
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Create Unix socket
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
            server.bind(str(self.socket_path))
            server.listen(5)
            server.settimeout(1.0)  # Allow periodic checks for shutdown
            
            self.logger.info(f"Socket server listening on {self.socket_path}")
            
            while True:
                try:
                    conn, _ = server.accept()
                    try:
                        # Send current state
                        data = self._get_state_json()
                        conn.sendall(data)
                    finally:
                        conn.close()
                except socket.timeout:
                    # Normal timeout, continue loop
                    continue
                except Exception as e:
                    self.logger.error(f"Socket error: {e}")
                    
        finally:
            server.close()
            if self.socket_path.exists():
                self.socket_path.unlink()
            self.logger.info("Socket server stopped")
