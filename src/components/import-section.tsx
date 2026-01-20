"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ImportError = { row: number; message: string };
type ImportResult = { created: number; skipped: number; errors: ImportError[] };

type TemplateLink = {
  href: string;
  label: string;
};

type ImportSectionProps = {
  title: string;
  description: string;
  templateLinks: TemplateLink[];
  importUrl: string;
  importLabel: string;
};

export function ImportSection({
  title,
  description,
  templateLinks,
  importUrl,
  importLabel,
}: ImportSectionProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErrorMessage("Choose a CSV or XLSX file to import.");
      setResult(null);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(importUrl, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as ImportResult & { error?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Import failed.");
        return;
      }

      setResult({
        created: data.created ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? [],
      });

      if ((data.created ?? 0) > 0) {
        router.refresh();
      }
    } catch (error) {
      setErrorMessage((error as Error).message ?? "Import failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {templateLinks.map((link) => (
            <Button key={link.href} asChild variant="outline">
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          <Label htmlFor={`${importLabel}-file`}>Import file</Label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              ref={fileRef}
              id={`${importLabel}-file`}
              type="file"
              accept=".csv,.xlsx"
            />
            <Button type="button" onClick={handleImport} disabled={isSubmitting}>
              {isSubmitting ? "Importing..." : `Import ${importLabel}`}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Accepted formats: CSV or XLSX. First row must contain headers.
          </p>
        </div>
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        {result ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>
                <span className="font-medium">Created:</span> {result.created}
              </span>
              <span>
                <span className="font-medium">Skipped:</span> {result.skipped}
              </span>
              <span>
                <span className="font-medium">Errors:</span> {result.errors.length}
              </span>
            </div>
            {result.errors.length > 0 ? (
              <div className="space-y-2">
                <p className="font-medium text-foreground">Error rows</p>
                <ul className="space-y-1 text-muted-foreground">
                  {result.errors.map((error, index) => (
                    <li key={`${error.row}-${index}`}>
                      Row {error.row}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
