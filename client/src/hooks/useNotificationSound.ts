/**
 * @module useNotificationSound
 * Plays browser-side audible notifications when ticket status changes.
 * Uses the Web Audio API to synthesize short tones — no external sound files needed.
 *
 * Tone patterns by AlertTone:
 * - positive (→ done): ascending two-note chime (C5 → E5)
 * - alert (→ review): two short pips at A4
 * - negative (regression): descending two-note (E4 → C4)
 * - neutral (other): single short pip at C5
 *
 * Requires user interaction to have occurred before the AudioContext will play
 * (browser autoplay policy). The first real status-change event typically happens
 * well after the user has clicked something.
 *
 * Respects the server's `audibleAlerts` config — only plays when enabled.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { AlertTone, ServerMessage } from '../types';

/** Minimum interval (ms) between notifications to avoid rapid-fire sounds. */
const DEBOUNCE_MS = 400;

/**
 * Play a synthesized tone pattern for the given alert type.
 * Uses Web Audio API oscillators — lightweight and dependency-free.
 */
export function playTone(ctx: AudioContext, tone: AlertTone): void {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  // Shared volume: gentle notification level
  const volume = 0.15;

  switch (tone) {
    case 'positive': {
      // Ascending two-note chime: C5 (523 Hz) → E5 (659 Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 523.25; // C5
      osc1.connect(gain);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 659.25; // E5
      osc2.connect(gain);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.setValueAtTime(volume, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.start(now);
      osc1.stop(now + 0.12);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.35);
      break;
    }

    case 'alert': {
      // Two short pips at A4 (440 Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 440;
      osc1.connect(gain);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 440;
      osc2.connect(gain);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.setValueAtTime(0.001, now + 0.08);
      gain.gain.setValueAtTime(volume, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc1.start(now);
      osc1.stop(now + 0.08);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.25);
      break;
    }

    case 'negative': {
      // Descending two-note: E4 (330 Hz) → C4 (262 Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 329.63; // E4
      osc1.connect(gain);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 261.63; // C4
      osc2.connect(gain);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.setValueAtTime(volume, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.start(now);
      osc1.stop(now + 0.12);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.35);
      break;
    }

    case 'neutral':
    default: {
      // Single short pip at C5
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 523.25; // C5
      osc.connect(gain);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.start(now);
      osc.stop(now + 0.15);
      break;
    }
  }
}

/**
 * Hook that listens for `issue:statusChanged` WebSocket messages and plays
 * an audible notification tone in the browser.
 *
 * @param subscribe - WebSocket subscribe function from useWebSocket
 * @param enabled - Whether audible alerts are enabled (from server config)
 */
export function useNotificationSound(
  subscribe: (handler: (msg: ServerMessage) => void) => () => void,
  enabled: boolean,
): void {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastPlayedRef = useRef<number>(0);

  // Lazily create AudioContext on first use
  const getAudioContext = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) {
      // Resume if suspended (browser autoplay policy)
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return audioCtxRef.current;
    }
    try {
      audioCtxRef.current = new AudioContext();
      return audioCtxRef.current;
    } catch {
      // Web Audio API not supported
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const unsub = subscribe((msg) => {
      if (msg.type !== 'issue:statusChanged') return;

      // Debounce rapid-fire notifications
      const now = Date.now();
      if (now - lastPlayedRef.current < DEBOUNCE_MS) return;
      lastPlayedRef.current = now;

      const ctx = getAudioContext();
      if (!ctx) return;

      playTone(ctx, msg.alertTone);
    });

    return unsub;
  }, [subscribe, enabled, getAudioContext]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, []);
}
