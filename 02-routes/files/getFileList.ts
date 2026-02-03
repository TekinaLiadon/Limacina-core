
export default async function (ctx)  {
//[ "request", "store", "qi", "path", "set", "headers", "cookie", "query", "body" ]
    console.log(ctx)
    return ctx.store.chokidar
}