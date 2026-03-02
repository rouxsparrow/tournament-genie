"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createRefereeAccount,
  resetRefereePassword,
  revokeAllRefereeSessionsAction,
  revokeRefereeAccountSessions,
  setRefereeActive,
} from "@/app/referees/actions";

type RefereeAccountItem = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  lastLoginLabel: string;
  activeSessionCount: number;
};

export function RefereesClient({
  initialAccounts,
}: {
  initialAccounts: RefereeAccountItem[];
}) {
  const router = useRouter();
  const accounts = initialAccounts;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordByAccount, setPasswordByAccount] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalActiveSessions = useMemo(
    () => accounts.reduce((sum, account) => sum + account.activeSessionCount, 0),
    [accounts]
  );

  const runAction = (action: () => Promise<{ error?: string } | null | undefined>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setMessage(result.error);
        return;
      }
      router.refresh();
    });
  };

  const submitCreate = () => {
    runAction(async () => {
      const result = await createRefereeAccount({ username, displayName, password });
      if (!result || "error" in result) {
        return result;
      }

      setUsername("");
      setDisplayName("");
      setPassword("");
      setMessage("Referee account created.");
      return null;
    });
  };

  const submitResetPassword = (accountId: string) => {
    const nextPassword = passwordByAccount[accountId] ?? "";
    runAction(async () => {
      const result = await resetRefereePassword({
        refereeAccountId: accountId,
        newPassword: nextPassword,
      });
      if (!result || "error" in result) {
        return result;
      }

      setPasswordByAccount((prev) => ({ ...prev, [accountId]: "" }));
      setMessage(`Password reset. Revoked sessions: ${result.revokedSessions}.`);
      return null;
    });
  };

  const submitToggleActive = (accountId: string, nextIsActive: boolean) => {
    runAction(async () => {
      const result = await setRefereeActive({
        refereeAccountId: accountId,
        isActive: nextIsActive,
      });
      if (!result || "error" in result) {
        return result;
      }

      setMessage(
        nextIsActive
          ? "Account activated."
          : `Account deactivated. Revoked sessions: ${result.revokedSessions}.`
      );
      return null;
    });
  };

  const submitRevokeSessions = (accountId: string) => {
    runAction(async () => {
      const result = await revokeRefereeAccountSessions(accountId);
      if (!result || "error" in result) {
        return result;
      }
      setMessage(`Revoked sessions: ${result.revokedSessions}.`);
      return null;
    });
  };

  const submitRevokeAll = () => {
    runAction(async () => {
      const result = await revokeAllRefereeSessionsAction();
      if (!result || "error" in result) {
        return result;
      }
      setMessage(`Revoked all referee sessions: ${result.revokedSessions}.`);
      return null;
    });
  };

  return (
    <div className="mt-6 space-y-6">
      {message ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-foreground">
          {message}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <h2 className="text-sm font-semibold text-foreground">Create Referee Account</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="ref_p5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Display Name</label>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Referee P5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Initial Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="At least 10 characters"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Password minimum: 10 characters.</p>
          <Button type="button" onClick={submitCreate} disabled={pending}>
            Create account
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Active sessions: <span className="font-semibold text-foreground">{totalActiveSessions}</span>
        </div>
        <Button type="button" variant="outline" onClick={submitRevokeAll} disabled={pending}>
          Revoke all sessions
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Display</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Password Reset</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No referee accounts yet.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium text-foreground">{account.username}</TableCell>
                  <TableCell>{account.displayName}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        account.isActive
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-red-600 bg-red-600 text-white"
                      }
                    >
                      {account.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {account.lastLoginLabel}
                  </TableCell>
                  <TableCell>{account.activeSessionCount}</TableCell>
                  <TableCell>
                    <div className="flex min-w-52 items-center gap-2">
                      <input
                        type="password"
                        value={passwordByAccount[account.id] ?? ""}
                        onChange={(event) =>
                          setPasswordByAccount((prev) => ({ ...prev, [account.id]: event.target.value }))
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        placeholder="New password"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => submitResetPassword(account.id)}
                        disabled={pending}
                      >
                        Reset
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => submitRevokeSessions(account.id)}
                        disabled={pending}
                      >
                        Revoke sessions
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={account.isActive ? "destructive" : "default"}
                        onClick={() => submitToggleActive(account.id, !account.isActive)}
                        disabled={pending}
                      >
                        {account.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
