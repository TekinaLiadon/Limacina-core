import { Module } from "@nestjs/common";
import { MemoryDb } from "./memory-db";

@Module({
  providers: [MemoryDb],
  exports: [MemoryDb],
})
export class MemoryModule {}
