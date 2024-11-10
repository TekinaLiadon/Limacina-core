import { Elysia } from "elysia";
import jwt from "jsonwebtoken"

export default (app: Elysia) => {
    if ("jwt" in app.store) return app;
    const result = {
        sign: async (user = {}) => {
            return jwt.sign(user, Bun.env.JWT_KEY, { algorithm: 'RS256', expiresIn: 31536000000 }, function(err, token) {
                console.log(token);
            })
        },
        verify: async (token) => {
            return jwt.verify(token, Bun.env.JWT_KEY, {algorithm: ['RS256'],}, function (err, payload) {
                console.log(token)
            })
        },
    }
    return app.state("jwt", result);
};