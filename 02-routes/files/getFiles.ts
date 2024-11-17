
export default async function (ctx)  {
//[ "request", "store", "qi", "path", "set", "headers", "cookie", "query", "body" ]
    if(!ctx.body.url) throw { message: "Необходим url", code: 400 };

    return new Response(Bun.file(`public/${ctx.body.url}`))
}