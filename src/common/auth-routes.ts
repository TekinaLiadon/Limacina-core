import { V1_API_PREFIX } from "../v1/v1-prefix";

export const AUTH_BASE_PATH = "common/auth";

export const AUTH_LOGIN_SEGMENT = "login";
export const AUTH_REGISTRATION_SEGMENT = "registration";
export const AUTH_PASSWORD_SEGMENT = "password";

const authRoute = (segment: string): string => `/${V1_API_PREFIX}/${AUTH_BASE_PATH}/${segment}`;

export const AUTH_LOGIN_ROUTE = authRoute(AUTH_LOGIN_SEGMENT);
export const AUTH_REGISTRATION_ROUTE = authRoute(AUTH_REGISTRATION_SEGMENT);
export const AUTH_PASSWORD_ROUTE = authRoute(AUTH_PASSWORD_SEGMENT);
