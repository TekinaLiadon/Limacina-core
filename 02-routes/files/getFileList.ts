
export default async function (ctx)  {
//[ "request", "store", "qi", "path", "set", "headers", "cookie", "query", "body" ]
    console.log(ctx.store)
    return ctx.store.chokidar
}