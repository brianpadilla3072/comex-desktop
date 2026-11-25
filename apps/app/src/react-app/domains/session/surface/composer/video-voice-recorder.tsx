/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";

const MAX_SECONDS = 30;
const MIN_SECONDS = 3;

type RecorderStatus = "idle" | "recording" | "ready" | "saving";

type VideoVoiceRecorderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upload: ((file: File, path: string) => Promise<void>) | null;
  onSaved: (path: string) => void;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voz";
}

export function VideoVoiceRecorder({ open, onOpenChange, upload, onSaved }: VideoVoiceRecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [name, setName] = useState("voz");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const reset = () => {
    clearTimer();
    stopStream();
    recorderRef.current = null;
    chunksRef.current = [];
    setStatus("idle");
    setSeconds(0);
    setBlob(null);
    setError(null);
    setConsent(false);
  };

  useEffect(() => {
    if (!audioUrl) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  useEffect(() => {
    if (open) return;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    reset();
  }, [open]);

  useEffect(() => () => {
    clearTimer();
    stopStream();
  }, []);

  const start = async () => {
    setError(null);
    setBlob(null);
    setSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const next = new Blob(chunksRef.current, { type: mimeType });
        setBlob(next);
        setStatus("ready");
        clearTimer();
        stopStream();
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setStatus("recording");
      timerRef.current = window.setInterval(() => {
        setSeconds((value) => {
          const next = value + 1;
          if (next >= MAX_SECONDS) {
            if (recorderRef.current?.state === "recording") recorderRef.current.stop();
            return MAX_SECONDS;
          }
          return next;
        });
      }, 1000);
    } catch {
      setError(t("composer.video_recorder_mic_error"));
      setStatus("idle");
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const save = async () => {
    if (!upload || !blob) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("composer.video_recorder_name_required"));
      return;
    }
    if (!consent) {
      setError(t("composer.video_recorder_consent_required"));
      return;
    }
    if (seconds < MIN_SECONDS) {
      setError(t("composer.video_recorder_too_short", { min: MIN_SECONDS }));
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const slug = slugify(trimmed);
      const path = `voices/${slug}/referencia.webm`;
      await upload(new File([blob], "referencia.webm", { type: blob.type || "audio/webm" }), path);
      const consentText = [
        "# Consentimiento de voz",
        "",
        `Nombre: ${trimmed}`,
        `Fecha: ${new Date().toISOString().slice(0, 10)}`,
        "",
        "Autorizo a clonar mi voz a partir de la grabación `referencia.webm` y a usarla",
        "para narraciones de video en este espacio de trabajo. Entiendo que la voz",
        "sintética puede sonar como yo y que no se usará para engañar ni suplantar",
        "identidad. Puedo revocar este consentimiento por escrito.",
        "",
      ].join("\n");
      await upload(
        new File([consentText], "consentimiento.md", { type: "text/markdown" }),
        `voices/${slug}/consentimiento.md`,
      );
      toast.success(t("composer.video_recorder_saved"));
      onSaved(path);
      onOpenChange(false);
    } catch (cause) {
      setStatus("ready");
      setError(cause instanceof Error ? cause.message : t("composer.video_recorder_save_error"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && recorderRef.current?.state === "recording") stop();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("composer.video_recorder_title")}</DialogTitle>
          <DialogDescription>{t("composer.video_recorder_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {status === "recording" ? (
              <Button type="button" variant="outline" onClick={stop}>
                <Square className="size-4" />
                {t("composer.video_recorder_stop")}
              </Button>
            ) : status === "ready" ? (
              <Button type="button" variant="outline" onClick={() => void start()}>
                <Mic className="size-4" />
                {t("composer.video_recorder_again")}
              </Button>
            ) : (
              <Button type="button" onClick={() => void start()} disabled={status === "saving"}>
                <Mic className="size-4" />
                {t("composer.video_recorder_start")}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">{seconds}s / {MAX_SECONDS}s</span>
          </div>
          {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : null}
          <Field>
            <FieldLabel htmlFor="video-voice-name">{t("composer.video_recorder_name")}</FieldLabel>
            <Input
              id="video-voice-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="erik"
              disabled={status === "saving"}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="video-voice-consent"
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
              disabled={status === "saving"}
            />
            <FieldLabel htmlFor="video-voice-consent">{t("composer.video_recorder_consent")}</FieldLabel>
          </Field>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={status === "saving"}>
            {t("composer.video_recorder_cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!upload || !blob || !consent || status === "saving"}
          >
            {status === "saving" ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("composer.video_recorder_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
