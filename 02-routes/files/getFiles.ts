import path from 'path';
export default async function* (ctx)  {
    //[ "request", "store", "qi", "path", "set", "headers", "cookie", "query", "body" ]
    const filePath = path.resolve(__dirname, '../../public/G.png'); // Путь к файлу
    const readStream = Bun.file(filePath)
    const file = await readStream.stream()
    ctx.set.headers['Connection'] = 'keep-alive'
    for await (const chunk of file) {
        yield `${chunk.toString('base64')}\n\n`
    }

    /*for (let i = 0; i < 10; i++) {
        yield `data: ${i}\n\n`;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }*/
    /*function sendFile(file) {
        const readStream = fs.createReadStream(file);
        readStream.on('data', (chunk) => {
            ctx.res.write(`data: ${JSON.stringify({ type: 'data', file, chunk })}\n\n`);
        });
        readStream.on('end', () => {
            ctx.res.write(`data: ${JSON.stringify({ type: 'end', file })}\n\n`);
        });
    }

    function walk(dir) {
        fs.readdir(dir, (err, files) => {
            if (err) throw err;
            files.forEach((file) => {
                const filePath = path.join(dir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) throw err;

                    if (stats.isDirectory()) {
                        walk(filePath);
                    } else {
                        sendFile(filePath);
                    }
                });
            });
        });
    }*/

    /*walk(directory);*/
}