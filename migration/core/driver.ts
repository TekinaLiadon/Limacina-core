export interface MigrationDriver {
  install(): Promise<void>;
  listExecuted(): Promise<string[]>;
  record(migration: string): Promise<void>;
  remove(migration: string): Promise<void>;
  close(): Promise<void>;
}

export async function createDriver(databaseUrl: string): Promise<MigrationDriver> {
  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol.replace(":", "");
  } catch {
    if (databaseUrl.startsWith("sqlite:")) {
      protocol = "sqlite";
    } else {
      throw new Error(`Cannot parse database URL: ${databaseUrl}`);
    }
  }
  switch (protocol) {
    case "postgres":
    case "postgresql": {
      const mod = await import("./../drivers/postgres.js");
      return mod.create(databaseUrl);
    }
    case "sqlite": {
      const mod = await import("./../drivers/sqlite.js");
      return mod.create(databaseUrl);
    }
    case "mariadb":
    case "mysql": {
      const mod = await import("./../drivers/mariadb.js");
      return mod.create(databaseUrl);
    }
    default:
      throw new Error(`Unsupported database protocol: ${protocol}`);
  }
}
