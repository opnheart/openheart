"""
OpenHeart Keystroke Analyzer

Monitors keyboard input timing patterns to detect stress and flow states.
Privacy-first: Only timing data is processed, never key contents.
"""

import time
import logging
from typing import Callable, List, Optional
from threading import Event
from collections import deque
from dataclasses import dataclass


@dataclass
class KeyEvent:
    """Represents a single keystroke event (timing only, no content)."""
    timestamp: float  # Unix timestamp in seconds
    event_type: str   # "press" or "release"
    is_backspace: bool


class KeystrokeAnalyzer:
    """
    Analyzes keystroke timing patterns to detect stress levels.
    
    Digital Kinesics metrics:
    - Dwell Time: Duration of keypress
    - Flight Time: Time between key release and next key press
    - Edit Flux: Ratio of backspaces to total characters
    - Rhythmic Jitter: Variance in inter-key intervals
    
    Privacy: NO key codes or characters are stored.
    """
    
    def __init__(
        self,
        on_state_update: Callable[[float, str, float, str], None],
        logger: Optional[logging.Logger] = None,
        window_size: int = 50,          # Number of keystrokes to analyze
        update_interval: float = 1.0,   # Seconds between state updates
    ):
        self.on_state_update = on_state_update
        self.logger = logger or logging.getLogger(__name__)
        self.window_size = window_size
        self.update_interval = update_interval
        
        # Timing data (privacy-safe: only intervals, not key codes)
        self.intervals: deque = deque(maxlen=window_size)
        self.dwell_times: deque = deque(maxlen=window_size)
        self.backspace_count: int = 0
        self.total_keys: int = 0
        
        # State tracking
        self.last_key_time: Optional[float] = None
        self.last_press_time: Optional[float] = None
        self.last_update_time: float = 0
        
        # Flow state detection
        self.flow_start_time: Optional[float] = None
        self.flow_consistency_buffer: deque = deque(maxlen=60)  # 1 minute
    
    def _on_key_press(self, key):
        """Handle key press event. Extract timing only."""
        now = time.time()
        
        # Calculate flight time (time since last key release)
        if self.last_key_time is not None:
            interval = now - self.last_key_time
            if interval < 2.0:  # Ignore long pauses
                self.intervals.append(interval)
        
        # Track press time for dwell calculation
        self.last_press_time = now
        self.total_keys += 1
        
        # Check if backspace (privacy-safe check)
        try:
            from pynput import keyboard
            if key == keyboard.Key.backspace:
                self.backspace_count += 1
        except:
            pass
        
        # Periodic state update
        if now - self.last_update_time >= self.update_interval:
            self._update_state()
            self.last_update_time = now
    
    def _on_key_release(self, key):
        """Handle key release event. Calculate dwell time."""
        now = time.time()
        
        # Calculate dwell time
        if self.last_press_time is not None:
            dwell = now - self.last_press_time
            if dwell < 1.0:  # Reasonable dwell time
                self.dwell_times.append(dwell)
        
        self.last_key_time = now
    
    def _calculate_stress_heuristic(self) -> tuple[float, float]:
        """
        Calculate stress index using heuristic rules.
        
        Returns:
            (stress_index, confidence)
        """
        if len(self.intervals) < 5:
            return 0.0, 0.0  # Not enough data
        
        # 1. Typing speed component (faster = potentially more stressed)
        avg_interval = sum(self.intervals) / len(self.intervals)
        speed_stress = max(0, 1.0 - (avg_interval / 0.3))  # Normalize around 300ms
        
        # 2. Variance component (high variance = cognitive friction)
        if len(self.intervals) >= 3:
            mean = sum(self.intervals) / len(self.intervals)
            variance = sum((x - mean) ** 2 for x in self.intervals) / len(self.intervals)
            jitter_stress = min(1.0, variance / 0.05)  # Normalize around 50ms variance
        else:
            jitter_stress = 0.0
        
        # 3. Error rate component (more backspaces = frustration)
        if self.total_keys > 0:
            backspace_ratio = self.backspace_count / self.total_keys
            error_stress = min(1.0, backspace_ratio / 0.15)  # Normalize around 15%
        else:
            error_stress = 0.0
        
        # Weighted combination
        stress_index = (
            0.3 * speed_stress +
            0.4 * jitter_stress +
            0.3 * error_stress
        )
        
        # Confidence based on data quantity
        confidence = min(1.0, len(self.intervals) / self.window_size)
        
        return round(stress_index, 2), round(confidence, 2)
    
    def _detect_flow_state(self, stress_index: float) -> str:
        """
        Detect flow state based on stress consistency.
        
        Flow states:
        - DEEP_FLOW: Low stress, consistent rhythm for 5+ minutes
        - CALM: Low stress, short duration
        - NORMAL: Moderate stress
        - STRESSED: High stress
        """
        now = time.time()
        
        # Add to consistency buffer
        self.flow_consistency_buffer.append((now, stress_index))
        
        # Cleanup old entries
        cutoff = now - 300  # 5 minutes
        while self.flow_consistency_buffer and self.flow_consistency_buffer[0][0] < cutoff:
            self.flow_consistency_buffer.popleft()
        
        # Calculate average stress over window
        if len(self.flow_consistency_buffer) >= 5:
            recent_stress = [s for _, s in self.flow_consistency_buffer]
            avg_stress = sum(recent_stress) / len(recent_stress)
            stress_variance = sum((s - avg_stress) ** 2 for s in recent_stress) / len(recent_stress)
            
            # Detect deep flow
            if avg_stress < 0.3 and stress_variance < 0.02:
                duration = now - self.flow_consistency_buffer[0][0]
                if duration >= 300:  # 5 minutes
                    return "DEEP_FLOW"
                elif duration >= 60:  # 1 minute
                    return "CALM"
        
        # Simple thresholds
        if stress_index < 0.3:
            return "CALM"
        elif stress_index < 0.6:
            return "NORMAL"
        else:
            return "STRESSED"
    
    def _update_state(self):
        """Calculate current state and notify callback."""
        stress_index, confidence = self._calculate_stress_heuristic()
        flow_state = self._detect_flow_state(stress_index)
        
        self.logger.debug(
            f"State update: stress={stress_index}, flow={flow_state}, "
            f"confidence={confidence}, samples={len(self.intervals)}"
        )
        
        # Notify callback
        self.on_state_update(stress_index, flow_state, confidence, "keystroke")
    
    def start(self, shutdown_event: Event):
        """
        Start keyboard monitoring.
        
        Args:
            shutdown_event: Event to signal shutdown
        """
        try:
            from pynput import keyboard
            
            self.logger.info("Keystroke monitoring started")
            self.logger.info("Privacy mode: Only timing patterns are analyzed, no key contents")
            
            # Create listener
            listener = keyboard.Listener(
                on_press=self._on_key_press,
                on_release=self._on_key_release
            )
            
            listener.start()
            
            # Wait for shutdown signal
            while not shutdown_event.is_set():
                shutdown_event.wait(timeout=1.0)
            
            listener.stop()
            self.logger.info("Keystroke monitoring stopped")
            
        except ImportError:
            self.logger.error("pynput not installed. Run: pip install pynput")
            raise
        except Exception as e:
            self.logger.error(f"Failed to start keyboard listener: {e}")
            self.logger.error("On macOS, enable Accessibility permissions in System Preferences")
            raise
