import {Elysia} from "elysia";
import router from "./router";
import {swagger} from "@elysiajs/swagger";
import {routerList} from "../02-routes/index.js";
import redis from "./redis";
import jwt from './jwt'
import chokidar from './chokidar';

const startServe = async () => {
    await routerList();
    const app = new Elysia()
        /*.use(redis)*/
        .use(router)
        .use(chokidar)
        .use(jwt)
        .onError(({error, set}) => {
            set.status = error?.code || 500;
            return {
                message: error?.message || error.toString(),
            };
        })
        .use(
            swagger({
                path: "/api",
                documentation: {
                    info: {
                        title: "Limacina Documentation",
                        version: "1.0.0",
                    },
                    tags: [{name: "Auth", description: "Эндпоинты для авторизации"}],
                },
            })
        )
        .listen(3005);
    console.log(`🦊 Сервер запущен на ${app.server?.hostname}:${app.server?.port}, файлы индексируются`);
};

startServe();











