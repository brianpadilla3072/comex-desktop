/** @jsxImportSource react */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { t } from "@/i18n";

/**
 * In-app replacement for `window.confirm`. The native dialog blocks the renderer (and every CDP
 * client driving it), ignores the app's design and language, and cannot be dismissed by tests.
 *   if (!(await confirmDialog({ title: "...", destructive: true }))) return;
 * Rendered by <ConfirmDialogHost />, mounted once in the app providers.
 */
export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (confirmed: boolean) => void };
const queue: Pending[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    queue.push({ ...options, resolve });
    notify();
    // No host mounted (tests, isolated renders): answer "no" instead of hanging the caller.
    if (!listeners.size) settle(false);
  });
}

function settle(confirmed: boolean) {
  const current = queue.shift();
  current?.resolve(confirmed);
  notify();
}

export function ConfirmDialogHost() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion(version => version + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  const current = queue[0];
  return <AlertDialog open={Boolean(current)} onOpenChange={open => { if (!open && current) settle(false); }}>
    {current ? <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{current.title}</AlertDialogTitle>
        {current.description ? <AlertDialogDescription>{current.description}</AlertDialogDescription> : null}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => settle(false)}>{current.cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction variant={current.destructive ? "destructive" : "default"} onClick={() => settle(true)}>{current.confirmLabel ?? t("common.confirm")}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent> : null}
  </AlertDialog>;
}
