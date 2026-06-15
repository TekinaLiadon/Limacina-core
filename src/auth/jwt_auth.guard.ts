import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class Jwt_authGuard extends AuthGuard("jwt") {}
