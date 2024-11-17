

export default async function* (ctx)  {
    const readStream = Bun.file('public/G.png')
    const file = await readStream.stream()
    ctx.set.headers['Connection'] = 'keep-alive'
    ctx.set.headers['Content-Length'] = readStream.size;
    ctx.set.headers['Content-Type'] = readStream.type;
    /*ctx.set.headers['Content-Disposition'] = 'attachment; filename="G.png"';*/
    console.log(ctx.set.headers, readStream.name)
    for await (const chunk of file) {
        console.log(chunk.length)
        yield `data:${chunk.toString('base64')}\n\n`
    }
}