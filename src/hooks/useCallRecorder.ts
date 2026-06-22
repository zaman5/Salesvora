import { useState, useRef, useCallback, useEffect } from "react";

export type RecorderStatus = "inactive" | "recording" | "paused" | "stopped";

interface UseCallRecorderResult {
  status: RecorderStatus;
  isRecording: boolean;
  recordingTime: number; // seconds
  audioUrl: string | null; // object URL for playback
  audioDataUrl: string | null; // base64 data URL for persistence
  audioBlob: Blob | null;
  error: string | null;
  startRecording: (getRemoteStream?: () => MediaStream | null) => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<{ dataUrl: string; blob: Blob; duration: number } | null>;
  resetRecording: () => void;
  setMicMuted: (muted: boolean) => void;
}

/**
 * Browser microphone call recorder built on the MediaRecorder API.
 * - start / pause / resume / stop
 * - live elapsed-time counter
 * - produces both an object URL (instant playback) and a base64
 *   data URL (safe to persist via tRPC -> db)
 */
export function useCallRecorder(): UseCallRecorderResult {
  const [status, setStatus] = useState<RecorderStatus>("inactive");
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const remotePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const stopResolverRef = useRef<((v: { dataUrl: string; blob: Blob; duration: number } | null) => void) | null>(null);
  const timeRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    clearTimer();
    timerRef.current = setInterval(() => {
      timeRef.current += 1;
      setRecordingTime(timeRef.current);
    }, 1000);
  };

  const releaseStream = () => {
    if (remotePollRef.current) {
      clearInterval(remotePollRef.current);
      remotePollRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        /* noop */
      }
      audioCtxRef.current = null;
    }
  };

  const pickMimeType = (): string => {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  };

  const startRecording = useCallback(async (getRemoteStream?: () => MediaStream | null) => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Recording is not supported in this browser.");
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      return; // already recording
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      // Record through a Web Audio mixer so we can blend the agent's mic with
      // the client's call audio into ONE recording (both sides of the call).
      let recordStream: MediaStream = stream;
      if (getRemoteStream) {
        try {
          const Ctx: typeof AudioContext =
            window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          if (ctx.state === "suspended") await ctx.resume();
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(stream).connect(dest); // agent mic
          recordStream = dest.stream;

          // The client's audio stream may attach a moment after the call
          // connects, so keep trying to add it until it's available.
          let remoteAttached = false;
          const attachRemote = () => {
            if (remoteAttached || !audioCtxRef.current) return;
            const rs = getRemoteStream();
            if (rs && rs.getAudioTracks().length > 0) {
              try {
                audioCtxRef.current.createMediaStreamSource(rs).connect(dest); // client audio
                remoteAttached = true;
                if (remotePollRef.current) {
                  clearInterval(remotePollRef.current);
                  remotePollRef.current = null;
                }
              } catch {
                /* will retry */
              }
            }
          };
          attachRemote();
          if (!remoteAttached) {
            remotePollRef.current = setInterval(attachRemote, 400);
            // give up trying after ~12s
            setTimeout(() => {
              if (remotePollRef.current) {
                clearInterval(remotePollRef.current);
                remotePollRef.current = null;
              }
            }, 12000);
          }
        } catch {
          recordStream = stream; // mixing unavailable -> mic only
        }
      }

      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onerror = () => {
        setError("Recording failed unexpectedly.");
        setStatus("inactive");
        clearTimer();
        releaseStream();
      };

      recorder.onstop = () => {
        clearTimer();
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const finalDuration = timeRef.current;

        // Revoke any previous object URL
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        setAudioBlob(blob);
        setAudioUrl(url);
        setStatus("stopped");
        releaseStream();

        // Convert to base64 data URL for persistence
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          setAudioDataUrl(dataUrl);
          if (stopResolverRef.current) {
            stopResolverRef.current(dataUrl ? { dataUrl, blob, duration: finalDuration } : null);
            stopResolverRef.current = null;
          }
        };
        reader.onerror = () => {
          if (stopResolverRef.current) {
            stopResolverRef.current(null);
            stopResolverRef.current = null;
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(1000); // collect data every second
      timeRef.current = 0;
      setRecordingTime(0);
      setStatus("recording");
      startTimer();
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
        setError("Microphone permission denied. Please allow microphone access to record calls.");
      } else if (e?.name === "NotFoundError") {
        setError("No microphone found on this device.");
      } else {
        setError("Could not start recording: " + (e?.message || "unknown error"));
      }
      setStatus("inactive");
      releaseStream();
    }
  }, []);

  const pauseRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === "recording") {
      rec.pause();
      clearTimer();
      setStatus("paused");
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === "paused") {
      rec.resume();
      startTimer();
      setStatus("recording");
    }
  }, []);

  /**
   * Stops recording and resolves with { dataUrl, blob, duration } once the
   * audio has been finalized — safe to await before saving to the backend.
   */
  const stopRecording = useCallback((): Promise<{ dataUrl: string; blob: Blob; duration: number } | null> => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      stopResolverRef.current = resolve;
      try {
        rec.stop();
      } catch {
        stopResolverRef.current = null;
        resolve(null);
      }
    });
  }, []);

  const resetRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
    clearTimer();
    releaseStream();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    chunksRef.current = [];
    timeRef.current = 0;
    mediaRecorderRef.current = null;
    setStatus("inactive");
    setRecordingTime(0);
    setAudioUrl(null);
    setAudioDataUrl(null);
    setAudioBlob(null);
    setError(null);
  }, []);

  /** Mute/unmute the microphone track without stopping the recording. */
  const setMicMuted = useCallback((muted: boolean) => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => (t.enabled = !muted));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      releaseStream();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return {
    status,
    isRecording: status === "recording" || status === "paused",
    recordingTime,
    audioUrl,
    audioDataUrl,
    audioBlob,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
    setMicMuted,
  };
}
