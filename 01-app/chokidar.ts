import { Elysia } from "elysia";
import chokidar from "chokidar";
import {getHash} from "../06-shared/utils";

export default (app: Elysia) => {
    if ("chokidar" in app.store) return app;
    const filesHash = {}
    chokidar.watch('public', {
        interval: 10000,
        binaryInterval: 10000,
    }).on('all', async (event, path) => {
        const namePath = path.replace('public/', '')
        if(event === 'add') filesHash[namePath] = await getHash(path)
        else if (event === 'change') filesHash[namePath] = await getHash(path)
        else if (event === 'unlink') delete filesHash[namePath]
    }).on('ready', () => console.log('🦊 Индексакция файлов завершена'))
    return app.state("chokidar", filesHash);
};