import { ApiProperty } from "@nestjs/swagger";

export class LauncherPlatformDto {
  @ApiProperty()
  os!: string;

  @ApiProperty()
  arch!: string;
}

export class LauncherVersionDto {
  @ApiProperty()
  version!: string;

  @ApiProperty({ type: [LauncherPlatformDto] })
  platforms!: LauncherPlatformDto[];
}
