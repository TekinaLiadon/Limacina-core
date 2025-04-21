
export default async (ctx) => {
    if(!ctx.body.url) throw { message: "Необходим url", code: 400 };
    const file = Bun.file(`public/${ctx.body.url}`);
    const stream = file.stream();
    return new Response(stream, {
        headers: {
            "Content-Type": file.type,
            'Content-Length': file.size,
        }
    });
}