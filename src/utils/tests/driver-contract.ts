import { describe } from "bun:test";

export interface ContractDriver {
  driver: "map" | "postgres";
  db: boolean;
}

export const contractDrivers = (): ContractDriver[] => [
  { driver: "map", db: true },
  { driver: "postgres", db: Boolean(process.env["DATABASE_URL"]) },
];

export function contractDescribeEach(contract: string, fn: (driver: ContractDriver) => void): void {
  describe.each(contractDrivers())("$driver", (driver) => {
    describe.skipIf(!driver.db)(contract, () => fn(driver));
  });
}
