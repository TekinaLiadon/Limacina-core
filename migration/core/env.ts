export function getDatabaseUrl(): string {
  const url = Bun.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .env or export it in your shell.");
  }
  return url;
}
