import { Body, Controller, Get, Patch, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/roles.decorator";
import { AdminService } from "./admin.service";
import { ApproveUserDto, UnapprovedUsersQueryDto } from "./dto/dto";

@ApiTags("admin")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("unapproved")
  @ApiOperation({ summary: "Получить список неодобренных пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 50 })
  @ApiResponse({ status: 200, description: "Список неодобренных пользователей" })
  async getUnapprovedUsers(@Query() query: UnapprovedUsersQueryDto) {
    return this.adminService.findUnapprovedUsers(query.limit);
  }

  @Patch("approve")
  @ApiOperation({ summary: "Изменить статус одобрения пользователя" })
  @ApiBody({ type: ApproveUserDto })
  @ApiResponse({ status: 200, description: "Статус одобрения изменён" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setApproved(@Body() dto: ApproveUserDto) {
    await this.adminService.setApproved(dto.username, dto.approved);
    return { success: true };
  }
}
